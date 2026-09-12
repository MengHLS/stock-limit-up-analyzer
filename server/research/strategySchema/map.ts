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
  normalizeStrategyDefinition,
  type StrategyDefinition,
  type StrategyDefinitionInput,
} from "./definition";
import { validateCanonicalStrategyDefinition } from "./definitionValidation";
import { deriveLegacyViews, legacyViewsEqual } from "./legacyViews";
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

// ---------------------------------------------------------------------------
// STEP STRATEGY-003 — Canonical Definition ⇄ v1 兼容视图
// ---------------------------------------------------------------------------
// 派生实现（deriveLegacyViews / deriveExecutionModel / legacyViewsEqual）已抽到叶子模块
// ./legacyViews.ts：它同时被 validate.ts 复用做「反序列化后一致性复核」，若留在本文件
// 会与 validate.ts 形成运行时循环依赖。
/**
 * 在组装前把 Canonical `definition` 与 v1 视图对齐：
 *   - definition 缺失 → 原样返回（既有行为零改动）；
 *   - definition 存在 → 校验它 → 派生视图 → **缺失的 v1 字段由派生值补齐**；
 *     调用方**显式提供**且与派生值不一致的字段 → 报 `SCHEMA_DEFINITION_VIEW_CONFLICT`（不静默覆盖）。
 */
function alignDefinitionViews(clone: Record<string, unknown>, issues: { code: string; path: string; message: string }[]): void {
  const rawDefinition = clone.definition;
  if (rawDefinition === undefined || rawDefinition === null) return;

  const definition = normalizeStrategyDefinition(rawDefinition as StrategyDefinitionInput);
  const definitionValidation = validateCanonicalStrategyDefinition(definition);
  // 校验器的 issue.path 以 StrategyDefinition 根为基准（如 exit.rules[0]），
  // 嵌入 StrategyDocument 时必须补 `definition.` 前缀；否则文档路径与 refetch 时
  // validate.ts 的路径不一致（后者会再 rebase 一次）。
  issues.push(...definitionValidation.issues.map((item) => ({
    code: item.code,
    path: `definition.${item.path}`,
    message: item.message,
  })));
  clone.definition = definition;

  const views = deriveLegacyViews(definition);

  const conflict = (field: string): void => {
    issues.push({
      code: "SCHEMA_DEFINITION_VIEW_CONFLICT",
      path: field,
      message: `${field} 与 definition 派生结果不一致。definition 是 Canonical（唯一权威），` +
        "v1 字段是其派生视图；请删除该字段让组装层自动派生，或修正 definition —— 本层不会静默覆盖。",
    });
  };

  const fillOrCheck = (field: string, derived: unknown): void => {
    const current = clone[field];
    if (current === undefined || current === null) {
      clone[field] = derived;
      return;
    }
    if (!legacyViewsEqual(current, derived)) conflict(field);
  };

  fillOrCheck("entryRules", views.entryRules);
  fillOrCheck("exitRules", views.exitRules);
  fillOrCheck("riskRules", views.riskRules);
  fillOrCheck("positionSizing", views.positionSizing);
  fillOrCheck("parameters", views.parameters);

  if (views.datasetVersion !== undefined) {
    const current = clone.datasetVersion;
    if (current === undefined || current === null || current === "") {
      clone.datasetVersion = views.datasetVersion;
    } else if (!legacyViewsEqual(current, views.datasetVersion)) {
      issues.push({
        code: "SCHEMA_DEFINITION_DATASET_VERSION_MISMATCH",
        path: "datasetVersion",
        message: `datasetVersion（${String(current)}）与 definition.datasets 的 PRIMARY 绑定（${views.datasetVersion}）不一致`,
      });
    }
  }

  // STRATEGY-004：doc 级 datasetVersionId 是 PRIMARY 绑定权威坐标的兼容视图（单向派生）。
  if (views.datasetVersionId !== undefined) {
    const current = clone.datasetVersionId;
    if (current === undefined || current === null) {
      clone.datasetVersionId = views.datasetVersionId;
    } else if (!legacyViewsEqual(current, views.datasetVersionId)) {
      issues.push({
        code: "SCHEMA_DEFINITION_DATASET_VERSION_ID_MISMATCH",
        path: "datasetVersionId",
        message: `datasetVersionId（${String(current)}）与 definition.datasets 的 PRIMARY 绑定（${views.datasetVersionId}）不一致`,
      });
    }
  } else if (clone.datasetVersionId !== undefined && clone.datasetVersionId !== null) {
    // PRIMARY 绑定走 legacy rd-… 分支（未声明坐标），doc 级却声明了坐标 → 语义冲突，响亮拒绝。
    issues.push({
      code: "SCHEMA_DEFINITION_DATASET_VERSION_ID_MISMATCH",
      path: "datasetVersionId",
      message: `datasetVersionId（${String(clone.datasetVersionId)}）与 definition.datasets 的 PRIMARY 绑定不一致：` +
        "该绑定未声明 datasetVersionId（legacy rd-… 分支），doc 级坐标必须删除或改为在绑定时声明。",
    });
  }

  const assumptions = clone.executionAssumptions;
  if (assumptions === undefined || assumptions === null) {
    issues.push({
      code: "SCHEMA_DEFINITION_EXECUTION_ASSUMPTIONS_REQUIRED",
      path: "executionAssumptions",
      message: "提供 definition 时仍须显式提供 executionAssumptions.backtestConfig 与 .costModel（成本费率与初始资金无法从 definition 派生）",
    });
    return;
  }
  const asRecord = assumptions as Record<string, unknown>;
  const providedModel = asRecord.executionModel;
  if (providedModel === undefined || providedModel === null) {
    asRecord.executionModel = views.executionModel;
  } else if (!legacyViewsEqual(providedModel, views.executionModel)) {
    issues.push({
      code: "SCHEMA_DEFINITION_EXECUTION_MODEL_MISMATCH",
      path: "executionAssumptions.executionModel",
      message: `executionModel（${String(providedModel)}）与 definition.execution 的时序对派生结果（${views.executionModel}）不一致；` +
        "executionModel 是派生视图，请删除它让组装层自动派生。",
    });
  }
}

