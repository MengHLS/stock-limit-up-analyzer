/**
 * analysisBatchForm — 「批量建分析」的纯函数层（矩阵展开 / 标准套件 / 模板预览）。
 *
 * 解决的问题：用户「我需要手动建立很多分析，有没有什么办法可以减少这个过程」。
 * 研究里大量重复的是 **类型 × 目标 × 视界 × 维度** 的组合，逐个填对话框成本极高。
 *
 * 三条纪律：
 *
 *   1. **只有一套展开器**。标准套件**不另写一套生成逻辑**，它只是「用一组预设值填
 *      `BatchMatrixFormState`」然后交给同一个 `expandAnalysisMatrix`。两份展开逻辑必然漂移。
 *
 *   2. **不生成跑不了的分析**。每个类型缺必要输入时**不产出**，而是记进 `skipped`
 *      并写明确切原因（如「条件分析需要至少一条填好的条件」）。这与引擎的
 *      `BATCH_VALIDATION_FAILED` 是同一种态度：宁可不建，也不建一个注定报错的。
 *
 *   3. **命名不臆造、且批内唯一**。名称一律由 `suggestAnalysisName`（唯一权威）派生；
 *      仅当某类型在批内会产生重名（典型是 STABILITY：名称里没有目标变量）时追加消歧后缀，
 *      最后再有一道重名兜底。绝不编造「分析1 / 分析2」这种没有信息量的名字。
 *
 *   4. **内置示例复用同一条构造路径**。「从例子开始」的示例既不塞进矩阵、也不手写载荷，
 *      而是先由 `applyAnalysisExample` 得到**完整表单状态**，再由 `formStateToBatchItem`
 *      转成条目 —— 于是「示例建出来的分析」与「手动填表建出来的分析」逐字段同源，
 *      不会出现「示例写的口径与表单写的口径不一样」。
 */

import {
  availableFutureReturnHorizons,
  conditionGroupsToPayload,
  createDefaultAnalysisForm,
  recommendFeatureField,
  recommendTargetField,
  suggestAnalysisName,
  toAnalysisConfig,
  toAnalysisTarget,
  type AnalysisConditionInput,
  type AnalysisFormCatalog,
  type ConditionGroupDraft,
  type CreateAnalysisFormState,
  type ImplementedAnalysisType,
} from "./createAnalysisForm";

/**
 * 单批上限（**显示用副本**）。
 *
 * 客户端**不能** import 服务端的 `MAX_BATCH_CREATE_ITEMS` —— 那会把服务端模块拖进
 * 浏览器 bundle（项目有专门的 bundle 泄漏检查）。真正的权威仍在服务端：
 * 超限时服务端返回 `BATCH_TOO_LARGE`。这里的副本只用于「建按钮前先提示」。
 */
export const MAX_BATCH_ITEMS = 200;

/**
 * **矩阵可表达**的分析类型（批量对话框的类型多选以此为界）。
 *
 * SEGMENT_RELATION 刻意不在其中：它的两个窗**就是研究问题本身**（「哪两段」即选题），
 * 一套窗参数铺开 N 项只会产出 N 个一模一样的配置 —— 那不是批量，那是复制。
 * 它必须逐题在「新建分析」里按窗建。若调用方仍把 SEGMENT_RELATION 传进矩阵，
 * `expandAnalysisMatrix` 会记一条 `skipped` 说明，**不会静默不建**。
 */
export const MATRIX_ANALYSIS_TYPES = [
  "DESCRIPTIVE",
  "QUANTILE",
  "CONDITIONAL",
  "EVENT_STUDY",
  "STABILITY",
] as const satisfies ReadonlyArray<ImplementedAnalysisType>;

// ---------------------------------------------------------------------------
// 矩阵状态
// ---------------------------------------------------------------------------

/**
 * 矩阵选择（各类型各取所需的输入）。
 *
 * 字段与 `analysisFormRequirements` 一一对应，**没有多余字段**：
 *   - DESCRIPTIVE ← `variables`
 *   - QUANTILE    ← `featureField` + `targetFields` + `quantileGroups`
 *   - CONDITIONAL ← `targetFields` + `conditions`（必须有条件）
 *   - EVENT_STUDY ← `horizons`（**不受 targetFields 影响**，它不产出主效应）
 *   - STABILITY   ← `targetFields` × `stabilityDimensions`
 */
