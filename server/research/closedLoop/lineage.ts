/**
 * STEP 25 / C-25.1 — Closed Loop：§28 谱系整合（每阶段 run 落一条 experimentLineage 兼容记录）。
 *
 * 复用（import 只读，不复制不重写）C-13.3 experimentLineage：
 *   - createExperimentLineageRecord：现成的「§28 入账工厂」——给定全字段输入即组装记录 +
 *     fingerprint + 结构校验 + 深冻结；不存在独立 DB 入账函数（C-13.3 为纯模块）。
 *   - 类型与校验：ExperimentLineageRecord / LINEAGE_MISSING_CODES 显式缺省纪律。
 *
 * 诚实纪律：
 *   - metadata 解析不到 datasetVersion / codeVersion / costModel 等 → 显式 missing 标记
 *     （LINEAGE_*_UNRESOLVED），绝不猜 "latest" / "v1"；
 *   - regime 未做真实评估 → 结构化 unassessed 占位（本模块不编造 regime 标签）；
 *   - outcome 为 null（中间阶段 run 无 §28 metrics/result 挂载，属「实验输入阶段记录」，
 *     合法空态；真实接线在 VALIDATED 阶段由对应模块 run 结果挂载）。
 */

import {
  LINEAGE_MISSING_CODES,
  REGIME_UNASSESSED_REASON_CODE,
  type ExperimentLineageCostModelRef,
  type ExperimentLineageRecord,
  type ExperimentLineageSlippageRef,
  type ExperimentLineageStringRef,
} from "../experimentLineage/types";
import { createExperimentLineageRecord } from "../experimentLineage/map";
import { assertValidExperimentLineageRecord } from "../experimentLineage/validate";
import type { ClosedLoopRunMetadata } from "./types";

// ---------------------------------------------------------------------------
// 显式 missing 构造（禁止猜默认值）
// ---------------------------------------------------------------------------

function missing(code: string, reason: string): { kind: "missing"; code: string; reason: string } {
  return { kind: "missing", code, reason };
}

function resolved(value: string): ExperimentLineageStringRef {
  return { kind: "resolved", value };
}

/** dataset_version ref：rd-… 内容寻址（C-12.6）或显式 missing。 */
function datasetRef(metadata: ClosedLoopRunMetadata): ExperimentLineageStringRef {
  if (metadata.datasetVersion !== null && metadata.datasetVersion.trim() !== "") {
    return resolved(metadata.datasetVersion);
  }
  return missing(
    LINEAGE_MISSING_CODES.DATASET_VERSION_UNRESOLVED,
    "闭环运行未绑定真实 Research Dataset 版本（CODE_READY 合成/未接数据链）；真实接线后注入 metadata.datasetVersion",
  );
}

/** universe_version ref：universeId = research-dataset:<datasetVersion> 内容指纹语义。 */
function universeRef(metadata: ClosedLoopRunMetadata): ExperimentLineageStringRef {
  if (metadata.universeVersion !== null && metadata.universeVersion.trim() !== "") {
    return resolved(metadata.universeVersion);
  }
  return missing(
    LINEAGE_MISSING_CODES.UNIVERSE_VERSION_UNRESOLVED,
    "universe 决议当前无独立版本载体（绑定在 Research Dataset 内容指纹内）；请显式注入 universeVersion=datasetVersion",
  );
}

/** code_version ref：composeCodeVersion(packageVersion, gitHead, dirty) 注入。 */
function codeVersionRef(metadata: ClosedLoopRunMetadata): ExperimentLineageStringRef {
  if (metadata.codeVersion !== null && metadata.codeVersion.trim() !== "") {
    return resolved(metadata.codeVersion);
  }
  return missing(
    LINEAGE_MISSING_CODES.CODE_VERSION_UNRESOLVED,
    "metadata.codeVersion 未注入（应在入口用 composeCodeVersion 解析后注入；纯模块禁止读 package.json/git）",
  );
}

