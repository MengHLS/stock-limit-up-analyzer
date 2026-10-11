/**
 * `FIRSTBOARD-ROLLING-POOL-EARLY-ENTRY-RUNNER-002` —— 冻结退出政策的**唯一读取器**。
 *
 * 本轮**唯一继承物** = 策略版本 `strategy_versions.id = 3600005`
 * （`first-limit-pullback-3f-top3-runner-t74@2.0.0`）的
 *   - `definition.exit`（含 `candidateExitPolicy = DISABLED` 与统一退出策略 `exit-unified-policy`）；
 *   - `executionAssumptions`（初始资金 / 成本六字段 / 执行模型 / 账户上限）。
 *
 * 🔴 纪律：
 *   - **不改**该策略版本、**不新建**策略版本、**不写库**；
 *   - 读出来先**断言内容指纹**，不匹配即**响亮失败**（拒绝在漂移的政策上做研究）；
 *   - 仓位**换成统一 20% 权益比例**（旧 `positionTiers` 0.05/0.20/0.25 **不继承**）。
 *
 * ⚠️ 文档里的 `entry` / `recipe` 字段**不参与候选选择**：本轮候选集由实验自己产出并作为
 *    `sourceRun` 传入（`runTradeSimulation` 只消费 `{dataset, sourceRun, simConfig}`），
 *    `assembleRunWorkbenchInputs` 从文档派生的只是成本 / 退出 / 仓位 / 执行模型 / 账户上限。
 *    为保持装配成功，`entry` / `recipe` 结构**原样保留**且**不被读取**；这一点在 RESULT 里披露。
 */
import { DbStrategyRepository } from "../research/strategyPersistence/db";
import { StrategyService } from "../research/strategyPersistence/service";
import type { StrategyDocument } from "../research/strategySchema/types";

/** 派生文档里的 `definition`（必填；来源文档若缺省则由调用方响亮失败）。 */
type RequiredDefinition = NonNullable<StrategyDocument["definition"]>;

/** 冻结参考（只读核验用；与目标 §5 声明逐字符一致）。 */
export const FROZEN_RUNNER_STRATEGY_REFERENCE = Object.freeze({
  strategyVersionId: 3600005,
  strategyId: "first-limit-pullback-3f-top3-runner-t74",
  version: "2.0.0",
  fingerprint: "f6b6147210758ad9ce6f37cffc0d43cab1675a99cb38bb79b3fc18df86dfef3c",
});

/** 本轮统一仓位：决策日收盘总权益 × 20%。 */
export const EARLY_ENTRY_POSITION_FRACTION = 0.2;

export interface FrozenRunnerPolicyBundle {
  /** 冻结文档的**真实**内容指纹（已断言 = 参考值）。 */
  readonly sourceFingerprint: string;
  readonly sourceStrategyId: string;
  readonly sourceVersion: string;
  /** `definition.exit` 原样（唯一继承物之一）。 */
  readonly exit: RequiredDefinition["exit"];
  /** `executionAssumptions` 原样（唯一继承物之二）。 */
  readonly executionAssumptions: StrategyDocument["executionAssumptions"];
  /** 本轮的派生文档：退出 + 执行假设逐字节继承，仓位改为统一 20% 权益比例。 */
  readonly document: StrategyDocument;
}

function assertFingerprint(actual: string): void {
  if (actual !== FROZEN_RUNNER_STRATEGY_REFERENCE.fingerprint) {
    throw new Error(
      "EARLY-ENTRY-002：冻结退出政策的策略指纹漂移 —— "
      + `期望 ${FROZEN_RUNNER_STRATEGY_REFERENCE.fingerprint}，实际 ${actual}。`
      + "拒绝在漂移的退出政策上继续研究。",
    );
  }
}

/**
 * 读出冻结政策并派生本轮文档。
 *
 * @param overrideStrategyId 派生文档用的新身份（默认 `first-limit-pullback-early-entry-runner`）。
 * @param overrideVersion 派生文档版本（默认 `1.0.0`）。
 */