export interface BatchMatrixFormState {
  analysisTypes: ImplementedAnalysisType[];
  featureField: string;
  targetFields: string[];
  quantileGroups: string;
  horizons: number[];
  stabilityDimensions: string[];
  variables: string[];
  /** 条件对所有 CONDITIONAL 项复用同一组（批量下逐项填条件没有意义）。 */
  conditions: ConditionGroupDraft[];
}

export function createDefaultBatchMatrixForm(catalog: AnalysisFormCatalog): BatchMatrixFormState {
  const feature = recommendFeatureField(catalog.features);
  const target = recommendTargetField(catalog.outcomes);
  const horizons = availableFutureReturnHorizons(catalog.outcomes);
  return {
    analysisTypes: ["QUANTILE"],
    featureField: feature,
    targetFields: target ? [target] : [],
    quantileGroups: "10",
    horizons: horizons.includes(5) ? [5] : horizons.slice(0, 1),
    stabilityDimensions: catalog.dimensions.slice(0, 1),
    variables: [],
    conditions: [],
  };
}

// ---------------------------------------------------------------------------
// 展开结果
// ---------------------------------------------------------------------------

/** 待创建项（预览清单与 API 载荷共用同一形态）。 */
export interface BatchItemDraft {
  analysisType: ImplementedAnalysisType;
  name: string;
  target?: string;
  config: Record<string, unknown>;
  conditions?: AnalysisConditionInput[];
}

/** 被跳过的类型 + 确切原因（**不静默少建**）。 */
export interface BatchSkippedReason {
  analysisType: ImplementedAnalysisType;
  reason: string;
}

export interface BatchExpansion {
  items: BatchItemDraft[];
  skipped: BatchSkippedReason[];
  /** 因超出单批上限而未生成的数量（0 = 没截断）。 */
  truncated: number;
}

/**
 * 构造一个「只为复用 toAnalysisConfig / suggestAnalysisName」的合成表单状态。
 *
 * 起点是 `createDefaultAnalysisForm` 而非手写字面量：表单状态每加一个字段，
 * 手写字面量就会漏一个（本轮 SEGMENT_RELATION 的 7 个窗字段就是这样暴露出来的）。
 * 默认值只有一处权威，这里只覆盖矩阵自己管的字段。
 */
function syntheticState(params: {
  analysisType: ImplementedAnalysisType;
  featureField?: string;
  targetField?: string;
  variables?: string[];
  quantileGroups?: string;
  stabilityDimension?: string;
  horizons?: number[];
}): CreateAnalysisFormState {
  return {
    ...createDefaultAnalysisForm(params.analysisType),
    name: "",
    featureField: params.featureField ?? "",
    targetField: params.targetField ?? "",
    variables: params.variables ?? [],
    quantileGroups: params.quantileGroups ?? "10",
    stabilityDimension: params.stabilityDimension ?? "",
    horizons: params.horizons ?? [],
    conditions: [],
  };
}

/**
 * 命名：先取 `suggestAnalysisName`（唯一权威），仅在**批内会重名**时补消歧信息。
 *
 * 目前唯一需要补的是 STABILITY —— 它的建议名是「稳定性分析：按 year 分组」，
 * 不含目标变量，多个目标就会撞名。
 */
function batchItemName(params: {
  analysisType: ImplementedAnalysisType;
  featureField?: string;
  targetField?: string;
  variables?: string[];
  quantileGroups?: string;
  stabilityDimension?: string;
  horizons?: number[];
}): string {
  const base = suggestAnalysisName(syntheticState(params));
  if (params.analysisType === "STABILITY" && params.targetField) {
    return `${base} → ${params.targetField}`;
  }
  return base;
}

