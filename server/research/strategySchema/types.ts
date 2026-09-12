/**
 * STEP 15 / C-15.1 — Strategy Schema + Versioning：策略本体类型（类型权威源）。
 *
 * 背景（ROADMAP §16 / §17）：
 *   - §16 要求「策略必须结构化并统一」：strategyId / version / name / description /
 *     universe / entry rules / exit rules / position sizing / risk rules / parameters /
 *     dataset version / execution assumptions，且策略必须可保存/加载/复制/比较/版本化；
 *   - §17 要求从 STEP 15 起具备最小版本能力：每个版本可追溯 strategy / parameters /
 *     dataset / universe / backtest config / cost model / execution model / code version /
 *     created_at；完整 Strategy Lifecycle 状态机属 STEP 21 / C-21.1，本目录不做。
 *
 * 与既有载体的关系（详见本目录 map.ts 与交付报告）：
 *   - Strategy13（C-13.2，signalEngine/types.ts）是「可执行配方」视角：含 FeatureProvider /
 *     SignalBuilder 等函数实例，不可整体 JSON 序列化。本目录将其「可序列化面」提炼为
 *     StrategyRecipe 引用（recipeKind="signalEngine"），嵌入 StrategyDocument 供审计与版本化，
 *     可执行实例仍由策略代码库按 recipeId 持有——本目录不复制执行器；
 *   - StrategyContract（STEP 10，framework/contract.ts）是身份 / 参数 schema / 所需数据 /
 *     频率视角，被本目录以 recipe 字段吸收其可序列化面，不作运行时依赖；
 *   - experimentLineage（C-13.3）回答「一次实验结果怎么产生」，codeVersion 采用注入式
 *     composeCodeVersion 且缺省显式 missing；本目录的 §17 版本追溯记录（StrategyVersionRecord）
 *     codeVersion / createdAt 同样由入口注入，风格对齐。
 *
 * 铁律：全部字段 readonly；可 JSON 序列化；禁止 NaN / Infinity / Date.now / Math.random；
 * 构造确定性；失败响亮。生命周期状态机 / 执行引擎 / 优化不在本目录范围。
 */

import type { DecisionPoint } from "../../data";
import type { CostModel } from "../../engine/domain";
import type {
  RankingConfig,
  SelectionConfig,
  SignalFrequency,
} from "../framework/contract";
import type { FeatureVersionRef } from "../signalEngine/types";
import type { ResearchParameterSchema, ResearchParameterSet } from "../types";
// STEP STRATEGY-003：富 StrategyDefinition（类型唯一来源在 definition.ts；此处仅 type-only 引用，
// 不构成运行时循环依赖 —— definition.ts 不 import 本文件）。
import type { StrategyDefinition } from "./definition";

// ---------------------------------------------------------------------------
// 记录书签
// ---------------------------------------------------------------------------

/** 策略本体记录种类标签（供序列化 / 反序列化判别，防止类型混淆）。 */
export const STRATEGY_DOCUMENT_RECORD_KIND = "STRATEGY_DOCUMENT" as const;

/** 策略本体 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const STRATEGY_DOCUMENT_RECORD_VERSION = 1 as const;

/** 版本追溯记录种类标签。 */
export const STRATEGY_VERSION_RECORD_KIND = "STRATEGY_VERSION_RECORD" as const;

/** 版本追溯记录 schema 版本。 */
export const STRATEGY_VERSION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 结构化版本（major.minor.patch）
// ---------------------------------------------------------------------------

/** 语义版本严格形态：三段非负整数，禁止前导零（"1.0.0" / "2.0.0"；兼容 §17 V1.0/V1.1/V2.0 语义）。 */
export const STRATEGY_VERSION_FORMAT_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** 版本 bump 级别（patch 最低，major 最高；「至少 minor」= 不低于 minor）。 */
export type StrategyVersionBump = "patch" | "minor" | "major";

/** 值是否为合法策略版本号（供 validator / 测试复用）。 */
export function isValidStrategyVersionFormat(value: string): boolean {
  return STRATEGY_VERSION_FORMAT_RE.test(value);
}

// ---------------------------------------------------------------------------
// 声明式规则（entry / exit / risk 共用描述符，声明不执行）
// ---------------------------------------------------------------------------

/** 声明式规则种类（机器可读的分类，不构成执行语义）。 */
export const DECLARED_RULE_KINDS = ["threshold", "time-based", "state", "event"] as const;
export type DeclaredRuleKind = (typeof DECLARED_RULE_KINDS)[number];

/** 声明式比较操作符（与 operand 配对，仅供审计 / 未来执行器引用）。 */
export const RULE_COMPARISON_OPERATORS = [">=", ">", "<=", "<", "==", "!="] as const;
export type RuleComparisonOperator = (typeof RULE_COMPARISON_OPERATORS)[number];

