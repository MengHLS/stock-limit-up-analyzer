/**
 * PARAMETER-001-PRE — 轻量性能剖析器（**默认完全关闭**）。
 *
 * ## 为什么需要它
 *
 * `BACKTEST-002` 收尾留下的 R-06：同一条真实运行链路（`Research`→`Backtest`→`Evaluation`）
 * 在 `2026-09-14` 实测 **14.3 s**，到 `2026-09-19` 变成 **593.3 s**（≈41×），且**缩短请求
 * 窗口不缩短耗时**（1 个月 616.4 s）。参数搜索要在同一条链路上跑几百次 ⇒ 先把耗时拆到
 * 阶段级是**开工前提**，而不是优化本身。
 *
 * ## 硬纪律（与 `PROJECT_RULES` 一致）
 *
 * 1. **默认零影响**：`enabled` 在模块加载时读一次环境变量。关闭时 `perfRun` / `perfRunAsync`
 *    只有一次布尔判断（不取时间、不入栈、不分配）；`perfCount` 同样是布尔短路。
 *    生产行为、业务结果、DB Schema **全部不变**。
 * 2. **不写库**：产物只进内存 + 由调用方决定落盘（JSON 文件 / stdout）。绝不进
 *    `resultJson`、绝不新增表。
 * 3. **monotonic**：一律用 `process.hrtime.bigint()`（不受系统时钟回拨影响）。
 * 4. **支持嵌套**：维护帧栈；`selfMs` = 自身墙钟 − 帧内子段时间，因此「逐决策日循环累计」
 *    与「嵌套子阶段」都能同时读出来。
 * 5. **并发诚实**：并发的子帧会让父帧的 `selfMs` 被 clamp 到 0（不伪造负数）；
 *    父帧另记 `wallMs`，并发度可据此判断（Σchildren > wall ⇒ 并行）。
 *
 * ## 开关
 *
 * | 环境变量 | 作用 |
 * |---|---|
 * | `PARAM_PROFILE=1` | 打开剖析（任何其它值/不设 = 关闭） |
 * | `PARAM_PROFILE_OUT=<path>` | 结束时写 machine-readable JSON 到该路径 |
 * | `PARAM_PROFILE_STDOUT=1` | 结束时打印人类可读 summary |
 * | `PARAM_PROFILE_MIN_MS=<n>` | summary 只列出 ≥ n ms 的节点（默认 0 = 全列） |
 * | `PARAM_PROFILE_DB=1` | 额外统计 DB 往返（由 `server/db.ts` 挂钩连接池） |
 *
 * 纯内存模块：无 IO（除调用方显式调用的 `writePerfReport`）/ 无 `Date.now` / 无随机。
 */

// ---------------------------------------------------------------------------
// 开关（模块加载时读一次）
// ---------------------------------------------------------------------------

/** 是否打印 DB 往返统计（`db.ts` 会读它决定是否挂钩连接池）。 */
export const PERF_DB_HOOK_ENABLED: boolean = process.env.PARAM_PROFILE === "1" && process.env.PARAM_PROFILE_DB !== "0";

const ENABLED = process.env.PARAM_PROFILE === "1";

/** 剖析是否开启（关闭时全部入口退化为直通）。 */
export function isPerfProfilingEnabled(): boolean {
  return ENABLED;
}

// ---------------------------------------------------------------------------
// 计时原语
// ---------------------------------------------------------------------------

interface PerfNode {
  label: string;
  /** 该节点自身帧的墙钟累计（ms）。 */
  wallMs: number;
  /** 自身帧墙钟 − 帧内子帧墙钟（clamp ≥ 0）。 */
  selfMs: number;
  /** 进入次数。 */
  calls: number;
  children: Map<string, PerfNode>;
}

interface Frame {
  node: PerfNode;
  startNs: bigint;
  childNs: bigint;
}

