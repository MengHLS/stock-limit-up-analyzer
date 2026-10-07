/**
 * STEP 7.3 扩展 — BaoStock 驻留会话客户端。
 *
 * BaoStock 免费接口没有「全市场单日」端点，只能逐票调用 `query_history_k_data_plus`。
 * 逐票若「每股 spawn 新进程 + login/logout」（每次 ~1-2s 固定开销），全市场回填不可行；
 * 故复用 `scripts/providers/baostock_probe.py` 的 `session` 驻留模式：login 一次，
 * stdin/stdout 走 JSONL 请求/响应。
 *
 * 可靠性：
 *   - 请求级超时看门狗：超时即 kill 会话，本请求抛错、下个请求自动重启（重新 login）；
 *   - 子进程异常退出：所有 in-flight reject，下个请求自动重生；
 *   - BaoStock「单账号单活跃会话」约束由「同一时刻只有一个驻留子进程」保证。
 *
 * 与 `scripts/backfillStatusLiquidity.ts` 内的 BaostockSession 语义一致（该脚本为运维脚本、
 * 刻意不共享本模块，避免改动正在运行的长任务）。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_PROBE_SCRIPT = fileURLToPath(new URL("../../../scripts/providers/baostock_probe.py", import.meta.url));

/** 默认 python 解释器解析顺序（与既有 pythonBridge 约定一致）。 */
export function resolveBaostockPython(env: NodeJS.ProcessEnv = process.env): string {
  return env.MARKETDATA_PYTHON ?? env.BAOSTOCK_PYTHON ?? "python";
}

/**
 * 会话已失效/服务端拒答的错误特征。
 *
 * 实测（2026-10-06）：长驻会话跑约 3000+ 次请求后，BaoStock 会开始对**每次**请求返回
 * 「网络接收错误」（Python 侧 rs.error_code != 0），此时进程仍存活、但底层连接已废——
 * 单纯重试无效。检测到这些特征即 kill 会话，让下一个请求重新 spawn（重新 login）。
 */
const SESSION_BROKEN_PATTERN = /网络接收错误|未登录|login|logout|session|timeout|连接|connect|socket|network/i;

export interface BaostockSessionOptions {
  pythonPath?: string;
  probeScriptPath?: string;
  requestTimeoutMs?: number;
  warn?: (message: string) => void;
}

export class BaostockSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stderrTail = "";
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void; timer: NodeJS.Timeout }
  >();
  private nextId = 1;

  private readonly pythonPath: string;
  private readonly probeScriptPath: string;
  private readonly requestTimeoutMs: number;
  private readonly warn: (message: string) => void;

  constructor(options: BaostockSessionOptions = {}) {
    this.pythonPath = options.pythonPath ?? resolveBaostockPython();
    this.probeScriptPath = options.probeScriptPath ?? DEFAULT_PROBE_SCRIPT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  /** 会展话未存活则 spawn（login 在 Python 侧启动即执行）。 */
  private ensureAlive(): void {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) return;
    this.child = spawn(this.pythonPath, [this.probeScriptPath, "session"], {
      env: process.env,
      windowsHide: true,
    });
    this.stdoutBuffer = "";
    this.stderrTail = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-2000);
    });
    this.child.on("error", (error) => {
      this.rejectAll(new Error(`baostock session spawn error: ${error.message}`));
      this.child = null;
    });
    this.child.on("exit", (code, signal) => {
      const error = new Error(
        `baostock session exited code=${code} signal=${signal ?? ""}${this.stderrTail ? ` stderr=${this.stderrTail.slice(-300)}` : ""}`,
      );
      this.rejectAll(error);
      this.child = null;
    });
  }

  private rejectAll(error: unknown): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message: { id?: number; ok?: boolean; result?: unknown; error?: string };
      try {
        message = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string };
      } catch {
        continue; // Python 侧 login/logout 打印已被 redirect，非 JSON 行理论上不出现
      }
      if (message.id === undefined) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        const errorText = message.error ?? "baostock session request error";
        // 会话已废：kill 让下个请求重新 login（否则会一直对同一失效连接重试）。
        if (SESSION_BROKEN_PATTERN.test(errorText)) {
          this.kill(`会话失效（${errorText.slice(0, 60)}）`);
        }
        pending.reject(new Error(errorText));
      }
    }
  }

  /** 发送一个请求并同步等待对应 id 的响应；超时/崩溃时本请求抛错，会话由下个请求重生。 */
  request<T>(request: Record<string, unknown>): Promise<T> {
    this.ensureAlive();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill("request timeout");
        reject(new Error(`baostock session request timeout (${this.requestTimeoutMs}ms): ${JSON.stringify(request)}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      const payload = `${JSON.stringify({ id, ...request })}\n`;
      try {
        this.child!.stdin.write(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.kill("stdin write failed");
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private kill(reason: string): void {
    try {
      this.child?.kill();
    } catch {
      // 已退出则忽略
    }
    this.child = null;
    if (reason !== "closed") this.warn(`  [baostock session] ${reason}，下个请求将自动重启`);
  }

  /** 关闭驻留会话（进程退出/任务结束必须调用，避免悬挂 login 会话）。 */
  async close(): Promise<void> {
    this.kill("closed");
  }
}

let sharedSession: BaostockSession | null = null;

/** 进程级共享会话（多次逐票取数复用同一 login）。 */
export function getSharedBaostockSession(options?: BaostockSessionOptions): BaostockSession {
  if (!sharedSession) sharedSession = new BaostockSession(options);
  return sharedSession;
}

/** 关闭并清空共享会话。 */
export async function closeSharedBaostockSession(): Promise<void> {
  if (!sharedSession) return;
  await sharedSession.close();
  sharedSession = null;
}