/**
 * 声明式规则描述符（§16 entry rules / exit rules / risk rules 的统一载体）。
 *
 * 设计纪律：本模块只做「结构化、可审计、可版本化」的规则声明，不实现执行引擎——
 * description 是唯一完整人类可读语义；kind/field/operator/operand 是机器可读的
 * 结构化片段（field 引用数据/参数名，operator+operand 表达数值或字符串比较意图），
 * 供比较 / 指纹 / 未来（C-14.x 之后）执行器引用。不允许出现自由文本兜底。
 */
export interface DeclaredRule {
  /** 规则 id（所在规则集内唯一；供引用与审计）。 */
  readonly id: string;
  readonly kind: DeclaredRuleKind;
  /** 人类可读完整语义（唯一必填的语义表述，禁止留空）。 */
  readonly description: string;
  /** 数据 / 参数引用（审计），如 "price.pctChange"、"position.holdingDays"。 */
  readonly field?: string;
  readonly operator?: RuleComparisonOperator;
  /** 比较目标（与 operator 配对；null 表示与「无值/未设」比较）。 */
  readonly operand?: number | string | null;
  /** 补充说明（可选）。 */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Position Sizing（声明式，不执行）
// ---------------------------------------------------------------------------

/** 仓位规则种类（机器可读白名单）。 */
export const POSITION_SIZING_KINDS = ["equal-weight", "fixed-fraction", "rank-weighted"] as const;
export type PositionSizingKind = (typeof POSITION_SIZING_KINDS)[number];

/**
 * 仓位规则声明（§16 position sizing）。
 * equal-weight：入选等权分仓；fixed-fraction：每仓占初始资金 fraction；rank-weighted：按排名加权。
 */
export type PositionSizingDeclaration =
  | { readonly kind: "equal-weight"; readonly maxPositions: number }
  | { readonly kind: "fixed-fraction"; readonly fraction: number; readonly maxPositions: number }
  | { readonly kind: "rank-weighted"; readonly maxPositions: number };

// ---------------------------------------------------------------------------
// Universe / Dataset / Execution assumptions
// ---------------------------------------------------------------------------

/**
 * Universe 声明（§16 universe）。
 *
 * 研究链路的事实（见 C-13.1 handle.ts）：Research Dataset 的 universeDefinition 决议
 * as-of 成员，universeId = deriveDatasetUniverseId(datasetVersion) = "research-dataset:<rd-…>"。
 * 因此 dataset 派生 universe 时写 universeId 并省略 members；静态白名单（测试 / 演示）用
 * 显式 members 表达。
 */
export interface StrategyUniverse {
  /** universe 标识（非空）；派生 universe 必须等于 research-dataset:<datasetVersion>。 */
  readonly universeId: string;
  /** 显式固定成员（升序去重交给调用方纪律；validator 校验重复与空项）；派生 universe 时省略。 */
  readonly members?: readonly string[];
  /** 人类可读说明（审计用）。 */
  readonly description?: string;
}

/** 回测配置声明（§17 backtest config 项；完整口径见 executionAssumptions.costModel）。 */
export interface StrategyBacktestConfig {
  /** 初始资金（> 0）。 */
  readonly initialCapital: number;
  /** 最大持仓数（>= 1 整数）；缺省则由 positionSizing.maxPositions 表达。 */
  readonly maxPositions?: number;
}

/**
 * Execution Assumptions（§16 execution assumptions / §17 backtest config + cost model + execution model）。
 *
 * 与 backtest 层的命名对齐：ExecutionModelId（NEXT_OPEN/…）与 CostModel（engine/domain 六字段
 * 单一事实来源）。研究链路 legacy 的 "next-open" 小写写法亦在白名单内（engineAdapter 校验口径），
 * 未来 C-14.x 交易模拟消费本字段形态。
 */
export interface StrategyExecutionAssumptions {
  readonly backtestConfig: StrategyBacktestConfig;
  /** 冻结的成本模型（engine/domain CostModel 六字段单一来源，深拷贝冻结）。 */
  readonly costModel: CostModel;
  /** 执行模型标识（白名单见 STRATEGY_EXECUTION_MODEL_IDS）。 */
  readonly executionModel: string;
}

/** 执行模型标识白名单（backtest ExecutionModelId 四值 + 研究链路 "next-open"）。 */
export const STRATEGY_EXECUTION_MODEL_IDS = [
  "NEXT_OPEN",
  "NEXT_CLOSE",
  "VWAP_PROXY",
  "LIMIT_PRICE",
  "next-open",
] as const;

export type StrategyExecutionModelId = (typeof STRATEGY_EXECUTION_MODEL_IDS)[number];

// ---------------------------------------------------------------------------
// 执行配方引用（C-13.2 Strategy13 的可序列化面）
// ---------------------------------------------------------------------------

/**
 * 执行配方引用（嵌入策略本体的可序列化摘要，不携带函数实例）。
 *
 * recipeKind="signalEngine"：对应 C-13.2 signalEngine 的 Strategy13（Feature→Signal→Ranking→Selection
 * 可执行配方）。可执行实例由策略代码库 / 调用方以 recipeId 为键持有并注册；本模块只保存其
 * 可序列化面（决策时点 / 特征版本 / 排序与选择配置 / 频率 / 所需数据域），使策略文档可保存、
 * 比较与版本化，同时不复制执行器。
 */
export interface StrategyRecipe {
  /** 配方载体种类（当前唯一：signalEngine；未来新增配方载体须扩展 union 语义）。 */
  readonly kind: "signalEngine";
  /** 执行配方唯一标识（策略代码库把 C-13.2 Strategy13 实例注册到该键）。 */
  readonly recipeId: string;
  /** 决策时点（全 run 固定 open | close；= Strategy13.point）。 */
  readonly point: DecisionPoint;
  /** 信号频率（= StrategyContract.signalFrequency）。 */
  readonly signalFrequency: SignalFrequency;
  /** 人类可读信号描述（审计用；可缺省）。 */
  readonly signalDescription?: string;
  /** 配方声明依赖的特征（featureId → version，按 featureId 升序）。 */
  readonly featureVersions: readonly FeatureVersionRef[];
  /** 排序配置快照（= Strategy13.rankingConfig）。 */
  readonly rankingConfig: Readonly<RankingConfig>;
  /** 选择配置快照（= Strategy13.selectionConfig）。 */
  readonly selectionConfig: Readonly<SelectionConfig>;
  /** 所需数据域（= StrategyContract.requiredData，如 OHLCV / Industry）。 */
  readonly requiredData: readonly string[];
}

// ---------------------------------------------------------------------------
// 策略本体（§16 全字段）
// ---------------------------------------------------------------------------

/** 策略本体元数据（审计用，不参与计算）。 */
export interface StrategyMetadata {
  readonly author?: string;
  readonly tags?: readonly string[];
}

/**
 * §16 策略本体（不可变、可序列化、确定性；策略族的正式声明）。
 *
 * 覆盖 §16 全部字段：strategyId / version / name / description / universe / entry rules /
 * exit rules / position sizing / risk rules / parameters（参数 schema）/ dataset version /
 * execution assumptions。recipe 为 §16 之外的可选补充——把 C-13.2 执行配方的可序列化面
 * 嵌入本体，使「声明」与「执行配方」可一同版本化。
 *
 * version 为严格 major.minor.patch 语义版本（§17 示例 V1.0/V1.1/V2.0 的量化形态）。
 */
export interface StrategyDocument {
  readonly recordKind: typeof STRATEGY_DOCUMENT_RECORD_KIND;
  readonly recordVersion: typeof STRATEGY_DOCUMENT_RECORD_VERSION;