/** 批内重名兜底：追加「 #n」。只影响显示名，不改变任何配置。 */
function dedupeNames(items: BatchItemDraft[]): BatchItemDraft[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const count = (seen.get(item.name) ?? 0) + 1;
    seen.set(item.name, count);
    return count === 1 ? item : { ...item, name: `${item.name} #${count}` };
  });
}

/** 条件草稿 → API 载荷（空条件返回 `undefined`，与单建「无条件就不发 key」一致）。 */
function conditionsOf(state: BatchMatrixFormState): AnalysisConditionInput[] | undefined {
  const rows = conditionGroupsToPayload(state.conditions);
  return rows.length > 0 ? rows : undefined;
}

/**
 * 矩阵展开：**唯一**的展开入口（标准套件也走这里）。
 *
 * 展开规则（可逐一核对，没有隐藏分支）：
 *   - DESCRIPTIVE → 1 项（`variables` 为空则跳过）
 *   - QUANTILE    → 每个 `targetFields` 1 项（缺特征或目标则跳过）
 *   - CONDITIONAL → 每个 `targetFields` 1 项（无条件则**整体跳过**并说明）
 *   - EVENT_STUDY → 1 项（`horizons` 一次给全；为空则跳过）
 *   - STABILITY   → `targetFields` × `stabilityDimensions` 的笛卡尔积
 *   - SEGMENT_RELATION → **不产出**，并记一条 skipped（两个窗是选题本身，矩阵无法替你选）
 *   - 未勾选的类型不产出，也**不算 skipped**（那是用户的明确选择，不是缺输入）
 */
export function expandAnalysisMatrix(state: BatchMatrixFormState): BatchExpansion {
  const items: BatchItemDraft[] = [];
  const skipped: BatchSkippedReason[] = [];
  const conditions = conditionsOf(state);

  const wants = (t: ImplementedAnalysisType) => state.analysisTypes.includes(t);

  if (wants("QUANTILE")) {
    if (!state.featureField) {
      skipped.push({ analysisType: "QUANTILE", reason: "未选择特征变量（分位分析必须先有特征）" });
    } else if (state.targetFields.length === 0) {
      skipped.push({ analysisType: "QUANTILE", reason: "未选择目标变量" });
    } else {
      for (const target of state.targetFields) {
        const params = {
          analysisType: "QUANTILE" as const,
          featureField: state.featureField,
          targetField: target,
          quantileGroups: state.quantileGroups,
        };
        items.push({
          analysisType: "QUANTILE",
          name: batchItemName(params),
          target,
          config: toAnalysisConfig(syntheticState(params)),
          ...(conditions ? { conditions } : {}),
        });
      }
    }
  }

  if (wants("CONDITIONAL")) {
    if (state.targetFields.length === 0) {
      skipped.push({ analysisType: "CONDITIONAL", reason: "未选择目标变量" });
    } else if (!conditions) {
      skipped.push({
        analysisType: "CONDITIONAL",
        reason: "未填写条件 —— 空条件等于「等于全样本」，引擎会拒绝，故本类型未生成",
      });
    } else {
      for (const target of state.targetFields) {
        const params = { analysisType: "CONDITIONAL" as const, targetField: target };
        items.push({
          analysisType: "CONDITIONAL",
          name: batchItemName(params),
          target,
          config: toAnalysisConfig(syntheticState(params)),
          conditions,
        });
      }
    }
  }

  if (wants("EVENT_STUDY")) {
    if (state.horizons.length === 0) {
      skipped.push({ analysisType: "EVENT_STUDY", reason: "未选择视界（T+N）" });
    } else {
      const params = { analysisType: "EVENT_STUDY" as const, horizons: [...state.horizons] };
      items.push({
        analysisType: "EVENT_STUDY",
        name: batchItemName(params),
        config: toAnalysisConfig(syntheticState(params)),
        ...(conditions ? { conditions } : {}),
      });
    }
  }

  if (wants("STABILITY")) {
    if (state.targetFields.length === 0) {
      skipped.push({ analysisType: "STABILITY", reason: "未选择目标变量" });
    } else if (state.stabilityDimensions.length === 0) {
      skipped.push({ analysisType: "STABILITY", reason: "未选择稳定性维度" });
    } else {
      for (const target of state.targetFields) {
        for (const dimension of state.stabilityDimensions) {
          const params = {
            analysisType: "STABILITY" as const,
            targetField: target,
            stabilityDimension: dimension,
          };
          items.push({
            analysisType: "STABILITY",
            name: batchItemName(params),
            target,
            config: toAnalysisConfig(syntheticState(params)),
            ...(conditions ? { conditions } : {}),
          });
        }
      }
    }
  }

  if (wants("DESCRIPTIVE")) {
    if (state.variables.length === 0) {
      skipped.push({ analysisType: "DESCRIPTIVE", reason: "未选择要描述统计的变量" });
    } else {
      const params = { analysisType: "DESCRIPTIVE" as const, variables: [...state.variables] };
      items.push({
        analysisType: "DESCRIPTIVE",
        name: batchItemName(params),
        config: toAnalysisConfig(syntheticState(params)),
        ...(conditions ? { conditions } : {}),
      });
    }
  }

  // SEGMENT_RELATION 不在 MATRIX_ANALYSIS_TYPES 里；这里只是「万一被传到」时的诚实交代。
  if (state.analysisTypes.includes("SEGMENT_RELATION")) {
    skipped.push({
      analysisType: "SEGMENT_RELATION",
      reason: "分段关系要先定「哪两段」（两个窗就是研究问题本身），请逐个在「新建分析」里按窗建",
    });
  }

  const deduped = dedupeNames(items);
  const limited = deduped.slice(0, MAX_BATCH_ITEMS);
  return {
    items: limited,
    skipped,
    truncated: Math.max(0, deduped.length - limited.length),
  };
}

