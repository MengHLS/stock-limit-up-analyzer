import { createHash } from "node:crypto";
import type {
  ExperimentConfirmatoryGate,
  ExperimentDatasetBinding,
  ExperimentDatasetFacts,
  ExperimentEvaluationWindow,
  ExperimentResearchPhase,
  ExperimentParameterValues,
  ExperimentProtocolContext,
  ExperimentResearchProtocolInput,
  ExperimentRunLifecycleStatus,
} from "@shared/researchExperimentsContracts";
import { serializeCanonical } from "../research/searchRobustness/canonical";
import { ExperimentError } from "./errors";

export const EXPERIMENT_PROTOCOL_FINGERPRINT_PREFIX = "protocol-sha256:";

export const EXPLORATORY_PROTOCOL: ExperimentProtocolContext = Object.freeze({
  phase: "EXPLORATORY",
  protocolId: null,
  protocolVersion: null,
  hypothesisCode: null,
  protocolFingerprint: null,
  evaluationWindow: null,
  parentRunId: null,
});

export function protocolWindowOf(
  protocol: ExperimentResearchProtocolInput,
): ExperimentEvaluationWindow {
  return protocol.phase === "OBSERVATION"
    ? protocol.observationWindow
    : protocol.holdoutWindow;
}

/** Dataset 绑定的协议身份只取不可变坐标；展示标签变化不得改写协议。 */
export function protocolDatasetBindingIdentity(
  bindings: readonly ExperimentDatasetBinding[],
): ReadonlyArray<{
  alias: string;
  datasetVersionId: number;
  datasetCode: string;
}> {
  return bindings
    .map((binding) => ({
      alias: binding.alias,
      datasetVersionId: binding.datasetVersionId,
      datasetCode: binding.datasetCode,
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

export interface ProtocolRunWindowFact {
  readonly runId: string;
  readonly status: ExperimentRunLifecycleStatus;
  readonly researchPhase: ExperimentResearchPhase;
  readonly parentRunId: string | null;
  readonly datasetVersionId: number;
  readonly evaluationWindow: ExperimentEvaluationWindow | null;
}

/**
 * 找出会让 Holdout 变成「已看过数据」的历史 Run。
 *
 * `evaluationWindow = null` 的历史 Run 读取的是 Dataset 全窗；对确认性研究来说，
 * 它必然覆盖目标 Holdout 窗口，因此一律视为污染。
 */
export function findHoldoutWindowContamination(args: {
  readonly targetWindow: ExperimentEvaluationWindow;
  readonly datasetVersionId: number;
  readonly excludeRunIds?: readonly string[];
  readonly runs: readonly ProtocolRunWindowFact[];
}): ProtocolRunWindowFact[] {
  const excluded = new Set(args.excludeRunIds ?? []);
  return args.runs.filter((run) => {
    if (excluded.has(run.runId)) return false;
    if (run.researchPhase === "HOLDOUT") return false;
    if (run.datasetVersionId !== args.datasetVersionId) return false;
    if (run.evaluationWindow === null) return true;
    return (
      run.evaluationWindow.startDate <= args.targetWindow.endDate &&
      run.evaluationWindow.endDate >= args.targetWindow.startDate
    );
  });
}

export function assertProtocolWindowWithinDataset(
  protocol: ExperimentResearchProtocolInput,
  facts: ExperimentDatasetFacts,
): void {
  if (facts.startDate === null || facts.endDate === null) {
    throw new ExperimentError(
      "EXPERIMENT_PROTOCOL_INVALID",
      `Dataset ${facts.datasetVersionId} 没有声明完整日期范围，不能用于确认性研究`,
      { datasetVersionId: facts.datasetVersionId },
    );
  }
  const window = protocolWindowOf(protocol);
  if (window.startDate < facts.startDate || window.endDate > facts.endDate) {
    throw new ExperimentError(
      "EXPERIMENT_PROTOCOL_INVALID",
      `${protocol.phase} 窗口 ${window.startDate}..${window.endDate} 超出 Dataset 范围 ` +
        `${facts.startDate}..${facts.endDate}`,
      { phase: protocol.phase, window, dataset: facts },
    );
  }
}

export function computeProtocolFingerprint(args: {
  protocol: ExperimentResearchProtocolInput;
  experimentId: string;
  datasetVersionId: number;
  parameters: ExperimentParameterValues;
  datasetBindings?: readonly ExperimentDatasetBinding[];
}): string {
  const auxiliaryDatasets = protocolDatasetBindingIdentity(args.datasetBindings ?? [])
    .filter((binding) => binding.alias !== "primary")
    .map(({ alias, datasetVersionId, datasetCode }) => ({
      alias,
      datasetVersionId,
      datasetCode,
    }));
  const body = {
    protocolId: args.protocol.protocolId,
    protocolVersion: args.protocol.protocolVersion,
    hypothesisCode: args.protocol.hypothesisCode,
    observationWindow: args.protocol.observationWindow,
    holdoutWindow: args.protocol.holdoutWindow,
    experimentId: args.experimentId,
    datasetVersionId: args.datasetVersionId,
    parameters: args.parameters,
    // 单 Dataset 协议保持既有指纹不变；声明 auxiliary 后，版本坐标进入协议身份。
    ...(auxiliaryDatasets.length > 0 ? { auxiliaryDatasets } : {}),
  };
  const digest = createHash("sha256")
    .update(serializeCanonical(body))
    .digest("hex");
  return `${EXPERIMENT_PROTOCOL_FINGERPRINT_PREFIX}${digest}`;
}

export function validateConfirmatoryGate(args: {
  phase: ExperimentProtocolContext["phase"];
  protocolFingerprint: string | null;
  gate: ExperimentConfirmatoryGate | undefined;
}): void {
  if (args.phase === "EXPLORATORY") {
    if (args.gate !== undefined) {
      throw new ExperimentError(
        "EXPERIMENT_CONFIRMATORY_GATE_INVALID",
        "EXPLORATORY Run 不得产出 confirmatoryGate",
      );
    }
    return;
  }
  if (args.protocolFingerprint === null) {
    throw new ExperimentError(
      "EXPERIMENT_PROTOCOL_INVALID",
      "确认性 Run 缺少 protocolFingerprint",
    );
  }
  if (args.gate === undefined) {
    throw new ExperimentError(
      "EXPERIMENT_CONFIRMATORY_GATE_INVALID",
      `${args.phase} Run 必须产出 confirmatoryGate`,
    );
  }
  if (args.gate.protocolFingerprint !== args.protocolFingerprint) {
    throw new ExperimentError(
      "EXPERIMENT_CONFIRMATORY_GATE_INVALID",
      `confirmatoryGate.protocolFingerprint=${args.gate.protocolFingerprint} ` +
        `≠ Run.protocolFingerprint=${args.protocolFingerprint}`,
      { gate: args.gate.protocolFingerprint, run: args.protocolFingerprint },
    );
  }
  if (
    args.phase === "OBSERVATION" &&
    args.gate.status !== "OBSERVATION_READY" &&
    args.gate.status !== "INSUFFICIENT"
  ) {
    throw new ExperimentError(
      "EXPERIMENT_CONFIRMATORY_GATE_INVALID",
      `OBSERVATION Run 的 Gate 不能是 ${args.gate.status}；` +
        "应为 OBSERVATION_READY 或 INSUFFICIENT",
      { status: args.gate.status },
    );
  }
  if (
    args.phase === "HOLDOUT" &&
    args.gate.status === "OBSERVATION_READY"
  ) {
    throw new ExperimentError(
      "EXPERIMENT_CONFIRMATORY_GATE_INVALID",
      "HOLDOUT Run 不得给 OBSERVATION_READY；应为 PASS / FAIL / INSUFFICIENT",
      { status: args.gate.status },
    );
  }
}