  // -- §16 身份 --
  readonly strategyId: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;

  // -- §16 rules --
  readonly universe: StrategyUniverse;
  /** 入场规则集（可空数组 = 无显式入场门槛；id 集内唯一）。 */
  readonly entryRules: readonly DeclaredRule[];
  /** 退出规则集（可空数组 = 持有至期末退出）。 */
  readonly exitRules: readonly DeclaredRule[];
  readonly positionSizing: PositionSizingDeclaration;
  /** 风险规则集（如 max 持仓 / stop-loss / 最大回撤闸门）。 */
  readonly riskRules: readonly DeclaredRule[];

  // -- §16 参数空间（schema，defaultValue 表达该版本默认参数） --
  readonly parameters: ResearchParameterSchema;

  // -- §16 dataset 绑定 --
  /** 内容寻址数据集版本（rd-…，见 C-12.6.1；validator 校验格式）。 */
  readonly datasetVersion: string;
  /**
   * 🔴 STEP STRATEGY-004 — **Dataset Registry 权威坐标**（`dataset_version.id`）。
   *
   * 与 `datasetVersion` 成对：本字段是跨模块唯一 Dataset Version 引用，
   * `datasetVersion` 降级为显示 / 快照 label（`v1` / `v2`）。
   *
   * 与 `definition.datasets` 中 PRIMARY 绑定的关系（与 v1 视图同一纪律）：
   *   Canonical `definition.datasets(PRIMARY).datasetVersionId`  ──单向派生──►  本字段
   * 提供 definition 时本字段由派生值补齐；显式提供且与派生值不一致 → 响亮报错（不静默覆盖）。
   * 缺省 = legacy `rd-…` 绑定（保留旧兼容分支）。
   */
  readonly datasetVersionId?: number;