/** cost_model ref：创建期冻结 CostModel（STEP 8）或显式 missing。 */
function costModelRef(metadata: ClosedLoopRunMetadata): ExperimentLineageCostModelRef {
  if (metadata.costModel !== null) {
    return { kind: "frozen", model: structuredClone(metadata.costModel) };
  }
  return missing(
    LINEAGE_MISSING_CODES.COST_MODEL_UNRESOLVED,
    "闭环运行未冻结成本模型（metadata.costModel 为 null）；禁止按当前默认值补猜",
  );
}

/** slippage ref：= 冻结 CostModel.slippageBps（当前引擎唯一实现）或 missing。 */
function slippageRef(costRef: ExperimentLineageCostModelRef): ExperimentLineageSlippageRef {
  if (costRef.kind === "frozen") {
    return { kind: "resolved", model: "fixed-bps", slippageBps: costRef.model.slippageBps };
  }
  return missing(
    LINEAGE_MISSING_CODES.SLIPPAGE_MODEL_UNRESOLVED,
    "当前引擎唯一滑点实现 = 冻结 CostModel.slippageBps；costModel 未冻结故不可解析",
  );
}

/** execution_model ref：如 "next-open"，或显式 missing。 */
function executionModelRef(metadata: ClosedLoopRunMetadata): ExperimentLineageStringRef {
  if (metadata.executionModel !== null && metadata.executionModel.trim() !== "") {
    return resolved(metadata.executionModel);
  }
  return missing(
    LINEAGE_MISSING_CODES.EXECUTION_MODEL_UNRESOLVED,
    "metadata.executionModel 未注入（当前生产引擎仅实现 next-open，但运行未显式声明该口径）",
  );
}

// ---------------------------------------------------------------------------
// 主适配：阶段 run → §28 谱系记录
// ---------------------------------------------------------------------------

export interface ClosedLoopLineageMappingInput {
  readonly stageId: string;
  /** 阶段内 run id（=`${runId}::${stageId}`）。 */
  readonly stageRunId: string;
  readonly metadata: ClosedLoopRunMetadata;
  /** 阶段 createdAt（ISO-8601 UTC；注入式）。 */
  readonly createdAt: string;
}

/**
 * 每阶段 run 落一条 §28 谱系记录（C-13.3 createExperimentLineageRecord 组装 +
 * fingerprint + 结构校验 + 深冻结；返回后经 assert 复核齐备性可选项）。
 *
 * 说明：C-13.3 无独立 DB「入账函数」（纯模块）；createExperimentLineageRecord 即其
 * 现成入账工厂，本适配做「阶段 run → 全字段输入」的纯映射。outcome=null（中间阶段
 * 无结果谱系挂载）；参数集取 metadata.parameterSet（阶段级参数演进由真实接线细化，
 * 本层不做子集推断）。
 */
export function closedLoopStageToLineageRecord(input: ClosedLoopLineageMappingInput): ExperimentLineageRecord {
  const { metadata } = input;
  const costRef = costModelRef(metadata);
  const record = createExperimentLineageRecord({
    experimentId: metadata.experimentId,
    strategyId: metadata.strategyId,
    strategyVersion: metadata.strategyVersion,
    datasetVersion: datasetRef(metadata),
    universeVersion: universeRef(metadata),
    parameterSet: structuredClone(metadata.parameterSet),
    dateRange: {
      startDate: metadata.dateRange.startDate,
      endDate: metadata.dateRange.endDate,
    },
    costModel: costRef,
    slippageModel: slippageRef(costRef),
    executionModel: executionModelRef(metadata),
    regime: {
      kind: "unassessed",
      reasonCode: REGIME_UNASSESSED_REASON_CODE,
      reason:
        "C-25.1 编排层不评估 regime（C-22.1 属独立模块）；该阶段谱系未挂 assessed 标签，" +
        "真实接线由 regime 阶段 run 结果回填",
    },
    outcome: null,
    codeVersion: codeVersionRef(metadata),
    createdAt: input.createdAt,
  });
  return record;
}

/**
 * 复核 §28 谱系记录齐备性（requireResolvedRefs=true：显式 missing 会报缺项 issue）。
 * 用于「数据链已就绪」场景的完整性断言；解析不到版本属诚实缺口而非记录损坏。
 */
export function assertClosedLoopLineageResolved(record: ExperimentLineageRecord): void {
  assertValidExperimentLineageRecord(record, { requireResolvedRefs: true });
}
