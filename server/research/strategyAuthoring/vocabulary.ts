/**
 * SCOPE-002 §1.4 —— 策略创作**元数据词表**（只读、确定性）。
 *
 * 这是前端唯一的"有哪些预设 / 有哪些配方 / 有哪些 Runner 状态 / 有哪些策略类型"来源。
 * 前端**不得**再抄一份字面量（`AGENTS.md` §6-10 + SCOPE-002 §0.2 P2）：
 * 客户端只能 `import type`，运行时值一律由本模块经 tRPC 下发。
 *
 * 🔴 本模块只做**汇总**：所有条目都从既有注册表读，
 *    `presetRegistry` / `recipeRegistry` / `stateFactorRegistry` / `strategySchema` / `lifecycle`
 *    仍各自是唯一权威。这里不新增任何语义。
 */
import { createHash } from "node:crypto";
import { STRATEGY_TYPES } from "../strategySchema/types";
import { STRATEGY_LIFECYCLE_STATUSES } from "../lifecycle/types";
import { RUNNER_STATE_DEFINITIONS } from "../stateFactorRegistry";
import { STOP_POLICY_EXPERIMENTS } from "../exitPolicyExperiments";
import { listStrategyRecipeProjections } from "../recipeRegistry";
import type { StrategyRecipe } from "../strategySchema/types";
import {
  EXIT_POLICY_SLOTS,
  type ExitPolicySlotId,
  type ExitPolicySlotVisibility,
} from "./exitPolicySlots";
import {
  EXIT_POLICY_RULE_ENVELOPE,
  STRATEGY_AUTHORING_SLOTS,
  STRATEGY_AUTHORING_SLOT_LABELS,
  listStrategyAuthoringPresets,
  type StrategyAuthoringSlot,
  type StrategyPresetParameter,
  type StrategyPresetStatus,
} from "./presetRegistry";

/** 词表里的槽位元数据（**预设槽**，与 `DEFINITION_SEGMENTS` 的 7 段是不同轴，不冲突）。 */
export interface StrategyAuthoringPresetSlot {
  readonly slot: StrategyAuthoringSlot;
  readonly label: string;
  readonly required: boolean;
  readonly description: string;
}

/** 预设摘要（不含 payload —— payload 由 `materializePreset` 按需产出）。 */
export interface StrategyAuthoringPresetSummary {
  readonly presetId: string;
  readonly slot: StrategyAuthoringSlot;
  /** 技术标识（只在"技术细节"里出现）。 */
  readonly label: string;
  readonly description: string;
  /** 「配方名」：**规则式中文名**，本身就说明白这个配方做什么（下拉显示的就是它）。 */
  readonly displayName: string;
  /** 更长的口径说明；UI **不要当作正文渲染**，只作 tooltip / 技术细节。 */
  readonly summary: string;
  readonly status: StrategyPresetStatus;
  readonly version: string;
  readonly sourceRef: string;
  readonly advancedOnly: boolean;
  readonly parameters: readonly StrategyPresetParameter[];
}

/**
 * FE-PLAN-004 —— 退出政策的槽表（**不含 \`patch\`**）。
 *
 * 🔴 前端只拿"有哪些槽、每槽有哪些方案、每个方案能调哪些参数"；
 *    **拼装 policy 的逻辑一律留在服务端**（\`applyExitPolicySlot\`）——
 *    与 SCOPE-002 §0.2 P4「前端只做选预设 + 填参数」同一纪律。
 */
export interface StrategyAuthoringExitPolicySlotOptionSummary {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly parameters: readonly StrategyPresetParameter[];
}

export interface StrategyAuthoringExitPolicySlotSummary {
  readonly slotId: ExitPolicySlotId;
  readonly label: string;
  readonly question: string;
  readonly visibility: ExitPolicySlotVisibility;
  readonly options: readonly StrategyAuthoringExitPolicySlotOptionSummary[];
}