  // -- §16 execution assumptions --
  readonly executionAssumptions: StrategyExecutionAssumptions;

  /**
   * STEP STRATEGY-003 — **富 StrategyDefinition**（可选）。
   *
   * 提供时它成为该版本的 **Canonical 规则快照**：`entry / exit / position / risk / execution /
   * parameters / datasets` 完整表达「研究什么事件、观察多久、满足什么条件、何时出信号、
   * 什么时候成交、买多少、什么时候卖、如何控风险、哪些参数可优化」。
   *
   * 与上方 v1 字段的关系（用户裁定 D1：在既有文档内演进，不建第二套 Source of Truth）：
   *   Canonical `definition`  ──派生──►  entryRules / exitRules / riskRules /
   *                                     positionSizing / parameters / executionModel
   * 即 v1 字段是 **definition 的兼容视图**（派生是有损的，映射表见 map.ts#deriveLegacyViews）。
   * `createStrategyDocument` 在提供 definition 时**自动派生缺失的 v1 字段**；若调用方同时显式
   * 提供且与派生结果不一致，会响亮报 `SCHEMA_DEFINITION_VIEW_CONFLICT`（不静默覆盖）。
   *
   * 未提供 definition 时，本字段缺省，文档行为与 STEP-001 / STRATEGY-002 完全一致。
   */
  readonly definition?: StrategyDefinition;

  // -- 执行配方引用（可选；C-13.2 Strategy13 可序列化面） --
  readonly recipe?: StrategyRecipe;

  // -- 元数据 / 指纹 --
  readonly metadata?: StrategyMetadata;
  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

/** createStrategyDocument 输入（recordKind / recordVersion / fingerprint 由组装层固定）。 */
export type StrategyDocumentInput = Omit<StrategyDocument, "recordKind" | "recordVersion" | "fingerprint">;

// ---------------------------------------------------------------------------
// §17 版本追溯记录
// ---------------------------------------------------------------------------

/** createStrategyVersionRecord 上下文（注入式，风格对齐 experimentLineage）。 */
export interface StrategyVersionRecordContext {
  /** 代码版本（入口用 composeCodeVersion(packageVersion, git) 解析后注入；本模块不自行读文件）。 */
  readonly codeVersion: string;
  /** 版本创建时间（ISO-8601 UTC；元数据，非复现输入，由入口注入）。 */
  readonly createdAt: string;
}

/**
 * §17 最小版本追溯记录：一个策略版本的不可变快照，直接回答「该版本可追溯的 9 项」。
 *
 *   strategy       → strategy（完整 §16 本体快照）
 *   parameters     → parameterSet（该版本解析后的参数集，validator 复核与 schema 一致）
 *   dataset        → datasetVersion（= strategy.datasetVersion，validator 复核一致）
 *   universe       → universeId（= strategy.universe.universeId）
 *   backtest config→ backtestConfig（= strategy.executionAssumptions.backtestConfig）
 *   cost model     → costModel（= strategy.executionAssumptions.costModel）
 *   execution model→ executionModel（= strategy.executionAssumptions.executionModel）
 *   code version   → codeVersion（入口注入；格式校验）
 *   created_at     → createdAt（入口注入）
 *
 * 冗余字段采用「validator 复核一致」纪律：顶层追溯字段必须等于 strategy 内对应字段，
 * 便于机器按 §17 逐项查询而不丢失本体。生命周期状态机（C-21.1）不做。
 */
export interface StrategyVersionRecord {
  readonly recordKind: typeof STRATEGY_VERSION_RECORD_KIND;
  readonly recordVersion: typeof STRATEGY_VERSION_RECORD_VERSION;

  // -- §17 身份 --
  readonly strategyId: string;
  readonly version: string;

  // -- §17 九项追溯 --
  /** §17 strategy：该版本完整策略本体快照。 */
  readonly strategy: StrategyDocument;
  /** §17 parameters：该版本解析后的参数集（schema 一致）。 */
  readonly parameterSet: Readonly<ResearchParameterSet>;
  /** §17 dataset：内容寻址数据集版本。 */
  readonly datasetVersion: string;
  /** §17 universe：universe 标识。 */
  readonly universeId: string;
  /** §17 backtest config。 */
  readonly backtestConfig: StrategyBacktestConfig;
  /** §17 cost model（冻结）。 */
  readonly costModel: CostModel;
  /** §17 execution model。 */
  readonly executionModel: string;
  /** §17 code version（注入）。 */
  readonly codeVersion: string;
  /** §17 created_at（注入，ISO-8601 UTC）。 */
  readonly createdAt: string;

  /** 内容指纹（sha256，十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}
