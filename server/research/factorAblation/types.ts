/**
 * STEP 20 / C-20.2 — 因子消融与 OOS 退化（Factor Ablation / Perturbation / OOS Degradation）。
 * 类型契约权威源。
 *
 * 定位与边界（ROADMAP §22「STEP 20 — Overfitting Detection」+ TASK_TRACKING §3.6 C-20.2）：
 *
 *   C-20.2 是过拟合检测的**第二批**能力交付，回答两个问题：
 *     1. 策略的成分（factor / rule / signal / component 子集）中，剔除哪些会显著改变绩效？
 *        各成分对收益/回撤的（描述性）贡献排序是什么样？
 *     2. 哪些信号「IS（样本内）贡献显著、但 OOS（样本外）贡献转负/趋零」——即
 *        「回测好、泛化差」的机器可读候选（**不下因果结论**，仅记录为过拟合信号候选）。
 *
 *   本模块只消融**策略的成分集合**（引用式描述，不复制策略本体），**不做**：
 *     - 参数数值扰动（C-18.1 已覆盖 parameter perturbation）；
 *     - 成本 / 滑点 / 执行扰动（C-18.1 cost/slippage/execution 轴已覆盖）；
 *     - PBO / 参数敏感性 / Overfitting 聚合判定（C-20.1 已覆盖）；
 *     - 成分交互项显著性检验、p 值、贝叶斯、假设检验（明确 unassessed，见 ABLATION_MODE_META）；
 *     - 自动剔除并重训、据消融结果改参/选参（重训选参属 C-17.1 / C-19.x 职责）；
 *     - 「策略能否上线」结论（C-25.1 闭环）。
 *
 *   与相邻模块的关系（**只读 import，不复制、不重写、不修改既有文件**）：
 *     - C-20.1（overfittingDetection）：`OfdAssessmentInput` / `ParameterSensitivityRobustnessView`
 *       是 C-20.1 聚合判定的输入形态。本模块产出 `toAblationRobustnessView` /
 *       `toAblationOfdAssessmentInput`（adapt.ts）把消融结论**并列附加**到该兼容形态，
 *       供协调者在不改动 overfittingDetection 的前提下把消融证据并入 Overfitting 聚合；
 *     - C-19.2（oosIsolation）：OOS 段由调用方注入、只读、**不参与任何目标筛选/排序**；
 *       本模块只消费调用方注入的 OOS 评估器与固定（先验）变体顺序，机器上不存在
 *       「用 OOS 结果决定顺序」的路径（order 在评估前固定）；
 *     - C-18.1（robustness）：`DEFAULT_RETURN_DRIFT_THRESHOLD_PCT` /
 *       `DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT` 用于 adapt.ts 的视图形态兼容
 *       （仅结构占位，消融自身阈值见下），值 import 只读；
 *     - C-16.1/C-16.2：评估器的桥接由调用方实现（evaluator 注入式，本模块不跑回测）。
 *
 *   铁律（对齐项目最高规范 §0/§36/§42/§44.4）：
 *     - **PIT 安全**：消融输入/标签只取 T 时刻已知信息；OOS 数据严禁参与任何消融/选择；
 *     - **确定性**：纯函数、readonly 入参、无 Date.now / Math.random / IO
 *       （ablationRunId / createdAt 由调用方注入）；
 *     - **指纹防篡改**：canonicalStringify（server/researchDataset/version.ts，键字典序）
 *       + sha256 + serialize / deserialize / validate round-trip；
 *     - **FAIL FAST**：空成分集 / 成分数 < 2 / 顺序非法 / base 评估失败 → 响亮抛错（稳定
 *       error code）；无 OOS 段 / 无可评估变体 → 显式 unassessed + reasonCode；
 *     - **诚实边界**：本模块一切贡献度量是**描述性归因**（非因果推断）；排序是完整清单
 *       （**显式非单点 argmax**）；信号仅记录为候选，不下结论、不自动剔除、不重训。
 *
 * 消融模式（几何 + 用途）：
 *   - REMOVE_SINGLE   单点移除：全模型逐次移除**一个**成分 → N 个变体；度量各成分在
 *                     「其余成分在场」下的边际贡献；
 *   - LEAVE_ONE_OUT   留一全集：与单点移除同几何的**全谱枚举**（对成分全集逐一剔除），
 *                     是贡献归因的标准全集操作；本模块不重训，因此与 REMOVE_SINGLE 共用
 *                     同一变体生成器（差异见 ABLATION_MODE_META 的用途说明）；
 *   - CUMULATIVE_REMOVE 逐层累积去除：按**先验顺序**（order）逐次累加移除
 *                     （第 k 变体 = 移除前 k 个），度量层级剥离的增量损失；
 *   - FORWARD_ADD     反向加回（forward-selection 风格）：从**空模型**按先验顺序逐次加入
 *                     （第 k 变体 = 前 k 个激活），度量逐步加入的增量贡献；仅为描述性归因，
 *                     不做统计显著性 / 自动选参。
 *   顺序（order）必须先于任何 OOS 求值给定（可用 IS 结果在**下一次**运行中指导顺序，
 *   但绝不能用本次 OOS 结果）；顺序只是展示/剥离路径，不是参数选择。
 */

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** AblationAssessmentRun 记录种类标签（供序列化 / 反序列化判别）。 */
export const ABLATION_ASSESSMENT_RUN_RECORD_KIND = "ABLATION_ASSESSMENT_RUN" as const;

