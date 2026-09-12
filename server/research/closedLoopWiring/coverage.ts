/**
 * 闭环装配层 — 覆盖率探测（**取代硬编码 `executorBound = false`**）。
 *
 * 纯函数、零 IO：给定「被请求的阶段集 + 调用方真实入参」，逐阶段判定是否**真的能跑**。
 * 判定链：`wired`（本层有没有真执行器）∧ `satisfyVia` 至少一个来源成立。
 *
 * `artifact` 类来源是**静态可判**的：某阶段需要上游产物时，只要该产物的产生阶段
 * （`CLOSED_LOOP_ARTIFACT_PRODUCER`）**在本次请求的链内、位于本阶段之前、且自身已覆盖**，
 * 就认为该产物在运行期必然可得——否则执行器会在运行期抛 `ClosedLoopWiringError`。
 */

import { CLOSED_LOOP_STAGE_IDS, closedLoopStageIndex, type ClosedLoopStageId } from "../closedLoop/types";
import {
  CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS,
  closedLoopStageWiringRequirement,
  closedLoopWiringMissingReasonCode,
} from "./requirements";
import {
  CLOSED_LOOP_ARTIFACT_PRODUCER,
  type ClosedLoopInputSource,
  type ClosedLoopStageCoverage,
  type ClosedLoopStageWiringRequirement,
  type ClosedLoopWiringArtifactKey,
  type ClosedLoopWiringCoverage,
  type ClosedLoopWiringInputs,
} from "./types";

/** 排序为 canonical 顺序（调用方给什么顺序都归一为拓扑序，便于「上游在前」判断）。 */
function canonicalOrder(stageIds: readonly ClosedLoopStageId[]): ClosedLoopStageId[] {
  return [...stageIds].sort((a, b) => closedLoopStageIndex(a) - closedLoopStageIndex(b));
}

/** 调用方入参是否已提供（判据：键存在且值非 undefined / null）。 */
function hasInput(inputs: ClosedLoopWiringInputs, key: keyof ClosedLoopWiringInputs): boolean {
  const value = inputs[key];
  return value !== undefined && value !== null;
}

/**
 * 上游产物在**本次请求链内**是否可得。
 *
 * 判据（三者同时成立）：产生阶段在链内；产生阶段位于消费者之前；产生阶段自身已覆盖。
 * 注意：这里判断的是「必然可得」，不含运行期手动预填的旁路产物（那是更宽松的运行期情形）。
 */
function artifactAvailable(
  key: ClosedLoopWiringArtifactKey,
  consumerIndex: number,
  coveredInOrder: ReadonlySet<ClosedLoopStageId>,
): boolean {
  const producer = CLOSED_LOOP_ARTIFACT_PRODUCER[key];
  if (!coveredInOrder.has(producer)) return false;
  return closedLoopStageIndex(producer) < consumerIndex;
}

interface SourceEvaluation {
  readonly satisfied: boolean;
  readonly descriptor: string;
  readonly missingInputs: readonly string[];
  readonly missingArtifacts: readonly string[];
}

/** 评估单个入参来源（来源内 inputs 与 artifacts **同时**要满足；来源之间才是 OR）。 */
function evaluateSource(
  source: ClosedLoopInputSource,
  inputs: ClosedLoopWiringInputs,
  consumerIndex: number,
  coveredInOrder: ReadonlySet<ClosedLoopStageId>,
): SourceEvaluation {
  const requiredInputs = source.inputs ?? [];
  const requiredArtifacts = source.artifacts ?? [];
  const missingInputs = requiredInputs.filter((key) => !hasInput(inputs, key));
  const missingArtifacts = requiredArtifacts.filter(
    (key) => !artifactAvailable(key, consumerIndex, coveredInOrder),
  );
  const descriptorParts: string[] = [];
  if (requiredInputs.length > 0) descriptorParts.push(`input:${requiredInputs.join("+")}`);
  if (requiredArtifacts.length > 0) descriptorParts.push(`artifact:${requiredArtifacts.join("+")}`);
  return {
    satisfied: missingInputs.length === 0 && missingArtifacts.length === 0,
    descriptor: descriptorParts.join(" & "),
    missingInputs,
    missingArtifacts,
  };
}

