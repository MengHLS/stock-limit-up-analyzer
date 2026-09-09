/**
 * STEP DS-V2 — Research Dataset Certification（C-12.6.3）。
 *
 * 目标（任务 §4/§5/§7）：把「构建 gate」升级为「研究认证」——
 *   CONFIGURE → VALIDATE → PREVIEW → CERTIFY → CREATE IMMUTABLE VERSION。
 *
 * 与 gate 的区别（关键，禁止混淆）：
 *   - gate（builder 产物）：构建期事实判定（FAIL / PASS / INCONCLUSIVE），回答「数据能不能拼出来」；
 *   - certification（本模块）：研究期资格判定（CERTIFIED / CONDITIONAL / REJECTED），回答
 *     「这个数据集能不能作为正式研究实验环境」。certification 消费 gate，但比 gate 更严格：
 *     即便 gate=PASS，若固定快照（含未来知识）或依赖了历史 PIT 不完整的 Industry/Liquidity，
 *     也只能 CONDITIONAL，不得 CERTIFIED。
 *
 * 铁律：
 *   - 纯函数：无 IO / 无 Date.now / 无 Math.random；同输入必同输出（确定性，可测试可复现）。
 *   - 禁止伪造：CODE_READY ≠ CERTIFIED；TEST PASS ≠ CERTIFIED；UI 可选择 ≠ DATA AVAILABLE。
 *   - content-addressed identity（datasetId / datasetVersion / 各 fingerprint）保持不变，
 *     本模块只在其上叠加「研究资格」注解，绝不改写身份。
 */

import { indexPolicyById } from "./policy";
import type { ResearchDataset } from "./types";

// ---------------------------------------------------------------------------
// 能力三态（与 capability.ts 一致）
// ---------------------------------------------------------------------------

/** 能力可用性三态（AVAILABLE / CONDITIONAL / UNAVAILABLE）。 */
export type DatasetCapabilityStatus = "AVAILABLE" | "CONDITIONAL" | "UNAVAILABLE";

/** 认证资格三态。 */
export type DatasetCertificationStatus = "CERTIFIED" | "CONDITIONAL" | "REJECTED";

/** 认证依赖声明：研究是否实际消费这些可选域（未声明的域不参与研究，不影响认证）。 */
export interface DatasetCertificationRequirements {
  /** 研究是否依赖历史行业归属（行业筛选 / 行业中性化 / 行业因子）。 */
  industry?: boolean;
  /** 研究是否依赖历史流动性/市值（市值中性 / 换手过滤 / 流动性因子）。 */
  liquidity?: boolean;
  /** 研究是否依赖公司行为（复权价 / 除权事件）。 */
  corporateActions?: boolean;
}

/** 认证所需的能力事实（来自 capability 元数据探测，非猜测）。 */
export interface DatasetCapabilityFacts {
  industryHistoricalPit: DatasetCapabilityStatus;
  liquidityHistoricalCoverage: DatasetCapabilityStatus;
  corporateActionPit: DatasetCapabilityStatus;
}