export interface StrategyAuthoringRunnerState {
  readonly stateId: string;
  readonly version: string;
  /** 已注册且可执行的状态一律 `false`；保留该字段是为了未来标记退役状态而不破坏契约。 */
  readonly deprecated: boolean;
}

export interface StrategyAuthoringVocabulary {
  /** 内容 hash：前端可长期缓存，hash 变化即失效。 */
  readonly vocabularyVersion: string;
  readonly presetSlots: readonly StrategyAuthoringPresetSlot[];
  readonly presets: readonly StrategyAuthoringPresetSummary[];
  /** FE-PLAN-004：退出政策的 9 个规则槽（每槽「方案 + 参数」）。 */
  readonly exitPolicySlots: readonly StrategyAuthoringExitPolicySlotSummary[];
  /**
   * 还没有退出政策时的**起步基准**（= 已登记实验 `SL-00` 的 policy）。
   *
   * 🔴 为什么需要它：46 个实验全部建在这条「脊」上（固定 6% 止损 / 盘中 / 破 MA5-10 /
   * 最长 5 日 / 够强延至 10 日）—— 它就是本项目的**实验基准**，不是新发明的默认值。
   * 没有它，用户必须先在「推荐组合」里挑一个整包才能碰任何槽（实测反馈：不选就看不到 9 槽）。
   */
  readonly exitPolicyBasePolicy: Readonly<Record<string, unknown>>;
  /** 起步基准的人话名（UI 只作一行说明）。 */
  readonly exitPolicyBaseLabel: string;
  /** 已注册配方的**规范投影**（= RECIPE 预设的 payload 清单，同一来源）。 */
  readonly recipes: readonly StrategyRecipe[];
  readonly runnerStates: readonly StrategyAuthoringRunnerState[];
  /** `exit.rules[].policy.state` 已 deprecated，新策略应用 `stateCondition`。 */
  readonly deprecatedRunnerBridgeStateField: boolean;
  /**
   * EXIT_POLICY 预设落到 `definition.exit.rules[0]` 时的**规则外壳**（服务端唯一定义）。
   * 前端把它与 materialize 出的 `policy` 合并后逐字写入文档，**不得自行拼装**。
   */
  readonly exitPolicyRuleEnvelope: typeof EXIT_POLICY_RULE_ENVELOPE;
  readonly strategyTypes: readonly string[];
  readonly lifecycleStatuses: readonly string[];
}

const PRESET_SLOT_REQUIRED: Readonly<Record<StrategyAuthoringSlot, boolean>> = {
  RECIPE: true,
  EXIT_POLICY: false,
  POSITION: false,
  COST: false,
  EXIT_BASE: false,
  STOP: false,
  TAKE_PROFIT: false,
  TIME_EXIT: false,
  STRONG_HOLD: false,
  CAPITAL_RECYCLE: false,
  RUNNER_BRIDGE: false,
};

const PRESET_SLOT_DESCRIPTION: Readonly<Record<StrategyAuthoringSlot, string>> = {
  RECIPE: "决定「信号怎么算、按什么排序、取前几名」。缺它 ⇒ 装配层会落到 DEFAULT 配方，条件进不了回测。",
  EXIT_POLICY: "一整套退出政策（止损 / 止盈 / 到期 / 续持 / 资金循环 / Runner 桥）。",
  POSITION: "每笔买多少 + 最多同时持有几只。选中后会**填进**仓位段的字段（草稿仍是唯一真相）。",
  COST: "怎么成交 + 花多少成本（初始资金 / 六项费率 / 成交时点与价格）。同样只填字段。",
  EXIT_BASE: "高级：直接选一个完整退出政策基座（来自已登记的退出实验）。",
  STOP: "高级：只覆盖止损段。",
  TAKE_PROFIT: "高级：只覆盖止盈段。",
  TIME_EXIT: "高级：只覆盖到期退出段。",
  STRONG_HOLD: "高级：只覆盖强势续持段。",
  CAPITAL_RECYCLE: "高级：只覆盖资金循环段。",
  RUNNER_BRIDGE: "高级：只覆盖 Runner 持有桥段。",
};

