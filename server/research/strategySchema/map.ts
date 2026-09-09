/**
 * STEP 15 / C-15.1 — Strategy Schema + Versioning：组装 / 版本化 / 兼容映射（纯函数）。
 *
 * 职责：
 *   - createStrategyDocument：给定 §16 全字段输入 → 组装不可变本体（校验 → 规范化确定性
 *     顺序 → 计算 fingerprint → 深冻结）；
 *   - cloneStrategyDocument：版本化入口——显式 bump（patch/minor/major），叠加字段补丁生成
 *     新版本；不可变（原本体不被修改）；bump 语义闸门保证「结构变化至少 major、参数变化至少
 *     minor」（见 compare.ts classifyRequiredBumpKind）；
 *   - createStrategyVersionRecord：由本体 + 注入上下文（codeVersion / createdAt）产出 §17
 *     九项追溯记录；参数集缺省从 schema 默认值解析，required 无默认值 → 响亮抛错；
 *   - strategy13ToRecipeRef / attachSignal13Recipe：C-13.2 Strategy13 → 本体的执行配方引用
 *     （可序列化面；可执行实例由调用方按 recipeId 持有，本层不复制执行器）。
 *
 * 铁律：纯模块，无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、可序列化、确定性；
 * 失败响亮。lifecycle 状态机（C-21.1）/ 执行引擎不在本模块范围。
 */

import type { CostModel } from "../../engine/domain";
import type { SignalFrequency } from "../framework/contract";
import { ResearchValidationError } from "../experimentValidation";
import type { Strategy13 } from "../signalEngine/types";
import { assertValidStrategy13 } from "../signalEngine/validate";
import type { ResearchParameterSchema, ResearchParameterSet, ResearchParameterValue } from "../types";
import {
  STRATEGY_DOCUMENT_RECORD_KIND,
  STRATEGY_DOCUMENT_RECORD_VERSION,
  STRATEGY_VERSION_RECORD_KIND,
  STRATEGY_VERSION_RECORD_VERSION,
  type DeclaredRule,
  type PositionSizingDeclaration,
  type StrategyBacktestConfig,
  type StrategyDocument,
  type StrategyDocumentInput,
  type StrategyExecutionAssumptions,
  type StrategyMetadata,
  type StrategyRecipe,
  type StrategyUniverse,
  type StrategyVersionRecord,
  type StrategyVersionRecordContext,
} from "./types";
import { bumpStrategyVersion } from "./version";
import { classifyRequiredBumpKind, bumpCoversChange, type StrategyContentChangeKind } from "./compare";
import { validateStrategyDocument, validateStrategyVersionRecord, assertValidStrategyDocument } from "./validate";
import { computeStrategyDocumentFingerprint, computeStrategyVersionRecordFingerprint } from "./serialize";

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 深冻结（复制入参后冻结，绝不冻结调用方共享对象）。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