/** 展开结果 → `researchEngine.createAnalyses` 入参（去掉预览专用字段）。 */
export function toBatchCreatePayload(items: ReadonlyArray<BatchItemDraft>) {
  return items.map((item) => ({
    analysisType: item.analysisType,
    name: item.name,
    ...(item.target !== undefined ? { target: item.target } : {}),
    config: item.config,
    ...(item.conditions && item.conditions.length > 0 ? { conditions: item.conditions } : {}),
  }));
}

/**
 * **完整表单状态 → 批量条目**（「从例子开始」的内置示例走的就是这条路径）。
 *
 * 与 `expandAnalysisMatrix` 的分工是清楚的：矩阵**自己拼参数**（类型 × 目标 × 视界 × 维度），
 * 而这里直接吃一个已经配好的表单状态。两条路径共用 `toAnalysisConfig` /
 * `conditionGroupsToPayload` / `suggestAnalysisName` —— **不另造第二套「表单 → 载荷」的口径**，
 * 否则同一份配置从「新建分析」建和从「内置示例」建会写出不一样的东西。
 *
 * `nameOverride` 用于给示例起**研究问题式**的名字（示例卡标题，如「没跌破涨停日最低价的，
 * 20 日怎么走」）。缺省（或传空白）时退回 `suggestAnalysisName` —— 那个函数是命名唯一权威，
 * 它的输出是「类型 + 变量」式的机械名，信息量低于示例标题，但绝不臆造。
 */
export function formStateToBatchItem(
  state: CreateAnalysisFormState,
  nameOverride?: string,
): BatchItemDraft {
  const override = (nameOverride ?? "").trim();
  const target = toAnalysisTarget(state);
  const conditions = conditionGroupsToPayload(state.conditions);
  return {
    analysisType: state.analysisType,
    name: override !== "" ? override : suggestAnalysisName(state),
    ...(target !== undefined ? { target } : {}),
    config: toAnalysisConfig(state),
    ...(conditions.length > 0 ? { conditions } : {}),
  };
}

/**
 * 条目的「一行摘要」—— 把**真正会落库的内容**摊成一句人话。
 *
 * 为什么必须有：内置示例是**点一下直接建**（不趟预览清单），卡片上那行小字就是用户
 * 唯一的知情来源。刻意从 `BatchItemDraft` **反推**而不是从示例声明里另抄一份说明 ——
 * 示例声明改了、摘要会跟着改，两边不可能对不上。
 *
 * 只做缩略，不替用户判断口径：变量多于 3 个时写成「首 … 末（共 N 个）」，
 * 条件按「且」连接（与 `conditionGroupsToPayload` 的组内 AND 语义一致）。
 */