/**
 * `cloneVersion`（按指定源版本 clone，SPEC §13 / §26）的文档组装。
 *
 * - 源文档**有** Canonical definition → v1 兼容视图**不传入**，由 `assembleStrategyDocument`
 *   从被复制的 definition 单向重新派生（保证新版本的视图与定义一致）；
 * - 源文档**无** definition（历史 v1 文档）→ v1 字段原样复制。
 * - 版本号由调用方给出（可以是历史版本 +1，也可以是任意未占用的目标版本号）；
 *   `fingerprint` 必然重算（版本号本身参与指纹）。
 */
export function cloneStrategyDocumentToVersion(
  base: StrategyDocument,
  targetVersion: string,
  description?: string | null,
): StrategyDocument {
  const raw: Record<string, unknown> = {
    strategyId: base.strategyId,
    version: targetVersion,
    name: base.name,
    description: description ?? base.description,
    universe: base.universe,
    ...(base.definition === undefined
      ? {
        entryRules: base.entryRules,
        exitRules: base.exitRules,
        positionSizing: base.positionSizing,
        riskRules: base.riskRules,
        parameters: base.parameters,
      }
      : { definition: base.definition }),
    datasetVersion: base.datasetVersion,
    ...(base.datasetVersionId === undefined ? {} : { datasetVersionId: base.datasetVersionId }),
    executionAssumptions: base.executionAssumptions,
    ...(base.recipe === undefined ? {} : { recipe: base.recipe }),
    ...(base.metadata === undefined ? {} : { metadata: base.metadata }),
  };
  return assembleStrategyDocument(raw);
}

/**
 * 组装 Canonical `StrategyDefinition`：规范化（确定性顺序）→ 校验（结构 + Look-Ahead）→ 深冻结。
 *
 * 与 `createStrategyDocumentFromDefinition` 的分工：本函数产出**定义级**对象（无身份 / 无 universe /
 * 无成本模型），供「定义是否合法 / 两份定义是否同一套规则」的独立使用与测试；
 * 文档级组装仍走 `createStrategyDocumentFromDefinition`。
 */