function sortByFeatureIdThenVersion(a: { featureId: string; version: string }, b: { featureId: string; version: string }): number {
  if (a.featureId !== b.featureId) return a.featureId < b.featureId ? -1 : 1;
  return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 组装 / 规范化
// ---------------------------------------------------------------------------

/** 规范化确定性顺序（成员集合升序 / 特征版本按 featureId 升序）；入参为已隔离的深拷贝。 */
function normalizeCanonical(doc: Record<string, unknown>): void {
  const universe = doc.universe as StrategyUniverse | undefined;
  if (universe !== undefined && universe !== null && Array.isArray(universe.members) && universe.members.length > 0) {
    doc.universe = { ...universe, members: [...universe.members].sort() };
  }
  const recipe = doc.recipe as StrategyRecipe | undefined;
  if (recipe !== undefined && recipe !== null && Array.isArray(recipe.featureVersions)) {
    doc.recipe = { ...recipe, featureVersions: [...recipe.featureVersions].sort(sortByFeatureIdThenVersion) };
  }
}

/**
 * 组装 §16 策略本体（不可变、确定性）。
 * 顺序：深拷贝入参（绝不冻结 / 共享调用方对象）→ 规范化确定性顺序 → 组装书签 +
 * 计算 fingerprint（覆盖全部内容字段，含 recordKind/recordVersion）→ 全字段结构校验
 * （失败响亮抛 ResearchValidationError）→ 深冻结。
 */
export function createStrategyDocument(input: StrategyDocumentInput): StrategyDocument {
  const clone = structuredClone(input) as Record<string, unknown>;
  normalizeCanonical(clone);
  const body = {
    recordKind: STRATEGY_DOCUMENT_RECORD_KIND,
    recordVersion: STRATEGY_DOCUMENT_RECORD_VERSION,
    ...(clone as object),
  } as unknown as Omit<StrategyDocument, "fingerprint">;
  const fingerprint = computeStrategyDocumentFingerprint(body);
  const doc = { ...body, fingerprint } as unknown as StrategyDocument;
  const validation = validateStrategyDocument(doc);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  return deepFreeze(doc);
}

// ---------------------------------------------------------------------------
// 版本化（clone + bump 语义闸门）
// ---------------------------------------------------------------------------

/** clone 补丁：只允许覆盖本体内容字段（strategyId / version / 书签不可通过补丁变更）。 */
export interface StrategyDocumentPatch {
  readonly name?: string;
  /** null = 删除可选字段（description 移除）。 */
  readonly description?: string | null;
  readonly universe?: StrategyUniverse;
  readonly entryRules?: readonly DeclaredRule[];
  readonly exitRules?: readonly DeclaredRule[];
  readonly positionSizing?: PositionSizingDeclaration;
  readonly riskRules?: readonly DeclaredRule[];
  /** 参数 schema 替换（defaultValue 变化 → minor；参数本体增删/类型/约束变化 → major）。 */
  readonly parameters?: ResearchParameterSchema;
  readonly datasetVersion?: string;
  readonly executionAssumptions?: StrategyExecutionAssumptions;
  /** 传入即替换执行配方引用；缺省继承 base（不提供删除 recipe 的入口）。 */
  readonly recipe?: StrategyRecipe;
  /** null = 删除 metadata。 */
  readonly metadata?: StrategyMetadata | null;
}

/**
 * 版本化克隆：以 base 为源、按 bump 递增版本号并叠加 patch，产出不可变新版本。
 *
 * 不可变性：base 不被修改（字段 / 数组 / 嵌套对象原样保留）；
 * 语义闸门：新版本与 base 的内容差异所需 bump 级别若超过入参 bump 级别则响亮抛错——
 *   - 仅参数 defaultValue / 文本变化 → 至少 minor（传 patch/minor 均被拒）；
 *   - 结构 / 破坏性变化（rules / universe / datasetVersion / executionAssumptions / recipe /
 *     参数 schema 本体）→ 必须 major。
 */
export function cloneStrategyDocument(
  base: StrategyDocument,
  patch: StrategyDocumentPatch,
  bump: "patch" | "minor" | "major",
): StrategyDocument {
  const next: StrategyDocumentInput = {
    strategyId: base.strategyId,
    version: bumpStrategyVersion(base.version, bump),
    name: patch.name ?? base.name,
    description: patch.description === undefined ? base.description : (patch.description ?? undefined),
    universe: patch.universe ?? base.universe,
    entryRules: patch.entryRules ?? base.entryRules,
    exitRules: patch.exitRules ?? base.exitRules,
    positionSizing: patch.positionSizing ?? base.positionSizing,
    riskRules: patch.riskRules ?? base.riskRules,
    parameters: patch.parameters ?? base.parameters,
    datasetVersion: patch.datasetVersion ?? base.datasetVersion,
    executionAssumptions: patch.executionAssumptions ?? base.executionAssumptions,
    recipe: patch.recipe ?? base.recipe,
    metadata: patch.metadata === undefined ? base.metadata : (patch.metadata ?? undefined),
  };
  const doc = createStrategyDocument(next);

  // 版本语义闸门：bump 必须覆盖内容变化所需级别（见 compare.ts）。
  const required = classifyRequiredBumpKind(base, doc) as StrategyContentChangeKind;
  if (!bumpCoversChange(bump, required)) {
    throw new Error(
      `策略版本化 bump 级别不足：内容变化要求 ${required}，实际提供 ${bump}` +
      `（结构 / 破坏性变化必须 major，参数或文本变化至少 minor；原版本 ${base.version} 未被修改）`,
    );
  }
  return doc;
}

/**
 * 解析 schema 的「默认参数集」：取每个参数的 defaultValue（含 null）；required 且无
 * defaultValue 时无法自洽解析 → 响亮抛错（该版本没有可追溯的参数快照，调用方应显式传
 * parameterSet）。与既有 resolveParameterSet（要求调用方显式提供 required 参数）不同：
 * 本函数消费的是 schema 自身已声明的默认值，用于 §17 版本追溯快照。
 */
function resolveSchemaDefaultParameterSet(schema: ResearchParameterSchema): ResearchParameterSet {
  const set: Record<string, ResearchParameterValue> = {};
  for (const def of schema.parameters) {
    if (def.defaultValue !== undefined) {
      set[def.name] = def.defaultValue;
    } else if (def.required) {
      throw new ResearchValidationError([
        {
          code: "REQUIRED_PARAM_NO_DEFAULT",
          path: `parameters.parameters[${schema.parameters.indexOf(def)}]`,
          message: `必填参数 ${def.name} 未声明 defaultValue，无法解析 §17 parameters 追溯快照；请显式传入 parameterSet 或为该参数补充默认值`,
        },
      ]);
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// §17 版本追溯记录
// ---------------------------------------------------------------------------

/** createStrategyVersionRecord 输入。 */
export interface StrategyVersionRecordInput {
  /** §17 strategy：策略本体（须已通过校验）。 */
  readonly document: StrategyDocument;
  /** 注入上下文（codeVersion / createdAt；风格对齐 experimentLineage）。 */
  readonly context: StrategyVersionRecordContext;
  /**
   * §17 parameters：该版本参数集；缺省时从 document.parameters 解析默认值
   * （schema 存在 required 且无 defaultValue 的参数时解析失败 → 响亮抛错）。
   */
  readonly parameterSet?: ResearchParameterSet;
}

/**
 * 由策略本体 + 注入上下文组装 §17 九项追溯记录（不可变、确定性）。
 * 顶层追溯字段 = strategy 内对应字段的显式投影（validator 复核一致），便于机器按 §17 逐项查询。
 */
export function createStrategyVersionRecord(input: StrategyVersionRecordInput): StrategyVersionRecord {
  assertValidStrategyDocument(input.document);
  const doc = input.document;

  const parameterSet: ResearchParameterSet =
    input.parameterSet !== undefined
      ? structuredClone(input.parameterSet)
      : resolveSchemaDefaultParameterSet(doc.parameters);

  const cloneCostModel = (model: CostModel): CostModel => structuredClone(model);
  const cloneBacktest = (config: StrategyBacktestConfig): StrategyBacktestConfig => structuredClone(config);

  const record = {
    recordKind: STRATEGY_VERSION_RECORD_KIND,
    recordVersion: STRATEGY_VERSION_RECORD_VERSION,
    strategyId: doc.strategyId,
    version: doc.version,
    strategy: structuredClone(doc),
    parameterSet,
    datasetVersion: doc.datasetVersion,
    universeId: doc.universe.universeId,
    backtestConfig: cloneBacktest(doc.executionAssumptions.backtestConfig),
    costModel: cloneCostModel(doc.executionAssumptions.costModel),
    executionModel: doc.executionAssumptions.executionModel,
    codeVersion: input.context.codeVersion,
    createdAt: input.context.createdAt,
  };
  const fingerprint = computeStrategyVersionRecordFingerprint(record);
  const full = { ...record, fingerprint };
  const validation = validateStrategyVersionRecord(full);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  return deepFreeze(full);
}

// ---------------------------------------------------------------------------
// C-13.2 兼容映射：Strategy13 → 执行配方引用
// ---------------------------------------------------------------------------

/** strategy13ToRecipeRef 选项。 */
export interface Signal13RecipeOptions {
  /** 执行配方唯一标识（调用方把对应 C-13.2 Strategy13 实例注册到该键）。 */
  readonly recipeId: string;
  /** 信号频率（= 配套 StrategyContract.signalFrequency）。 */
  readonly signalFrequency: SignalFrequency;
  /** 所需数据域（= 配套 StrategyContract.requiredData，如 OHLCV / Industry）。 */
  readonly requiredData?: readonly string[];
}

/**
 * Strategy13 → 执行配方引用（StrategyRecipe）的兼容映射。
 *
 * 只提炼可序列化面：决策时点 / 特征版本（featureId → version，按 featureId 升序）/
 * 排序与选择配置快照 / 信号描述。可执行实例（FeatureProvider.compute、signalBuilder 等函数）
 * 仍由策略代码库以 recipeId 为键持有——本层是引用而非执行器复制。
 * 输入配方先经 assertValidStrategy13 校验（非法即抛 ResearchValidationError）。
 */
export function strategy13ToRecipeRef(strategy13: Strategy13, options: Signal13RecipeOptions): StrategyRecipe {
  assertValidStrategy13(strategy13);
  if (options.recipeId.trim() === "") {
    throw new Error("strategy13ToRecipeRef: recipeId 不能为空（调用方需把 C-13.2 Strategy13 实例注册到该键）");
  }
  const featureVersions = strategy13.features
    .map((feature) => ({ featureId: feature.featureId, version: feature.version }))
    .sort(sortByFeatureIdThenVersion);
  const recipe: StrategyRecipe = {
    kind: "signalEngine",
    recipeId: options.recipeId,
    point: strategy13.point,
    signalFrequency: options.signalFrequency,
    signalDescription: strategy13.signalDescription === undefined ? undefined : strategy13.signalDescription,
    featureVersions,
    rankingConfig: structuredClone(strategy13.rankingConfig),
    selectionConfig: structuredClone(strategy13.selectionConfig),
    requiredData: options.requiredData === undefined ? [] : [...options.requiredData],
  };
  return recipe;
}

/** 把 Strategy13 映射的配方引用挂到策略本体输入上（不校验；交由 createStrategyDocument 终检）。 */
export function attachSignal13Recipe(
  input: StrategyDocumentInput,
  strategy13: Strategy13,
  options: Signal13RecipeOptions,
): StrategyDocumentInput {
  return { ...input, recipe: strategy13ToRecipeRef(strategy13, options) };
}