export function describeBatchItem(draft: BatchItemDraft): string {
  const config = (draft.config ?? {}) as Record<string, unknown>;
  const bits: string[] = [];

  const variables = Array.isArray(config.variables) ? (config.variables as string[]) : [];
  if (variables.length > 0) {
    bits.push(
      variables.length <= 3
        ? variables.join(" / ")
        : `${variables[0]} … ${variables[variables.length - 1]}（共 ${variables.length} 个）`,
    );
  }
  if (typeof config.featureField === "string" && config.featureField !== "") bits.push(config.featureField);
  if (Array.isArray(config.windowA) && Array.isArray(config.windowB)) {
    const [aFrom, aTo] = config.windowA as number[];
    const [bFrom, bTo] = config.windowB as number[];
    bits.push(`窗A T+${aFrom}..T+${aTo} → 窗B T+${bFrom}..T+${bTo}`);
  }
  if (Array.isArray(config.horizons) && config.horizons.length > 0) {
    bits.push((config.horizons as number[]).map((h) => `T+${h}`).join(" / "));
  }

  const conditions = draft.conditions ?? [];
  if (conditions.length > 0) {
    bits.push(
      conditions
        .map((condition) => {
          // `IS_NULL` / `IS_NOT_NULL` 的发载荷值是显式 `null`，摘要里不该写成 "null"
          const value =
            condition.value === null || condition.value === undefined ? "" : ` ${String(condition.value)}`;
          return `${condition.fieldName} ${condition.operator}${value}`;
        })
        .join(" 且 "),
    );
  }

  if (draft.target !== undefined) bits.push(`→ ${draft.target}`);
  return bits.join(" · ");
}

// ---------------------------------------------------------------------------
// 标准研究套件
// ---------------------------------------------------------------------------

/** 套件被跳过的成员说明（用于「摊开清单」时如实交代）。 */
export interface SuiteSkippedNote {
  analysisType: ImplementedAnalysisType;
  reason: string;
}

export interface SuitePlan {
  state: BatchMatrixFormState;
  /** 套件**固定包含**的类型（即使因缺输入被跳过，也要说明原因）。 */
  members: ImplementedAnalysisType[];
  /** 套件看不到、需要用户另填的项（例如条件分析的条件）。 */
  notes: string[];
}

/**
 * 标准研究套件 = 「用一组预设值填矩阵，再走同一个展开器」。
 *
 * 为什么不做第二套生成逻辑：矩阵与套件的差别**只在默认值**，展开规则必须完全一致，
 * 否则「套件建出来的分析」与「矩阵建出来的同样分析」会不一致 —— 那是隐性口径分叉。
 *
 * 套件组成（每项都写明它靠什么输入）：
 *   1. DESCRIPTIVE  变量的分布（`variables` = 特征 + 目标，先看数据长相）
 *   2. QUANTILE     特征分 10 组 → 目标（最常用的第一刀）
 *   3. EVENT_STUDY  全部**真实存在**的视界（不硬编码 T+1/3/5/10/20）
 *   4. STABILITY    每个可用维度各一个（年度 / 板块 …逐维度检验方向是否稳定）
 *   5. CONDITIONAL  仅当用户已填条件时才有；否则**不生成**并说明（空条件会被引擎拒）
 *
 * ⚠️ 套件会替你做一部分研究设计，因此 UI **必须先摊开清单再确认**，不得静默铺开。
 */
