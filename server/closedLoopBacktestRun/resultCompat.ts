/**
 * CLOSED-LOOP-BACKTEST-PERSIST-001 — 留档结果的**读时兼容层**。
 *
 * 定位：`closed_loop_backtest_run.resultJson` 是**写入即冻结**的历史事实，而
 * `closedLoopRunResultSchema` 会随功能演进增字段 / 收紧枚举。若读路径拿**当前**契约
 * 直接校验每一条历史留档，任何一次契约演进都会让旧留档永久读不出来 —— 库里已经真实
 * 发生过两轮（2026-09-14 的 6 条早于 STRATEGY-ARCH-002；2026-10-03 的 3 条由
 * STRATEGY-3570001 脚本自造最小结果写进留档表）。
 *
 * 🔴 三条纪律：
 *   1. **不猜** —— 只做有事实依据的升级；没有依据就如实报「读不出来」，绝不编造字段。
 *   2. **不改库** —— 本层是纯函数，只在读路径的内存里投影，不回写 `resultJson`。
 *   3. **不静默** —— 升级过的结果带上 `upgradedFrom`，读不出来的结果带上 `reason`，
 *      调用方必须把它显示出来（「留了但读不出来」≠「本次没留结果」）。
 *
 * 已登记的升级路径（每条都必须写清「凭什么」，不许凭直觉）：
 *   - `pre-strategy-arch-002`：该留档早于 Strategy Core 生产接线（`ROADMAP.md` 9bn，
 *     2026-09-19），当时策略判定**只有**既有配方判定器这一条入口 ⇒ 补
 *     `strategyDecisionEngine = "legacy-recipe"` 并写明原因。
 */

import {
  closedLoopRunResultSchema,
  type ClosedLoopRunResult,
} from "../../shared/researchContracts";

/** 已登记的升级路径 id（进日志 / 未来进 UI，便于「哪条留档被升级过」可追溯）。 */
export const ARCHIVED_RESULT_UPGRADES = ["pre-strategy-arch-002"] as const;
export type ArchivedResultUpgrade = (typeof ARCHIVED_RESULT_UPGRADES)[number];

export type ArchivedResultReconciliation =
  | {
      readonly status: "ok";
      readonly result: ClosedLoopRunResult;
      /** `null` = 原样通过当前契约；非 null = 走了哪条已登记的升级路径。 */
      readonly upgradedFrom: ArchivedResultUpgrade | null;
    }
  | {
      readonly status: "unreadable";
      /** 一句人读原因（含具体字段），供界面如实展示。 */
      readonly reason: string;
    };

/** STRATEGY-ARCH-002 之前唯一判定入口的如实说明（补写进 `strategyDecisionEngineNote`）。 */
export const PRE_STRATEGY_ARCH_002_NOTE =
  "本留档早于 STRATEGY-ARCH-002（Strategy Core 生产接线，2026-09-19）：当时策略判定只有既有配方判定器这条入口，故按 legacy-recipe 记录（读时兼容层补写，非运行期记录）。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 契约不符时的可读原因：最多列 `limit` 条，附总条数。 */
function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[], limit = 6): string {
  const shown = issues
    .slice(0, limit)
    .map((issue) => `${issue.path.map((segment) => String(segment)).join(".") || "<root>"}：${issue.message}`);
  const tail = issues.length > shown.length ? ` …（共 ${issues.length} 处不符）` : "";
  return shown.join("；") + tail;
}

/**
 * 试跑一次已登记升级：补 pre-STRATEGY-ARCH-002 的两个 `assembly` 字段。
 *
 * 只在**该版本确实早于 Core 接线**的前提下才成立 —— 判据取「`assembly` 存在、且两个
 * 字段都没有」，这恰是那时写出的形状；其余情况（例如连 `assembly` 都没有的自造最小
 * 结果）不套用，避免把「脚本自造」误当成「旧版契约」。
 */
function tryPreStrategyArch002Upgrade(raw: Record<string, unknown>): ClosedLoopRunResult | null {
  const assembly = raw.assembly;
  if (!isRecord(assembly)) return null;
  if ("strategyDecisionEngine" in assembly || "strategyDecisionEngineNote" in assembly) return null;

  const candidate = {
    ...raw,
    assembly: {
      ...assembly,
      strategyDecisionEngine: "legacy-recipe",
      strategyDecisionEngineNote: PRE_STRATEGY_ARCH_002_NOTE,
    },
  };
  const parsed = closedLoopRunResultSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * 把一条历史 `resultJson` 对上当前契约。
 *
 * 返回 `ok` ⇒ 可直接交给 tRPC `output()`（`result` 已过 `closedLoopRunResultSchema`）；
 * 返回 `unreadable` ⇒ 调用方必须如实上报，**不得**降级成「本次没留结果」。
 */
export function reconcileArchivedClosedLoopResult(raw: unknown): ArchivedResultReconciliation {
  if (!isRecord(raw)) {
    return { status: "unreadable", reason: "留档结果不是对象。" };
  }

  const direct = closedLoopRunResultSchema.safeParse(raw);
  if (direct.success) {
    return { status: "ok", result: direct.data, upgradedFrom: null };
  }

  const upgraded = tryPreStrategyArch002Upgrade(raw);
  if (upgraded !== null) {
    return { status: "ok", result: upgraded, upgradedFrom: "pre-strategy-arch-002" };
  }

  return { status: "unreadable", reason: describeIssues(direct.error.issues) };
}
