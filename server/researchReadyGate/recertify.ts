/**
 * 数据域认证（gate 快照）重跑 —— 服务端唯一触发器。
 *
 * 背景（2026-09-13 实查）：`docs/researchReadyGate/research_ready_gate.json` 的**唯一生产者**是
 * `scripts/step12_certify_gate.mjs`（只读 TiDB 的独立 CLI）。此前整条链路**没有任何非人工入口**：
 *   - `scripts/orchestrate_backfill.mjs` 收尾不调用它 ⇒ 回填完成认证快照不变；
 *   - `server/dataHealthRouter.ts` 只有只读 query ⇒ 页面无从重跑；
 *   - 页面「刷新」只重读同一个 JSON ⇒ 看起来在重认证，其实什么都没算。
 * 本模块补的正是「服务端可触发」这一环，并且**只做一件事**：以服务端身份执行那条既有命令。
 *
 * 纪律（越界即错）：
 * - **判定逻辑零复制**：本模块不重写 17 项判定，**唯一 SoT 仍是那个脚本**。脚本改口径，本模块自动跟随；
 * - **禁伪造**：脚本非 0 退出 / 超时 / 产物缺失 / schema 校验失败 ⇒ `ok:false` 且 `snapshot` 为 null，
 *   **绝不返回任何 PASS 声明**，也**不写任何文件**（gate 文件只有脚本能写）；
 * - **不接收判定入参**：本函数签名里没有任何字段能让调用方指定状态；
 * - **串行化**：脚本用 `writeFileSync` 覆盖同一 JSON，两次运行交叠会让读者读到半截文件
 *   （页面会显示「解析失败」）。故进程内单飞（single-flight）：并发触发共享同一次运行；
 * - **为什么用子进程而不是把逻辑搬进 server**：
 *   ① 脚本自带独立 mysql 连接，天然规避本仓已知地雷「连接池 maxIdle === connectionLimit
 *      ⇒ 空闲回收失效 ⇒ 死连接被原样发出（read ECONNRESET）」；
 *   ② 搬进 server 会形成「脚本 / 服务端两份判定」，与唯一 SoT 纪律冲突（漂移不可检）。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_EVIDENCE_PATH, PROJECT_ROOT } from "../dataHealth";
import {
  RECERTIFY_MANUAL_COMMAND,
  RECERTIFY_SCRIPT_REL,
  researchReadyGateFileSchema,
  type RecertifyGateResult,
} from "../../shared/dataHealthContracts";

// ---------------------------------------------------------------------------
// 坐标
// ---------------------------------------------------------------------------

/** 脚本绝对路径（相对本模块定位；与服务端打包后的路径假设同 pythonBridge，见其注释）。 */
const SCRIPT_ABS = fileURLToPath(new URL("../../scripts/step12_certify_gate.mjs", import.meta.url));

/** 产物绝对路径（与 `dataHealth.ts` 的读取坐标同源，不另立一套）。 */
const EVIDENCE_ABS = join(PROJECT_ROOT, GATE_EVIDENCE_PATH);

/** 默认超时：脚本含多轮 COUNT / GROUP BY，给足余量；超时即如实失败，不自动重试。 */
export const RECERTIFY_TIMEOUT_MS = 300_000;

/** stdout / stderr 回传上限（排障够用，且不把大输出塞进 RPC）。 */
const OUTPUT_TAIL_CHARS = 2_000;

// ---------------------------------------------------------------------------
// 子进程执行
// ---------------------------------------------------------------------------