/** 认证结果（确定性；certifiedAt 由持久化层叠加，不在此纯函数内）。 */
export interface DatasetCertification {
  status: DatasetCertificationStatus;
  /** 是否可安全用于正式研究（= status === "CERTIFIED"）。 */
  researchSafe: boolean;
  /** 逐条理由（人类可读，按决策顺序稳定）。 */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// 认证决策
// ---------------------------------------------------------------------------

/**
 * 对已构建的 ResearchDataset 做研究认证。
 *
 * 决策树（顺序稳定，早命中即定案）：
 *   1. gate = FAIL            → REJECTED（构建失败，绝不认证）；
 *   2. gate = INCONCLUSIVE    → CONDITIONAL（证据不足，不能证明安全）；
 *   3. gate = PASS 且固定快照 → CONDITIONAL（固定 asOf 含相对 tradeDate 的未来知识，
 *      NON_RESEARCH_SAFE，§4 铁律禁止用于正式研究）；
 *   4. gate = PASS 且声明依赖 Industry 但历史 PIT 不完整 → CONDITIONAL；
 *   5. gate = PASS 且声明依赖 Liquidity 但历史覆盖不完整 → CONDITIONAL；
 *   6. gate = PASS 且声明依赖 CA 但 announcementDate PIT 不完整 → CONDITIONAL；
 *   7. 其余 gate = PASS → CERTIFIED。
 *
 * 注意：survivorship 由构建口径（B Master 全表含退市 + 逐日生命周期）结构性保证，
 *   不在此处重复判定，但若 policySet 缺失/损坏会如实降级为 CONDITIONAL（不伪造安全）。
 */
export function certifyResearchDataset(
  dataset: ResearchDataset,
  requirements: DatasetCertificationRequirements,
  facts: DatasetCapabilityFacts,
): DatasetCertification {
  const reasons: string[] = [];
  const gate = dataset.gate;

  if (gate === "FAIL") {
    reasons.push(`构建 gate=FAIL：${dataset.gateNotes.join("；") || "无说明"}`);
    return { status: "REJECTED", researchSafe: false, reasons };
  }

  if (gate === "INCONCLUSIVE") {
    reasons.push(`构建 gate=INCONCLUSIVE：${dataset.gateNotes.join("；") || "证据不足，不能证明数据链安全"}`);
    return { status: "CONDITIONAL", researchSafe: false, reasons };
  }

  // gate === "PASS" 起进入研究资格判定。
  const request = dataset.dataSnapshot.request;

  // 3. 固定快照 = 未来知识（NON_RESEARCH_SAFE）。
  if (!request.asOfPerTradeDate) {
    reasons.push(
      `PIT 口径为固定快照（asOf=${request.asOf ?? "null"}）：相对 tradeDate 含未来知识，` +
        `属 NON_RESEARCH_SAFE，禁止作为正式研究实验环境`,
    );
    return { status: "CONDITIONAL", researchSafe: false, reasons };
  }

  // 3b. 逐日 PIT 但 policySet 缺失/损坏（防篡改护栏）。
  const policyById = indexPolicyById(dataset.policySet);
  if (dataset.policySet.length === 0 || policyById.get("pit") === undefined || policyById.get("survivorship") === undefined) {
    reasons.push("policySet 缺失 pit/survivorship 声明，无法证明 PIT/survivorship 安全");
    return { status: "CONDITIONAL", researchSafe: false, reasons };
  }

  // 4. Industry 历史 PIT 依赖判定。
  if (requirements.industry === true && facts.industryHistoricalPit !== "AVAILABLE") {
    reasons.push(
      `研究依赖历史行业归属，但 Industry 历史 PIT=${facts.industryHistoricalPit}：` +
        `当前行业数据以当前快照为主（effectiveFrom 单点），不具备 2019–2026 历史行业序列，不能作为正式研究依据`,
    );
  }

  // 5. Liquidity 历史覆盖依赖判定。
  if (requirements.liquidity === true && facts.liquidityHistoricalCoverage !== "AVAILABLE") {
    reasons.push(
      `研究依赖历史流动性/市值，但 Liquidity 历史覆盖=${facts.liquidityHistoricalCoverage}：` +
        `换手/市值历史序列不完整，不能作为正式研究依据`,
    );
  }

  // 6. Corporate Action PIT 依赖判定。
  if (requirements.corporateActions === true && facts.corporateActionPit !== "AVAILABLE") {
    reasons.push(
      `研究依赖公司行为，但 Corporate Action PIT=${facts.corporateActionPit}：` +
        `announcementDate 缺失保守视为不可知，复权/除权口径不完整，不能作为正式研究依据`,
    );
  }

  if (reasons.length > 0) {
    return { status: "CONDITIONAL", researchSafe: false, reasons };
  }

  return {
    status: "CERTIFIED",
    researchSafe: true,
    reasons: [
      "构建 gate=PASS 且逐日 PIT、survivorship-safe、无依赖历史 PIT 不完整的可选域",
    ],
  };
}

/** 便捷判定：是否可安全用于正式研究。 */
export function isResearchSafe(certification: DatasetCertification): boolean {
  return certification.researchSafe;
}