export function createStrategyDefinition(input: StrategyDefinitionInput): StrategyDefinition {
  const definition = normalizeStrategyDefinition(input);
  const validation = validateCanonicalStrategyDefinition(definition);
  if (!validation.valid) {
    throw new ResearchValidationError(validation.issues);
  }
  return deepFreeze(definition);
}

/**
 * 组装 §16 策略本体（不可变、确定性）。
 * 顺序：深拷贝入参（绝不冻结 / 共享调用方对象）→ 规范化确定性顺序 →
 * **对齐 Canonical definition 与 v1 派生视图**（仅当提供 definition）→ 组装书签 +
 * 计算 fingerprint（覆盖全部内容字段，含 recordKind/recordVersion 与 definition）→
 * 全字段结构校验（失败响亮抛 ResearchValidationError）→ 深冻结。
 */
function assembleStrategyDocument(input: Record<string, unknown>): StrategyDocument {
  const clone = structuredClone(input);
  normalizeCanonical(clone);
  const preIssues: { code: string; path: string; message: string }[] = [];
  alignDefinitionViews(clone, preIssues);
  const body = {
    recordKind: STRATEGY_DOCUMENT_RECORD_KIND,
    recordVersion: STRATEGY_DOCUMENT_RECORD_VERSION,
    ...(clone as object),
  } as unknown as Omit<StrategyDocument, "fingerprint">;
  const fingerprint = computeStrategyDocumentFingerprint(body);
  const doc = { ...body, fingerprint } as unknown as StrategyDocument;
  const validation = validateStrategyDocument(doc);
  const issues = [...preIssues, ...validation.issues];
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
  return deepFreeze(doc);
}

/**
 * 组装 §16 策略本体（不可变、确定性）。
 * 提供 `definition` 时自动派生 v1 兼容视图（见 `alignDefinitionViews`）；
 * 未提供时行为与 STEP-001 / STRATEGY-002 完全一致。
 */
export function createStrategyDocument(input: StrategyDocumentInput): StrategyDocument {
  return assembleStrategyDocument(input as unknown as Record<string, unknown>);
}

/** `createStrategyDocumentFromDefinition` 输入：只需给 Canonical Definition 与不可派生项。 */
export interface StrategyDocumentFromDefinitionInput {
  readonly strategyId: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  readonly universe: StrategyUniverse;
  /** Canonical 富定义（`schemaVersion` 缺省补 `1.0`）。 */
  readonly definition: StrategyDefinitionInput;
  /** 省略时取 `definition.datasets` 中 PRIMARY 绑定的 datasetVersion。 */
  readonly datasetVersion?: string;
  /** 省略时取 `definition.datasets` 中 PRIMARY 绑定的 datasetVersionId（Dataset Registry 权威坐标）。 */
  readonly datasetVersionId?: number;
  /**
   * 执行假设：`backtestConfig` 与 `costModel`（费率/资金）**必须显式提供**（无法从 definition 派生）；
   * `executionModel` 省略时由 `definition.execution.executionTiming` 派生。
   */
  readonly executionAssumptions: {
    readonly backtestConfig: StrategyBacktestConfig;
    readonly costModel: CostModel;
    readonly executionModel?: string;
  };
  readonly recipe?: StrategyRecipe;
  readonly metadata?: StrategyMetadata;
}

/**
 * 由 Canonical `StrategyDefinition` 组装完整 StrategyDocument（STEP STRATEGY-003 的推荐入口）。
 * v1 兼容视图（entryRules / exitRules / riskRules / positionSizing / parameters / executionModel /
 * datasetVersion）全部由 definition 单向派生，调用方无需手工保持一致。
 *
 * ⚠️ 本入口**要求** definition 存在：传 undefined / null 会让组装层退化成
 * `definition = { schemaVersion: "1.0" }`（缺 entry/exit/…），最终在派生视图时抛出
 * 难以定位的 `Cannot read properties of undefined`。因此在这里**响亮失败**：
 * 无 definition 的历史 v1 文档必须走 `createStrategyDocument`。
 */