const root: PerfNode = { label: "PROFILE_TOTAL", wallMs: 0, selfMs: 0, calls: 0, children: new Map() };
const stack: Frame[] = [];
/** 计数量（不是时间）：调用次数、行数、往返数… */
const counters = new Map<string, number>();
/** 一次性刻度（ms）：由调用方直接报数（如已测好的子步骤）。 */
const marks = new Map<string, number>();

function nanosecondsSince(startNs: bigint): number {
  return Number(process.hrtime.bigint() - startNs) / 1e6;
}

function createNode(parent: PerfNode, label: string): PerfNode {
  const existing = parent.children.get(label);
  if (existing !== undefined) return existing;
  const created: PerfNode = { label, wallMs: 0, selfMs: 0, calls: 0, children: new Map() };
  parent.children.set(label, created);
  return created;
}

function enter(label: string): Frame {
  const parent = stack.length === 0 ? root : stack[stack.length - 1]!.node;
  const node = createNode(parent, label);
  const frame: Frame = { node, startNs: process.hrtime.bigint(), childNs: 0n };
  stack.push(frame);
  return frame;
}

function exit(frame: Frame): void {
  const elapsedNs = process.hrtime.bigint() - frame.startNs;
  const elapsedMs = Number(elapsedNs) / 1e6;
  frame.node.wallMs += elapsedMs;
  frame.node.calls += 1;
  frame.node.selfMs += Math.max(0, Number(elapsedNs - frame.childNs) / 1e6);
  // 弹出（容错：若因异常导致栈错位，这里只弹到该帧为止）
  const index = stack.lastIndexOf(frame);
  if (index >= 0) stack.length = index;
  if (stack.length > 0) stack[stack.length - 1]!.childNs += elapsedNs;
}

// ---------------------------------------------------------------------------
// 公开入口
// ---------------------------------------------------------------------------

/** 计一个同步段。关闭时 = 直接调用。 */
export function perfRun<T>(label: string, fn: () => T): T {
  if (!ENABLED) return fn();
  const frame = enter(label);
  try {
    return fn();
  } finally {
    exit(frame);
  }
}

/** 计一个异步段（`await` 链上的墙钟也算进去，含等待 DB 的 I/O 时间）。 */
export async function perfRunAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return await fn();
  const frame = enter(label);
  try {
    return await fn();
  } finally {
    exit(frame);
  }
}

/** 剖析帧（`perfBegin` 的返回值；只能交给 `perfEnd`）。 */
export interface PerfFrame {
  readonly __perfFrame: true;
}

/** 显式开启一段（用于「无法自然包成函数」的多语句区间，避免为埋点重排缩进）。 */
export function perfBegin(label: string): PerfFrame {
  if (!ENABLED) return { __perfFrame: true };
  enter(label);
  return { __perfFrame: true };
}

/**
 * 关闭由 `perfBegin` 开启的段。
 *
 * 取**栈顶**而不是要求调用方持有帧对象：这样埋点是「一对括线」，读起来就是
 * 「这一段从这到那」，且不会因中间出现分支而配错帧。
 */
export function perfEnd(_frame?: PerfFrame): void {
  if (!ENABLED) return;
  const top = stack[stack.length - 1];
  if (top === undefined) return;
  exit(top);
}

/** 计数器（次数 / 行数 / 往返数…）。关闭时 = 布尔短路。 */
export function perfCount(name: string, delta = 1): void {
  if (!ENABLED) return;
  counters.set(name, (counters.get(name) ?? 0) + delta);
}