interface SpawnOutcome {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** execFile 的 error 里与「退出码 / 超时」相关的字段（Node 类型未完整给出）。 */
interface ExecFileFailure extends NodeJS.ErrnoException {
  killed?: boolean;
  signal?: string | null;
}

function defaultRunScript(timeoutMs: number): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    execFile(
      // 用当前 node 二进制（而非裸 `node`）：不依赖 PATH，且与 .mjs 的运行期完全一致。
      process.execPath,
      [SCRIPT_ABS],
      {
        cwd: PROJECT_ROOT,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const e = error as ExecFileFailure | null;
        resolve({
          // 正常退出 → 0；非 0 退出 → 数字退出码；spawn 失败（如 ENOENT）或被杀 → null。
          exitCode: e === null ? 0 : typeof e.code === "number" ? e.code : null,
          timedOut: Boolean(e && (e.killed === true || e.signal === "SIGTERM")),
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

async function defaultReadEvidence(): Promise<string> {
  return readFile(EVIDENCE_ABS, "utf8");
}

const tail = (s: string): string =>
  s.length <= OUTPUT_TAIL_CHARS ? s : s.slice(-OUTPUT_TAIL_CHARS);

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 可注入依赖：**仅供单测**使用（默认全部走真实脚本与真实产物文件）。
 * 生产调用一律不传，避免出现「可替换判定来源」的口子。
 */
export interface RecertifyDeps {
  runScript?: () => Promise<SpawnOutcome>;
  readEvidence?: () => Promise<string>;
  scriptExists?: () => boolean;
  timeoutMs?: number;
}

/** 失败结果的公共骨架（`ok` 由调用点按实际情况覆写；`snapshot` 恒为 null）。 */
function failure(
  error: string,
  extra: {
    exitCode?: number | null;
    timedOut?: boolean;
    durationMs: number;
    stdoutTail?: string;
    stderrTail?: string;
  },
): RecertifyGateResult {
  return {
    ok: false,
    exitCode: extra.exitCode ?? null,
    timedOut: extra.timedOut ?? false,
    durationMs: extra.durationMs,
    sharedWithInFlight: false,
    script: RECERTIFY_SCRIPT_REL,
    manualCommand: RECERTIFY_MANUAL_COMMAND,
    error,
    snapshot: null,
    stdoutTail: extra.stdoutTail ?? "",
    stderrTail: extra.stderrTail ?? "",
  };
}

async function runOnce(deps: RecertifyDeps): Promise<RecertifyGateResult> {
  const startedAt = Date.now();
  const timeoutMs = deps.timeoutMs ?? RECERTIFY_TIMEOUT_MS;

  const present = (deps.scriptExists ?? ((): boolean => existsSync(SCRIPT_ABS)))();
  if (!present) {
    return failure(
      `认证脚本不存在：${RECERTIFY_SCRIPT_REL}。服务端不会自行计算 gate 判定，` +
        `请在仓库根执行等价命令：${RECERTIFY_MANUAL_COMMAND}`,
      { durationMs: Date.now() - startedAt },
    );
  }

  const outcome = await (deps.runScript ?? ((): Promise<SpawnOutcome> => defaultRunScript(timeoutMs)))();
  const stdoutTail = tail(outcome.stdout);
  const stderrTail = tail(outcome.stderr);
  const probe = { exitCode: outcome.exitCode, stdoutTail, stderrTail };

  if (outcome.timedOut) {
    return failure(
      `认证脚本超时（> ${Math.round(timeoutMs / 1000)}s）已终止；本次不产生任何认证结论`,
      { ...probe, timedOut: true, durationMs: Date.now() - startedAt },
    );
  }

  if (outcome.exitCode !== 0) {
    return failure(
      `认证脚本非 0 退出（exitCode=${outcome.exitCode ?? "null"}）；本次不产生任何认证结论`,
      { ...probe, durationMs: Date.now() - startedAt },
    );
  }

  let raw: string;
  try {
    raw = await (deps.readEvidence ?? defaultReadEvidence)();
  } catch (e) {
    return failure(`认证脚本已成功退出，但产物读取失败：${describe(e)}`, {
      ...probe,
      durationMs: Date.now() - startedAt,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return failure(`产物 JSON 解析失败：${describe(e)}`, {
      ...probe,
      durationMs: Date.now() - startedAt,
    });
  }

  const parsed = researchReadyGateFileSchema.safeParse(json);
  if (!parsed.success) {
    return failure(`产物 schema 校验失败：${parsed.error.message}`, {
      ...probe,
      durationMs: Date.now() - startedAt,
    });
  }

  const gate = parsed.data;
  return {
    ok: true,
    exitCode: 0,
    timedOut: false,
    durationMs: Date.now() - startedAt,
    sharedWithInFlight: false,
    script: RECERTIFY_SCRIPT_REL,
    manualCommand: RECERTIFY_MANUAL_COMMAND,
    error: null,
    snapshot: {
      capturedAt: gate.capturedAt,
      researchReady: gate.researchReady,
      dataFoundationReady: gate.dataFoundationReady ?? null,
      productionReady: gate.productionReady ?? null,
      summary: gate.summary,
      gates: gate.gates ?? null,
    },
    stdoutTail,
    stderrTail,
  };
}

/** 在途运行的句柄（并发触发共享同一次运行，避免交叠写同一 JSON）。 */
let inFlight: Promise<RecertifyGateResult> | null = null;

/**
 * 单飞门（single-flight）：无在途运行时才真正执行 `execute`；否则复用同一份结果，
 * 并把 `sharedWithInFlight` 标为 true。
 *
 * 独立导出是为了让「并发收敛」这一机制能被单测直接驱动 ——
 * 否则只能靠真起子进程来验证，而真起子进程会触发真实查库（不该出现在单测里）。
 */
export function recertifySingleFlight(
  execute: () => Promise<RecertifyGateResult>,
): Promise<RecertifyGateResult> {
  if (inFlight) {
    return inFlight.then((r) => ({ ...r, sharedWithInFlight: true }));
  }

  const pending = execute().finally(() => {
    inFlight = null;
  });
  inFlight = pending;
  return pending;
}

/**
 * 重跑数据域认证，返回如实结果。
 *
 * `deps` 仅单测使用（默认走真实脚本与真实产物文件）；无论是否注入，都经同一道单飞门。
 */
export function recertifyResearchReadyGate(deps?: RecertifyDeps): Promise<RecertifyGateResult> {
  return recertifySingleFlight(() => runOnce(deps ?? {}));
}