export function buildSuitePlan(args: {
  featureField: string;
  targetField: string;
  catalog: AnalysisFormCatalog;
  conditions?: ConditionGroupDraft[];
}): SuitePlan {
  const horizons = availableFutureReturnHorizons(args.catalog.outcomes);
  const dimensions = args.catalog.dimensions;
  const conditions = args.conditions ?? [];

  const notes: string[] = [];
  if (conditions.length === 0) {
    notes.push("未填写条件 → 套件不包含「条件分析」（空条件等于全样本，引擎会拒绝）");
  }
  if (dimensions.length === 0) {
    notes.push("当前 Dataset 没有可用维度 → 套件不包含「稳定性分析」");
  }
  if (horizons.length === 0) {
    notes.push("当前 Dataset 没有真实视界 → 套件不包含「事件研究」");
  }

  return {
    state: {
      analysisTypes: ["DESCRIPTIVE", "QUANTILE", "EVENT_STUDY", "STABILITY", "CONDITIONAL"],
      featureField: args.featureField,
      targetFields: [args.targetField],
      quantileGroups: "10",
      horizons,
      stabilityDimensions: [...dimensions],
      // DESCRIPTIVE 的变量取「特征 + 目标」——两者都在目录里，不发明变量
      variables: [args.featureField, args.targetField].filter((v): v is string => Boolean(v)),
      conditions,
    },
    members: ["DESCRIPTIVE", "QUANTILE", "EVENT_STUDY", "STABILITY", "CONDITIONAL"],
    notes,
  };
}

// ---------------------------------------------------------------------------
// 模板预览
// ---------------------------------------------------------------------------

/** 模板明细的最小展示形态（服务端已存的是**具体分析定义**，故不需要二次展开）。 */
export interface TemplatePreviewRow {
  sortOrder: number;
  analysisType: string;
  name: string;
  target: string | null;
}

/**
 * 模板明细 → 预览行。
 *
 * 刻意**不做任何展开/推导**：模板里存的就是一个个具体分析，直接如实列出即可。
 * （若在前端再实现一次展开，就会与服务端的 `templateItemsToBatchItems` 形成第二份权威。）
 */
export function templatePreviewRows(
  items: ReadonlyArray<{ sortOrder: number; analysisType: string; name: string; target?: string | null }>,
): TemplatePreviewRow[] {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      sortOrder: item.sortOrder,
      analysisType: item.analysisType,
      name: item.name,
      target: item.target ?? null,
    }));
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/** 表单级校验（只查「用户填错了」这类问题；逐项合法性由展开器 + 服务端预检兜底）。 */
export function validateBatchMatrixForm(state: BatchMatrixFormState): string[] {
  const errors: string[] = [];
  if (state.analysisTypes.length === 0) {
    errors.push("请至少选择一种分析类型");
  }
  if (state.analysisTypes.includes("QUANTILE") && !state.featureField) {
    errors.push("分位分析需要选择特征变量");
  }
  if (
    (state.analysisTypes.includes("QUANTILE") ||
      state.analysisTypes.includes("CONDITIONAL") ||
      state.analysisTypes.includes("STABILITY")) &&
    state.targetFields.length === 0
  ) {
    errors.push("请至少选择一个目标变量（分位 / 条件 / 稳定性分析都需要）");
  }
  if (state.analysisTypes.includes("QUANTILE")) {
    const n = Number(state.quantileGroups);
    if (!Number.isInteger(n) || n < 2 || n > 100) {
      errors.push("分组数必须是不小于 2、不超过 100 的整数");
    }
  }
  if (state.analysisTypes.includes("EVENT_STUDY") && state.horizons.length === 0) {
    errors.push("事件研究需要至少选择一个视界（T+N）");
  }
  if (state.analysisTypes.includes("STABILITY")) {
    if (state.stabilityDimensions.length === 0) errors.push("稳定性分析需要至少选择一个维度");
  }
  if (state.analysisTypes.includes("DESCRIPTIVE") && state.variables.length === 0) {
    errors.push("描述统计需要至少选择一个变量");
  }
  return errors;
}

/** 名称校验（与 `research_analysis_template.name varchar(120)` 及服务端校验一致）。 */
export function validateTemplateName(name: string): string[] {
  const errors: string[] = [];
  const trimmed = name.trim();
  if (trimmed === "") errors.push("请填写模板名");
  else if (trimmed.length > 120) errors.push("模板名不能超过 120 个字符");
  return errors;
}