/** 未覆盖时给出可读原因（不美化、不含糊）。 */
function noteFor(
  requirement: ClosedLoopStageWiringRequirement,
  gaps: { readonly missingInputs: readonly string[]; readonly missingArtifacts: readonly string[] } | null,
): string {
  if (!requirement.wired) {
    return requirement.notWiredReason ?? "未装配（缺未装配原因说明，属声明表缺陷）";
  }
  if (gaps === null) return "";
  const parts: string[] = [];
  if (gaps.missingInputs.length > 0) {
    parts.push(`缺调用方入参：${gaps.missingInputs.join("、")}`);
  }
  if (gaps.missingArtifacts.length > 0) {
    parts.push(
      `缺同链上游产物：${gaps.missingArtifacts.join("、")}（须先让产生阶段 ${
        gaps.missingArtifacts
          .map((k) => CLOSED_LOOP_ARTIFACT_PRODUCER[k as ClosedLoopWiringArtifactKey])
          .join("、")
      } 在链内且被覆盖）`,
    );
  }
  return parts.join("；");
}

/**
 * 评估装配覆盖率。
 *
 * @param inputs    调用方当前能提供的真实入参（全部可选）。
 * @param requested 被请求的阶段集；缺省 = canonical 全 14 阶段。顺序会被归一为拓扑序。
 */
export function assessClosedLoopWiringCoverage(
  inputs: ClosedLoopWiringInputs,
  requested?: readonly ClosedLoopStageId[],
): ClosedLoopWiringCoverage {
  const asked = requested ?? CLOSED_LOOP_STAGE_IDS;
  const ordered = canonicalOrder(asked);

  const stages: ClosedLoopStageCoverage[] = [];
  const coveredInOrder = new Set<ClosedLoopStageId>();

  for (const stageId of ordered) {
    const requirement = closedLoopStageWiringRequirement(stageId);
    const index = closedLoopStageIndex(stageId);

    let satisfiedSource: SourceEvaluation | null = null;
    const missingInputs = new Set<string>();
    const missingArtifacts = new Set<string>();
    for (const source of requirement.satisfyVia) {
      const candidate = evaluateSource(source, inputs, index, coveredInOrder);
      if (candidate.satisfied) {
        satisfiedSource = candidate;
        break;
      }
      // 所有失败来源的缺口合并上报（多路径阶段缺失时，用户需要看到全部选项）
      candidate.missingInputs.forEach((key) => missingInputs.add(key));
      candidate.missingArtifacts.forEach((key) => missingArtifacts.add(key));
    }

    const hasSource = requirement.satisfyVia.length > 0;
    const inputsSatisfied = hasSource && satisfiedSource !== null;
    const covered = requirement.wired && inputsSatisfied;
    if (covered) coveredInOrder.add(stageId);

    const gaps = { missingInputs: [...missingInputs], missingArtifacts: [...missingArtifacts] };
    stages.push({
      stageId,
      module: requirement.module,
      wired: requirement.wired,
      inputsSatisfied,
      satisfiedBy: satisfiedSource?.descriptor ?? null,
      missingInputs: gaps.missingInputs,
      missingArtifacts: gaps.missingArtifacts,
      covered,
      blockedReasonCode: covered ? null : closedLoopWiringMissingReasonCode(stageId),
      note: covered ? null : noteFor(requirement, gaps),
    });
  }

  const coveredStages = stages.filter((s) => s.covered).map((s) => s.stageId);
  const uncoveredStages = stages.filter((s) => !s.covered).map((s) => s.stageId);

  return {
    requested: ordered,
    stages,
    coveredStages,
    uncoveredStages,
    // 只有「被请求的阶段全部覆盖」才算执行器已绑定；空请求不算（无阶段可跑）
    executorBound: ordered.length > 0 && uncoveredStages.length === 0,
  };
}

/** 覆盖率结论的一句话摘要（诚实版：未覆盖原因逐条列出，不折叠）。 */
export function describeClosedLoopWiringCoverage(coverage: ClosedLoopWiringCoverage): string {
  const total = coverage.requested.length;
  const covered = coverage.coveredStages.length;
  if (coverage.executorBound) {
    return `闭环装配：${covered}/${total} 阶段全部覆盖（executorBound=true）——被请求链可真实执行。`;
  }
  const lines = coverage.uncoveredStages.map((stageId) => {
    const row = coverage.stages.find((s) => s.stageId === stageId)!;
    return `  · ${stageId}（${row.blockedReasonCode}）：${row.note ?? "未覆盖"}`;
  });
  return [
    `闭环装配：${covered}/${total} 阶段覆盖（executorBound=false）；未覆盖 ${coverage.uncoveredStages.length} 个：`,
    ...lines,
  ].join("\n");
}

/** 已装配（`wired=true`）的阶段清单——供文档与测试断言，不参与判定。 */
export function wiredClosedLoopStages(): readonly ClosedLoopStageId[] {
  return CLOSED_LOOP_STAGE_WIRING_REQUIREMENTS.filter((r) => r.wired).map((r) => r.stageId);
}