/** 直接报一个已测好的毫秒刻度（累加到同名的 mark 键上）。 */
export function perfMark(label: string, ms: number): void {
  if (!ENABLED) return;
  marks.set(label, (marks.get(label) ?? 0) + ms);
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

export interface PerfFlatEntry {
  label: string;
  wallMs: number;
  selfMs: number;
  calls: number;
}

export interface PerfReport {
  generatedAt: string;
  totalMs: number;
  counters: Record<string, number>;
  marks: Record<string, number>;
  /** 按「标签路径」展平的耗时表（wallMs 降序）。 */
  stages: PerfFlatEntry[];
  /** 嵌套树（供机器读；节点只含自身标签，路径用 `/` 连接）。 */
  tree: PerfTreeNode;
}

export interface PerfTreeNode {
  label: string;
  wallMs: number;
  selfMs: number;
  calls: number;
  children: PerfTreeNode[];
}

function flatten(node: PerfNode, prefix: string, out: PerfFlatEntry[]): void {
  const path = prefix === "" ? node.label : `${prefix}/${node.label}`;
  if (node !== root) {
    out.push({ label: path, wallMs: round6(node.wallMs), selfMs: round6(node.selfMs), calls: node.calls });
  }
  for (const child of node.children.values()) flatten(child, path, out);
}

function toTree(node: PerfNode): PerfTreeNode {
  return {
    label: node.label,
    wallMs: round6(node.wallMs),
    selfMs: round6(node.selfMs),
    calls: node.calls,
    children: [...node.children.values()].map(toTree),
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** 取当前累计快照（可在运行中途调用）。 */
export function perfSnapshot(): PerfReport {
  const stages: PerfFlatEntry[] = [];
  flatten(root, "", stages);
  stages.sort((a, b) => b.wallMs - a.wallMs);
  return {
    generatedAt: new Date().toISOString(),
    totalMs: round6(root.wallMs),
    counters: Object.fromEntries([...counters.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    marks: Object.fromEntries([...marks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    stages,
    tree: toTree(root),
  };
}

/** 复位（同一进程内跑多轮对照时用；只清计数与树，不碰环境变量）。 */
export function perfReset(): void {
  if (!ENABLED) return;
  root.wallMs = 0;
  root.selfMs = 0;
  root.calls = 0;
  root.children.clear();
  stack.length = 0;
  counters.clear();
  marks.clear();
}

/** 人类可读 summary（缩进按路径深度）。 */
export function formatPerfReport(report: PerfReport = perfSnapshot(), minMs?: number): string {
  const threshold = minMs ?? Number(process.env.PARAM_PROFILE_MIN_MS ?? 0);
  const lines: string[] = [];
  lines.push("=".repeat(96));
  lines.push(`PROFILE TOTAL = ${report.totalMs.toFixed(1)} ms`);
  lines.push("=".repeat(96));
  lines.push(pad("stage", 58) + pad("wall(ms)", 12) + pad("self(ms)", 12) + pad("%tot", 8) + "calls");
  for (const stage of report.stages) {
    if (stage.wallMs < threshold) continue;
    const pct = report.totalMs > 0 ? (stage.wallMs / report.totalMs) * 100 : 0;
    lines.push(
      pad(stage.label, 58) +
        pad(stage.wallMs.toFixed(1), 12) +
        pad(stage.selfMs.toFixed(1), 12) +
        pad(pct.toFixed(1) + "%", 8) +
        String(stage.calls),
    );
  }
  if (Object.keys(report.counters).length > 0) {
    lines.push("-".repeat(96));
    lines.push("counters:");
    for (const [key, value] of Object.entries(report.counters)) lines.push(`  ${pad(key, 56)}${value}`);
  }
  if (Object.keys(report.marks).length > 0) {
    lines.push("-".repeat(96));
    lines.push("marks (ms):");
    for (const [key, value] of Object.entries(report.marks)) lines.push(`  ${pad(key, 56)}${value.toFixed(1)}`);
  }
  return lines.join("\n");
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width - 1) + " " : text + " ".repeat(width - text.length);
}

/**
 * 把报告输出到 `PARAM_PROFILE_OUT`（JSON）与/或 stdout，供探针在运行结束时调用一次。
 *
 * 刻意不由本模块自动挂 `process.on("exit")`：显式调用更可控（探针自己在 finally 里调），
 * 也避免在测试 / 服务器进程里产生意料之外的写文件副作用。
 */
export function emitPerfReport(label = "PARAM-PROFILE", minMs?: number): PerfReport {
  const report = perfSnapshot();
  if (process.env.PARAM_PROFILE_STDOUT === "1") {
    console.log(`\n[${label}] ${formatPerfReport(report, minMs)}`);
  }
  return report;
}