export function createStrategyDocumentFromDefinition(
  input: StrategyDocumentFromDefinitionInput,
): StrategyDocument {
  const rawDefinition = input?.definition;
  if (rawDefinition === undefined || rawDefinition === null || typeof rawDefinition !== "object") {
    throw new ResearchValidationError([{
      code: "SCHEMA_DEFINITION_REQUIRED",
      path: "definition",
      message: "createStrategyDocumentFromDefinition 要求提供 definition（Canonical 富定义）；" +
        "历史 v1 文档（无 definition）请使用 createStrategyDocument。",
    }]);
  }
  const raw: Record<string, unknown> = {
    strategyId: input.strategyId,
    version: input.version,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    universe: input.universe,
    definition: {
      schemaVersion: "1.0",
      ...(structuredClone(rawDefinition) as object),
    },
    executionAssumptions: {
      backtestConfig: input.executionAssumptions.backtestConfig,
      costModel: input.executionAssumptions.costModel,
      ...(input.executionAssumptions.executionModel === undefined
        ? {}
        : { executionModel: input.executionAssumptions.executionModel }),
    },
    ...(input.datasetVersion === undefined ? {} : { datasetVersion: input.datasetVersion }),
    ...(input.datasetVersionId === undefined ? {} : { datasetVersionId: input.datasetVersionId }),
    ...(input.recipe === undefined ? {} : { recipe: input.recipe }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
  return assembleStrategyDocument(raw);
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
  /** STRATEGY-004：替换 Dataset Registry 权威坐标（`dataset_version.id`）。 */
  readonly datasetVersionId?: number;
  readonly executionAssumptions?: StrategyExecutionAssumptions;
  /**
   * STEP STRATEGY-003：替换 Canonical 富定义。传入时本函数会**忽略**上面的 v1 视图字段
   * （entryRules / exitRules / riskRules / positionSizing / parameters），改由新 definition
   * 单向派生，避免出现「definition 与视图不一致」的文档。
   */
  readonly definition?: StrategyDefinition;
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
  const nextVersion = bumpStrategyVersion(base.version, bump);
  const nextDefinition = patch.definition ?? base.definition;
  // 传入新 definition 时，v1 视图必须由它重新派生 —— 因此不再透传 base / patch 的视图字段。
  const inheritViews = patch.definition === undefined;
  const nextDatasetVersionId = patch.datasetVersionId ?? base.datasetVersionId;
  const next = {
    strategyId: base.strategyId,
    version: nextVersion,
    name: patch.name ?? base.name,
    description: patch.description === undefined ? base.description : (patch.description ?? undefined),
    universe: patch.universe ?? base.universe,
    entryRules: inheritViews ? (patch.entryRules ?? base.entryRules) : undefined,
    exitRules: inheritViews ? (patch.exitRules ?? base.exitRules) : undefined,
    positionSizing: inheritViews ? (patch.positionSizing ?? base.positionSizing) : undefined,
    riskRules: inheritViews ? (patch.riskRules ?? base.riskRules) : undefined,
    parameters: inheritViews ? (patch.parameters ?? base.parameters) : undefined,
    datasetVersion: patch.datasetVersion ?? base.datasetVersion,
    // 缺省不下发 undefined 键（保持「未声明」与「声明为空」的区分，指纹不受影响）。
    ...(nextDatasetVersionId === undefined ? {} : { datasetVersionId: nextDatasetVersionId }),
    executionAssumptions: patch.executionAssumptions ?? base.executionAssumptions,
    ...(nextDefinition === undefined ? {} : { definition: nextDefinition }),
    recipe: patch.recipe ?? base.recipe,
    metadata: patch.metadata === undefined ? base.metadata : (patch.metadata ?? undefined),
  } as unknown as StrategyDocumentInput;
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