/** AblationAssessmentRun schema 版本：字段语义变更必须递增。 */
export const ABLATION_ASSESSMENT_RUN_RECORD_VERSION = 1 as const;

/** AblationAssessmentRun ID 前缀（`ABL-YYYYMMDD-XXXXXXXX`，风格对齐 OFA-* / OOSISO-*）。 */
export const ABLATION_ASSESSMENT_RUN_ID_PREFIX = "ABL" as const;

// ---------------------------------------------------------------------------
// 消融成分目标（引用式描述，不复制策略本体）
// ---------------------------------------------------------------------------

/** 成分种类（factor=因子 / rule=规则 / signal=信号 / component=其它成分；纯引用语义）。 */
export type AblationComponentKind = "factor" | "rule" | "signal" | "component";

/** 全部分类（供校验 / 文档化）。 */
export const ABLATION_COMPONENT_KINDS: readonly AblationComponentKind[] = [
  "factor",
  "rule",
  "signal",
  "component",
];

/**
 * 消融目标 = 策略成分的**引用式描述**。
 *
 * 本类型只描述「我要消融哪个成分」（id + 种类 + 人读标签），**不复制**策略本体/参数/
 * 实现。真正「该成分如何禁用」由调用方在注入式 evaluator 闭包内解释
 * （evaluator 收到变体后自行按其语义把非激活成分从配方中拿掉并重估）。
 */