export async function loadFrozenRunnerPolicyBundle(input: {
  readonly overrideStrategyId?: string;
  readonly overrideVersion?: string;
} = {}): Promise<FrozenRunnerPolicyBundle> {
  const service = new StrategyService(new DbStrategyRepository());
  const bundle = await service.loadBundle(
    FROZEN_RUNNER_STRATEGY_REFERENCE.strategyId,
    FROZEN_RUNNER_STRATEGY_REFERENCE.version,
  );
  assertFingerprint(bundle.fingerprint);
  // 额外锚点：真实**版本行主键**必须等于目标声明的 id（防「同 label 不同行」）。
  if (bundle.versionRowId !== FROZEN_RUNNER_STRATEGY_REFERENCE.strategyVersionId) {
    throw new Error(
      "EARLY-ENTRY-002：冻结参考策略的版本行主键漂移 —— "
      + `期望 ${FROZEN_RUNNER_STRATEGY_REFERENCE.strategyVersionId}，实际 ${bundle.versionRowId}。`,
    );
  }

  const source = bundle.document;
  if (source.definition === undefined || source.definition.exit === undefined
    || source.executionAssumptions === undefined) {
    throw new Error("EARLY-ENTRY-002：冻结文档缺 definition.exit 或 executionAssumptions，拒绝继续。");
  }
  const sourceDefinition: RequiredDefinition = source.definition;

  const derived: StrategyDocument = {
    ...source,
    strategyId: input.overrideStrategyId ?? "first-limit-pullback-early-entry-runner",
    version: input.overrideVersion ?? "1.0.0",
    name: "首板滚动池 · 连续观察入场 × preReturn10 排序 × 固定 Runner",
    description:
      "EARLY-ENTRY-002 派生文档：**只继承** 3600005 的 definition.exit 与 executionAssumptions；"
      + "仓位改为统一决策日收盘权益 20%（旧 3F 分档仓位不继承）；"
      + "entry/recipe 结构保留但**不参与候选选择**（候选由实验自建的 sourceRun 提供）。",
    // 🔴 仓位：统一 20% 权益比例（去掉 score-tiered 分档）。
    positionSizing: {
      kind: "equity-fraction",
      fraction: EARLY_ENTRY_POSITION_FRACTION,
      maxPositions: 5,
    },
    definition: {
      ...source.definition,
      position: {
        ...source.definition.position,
        sizingMethod: "EQUITY_RATIO",
        positionRatio: EARLY_ENTRY_POSITION_FRACTION,
        maxSinglePosition: EARLY_ENTRY_POSITION_FRACTION,
        maxPositions: 5,
        // 旧 3F 评分分档仓位**不继承**。
        positionTiers: [],
        positionRankTiers: [],
      },
      // `exit` 逐字节继承（唯一继承物）。
    },
  };

  return {
    sourceFingerprint: bundle.fingerprint,
    sourceStrategyId: FROZEN_RUNNER_STRATEGY_REFERENCE.strategyId,
    sourceVersion: FROZEN_RUNNER_STRATEGY_REFERENCE.version,
    exit: sourceDefinition.exit!,
    executionAssumptions: source.executionAssumptions,
    document: derived,
  };
}

/** 冻结文档里的 `runnerBridge`（`PIT_RUNNER_HOLDING_BRIDGE / NEW_HIGH_3 / 5 / 74`）。 */
export function runnerBridgeOf(bundle: FrozenRunnerPolicyBundle): {
  readonly kind: "PIT_RUNNER_HOLDING_BRIDGE";
  readonly state: "NEW_HIGH_3";
  readonly decisionHoldingDays: 5;
  readonly extendToHoldingDays: 74;
} {
  const rules = bundle.exit?.rules ?? [];
  for (const rule of rules) {
    const policy = (rule as { policy?: { runnerBridge?: unknown } }).policy;
    const bridge = policy?.runnerBridge as { kind?: string; state?: string } | undefined;
    if (bridge !== undefined && bridge.kind === "PIT_RUNNER_HOLDING_BRIDGE") {
      return bridge as unknown as ReturnType<typeof runnerBridgeOf>;
    }
  }
  throw new Error("EARLY-ENTRY-002：冻结文档的 exit 里没有 PIT_RUNNER_HOLDING_BRIDGE，拒绝继续。");
}
