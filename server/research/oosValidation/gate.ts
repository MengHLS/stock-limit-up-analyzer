/**
 * OOS-001 — 输入 Validity Gate（**纯函数**，零 IO）。
 *
 * ## 为什么要有 Gate（而不是「读不到就往下走」）
 *
 * OOS 的**全部价值**在于「样本内发现 → 样本外检验」这条因果链。若源 Search Run
 * 没跑完 / 没有结果 / IS 基线不是 canonical 口径，那么「OOS 表现如何」这句话
 * 就建立在**不存在或不可比**的基线上 ⇒ 宁可**响亮拒绝**并给领域码，
 * 也不产出看起来正常的对照表。
 *
 * ```text
 * OOS_SOURCE_RUN_NOT_COMPLETED   源 Run 不是 COMPLETED（含状态列非法值）
 * OOS_SOURCE_NO_COMBINATIONS     源 Run 一行组合都没有
 * OOS_SOURCE_NO_RESULTS          源 Run 没有任何结果行
 * OOS_SOURCE_MISMATCH            读到的行不属于该 searchRunId（串线 ⇒ 规格 §16 T7）
 * OOS_SOURCE_METRICS_NOT_CANONICAL  选中组合的 IS 读数不是 canonical ⇒ 基线口径不可比
 * ```
 *
 * 🔴 最后一条只针对**选中的那一个组合**，不是全部结果：
 *   一个 Run 里失败组合的 `metricsSource` 必然是 `evaluators`（`null` 投影的既定语义），
 *   若按「全部必须 canonical」判，任何含失败组合的搜索都无法做 OOS ——
 *   那会误杀合法场景。判据必须落在**被验证的那条基线上**。
 */

import { ResearchValidationError } from "../experimentValidation";
import { isOosRunStatus } from "./run";

/** Gate 输入（全部已从库读出；本层零 IO）。 */
export interface OosSourceGateInput {
  readonly searchRunId: string;
  readonly sourceStatus: unknown;
  readonly combinationCount: number;
  readonly resultCount: number;
  /** 行归属校验：读到的组合 / 结果行里出现的 `searchRunId` 集合（规格 §16 T7）。 */
  readonly observedSearchRunIds: readonly string[];
}

/** 断言源 Search Run 满足建立 OOS 验证的条件（校验顺序固定，按最先卡住的那条报）。 */
export function assertOosSourceGate(input: OosSourceGateInput): void {
  if (!isOosRunStatus(input.sourceStatus)) {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_RUN_NOT_COMPLETED",
        path: "sourceSearchRunId",
        message:
          `源 Search Run ${input.searchRunId} 的状态列不是合法状态值（${String(input.sourceStatus)}）`
          + "⇒ 无法确认它已跑完，拒绝建立 OOS 验证。",
      },
    ]);
  }
  if (input.sourceStatus !== "COMPLETED") {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_RUN_NOT_COMPLETED",
        path: "sourceSearchRunId",
        message:
          `源 Search Run ${input.searchRunId} 当前状态为 ${input.sourceStatus}（要求 COMPLETED）`
          + "⇒ 未跑完的搜索上没有「样本内发现」，也就无从做样本外验证。",
      },
    ]);
  }
  const mismatched = [...new Set(input.observedSearchRunIds)].filter(
    (id) => id !== input.searchRunId,
  );
  if (mismatched.length > 0) {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_MISMATCH",
        path: "sourceSearchRunId",
        message:
          `读到的行里出现了不属于 ${input.searchRunId} 的 searchRunId`
          + `（${mismatched.join(" / ")}）⇒ 拒绝跨 Search Run 混合行（规格 §16 T7）。`,
      },
    ]);
  }
  if (input.combinationCount === 0) {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_NO_COMBINATIONS",
        path: "sourceSearchRunId",
        message: `源 Search Run ${input.searchRunId} 一行组合都没有 ⇒ 没有可冻结的候选。`,
      },
    ]);
  }
  if (input.resultCount === 0) {
    throw new ResearchValidationError([
      {
        code: "OOS_SOURCE_NO_RESULTS",
        path: "sourceSearchRunId",
        message: `源 Search Run ${input.searchRunId} 没有任何结果行 ⇒ 没有 IS 基线，无法对照（规格 §10）。`,
      },
    ]);
  }
}

/**
 * 断言选中组合的 IS 读数来自 canonical 口径。
 *
 * 🔴 为什么拒绝而不是「如实标注后继续」：IS 与 OOS 必须**同口径**才可对照。
 *   若 IS 走 `evaluators`（非 canonical 投影），两边的年化基数 / 回撤符号 / 算式形式
 *   都可能不同（BACKTEST-002 收尾二实测过：代数等价的写法在浮点下是两个不同的 double）
 *   ⇒ 「OOS 比 IS 差了 3 个百分点」可能只是口径差。修法 = 重跑那一次 Parameter Search。
 */
export function assertIsMetricsCanonical(input: {
  readonly searchRunId: string;
  readonly parameterHash: string;
  readonly metricsSource: string;
}): void {
  if (input.metricsSource === "canonical") return;
  throw new ResearchValidationError([
    {
      code: "OOS_SOURCE_METRICS_NOT_CANONICAL",
      path: "parameterHash",
      message:
        `源结果（Run ${input.searchRunId}，组合 ${input.parameterHash}）的 metricsSource = `
        + `${input.metricsSource}（要求 canonical）⇒ IS 与 OOS 口径不可比，拒绝建立对照。`
        + "请重跑该次 Parameter Search 以产出 canonical 读数后再做样本外验证。",
    },
  ]);
}