export interface AblationTarget {
  /** 成分 id（canonical，如 `factor_momentum` / `rule_t1_gap`；在同一 run 内必须唯一）。 */
  readonly targetId: string;
  /** 成分种类（机器可读）。 */
  readonly kind: AblationComponentKind;
  /** 人读标签（审计用途；可含中文，不参与计算）。 */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// 消融模式
// ---------------------------------------------------------------------------

/**
 * 消融模式（四类；几何见 types.ts 文件头「消融模式」）。
 * 全部模式均为**描述性归因**，非因果推断（见 ABLATION_MODE_META.caveat）。
 */
export type AblationMode =
  | "REMOVE_SINGLE"
  | "LEAVE_ONE_OUT"
  | "CUMULATIVE_REMOVE"
  | "FORWARD_ADD";

/** 全部模式（供校验 / 文档化）。 */
export const ABLATION_MODES: readonly AblationMode[] = [
  "REMOVE_SINGLE",
  "LEAVE_ONE_OUT",
  "CUMULATIVE_REMOVE",
  "FORWARD_ADD",
];

/** 消融变体的「值方向族」：remove 系「移除后绩效 vs 全模型」；add 系「加入后绩效 vs 前一变体」。 */
export type AblationValueFamily = "remove" | "add";

/** 各模式关于值方向的归属。 */
export function ablationModeValueFamily(mode: AblationMode): AblationValueFamily {
  return mode === "FORWARD_ADD" ? "add" : "remove";
}

/** 模式元数据（几何 + 用途；audit 用，不参与计算）。 */
export interface AblationModeMeta {
  readonly mode: AblationMode;
  /** 值方向族。 */
  readonly family: AblationValueFamily;
  /** 是否需要显式 order（CUMULATIVE_REMOVE / FORWARD_ADD 必须；REMOVE_SINGLE / LEAVE_ONE_OUT 忽略）。 */
  readonly requiresOrder: boolean;
  /** base 变体含义（remove 系 = 全模型；add 系 = 空模型）。 */
  readonly baseDescription: string;
  /** 人读用途说明。 */
  readonly purpose: string;
  /** 描述性归因免责声明（每种模式统一注明非因果推断）。 */
  readonly caveat: string;
}

/** 全模式元数据（键 = 模式字面量）。 */
export const ABLATION_MODE_META: Readonly<Record<AblationMode, AblationModeMeta>> = {
  REMOVE_SINGLE: {
    mode: "REMOVE_SINGLE",
    family: "remove",
    requiresOrder: false,
    baseDescription: "全模型（全部成分激活）",
    purpose: "单点移除：对目标清单中的每个成分构造「全模型 − 该成分」变体，度量其边际贡献",
    caveat: "描述性归因，非因果推断；不重训、不做显著性检验",
  },
  LEAVE_ONE_OUT: {
    mode: "LEAVE_ONE_OUT",
    family: "remove",
    requiresOrder: false,
    baseDescription: "全模型（全部成分激活）",
    purpose: "留一全集：对成分全集逐一剔除（几何与 REMOVE_SINGLE 一致，但要求覆盖全成分集合并以贡献排序为输出），"
      + "是贡献归因的标准全集操作",
    caveat: "描述性归因，非因果推断；留一贡献排序是完整清单（显式非单点 argmax），不做自动剔除",
  },
  CUMULATIVE_REMOVE: {
    mode: "CUMULATIVE_REMOVE",
    family: "remove",
    requiresOrder: true,
    baseDescription: "全模型（全部成分激活）",
    purpose: "逐层累积去除：按先验 order 从全模型逐步累加剔除，度量层级剥离的增量损失",
    caveat: "描述性归因，非因果推断；order 由调用方先验给定（禁止用本次 OOS 结果决定顺序）",
  },
  FORWARD_ADD: {
    mode: "FORWARD_ADD",
    family: "add",
    requiresOrder: true,
    baseDescription: "空模型（无成分激活）",
    purpose: "反向加回（forward-selection 风格）：从空模型按先验 order 逐步加入成分，度量增量贡献",
    caveat: "描述性归因，非因果推断；不做统计显著性/自动选参，前向顺序仅用于展示剥离路径",
  },
};

// ---------------------------------------------------------------------------
// 消融变体（一次「去/留成分」的配方快照，交给注入式 evaluator）
// ---------------------------------------------------------------------------

/**
 * 消融变体规格：描述「这次评估跑的是哪个成分子集」。
 *
 * evaluator 收到本规格后，按其语义把 `activeIds` 之外（或 `removedIds` 之内）的成分
 * 从配方中禁用并重估——禁用细节由调用方实现（引用式，规格本身不复制策略本体）。
 */
export interface AblationVariantSpec {
  /** 变体序号（0 = base；按评估顺序递增）。 */
  readonly variantIndex: number;
  /** 所属消融模式。 */
  readonly mode: AblationMode;
  /** 是否 = base（remove 系 = 全模型；add 系 = 空模型；恰一条且为 variants[0]）。 */
  readonly isBase: boolean;
  /** 稳定程序化 code（BASE_FULL / BASE_EMPTY / ABL_REMOVE_<id> / ABL_CUM_<k>_<id> / ABL_FWD_<k>_<id>）。 */
  readonly code: string;
  /** 人读标签（审计用途）。 */
  readonly label: string;
  /** 本变体的边际归因目标 id（base 与 FORWARD_ADD/CUMULATIVE_REMOVE 的中间变体可为 null）。 */
  readonly marginalTargetId: string | null;
  /** 本变体处于激活状态的成分 id（保持 components 顺序）。 */
  readonly activeIds: readonly string[];
  /** 相对「全成分集」被剔除的成分 id（remove 系；base/空模型 = []）。 */
  readonly removedIds: readonly string[];
  /** 相对「前一变体」新增的成分 id（FORWARD_ADD 第 k 步 = [order[k−1]]；其余 = []）。 */
  readonly addedIds: readonly string[];
}

// ---------------------------------------------------------------------------
// 评估契约（与 C-18.1 Robustness / C-20.1 OverfittingMetricsView 同构，域独立）
// ---------------------------------------------------------------------------

/** 单次消融评估的绩效标量视图（漂移/贡献计算消费的最小集合）。 */
export interface AblationMetricsView {
  /** 总收益率（%，可为负；必须有限）。 */
  readonly totalReturnPct: number;
  /** 最大回撤深度（%，>= 0；必须有限）。 */
  readonly maxDrawdownPct: number;
  /** 成交笔数；未知为 null；提供时必须为 >= 0 整数。 */
  readonly tradeCount: number | null;
}

/** 单次评估产物（成功携带标量；失败携带结构化错误）。 */
export type AblationSampleOutcome =
  | { readonly status: "succeeded"; readonly metrics: AblationMetricsView }
  | { readonly status: "failed"; readonly error: string };

/**
 * 注入式评估器：消融变体（成分子集）→ 绩效标量或结构化失败。
 * 编排器保持纯函数，不执行 IO / 回测；真实映射（变体 → 禁用成分 → 回测 → 绩效）由调用方闭包实现。
 * IS 与 OOS 各注入一个评估器（OOS 评估器缺省 → OOS 轨 unassessed，reasonCode=ABL_NO_OOS_TRACK）。
 */
export type AblationEvaluator = (variant: AblationVariantSpec) => AblationSampleOutcome;

// ---------------------------------------------------------------------------
// 阈值（OOS 退化信号判定）
// ---------------------------------------------------------------------------

/**
 * 消融 OOS 退化信号阈值（部分字段可缺省，由 resolveAblationThresholds 补齐）。
 *
 * 信号语义（**描述性候选**，非因果判定）：
 *   - 成分在 IS 上的收益边际贡献 > `isContributionFloorPct`（百分点），才算「IS 有意义贡献」；
 *   - 其 OOS 收益边际贡献 < 0 → `ABL_IS_POS_OOS_NEG`（样本外反向）；
 *   - 其 OOS 收益边际贡献 ∈ [0, `oosNeutralCeilingPct`] → `ABL_IS_POS_OOS_NEUTRAL`（样本外趋零）。
 */
export interface AblationThresholds {
  /** IS 贡献下限（百分点，> 0 才进入过拟合信号候选判定）。缺省 1。 */
  readonly isContributionFloorPct?: number;
  /** OOS「趋零」上界（百分点，>= 0；OOS 贡献落在 [0, 上界] 视为无样本外贡献）。缺省 0.5。 */
  readonly oosNeutralCeilingPct?: number;
}

/** 解析后的阈值（全字段有限、自描述；进入记录）。 */
export interface ResolvedAblationThresholds {
  readonly isContributionFloorPct: number;
  readonly oosNeutralCeilingPct: number;
}

/** IS 贡献下限缺省（百分点）：贡献 > 该值才算「IS 有意义贡献」，进入过拟合信号候选判定。 */
export const DEFAULT_IS_CONTRIBUTION_FLOOR_PCT = 1;

/** OOS「趋零」上界缺省（百分点）：OOS 贡献 ∈ [0, 上界] 视为无样本外贡献。 */
export const DEFAULT_OOS_NEUTRAL_CEILING_PCT = 0.5;

// ---------------------------------------------------------------------------
// 结果记录结构
// ---------------------------------------------------------------------------

/**
 * 单变体评估结果（索引顺序 = 变体顺序；样本携带完整变体规格，可审计复现）。
 * 成功且存在该轨 base 绩效时，附带相对 base 的原始差量（变体绩效 − base 绩效）。
 */
export interface AblationSampleResult {
  /** 本样本对应的变体规格（完整记录，用于审计「跑的是哪个配方」）。 */
  readonly variant: AblationVariantSpec;
  /** 评估状态。 */
  readonly status: "succeeded" | "failed";
  /** status=succeeded 时绩效标量（有限）；failed 时为 null。 */
  readonly metrics: AblationMetricsView | null;
  /** status=failed 时的结构化错误；succeeded 时为 null。 */
  readonly error: string | null;
  /** 相对该轨 base 的收益差（百分点）= metrics.totalReturnPct − base.totalReturnPct；base 或本样本失败 → null。 */
  readonly absoluteDeltaPct: number | null;
  /** 相对差（%）= absoluteDeltaPct / base.totalReturnPct × 100；base 收益 |·| < 1e-9 → null（避免 ±∞）。 */
  readonly relativeDeltaPct: number | null;
}

/** 单轨（IS 或 OOS）消融结果。samples[0] 恒为 base。 */
export interface AblationTrackResult {
  /** 轨标识。 */
  readonly track: "IS" | "OOS";
  /** 评估样本（索引 0 = base；顺序 = 变体顺序）。 */
  readonly samples: readonly AblationSampleResult[];
  /** base 是否评估成功（记录存在时恒 true——base 失败会响亮抛错）。 */
  readonly baseSucceeded: boolean;
  /** 成功评估的非 base 变体数。 */
  readonly evaluatedCount: number;
  /** 评估失败的非 base 变体数。 */
  readonly failedCount: number;
}

// ---------------------------------------------------------------------------
// 成分贡献与 OOS 退化信号
// ---------------------------------------------------------------------------

/**
 * 单成分的双轨贡献条目（IS/OOS 各自视角）。
 *
 * 收益边际贡献（百分点）语义为正 = 该成分**保留价值**（remove 系 = base 收益 − 剔除后收益；
 * FORWARD_ADD = 加入后收益 − 加入前收益）。方向 = sign(贡献)。
 * maxDrawdown delta（百分点）= 变体 maxDD − 参照 maxDD（remove 系参照 = base/前一变体），
 * 正 = 该成分在场时回撤更低（或加入后回撤上升的相反语义随模式而定），原始呈现不做归因。
 */
export interface AblationContributionEntry {
  /** 成分 id（= AblationTarget.targetId）。 */
  readonly targetId: string;
  readonly kind: AblationComponentKind;
  readonly label: string;
  /** 贡献所取自的变体序号（可审计定位）。 */
  readonly variantIndex: number;
  /** IS 收益边际贡献（百分点；变体失败/不可评估 → null）。 */
  readonly isContributionPct: number | null;
  /** OOS 收益边际贡献（百分点；无 OOS 轨/变体失败 → null）。 */
  readonly oosContributionPct: number | null;
  /** IS maxDD 变化（百分点；相对该轨参照变体）。 */
  readonly isMaxDrawdownDeltaPct: number | null;
  /** OOS maxDD 变化（百分点；相对该轨参照变体）。 */
  readonly oosMaxDrawdownDeltaPct: number | null;
  /** 该成分在 IS 轨是否可评估（变体成功）。 */
  readonly isAssessed: boolean;
  /** 该成分在 OOS 轨是否可评估。 */
  readonly oosAssessed: boolean;
  /** 按 IS 收益边际贡献降序的排名（1 = 最高；同贡献按 targetId 字典序打破；不可评估 → null）。 */
  readonly isRank: number | null;
  /**
   * 过拟合信号候选码（描述性；仅当 IS 贡献 > floor 且 OOS 贡献转负/趋零时非 null）。
   * 记录为候选，**不下因果结论**。
   */
  readonly signalCode: AblationOverfitSignalCode | null;
}

/**
 * 过拟合信号候选（「回测好、泛化差」的机器可读清单；**描述性**，非判定、非结论）。
 *
 * 与 C-20.1 OverfittingConclusion 的关系：本模块**不下** OVERFIT/NOT_OVERFIT 聚合结论，
 * 只产出候选清单；协调者经 adapt.ts 把 `sensitiveCount = signals.length` 投影到
 * `ParameterSensitivityRobustnessView`，再由 C-20.1 `assessOfdOverfitting` 决定是否并入
 * OVERFIT 聚合结论。
 */
export interface AblationOverfitSignal {
  readonly targetId: string;
  readonly kind: AblationComponentKind;
  readonly label: string;
  /** IS 收益边际贡献（百分点，必须 > floor 才进入候选）。 */
  readonly isContributionPct: number;
  /** OOS 收益边际贡献（百分点）。 */
  readonly oosContributionPct: number;
  /** 信号码（见下方联合）。 */
  readonly code: AblationOverfitSignalCode;
  /** 人读说明（审计用途）。 */
  readonly message: string;
}

/**
 * OOS 退化信号码（描述性 reasonCode 限定集合）。
 *
 *   - `ABL_IS_POS_OOS_NEG`     ：IS 贡献 > floor 且 OOS 贡献 < 0（样本外反向）；
 *   - `ABL_IS_POS_OOS_NEUTRAL` ：IS 贡献 > floor 且 OOS 贡献 ∈ [0, oosNeutralCeilingPct]
 *                                （样本外趋零/无贡献）。
 */
export type AblationOverfitSignalCode = "ABL_IS_POS_OOS_NEG" | "ABL_IS_POS_OOS_NEUTRAL";

/** 全部信号码（供校验 / 文档化）。 */
export const ABLATION_OVERFIT_SIGNAL_CODES: readonly AblationOverfitSignalCode[] = [
  "ABL_IS_POS_OOS_NEG",
  "ABL_IS_POS_OOS_NEUTRAL",
];

// ---------------------------------------------------------------------------
// 未评估原因码（显式 unassessed；绝不静默空结果）
// ---------------------------------------------------------------------------

/**
 * 记录级未评估原因码（记录生成后补充，非抛错场景）。
 *
 *   - `ABL_NO_OOS_TRACK`        ：调用方未注入 OOS 评估器 → OOS 轨为 null，IS/OOS 对照
 *                                  与过拟合信号候选无法评估（诚实留白，不冒充）；
 *   - `ABL_NO_IS_VARIANTS`      ：IS 轨全部非 base 变体评估失败 → 无成分可归因（base 仍成功）；
 *   - `ABL_NO_OOS_VARIANTS`     ：OOS 轨全部非 base 变体评估失败 → 信号候选无法评估。
 * 退化输入（空成分集 / 成分数 < 2 / 顺序非法 / base 失败）不属于本码表——那是 FAIL FAST 抛错。
 */
export type AblationReasonCode =
  | "ABL_NO_OOS_TRACK"
  | "ABL_NO_IS_VARIANTS"
  | "ABL_NO_OOS_VARIANTS";

/** 全部原因码（供校验 / 文档化）。 */
export const ABLATION_REASON_CODES: readonly AblationReasonCode[] = [
  "ABL_NO_OOS_TRACK",
  "ABL_NO_IS_VARIANTS",
  "ABL_NO_OOS_VARIANTS",
];

// ---------------------------------------------------------------------------
// AblationAssessmentRun（一次因子消融 + IS/OOS 退化评估的完整记录）
// ---------------------------------------------------------------------------

/**
 * 一次因子消融评估的完整记录（不可变、可 JSON 序列化、带指纹）。
 *
 * 内容：
 *   - 身份：ablationRunId / strategyId@strategyVersion / mode / components / order；
 *   - 口径：thresholds（解析后自描述）；
 *   - 结果：is（IS 轨必有）/ oos（OOS 轨可选）/ contributions（成分双轨贡献 + 排序）/
 *     signals（OOS 退化信号候选清单）/ unassessedReasonCode（显式留白）/ reasons（审计文本）。
 *
 * **无 promotion**：本记录不下「能否上线 / 过拟合 / 未过拟合」聚合结论、不剔除成分、
 * 不重训、不改参数——止于「成分双轨边际贡献 + 排序 + 描述性信号候选」这一事实。
 */
export interface AblationAssessmentRun {
  readonly recordKind: typeof ABLATION_ASSESSMENT_RUN_RECORD_KIND;
  readonly recordVersion: typeof ABLATION_ASSESSMENT_RUN_RECORD_VERSION;
  readonly ablationRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 消融模式。 */
  readonly mode: AblationMode;
  /** 被消融的成分目标清单（本记录的成分全集）。 */
  readonly components: readonly AblationTarget[];
  /** CUMULATIVE_REMOVE / FORWARD_ADD 的先验顺序（REMOVE_SINGLE / LEAVE_ONE_OUT → null）。 */
  readonly order: readonly string[] | null;
  /** 解析后的信号阈值。 */
  readonly thresholds: ResolvedAblationThresholds;
  /** IS（样本内）轨结果（必有）。 */
  readonly is: AblationTrackResult;
  /** OOS（样本外）轨结果（调用方注入 OOS 评估器才有；否则 null + reasonCode）。 */
  readonly oos: AblationTrackResult | null;
  /** 成分双轨贡献 + 排序（显式非单点 argmax；按 IS 贡献降序稳定排序）。 */
  readonly contributions: readonly AblationContributionEntry[];
  /** OOS 退化信号候选清单（描述性；无 OOS 轨 → 空数组 + reasonCode）。 */
  readonly signals: readonly AblationOverfitSignal[];
  /** 是否有 OOS 轨且可对照。 */
  readonly oosAssessed: boolean;
  /** 记录级未评估原因码（null = 双轨/贡献/信号完整交付）。 */
  readonly unassessedReasonCode: AblationReasonCode | null;
  /** 审计文本（人类可读，倒序说明）。 */
  readonly reasons: readonly string[];
  /** 运行记录创建时间（ISO-8601 UTC；调用方注入，非复现输入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

/**
 * 一次因子消融评估请求。
 *
 * 契约：
 *   - components 至少 2 个（贡献归因需要对照），targetId 唯一；
 *   - mode = CUMULATIVE_REMOVE / FORWARD_ADD 时 order 必须是 components 全排列
 *     （REMOVE_SINGLE / LEAVE_ONE_OUT 忽略 order）；
 *   - isEvaluator 必填；oosEvaluator 可选（缺省 → OOS 轨 unassessed）；
 *   - **OOS 只读纪律**：order / components 必须**先于任何 OOS 求值**给定；本模块不存在
 *     「用 OOS 结果决定顺序/筛选目标」的路径（代码层保证）；
 *   - ablationRunId / createdAt 由调用方注入（缺省见 run.ts）。
 */
export interface AblationRequest {
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 成分目标清单（引用式；>= 2）。 */
  readonly components: readonly AblationTarget[];
  /** 消融模式。 */
  readonly mode: AblationMode;
  /** 先验顺序（仅 CUMULATIVE_REMOVE / FORWARD_ADD 消费；缺省 = components 顺序）。 */
  readonly order?: readonly string[];
  /** IS 轨注入式评估器（必填）。 */
  readonly isEvaluator: AblationEvaluator;
  /** OOS 轨注入式评估器（可选；缺省 → OOS 轨 unassessed）。 */
  readonly oosEvaluator?: AblationEvaluator | null;
  /** 信号阈值（缺省 = 默认常量）。 */
  readonly thresholds?: AblationThresholds;
  /** Run ID（调用方注入，保证确定性）。 */
  readonly ablationRunId: string;
  /** 创建时间（ISO-8601 UTC；调用方注入，非复现输入）。 */
  readonly createdAt: string;
}