/** 构造词表（纯函数；同环境必得同输出）。 */
export function buildStrategyAuthoringVocabulary(): StrategyAuthoringVocabulary {
  const presets = listStrategyAuthoringPresets();
  const recipes = listStrategyRecipeProjections();
  const runnerStates: StrategyAuthoringRunnerState[] = [...RUNNER_STATE_DEFINITIONS]
    .map(definition => ({ stateId: definition.stateId, version: definition.version, deprecated: false }))
    .sort((a, b) => (a.stateId === b.stateId ? a.version.localeCompare(b.version) : a.stateId.localeCompare(b.stateId)));

  const presetSlots: StrategyAuthoringPresetSlot[] = STRATEGY_AUTHORING_SLOTS.map(slot => ({
    slot,
    label: STRATEGY_AUTHORING_SLOT_LABELS[slot],
    required: PRESET_SLOT_REQUIRED[slot],
    description: PRESET_SLOT_DESCRIPTION[slot],
  }));

  const exitPolicySlots: StrategyAuthoringExitPolicySlotSummary[] = EXIT_POLICY_SLOTS.map(slot => ({
    slotId: slot.slotId,
    label: slot.label,
    question: slot.question,
    visibility: slot.visibility,
    options: slot.options.map(option => ({
      optionId: option.optionId,
      displayName: option.displayName,
      summary: option.summary,
      parameters: option.parameters,
    })),
  }));

  /** 起步基准 = 已登记实验 SL-00 的 policy（**引用**，不是复刻；漂移由测试钉住）。 */
  const baseExperiment = STOP_POLICY_EXPERIMENTS["SL-00"];
  const exitPolicyBasePolicy = (baseExperiment?.policy ?? {}) as unknown as Readonly<Record<string, unknown>>;
  const exitPolicyBaseLabel = "实验基准 SL-00：" + (baseExperiment?.name ?? "");

  const summaries: StrategyAuthoringPresetSummary[] = presets.map(preset => ({
    presetId: preset.presetId,
    slot: preset.slot,
    label: preset.label,
    description: preset.description,
    displayName: preset.displayName,
    summary: preset.summary,
    status: preset.status,
    version: preset.version,
    sourceRef: preset.sourceRef,
    advancedOnly: preset.advancedOnly,
    parameters: preset.parameters,
  }));

  // 内容 hash：只覆盖"会影响前端渲染与选择"的面（参数 / 槽位 / 配方 / 状态 / 枚举）。
  const hashInput = JSON.stringify({
    presetSlots,
    presets: summaries.map(s => ({ presetId: s.presetId, slot: s.slot, displayName: s.displayName, status: s.status, version: s.version, advancedOnly: s.advancedOnly, parameters: s.parameters })),
    exitPolicyRuleEnvelope: EXIT_POLICY_RULE_ENVELOPE,
    exitPolicySlots,
    exitPolicyBasePolicy,
    exitPolicyBaseLabel,
    recipes,
    runnerStates,
    strategyTypes: [...STRATEGY_TYPES],
    lifecycleStatuses: [...STRATEGY_LIFECYCLE_STATUSES],
  });
  const vocabularyVersion = `authoring-vocab-sha256:${createHash("sha256").update(hashInput).digest("hex")}`;

  return {
    vocabularyVersion,
    presetSlots,
    presets: summaries,
    recipes,
    runnerStates,
    deprecatedRunnerBridgeStateField: true,
    exitPolicyRuleEnvelope: EXIT_POLICY_RULE_ENVELOPE,
    exitPolicySlots,
    exitPolicyBasePolicy,
    exitPolicyBaseLabel,
    strategyTypes: [...STRATEGY_TYPES],
    lifecycleStatuses: [...STRATEGY_LIFECYCLE_STATUSES],
  };
}