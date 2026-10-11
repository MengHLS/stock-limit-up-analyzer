/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` · 运行工具（SMOKE / STUDY）。
 *
 * ```bash
 * # SMOKE（两组 × (R + 2 随机) = 6 账户；**不持久化**）—— 本轮显式政策
 * node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolRecoveryStRun.mts --mode smoke --st-policy known-st-only
 *
 * # STUDY（两组 × (R + 20 随机) = 42 账户；经既有 startRun 入口持久化）—— 本轮显式政策
 * node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolRecoveryStRun.mts --mode study --st-policy known-st-only
 *
 * # 原严格政策（缺省；004 口径）
 * node --max-old-space-size=12288 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolRecoveryStRun.mts --mode smoke --st-policy strict
 * ```
 *
 * ## 🔴 `--st-policy` 的两种取值（**参数非法即拒绝启动**）
 *
 * | 值 | 政策 | 语义 |
 * |---|---|---|
 * | `strict`（缺省） | `STRICT_VERIFIED_NORMAL_ONLY` | 只认可 PIT 可核验 `NORMAL`；`ST` / `UNKNOWN` 一律拒绝；缺可核验结论 ⇒ `ST_COVERAGE_BLOCKED` |
 * | `known-st-only` | `KNOWN_ST_ONLY_EXPLORATORY` / `recovery-known-st-only/1.0.0` | **用户授权的探索性变体**：`UNKNOWN` 可参与，仅排除已有历史记录中的 `ST`；**不是**严格 PIT |
 *
 * ## 输出目录
 *
 * `_scratch/fbp8/`（**SORT-PARITY-008 的新目录**）—— **不覆盖** `_scratch/fbp7/`（007 交付）
 * 与 `_scratch/fbp4/`（004 交付）的历史产物：旧报告 / 旧 Run / 旧产物一律保持不变。
 *
 * ## 终态与退出码
 *
 * | 终态（§8） | 退出码 |
 * |---|---|
 * | `EXPLORATORY_COMPLETED`（产出矩阵 + 统计） | `0` |
 * | `SMOKE_ENGINEERING_FAILED` / `EXECUTION_FAILED`（工程失败） | `1` |
 * | `ST_COVERAGE_BLOCKED`（**仅严格模式**的合法暂停） | `3` |
 * | `DATA_LIMITED`（实际缺数据使指标无法完整计算） | `4` |
 *
 * ## 🔴 `SORT-PARITY-008` §5：SMOKE 必须跑**既有发布预算校验**
 *
 * 本地落盘成功**不**证明发布通过（007 的 42 账户就是这么被误导的：算完了、本地有产物、
 * Run 却是 `FAILED` / `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`）。因此 SMOKE 在写完本地产物之后
 * 还会用**平台既有**的 `validatePublishLimits` + `publishRunArtifacts`（**内存** ArtifactStorage）
 * 对**同一组实际产物**做一次预算校验与逐对象读回：
 *   - 件数 / 单件 / 总量 / result.json 体积全部按平台既有规则计算；
 *   - 每个 `.csv.gz` 解压后 SHA-256 必须等于压缩索引里的 `originalSha256`；
 *   - manifest 可定位、每个对象可读回。
 * 任一不满足 ⇒ 本轮 SMOKE 记为工程失败（exit 1）。
 *
 * ## 纪律
 *
 * - 只读 Dataset；`--mode` 只有 `smoke`(2) / `study`(20) 两档，**不自动扩跑**；
 * - SMOKE 只验工程正确，**不做收益筛选**；STUDY 无论方向好坏只完整执行一次；
 * - 🔴 **收益差不是是否继续 STUDY 的判断条件**；
 * - 🔴 未知 ST 状态**本身不是**停止条件（用户已确认的本轮政策）；
 *   停止条件限于：实际工程失败、非法资金/仓位、**已知 ST 买入**、冻结价格/排序/退出漂移、
 *   真实执行数据无法支持指标。
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultExperimentRunner, defaultExperimentRunService } from "../../server/researchExperiments/defaults";
import {
  verifyDeliveryBudgetAndReadBack,
  type DeliveryBudgetReport,
} from "../../research-experiments/first-board-pullback/rolling-pool-recovery-st/deliveryVerification";
import {
  ST_POLICY_DEFAULT_VALUE,
  ST_POLICY_PARAMETER_CODE,
  ST_POLICY_PARAMETER_VALUES,
  resolveStEligibilityPolicy,
} from "../../research-experiments/shared/rollingPoolRecovery";

const EXPERIMENT_ID = "first-board-pullback/rolling-pool-recovery-st";
const DATASET_VERSION_ID = 780_004;
/**
 * 🔴 `SORT-PARITY-008` 的**新**输出目录。
 *
 * 刻意**不**复用 `_scratch/fbp7/`：那一份是 007（代码顺序缺陷版本）的交付，
 * 必须原样保留以便对比；本轮产物一律写到 `fbp8/`。
 */
const OUT_DIR = new URL("../../_scratch/fbp8/", import.meta.url);

/** 两档模式的随机账户数（**冻结**：2 ⇒ 6 账户；20 ⇒ 42 账户）。 */
const MODE_RANDOM_ACCOUNT_COUNT: Readonly<Record<string, number>> = Object.freeze({
  smoke: 2,
  study: 20,
});

/** 终态退出码。 */
const EXIT_MATRIX_EMITTED = 0;
const EXIT_ENGINEERING_FAILURE = 1;
const EXIT_ST_COVERAGE_BLOCKED = 3;
const EXIT_DATA_LIMITED = 4;

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : null;
}

function save(name: string, value: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(new URL(name, OUT_DIR), JSON.stringify(value, null, 2));
}

function saveArtifacts(
  files: readonly { readonly name: string; readonly body: string | Uint8Array }[],
  subdirectory: string,
): void {
  const target = new URL(`./${subdirectory}/`, OUT_DIR);
  mkdirSync(target, { recursive: true });
  for (const file of files) {
    const body = typeof file.body === "string" ? file.body : Buffer.from(file.body);
    writeFileSync(new URL(file.name, target), body);
  }
}

interface TerminalReport {
  readonly exitCode: number;
  readonly terminalState: string;
  readonly engineeringChecks: readonly string[];
  readonly engineeringFailures: readonly string[];
}

/**
 * 终止态判定与摘要打印（**唯一**的收口点）。
 *
 * 🔴 工程自检（不是研究判据）：矩阵已产出、账户数正确、每组件数齐全、
 *    **已知 ST 买入 = 0**（两种政策都必须为 0）、UNKNOWN 状态在审计里被保留。
 */
function reportTerminalState(args: {
  readonly label: string;
  readonly mode: "smoke" | "study";
  readonly expectedTotalAccounts: number;
  readonly runStatus: string;
  /**
   * 🔴 **持久化 Run** 的真实状态（仅 STUDY 有；SMOKE 不持久化 ⇒ `null`）。
   *
   * 为什么必须单独看它：`outcome.runStatus` 是**执行器**的结果（实验算完了就是 SUCCEEDED），
   * 而 Run 行可能因为**产物写入失败**被标记为 FAILED（实测：
   * `EXPERIMENT_ARTIFACT_LIMIT_EXCEEDED`，单文件上限 64 MiB，`observation-repair-ledger-*`
   * 与 `opportunity-day-attribution.csv` 都超限）⇒ 此时 `resultManifestKey = null`，
   * 交付物**根本读不回来**。只看执行器结果会得出「EXPLORATORY_COMPLETED + exit 0」的**假成功**。
   */
  readonly persistedRunStatus: string | null;
  readonly persistedRunError: string | null;
  readonly persistedRunId: string | null;
  readonly error: unknown;
  readonly customPayload: unknown;
  readonly logs: readonly string[];
}): TerminalReport {
  for (const line of args.logs) console.log(`  ${line}`);
  if (args.runStatus !== "SUCCEEDED" || args.error !== null) {
    console.error(
      `[recovery-light-st] ${args.label} 工程失败：runStatus=${args.runStatus} error=${JSON.stringify(args.error)}`,
    );
    return {
      exitCode: EXIT_ENGINEERING_FAILURE,
      terminalState: args.mode === "smoke" ? "SMOKE_ENGINEERING_FAILED" : "EXECUTION_FAILED",
      engineeringChecks: [],
      engineeringFailures: [`runStatus=${args.runStatus}`],
    };
  }
  /**
   * 🔴 持久化失败 = 工程失败（**不得**被「矩阵已算出」掩盖）。
   *
   * 实测教训（`RECOVERY-LIGHT-ST-007` 首次 STUDY）：42 账户全部跑完、矩阵全部算出，
   * 但产物 `observation-repair-ledger-A_STRICT_20-2024.csv`（99,097,445 B）超过平台单文件上限
   * 67,108,864 B ⇒ Run 记为 `FAILED` / `resultManifestKey = null`；
   * 旧版工具只读 `outcome.runStatus`，于是打印 ✅ 并 **exit 0**。
   *
   * 🔴 `SORT-PARITY-008` 修正（**工具缺陷，不是研究参数变化**）：
   *    持久化 Run 的**生命周期**词表是 `PENDING → RUNNING → {COMPLETED|FAILED}`
   *    （`server/researchExperiments/persistence/runRepository.ts`），而 `SUCCEEDED` 属于
   *    **执行器**结论词表（`EXPERIMENT_RUN_STATUSES`）。旧判据把两者混用 ⇒
   *    一条**真正成功**的 `COMPLETED` Run 会被误报成「交付失败」（008 首跑实测：42 账户全部
   *    算完、manifest 已写、`resultManifestKey` 非空，工具却 exit 1）。
   *    成功判据 = 生命周期 `COMPLETED` —— `markCompleted` 在**结构上**要求非空 Manifest Key，
   *    所以 `COMPLETED` 本身就同时证明「有 manifest 且对象已上传并通过存在性验证」。
   */
  const PERSISTED_RUN_SUCCESS_STATUS = "COMPLETED";
  if (args.persistedRunStatus !== null && args.persistedRunStatus !== PERSISTED_RUN_SUCCESS_STATUS) {
    console.error(
      `[recovery-light-st] ❌ 工程自检失败：持久化 Run ${String(args.persistedRunId)} `
      + `status=${args.persistedRunStatus}（执行器结论=${args.runStatus}，两者不一致 ⇒ 交付物不可读）。`,
    );
    if (args.persistedRunError !== null) {
      console.error(`[recovery-light-st]    原因：${args.persistedRunError}`);
    }
    return {
      exitCode: EXIT_ENGINEERING_FAILURE,
      terminalState: "EXECUTION_FAILED",
      engineeringChecks: [
        `runId=${String(args.persistedRunId)}`,
        `outcome.runStatus=${args.runStatus}`,
        `persistedRun.status=${args.persistedRunStatus}`,
      ],
      engineeringFailures: [
        `持久化 Run status=${args.persistedRunStatus}`
        + (args.persistedRunError === null ? "" : `（${args.persistedRunError}）`),
      ],
    };
  }
  const custom = (args.customPayload ?? {}) as Record<string, unknown>;
  const status = custom.status ?? "(未声明)";
  const matrixEmittedDeclared = custom.matrixEmitted === true;
  const terminalStateDeclared = typeof custom.terminalState === "string"
    ? custom.terminalState
    : null;
  /**
   * 🔴 终态与「矩阵是否产出」必须**互相印证**（`RECOVERY-LIGHT-ST-007`）：
   *    `terminalState ∈ {EXPLORATORY_COMPLETED, DATA_LIMITED}` ⇔ `matrixEmitted === true`。
   *    两者不一致 ⇒ 工程失败（**不**静默取其中一个）。这正是 SMOKE 闸门要抓的那类缺陷：
   *    旧代码从不产出矩阵 ⇒ 从未写过这两个字段，「跑成功」与「刻意暂停」在信封上无法区分。
   */
  const terminalImpliesMatrix = terminalStateDeclared === "EXPLORATORY_COMPLETED"
    || terminalStateDeclared === "DATA_LIMITED";
  if (matrixEmittedDeclared !== terminalImpliesMatrix) {
    console.error(
      `[recovery-light-st] ❌ 工程自检失败：matrixEmitted=${String(custom.matrixEmitted)} 与 `
      + `terminalState=${String(terminalStateDeclared)} 不一致（两者必须互相印证）。`,
    );
    return {
      exitCode: EXIT_ENGINEERING_FAILURE,
      terminalState: args.mode === "smoke" ? "SMOKE_ENGINEERING_FAILED" : "EXECUTION_FAILED",
      engineeringChecks: [`matrixEmitted=${String(custom.matrixEmitted)}`, `terminalState=${String(terminalStateDeclared)}`],
      engineeringFailures: ["matrixEmitted 与 terminalState 不一致（终态信封不自洽）"],
    };
  }
  const matrixEmitted = matrixEmittedDeclared;
  console.log(
    `[recovery-light-st] ${args.label} 终态 status=${String(status)} `
    + `matrixEmitted=${String(matrixEmitted)} terminalState=${String(terminalStateDeclared ?? "(未声明)")}`,
  );

  if (!matrixEmitted) {
    const blocked = (custom.stCoverageBlocked ?? {}) as Record<string, unknown>;
    const provider = (custom.stProvider ?? {}) as Record<string, unknown>;
    console.error(
      "[recovery-light-st] 🔴 ST_COVERAGE_BLOCKED：**没有产出收益矩阵**（严格模式按目标 §4 默认条款刻意暂停）。\n"
      + `  计划候选 ${String(blocked.plannedCandidateCount ?? "?")} 个，其中 UNKNOWN_BLOCKED `
      + `${String(blocked.unknownBlockedCandidateCount ?? "?")} 个；`
      + `检查点 ${String(blocked.timepointChecks ?? "?")} 格（UNKNOWN ${String(blocked.unknownTimepointCheckCount ?? "?")}）；\n`
      + `  逐时点 ${JSON.stringify(blocked.unknownByTimepoint ?? {})}；逐原因 ${JSON.stringify(blocked.unknownByReason ?? {})}；\n`
      + `  缺失的 provider 身份 = ${String(provider.providerId ?? blocked.providerId ?? "?")}`
      + `（verifiable=${String(provider.verifiable ?? blocked.providerVerifiable ?? "?")}）；\n`
      + `  阻断原因：${JSON.stringify(blocked.blockedReasons ?? [])}\n`
      + "  ⇒ 该终态属于**严格模式**；本轮轻量政策请显式传 `--st-policy known-st-only`。",
    );
    return {
      exitCode: EXIT_ST_COVERAGE_BLOCKED,
      terminalState: "ST_COVERAGE_BLOCKED",
      engineeringChecks: [],
      engineeringFailures: [],
    };
  }

  const checks: string[] = [];
  const failures: string[] = [];
  if (args.persistedRunStatus !== null) {
    checks.push(
      `持久化 Run status=${args.persistedRunStatus}（生命周期成功值 = ${PERSISTED_RUN_SUCCESS_STATUS}；`
      + "`markCompleted` 结构性要求非空 Manifest Key）"
      + (args.persistedRunId === null ? "" : `，runId=${args.persistedRunId}`),
    );
  }
  const runMode = (custom.runMode ?? {}) as Record<string, unknown>;
  const totalAccountCount = typeof runMode.totalAccountCount === "number"
    ? runMode.totalAccountCount
    : null;
  checks.push(`矩阵已产出（matrixEmitted=true）`);
  if (totalAccountCount !== args.expectedTotalAccounts) {
    failures.push(`账户总数 ${String(totalAccountCount)} ≠ 期望 ${args.expectedTotalAccounts}`);
  } else {
    checks.push(`账户总数 = ${totalAccountCount}`);
  }
  const groups = Array.isArray(custom.groups) ? custom.groups : [];
  const accountsPerGroup = typeof runMode.accountsPerGroup === "number" ? runMode.accountsPerGroup : null;
  if (accountsPerGroup === null) {
    failures.push("runMode.accountsPerGroup 缺失");
  } else {
    for (const raw of groups) {
      const group = (raw ?? {}) as Record<string, unknown>;
      const accounts = Array.isArray(group.accounts) ? group.accounts : [];
      if (accounts.length !== accountsPerGroup) {
        failures.push(`组 ${String(group.group)} 账户数 ${accounts.length} ≠ ${accountsPerGroup}`);
      } else {
        checks.push(`组 ${String(group.group)} 账户数 = ${accounts.length}`);
      }
    }
  }
  const policy = (custom.stEligibilityPolicy ?? null) as Record<string, unknown> | null;
  if (policy === null) {
    checks.push("stEligibilityPolicy 未记录（严格旧载荷路径）");
  } else {
    const counts = (policy.counts ?? {}) as Record<string, unknown>;
    const orders = (counts.matchingOrders ?? {}) as Record<string, number>;
    const policyId = String(policy.policyId ?? "?");
    checks.push(`ST 资格政策 = ${policyId} / ${String(policy.policyVersion ?? "?")}`);
    // 🔴 已知 ST 买入必须为 0（两种政策都不允许 ST 成交）。
    const knownStOrders = orders.knownStOrders ?? 0;
    const knownStRejected = orders.knownStRejectedOrders ?? 0;
    if (knownStOrders !== knownStRejected) {
      failures.push(
        `已知 ST 订单 ${knownStOrders} 笔中只有 ${knownStRejected} 笔被拒 ⇒ 存在已知 ST 买入（停止条件）`,
      );
    } else {
      checks.push(`已知 ST 订单 = ${knownStOrders}，全部被拒（已知 ST 买入 = 0）`);
    }
    checks.push(
      `UNKNOWN 订单 ${orders.unknownOrders ?? 0}（成交 ${orders.unknownFilledOrders ?? 0} / `
      + `拒单 ${orders.unknownRejectedOrders ?? 0}）`,
    );
    checks.push(
      `因已知 ST 排除的排序候选 = ${String(counts.knownStExcludedCandidates ?? "?")}（政策描述，不是优化目标）`,
    );
    const source = (policy.source ?? null) as Record<string, unknown> | null;
    if (source !== null) {
      checks.push(
        `标签来源 ${String(source.sourceId)}：读入 ${String(source.rowsRead)} 行 / `
        + `指纹 ${String(source.sourceFingerprint).slice(0, 16)}…`,
      );
    }
  }
  for (const failure of failures) console.error(`[recovery-light-st] ❌ 工程自检失败：${failure}`);

  const resolvedTerminal = terminalStateDeclared
    ?? (failures.length > 0 ? (args.mode === "smoke" ? "SMOKE_ENGINEERING_FAILED" : "EXECUTION_FAILED") : "EXPLORATORY_COMPLETED");
  if (failures.length > 0) {
    return {
      exitCode: EXIT_ENGINEERING_FAILURE,
      terminalState: resolvedTerminal,
      engineeringChecks: checks,
      engineeringFailures: failures,
    };
  }
  if (resolvedTerminal === "DATA_LIMITED") {
    console.error(
      "[recovery-light-st] ⚠️ DATA_LIMITED：实际缺数据使退出 / 估值 / 指标无法完整计算。"
      + "已交付的完成结果照常产出；**不**静默强平、**不**补最后价、**不**删样本。",
    );
    return {
      exitCode: EXIT_DATA_LIMITED,
      terminalState: resolvedTerminal,
      engineeringChecks: checks,
      engineeringFailures: failures,
    };
  }
  console.log(`[recovery-light-st] ✅ ${args.label} 已产出收益矩阵（EXPLORATORY，已知 ST 买入 = 0）。`);
  return {
    exitCode: EXIT_MATRIX_EMITTED,
    terminalState: resolvedTerminal,
    engineeringChecks: checks,
    engineeringFailures: failures,
  };
}

// ---------------------------------------------------------------------------
// `SORT-PARITY-008`：**只读**复检一条已持久化 Run 的终态（不重算、不重跑）
// ---------------------------------------------------------------------------

/**
 * ```bash
 * node --max-old-space-size=4096 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolRecoveryStRun.mts \
 *   --verify-persisted RUN-20261011-AEB6DDAB --payload _scratch/fbp8/study-run.json
 * ```
 *
 * 为什么需要：正式 42 账户**本轮只跑一次**（目标 §8）。若工具侧的终态判据本身有缺陷，
 * 正确的处置是**用同一条已持久化 Run 的既有事实复检**，而不是再跑一次 42 账户去凑一个退出码。
 * 本分支只调 `readRunDetail`（只读）：不 execute、不写对象存储、不写库。
 */
const VERIFY_PERSISTED_RUN_ID = argValue("--verify-persisted");
if (VERIFY_PERSISTED_RUN_ID !== null) {
  const payloadFile = argValue("--payload");
  const envelope = payloadFile === null
    ? null
    : JSON.parse(readFileSync(path.resolve(payloadFile), "utf8")) as Record<string, any>;
  const service = defaultExperimentRunService();
  const detail = await service.readRunDetail(VERIFY_PERSISTED_RUN_ID);
  const persistedRun = detail.run as unknown as Record<string, any>;
  const custom = (envelope?.customPayload ?? detail.result?.customPayload ?? null) as Record<string, unknown> | null;
  const runMode = (custom?.runMode ?? {}) as Record<string, unknown>;
  const expectedTotalAccounts = typeof runMode.totalAccountCount === "number"
    ? runMode.totalAccountCount
    : null;
  if (expectedTotalAccounts === null) {
    console.error("[recovery-light-st] recheck 失败：拿不到 runMode.totalAccountCount ⇒ 无法核对账户数");
    process.exit(EXIT_ENGINEERING_FAILURE);
  }
  const report = reportTerminalState({
    label: `study-recheck(${VERIFY_PERSISTED_RUN_ID})`,
    mode: "study",
    expectedTotalAccounts,
    runStatus: String((persistedRun.summary ?? {}).runStatus ?? "SUCCEEDED"),
    persistedRunStatus: persistedRun.status ?? null,
    persistedRunError: persistedRun.errorCode === null || persistedRun.errorCode === undefined
      ? null
      : `${String(persistedRun.errorCode)}：${String(persistedRun.errorMessage ?? "")}`,
    persistedRunId: persistedRun.runId ?? VERIFY_PERSISTED_RUN_ID,
    error: null,
    customPayload: custom,
    logs: (envelope?.execution?.logs ?? []) as readonly string[],
  });
  save("study-recheck.json", {
    runId: VERIFY_PERSISTED_RUN_ID,
    persistedRunStatus: persistedRun.status ?? null,
    runStatusFromSummary: (persistedRun.summary ?? {}).runStatus ?? null,
    resultManifestKey: persistedRun.resultManifestKey ?? null,
    artifactCount: detail.artifacts.length,
    artifactsMissing: detail.artifacts.filter((item) => !item.present).map((item) => item.ref.key),
    artifactsError: detail.artifactsError,
    terminalState: report.terminalState,
    exitCode: report.exitCode,
    engineeringChecks: report.engineeringChecks,
    engineeringFailures: report.engineeringFailures,
  });
  console.log(`[recovery-light-st] recheck 完成：exitCode=${report.exitCode}（写出 _scratch/fbp8/study-recheck.json）`);
  process.exit(report.exitCode);
}

// ---------------------------------------------------------------------------
// 参数解析与校验（**非法即拒绝启动**）
// ---------------------------------------------------------------------------

const rawMode = (argValue("--mode") ?? "").toLowerCase();
const randomAccountCount = MODE_RANDOM_ACCOUNT_COUNT[rawMode];
if (randomAccountCount === undefined) {
  console.error(
    `[recovery-light-st] 未知 --mode=${rawMode || "(空)"}：只支持 smoke(2 随机/组 ⇒ 6 账户) 与 `
    + "study(20 随机/组 ⇒ 42 账户)。**不支持**扩跑（200 需独立参数记录 + 新 Run）。"
    + "（要看一条**已持久化** Run 的终态请用 `--verify-persisted <RUN_ID>`，那是只读复检、不重跑。）",
  );
  process.exit(2);
}

const rawStPolicy = argValue("--st-policy") ?? ST_POLICY_DEFAULT_VALUE;
let stPolicy;
try {
  stPolicy = resolveStEligibilityPolicy(rawStPolicy);
} catch (error) {
  console.error(
    `[recovery-light-st] --st-policy 非法：${(error as Error).message}\n`
    + `  允许值只有 [${ST_POLICY_PARAMETER_VALUES.join(", ")}]（缺省 = ${ST_POLICY_DEFAULT_VALUE}）。`,
  );
  process.exit(2);
}

const mode = rawMode as "smoke" | "study";
const expectedTotalAccounts = (1 + randomAccountCount) * 2;
console.log(
  `[recovery-light-st] mode=${mode} randomAccountCount=${randomAccountCount} `
  + `totalAccounts=${expectedTotalAccounts} dataset=${DATASET_VERSION_ID} experiment=${EXPERIMENT_ID} `
  + `--st-policy=${rawStPolicy} ⇒ 政策 ${stPolicy.id} / ${stPolicy.version}`
  + `（探索性=${String(stPolicy.exploratory)}，严格缺省=${String(stPolicy.strictDefault)}）`,
);
if (stPolicy.exploratory) {
  console.log(
    "[recovery-light-st] 🔴 EXPLORATORY / KNOWN_ST_ONLY：UNKNOWN 可参与（**用户明确授权**）；"
    + "只排除已有历史记录中的 ST。**不是**严格 PIT 研究，结论不得升级为 PIT / OOS / 模拟交易 / 实盘验证。",
  );
} else {
  console.log(
    "[recovery-light-st] 严格模式（缺省）：只认可 PIT 可核验 NORMAL；"
    + "缺可核验结论时以 `ST_COVERAGE_BLOCKED` 收口（exit code 3）—— 那是**预期的诚实暂停**，不是空仓结果。",
  );
}

let exitCode = EXIT_ENGINEERING_FAILURE;
const started = Date.now();
const parameters = { randomAccountCount, [ST_POLICY_PARAMETER_CODE]: rawStPolicy };

if (mode === "smoke") {
  // SMOKE：6 账户技术预检（不持久化；只验工程正确 / 账平 / 闸门，不做收益筛选）
  const runner = defaultExperimentRunner();
  const { outcome, artifactFiles } = await runner.runDetailed({
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
    parameters,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[recovery-light-st] smoke elapsed=${elapsed}s artifacts=${artifactFiles.length}`);
  saveArtifacts(artifactFiles, "smoke-artifacts");
  /**
   * 🔴 `SORT-PARITY-008` §5 —— **既有发布预算校验 + 逐对象读回**（只用内存 ArtifactStorage）。
   * 判据是平台自己的 `validatePublishLimits` / `publishRunArtifacts`，不是本工具的自我声明。
   */
  let delivery: DeliveryBudgetReport | null = null;
  let deliveryError: string | null = null;
  try {
    delivery = await verifyDeliveryBudgetAndReadBack({
      experimentId: EXPERIMENT_ID,
      experimentVersion: String(outcome.descriptor.version),
      experimentCodeDigest: String(
        (outcome.result?.customPayload as Record<string, unknown> | undefined)?.codeDigest
        ?? "unknown-code-digest",
      ),
      runId: "SMOKE-008-ENGINEERING-CHECK",
      datasetVersionId: DATASET_VERSION_ID,
      createdAt: "2026-10-11T00:00:00.000Z",
      result: outcome.result,
      logs: outcome.execution.logs,
      artifactFiles,
    });
  } catch (error) {
    deliveryError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  if (deliveryError !== null) {
    console.error(`[recovery-light-st] ❌ 交付预算/读回校验抛错：${deliveryError}`);
  } else if (delivery !== null) {
    console.log(
      `[recovery-light-st] 交付预算：产物 ${delivery.artifactFileCount} 件 / 对象 ${delivery.publishedObjectCount} 个；`
      + `最大单件 ${delivery.largestSingleBytes} B（上限 ${delivery.artifactMaxSingleBytes}）；`
      + `总量 ${delivery.totalDeliveredBytes} B（上限 ${delivery.artifactMaxTotalBytes}）；`
      + `result.json ${delivery.resultJsonBytes} B（上限 ${delivery.resultJsonMaxBytes}）；`
      + `压缩 ${delivery.compressedObjectNames.length} 件 / 原文 ${delivery.identityObjectNames.length} 件。`,
    );
    for (const check of delivery.decompressionChecks) {
      console.log(
        `[recovery-light-st]   ${check.match && check.deliveredIsNotPlainText ? "✅" : "❌"} ${check.objectName}`
        + ` 原文 ${check.originalBytes} B / 交付 ${check.deliveredBytes} B sha256=${check.recomputedSha256.slice(0, 16)}…`,
      );
    }
    console.log(
      `[recovery-light-st] 发布读回：manifest=${String(delivery.manifestKey)} `
      + `对象 ${delivery.manifestObjectCount} 个 / 存在性验证=${String(delivery.manifestVerificationPassed)} / `
      + `readBackOk=${String(delivery.readBackOk)}`,
    );
  }
  const report = reportTerminalState({
    label: "smoke",
    mode: "smoke",
    expectedTotalAccounts,
    runStatus: outcome.runStatus,
    // SMOKE **不持久化** ⇒ 没有持久化 Run 可核对（如实记 null，不冒充 SUCCEEDED）。
    persistedRunStatus: null,
    persistedRunError: null,
    persistedRunId: null,
    error: outcome.error,
    customPayload: outcome.result?.customPayload ?? null,
    logs: outcome.execution.logs,
  });
  /** 🔴 交付校验不通过 = 工程失败（本地落盘成功不能替代发布预算校验）。 */
  const deliveryFailed = deliveryError !== null
    || delivery === null
    || !delivery.withinLimits
    || !delivery.readBackOk;
  if (deliveryFailed && report.exitCode === 0) {
    console.error(
      "[recovery-light-st] ❌ 工程自检失败：交付预算 / 解压哈希 / 读回路径未全部通过 —— "
      + "本轮 SMOKE **不**算通过（不改研究参数、不改种子；先修工程缺陷再重验）。",
    );
  }
  save("smoke-outcome.json", {
    runStatus: outcome.runStatus,
    error: outcome.error,
    elapsedSeconds: Number(elapsed),
    stPolicyParameter: rawStPolicy,
    stEligibilityPolicyId: stPolicy.id,
    stEligibilityPolicyVersion: stPolicy.version,
    execution: outcome.execution,
    sampleSummary: outcome.result?.sampleSummary ?? null,
    tables: outcome.result?.tables ?? null,
    statistics: outcome.result?.statistics ?? null,
    customPayload: outcome.result?.customPayload ?? null,
    terminalState: report.terminalState,
    engineeringChecks: report.engineeringChecks,
    engineeringFailures: report.engineeringFailures,
    deliveryBudget: delivery,
    deliveryError,
    deliveryFailed,
    artifactFiles: artifactFiles.map((file) => ({
      name: file.name,
      role: file.role,
      label: file.label ?? null,
      contentType: file.contentType ?? null,
      bytes: typeof file.body === "string" ? Buffer.byteLength(file.body, "utf8") : file.body.byteLength,
    })),
  });
  console.log(`[recovery-light-st] wrote _scratch/fbp8/smoke-outcome.json + smoke-artifacts/**`);
  exitCode = deliveryFailed ? EXIT_ENGINEERING_FAILURE : report.exitCode;
} else {
  // STUDY：42 账户 EXPLORATORY Run（经既有 startRun 入口持久化 1 条 Run + 产物；只跑一次）
  const service = defaultExperimentRunService();
  const result = await service.execute({
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
    parameters,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[recovery-light-st] study elapsed=${elapsed}s run=${JSON.stringify(result.run)}`);
  const report = reportTerminalState({
    label: "study",
    mode: "study",
    expectedTotalAccounts,
    runStatus: result.outcome.runStatus,
    // 🔴 只看执行器结论会漏掉「产物写入失败 ⇒ Run=FAILED、结果不可读」的假成功（实测过）。
    persistedRunStatus: result.run?.status ?? null,
    persistedRunError: result.run === null || result.run === undefined
      ? null
      : (result.run.errorCode === null || result.run.errorCode === undefined
        ? null
        : `${String(result.run.errorCode)}：${String(result.run.errorMessage ?? "")}`),
    persistedRunId: result.run?.runId ?? null,
    error: result.outcome.error,
    customPayload: result.outcome.result?.customPayload ?? null,
    logs: result.outcome.execution.logs,
  });
  // 🔴 持久化路径的产物由平台写进既有 ArtifactStorage（`service.execute` 只回 Run 坐标与执行事实，
  //    **不回**产物字节）⇒ 这里只落执行事实；产物经 Run 详情 / Manifest 读取（不引第二套出口）。
  save("study-run.json", {
    run: result.run,
    persisted: result.persisted,
    runStatus: result.outcome.runStatus,
    error: result.outcome.error,
    elapsedSeconds: Number(elapsed),
    stPolicyParameter: rawStPolicy,
    stEligibilityPolicyId: stPolicy.id,
    stEligibilityPolicyVersion: stPolicy.version,
    execution: {
      startedAt: result.outcome.execution.startedAt,
      finishedAt: result.outcome.execution.finishedAt,
      durationMs: result.outcome.execution.durationMs,
      datasetFacts: result.outcome.execution.datasetFacts,
      logs: result.outcome.execution.logs,
    },
    sampleSummary: result.outcome.result?.sampleSummary ?? null,
    tables: result.outcome.result?.tables ?? null,
    statistics: result.outcome.result?.statistics ?? null,
    customPayload: result.outcome.result?.customPayload ?? null,
    terminalState: report.terminalState,
    engineeringChecks: report.engineeringChecks,
    engineeringFailures: report.engineeringFailures,
  });
  console.log("[recovery-light-st] wrote _scratch/fbp8/study-run.json（产物在既有 ArtifactStorage 里）");
  exitCode = report.exitCode;
}

process.exit(exitCode);
