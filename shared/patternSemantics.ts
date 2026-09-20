/**
 * PHASE-B-001 — **Pattern 受控语义声明槽**（Pattern Semantic Slot）。
 *
 * ## 要解决的问题
 *
 * 在此之前，Research Semantic Directory（`FEATURE_VARIABLES` / `assertConditionFieldsKnown`）
 * 是**封闭**的：Pattern 即使能在 `patterns/*.ts` 里声明，也**无法表达一个 Core 尚未知道的
 * 新语义** —— 想让新语义可研究，必须分别去改 Research Engine、变量白名单、Analysis Engine、
 * Strategy Engine、Candidate Builder 五处。本模块把这条路收敛成：
 *
 * ```text
 * Pattern Semantic Declaration（纯数据）
 *         ↓  expandPatternSemantics（唯一 Expander）
 *   ExpandedSemantic[]（规范化、可审计、带可用性）
 *      ↙                        ↘
 *  Research 投影              Strategy 投影
 * ```
 *
 * ## 三条不可妥协的边界（对应 B.3 / B.4 / B.5）
 *
 * 1. **Pattern 只提供声明**：本文件只有类型 + 纯函数 + 常量，**没有** Pattern 可执行代码、
 *    回调、SQL、策略引擎。执行逻辑一律由**人工审查过的命名扩展点**承担。
 * 2. **operator 是有限白名单**：Pattern 不得自定义任意 operator（见 `SEMANTIC_OPERATORS`）。
 * 3. **唯一 Expander**：展开只发生在 `expandPatternSemantics()`。禁止 Pattern A 自己展开、
 *    Pattern B 自己展开 —— 那会形成双写 Semantic SoT。
 *
 * ## 为什么放在 `shared/`
 *
 * 研究侧（`researchEngine`）与策略侧（`research/patternLibrary` → `strategyCore`）都要消费它，
 * 而本文件是**零依赖纯函数**；放 `shared/` 可让两侧引用同一份词汇，物理上杜绝两份定义漂移。
 */

// ---------------------------------------------------------------------------
// 1. 受控 operator 白名单（B.4）
// ---------------------------------------------------------------------------

/**
 * Pattern 可用的 operator 白名单（有限、可审计）。
 *
 * 🔴 为什么必须是白名单而不是「任意表达式」：条件最终要同时投影到**研究**（条件统计）与
 * **策略**（逐日执行）两侧。任意表达式无法保证两侧语义一致，也无法给出可审计的可用性；
 * 白名单保证「同一个声明在两个引擎里含义相同」是可证的。
 */
export const SEMANTIC_OPERATORS = [
  // 比较
  "EQ",
  "NE",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "BETWEEN",
  "IN",
  "NOT_IN",
  // 聚合（需要 window）
  "MIN",
  "MAX",
  "SUM",
  "COUNT",
  "AVG",
  "CHANGE",
  "PERCENT_CHANGE",
] as const;
export type SemanticOperator = (typeof SEMANTIC_OPERATORS)[number];

/** 需要 `windowDays` 的 operator（其余为单点判定）。 */
const AGGREGATING_OPERATORS: readonly SemanticOperator[] = [
  "MIN",
  "MAX",
  "SUM",
  "COUNT",
  "AVG",
  "CHANGE",
  "PERCENT_CHANGE",
];

export function isSemanticOperator(value: unknown): value is SemanticOperator {
  return typeof value === "string" && (SEMANTIC_OPERATORS as readonly string[]).includes(value);
}

export function isAggregatingOperator(op: SemanticOperator): boolean {
  return AGGREGATING_OPERATORS.includes(op);
}

// ---------------------------------------------------------------------------
// 2. 取值来源（决定可用性语义与「两侧投影是否同构」）
// ---------------------------------------------------------------------------

/**
 * 语义值的取值来源。
 *
 * - `EVENT_BAR`：事件日（T）当根 K 线 ⇒ 天然 PIT 安全（`availableFromOffset = 0`）；
 * - `PREFIX_BAR`：T 之前的 K 线（历史上下文）⇒ 同样 PIT 安全；
 * - `POST_BAR`：事件后第 k 个交易日（T+k）⇒ **观察日**语义，必须声明 `availableFromOffset = k`；
 * - `PATH_ROW` / `OUTCOME`：事件后逐日路径 / 结果视界 ⇒ **只能当结果（目标变量）**，
 *   禁止当条件（当条件即用未来信息筛样本）。
 */
export const SEMANTIC_SOURCES = [
  "EVENT_BAR",
  "PREFIX_BAR",
  "POST_BAR",
  "PATH_ROW",
  "OUTCOME",
] as const;
export type SemanticSource = (typeof SEMANTIC_SOURCES)[number];

export function isSemanticSource(value: unknown): value is SemanticSource {
  return typeof value === "string" && (SEMANTIC_SOURCES as readonly string[]).includes(value);
}

/** 只能作为**结果**（目标变量）的来源 —— 当条件即未来函数。 */
export const OUTCOME_ONLY_SOURCES: readonly SemanticSource[] = ["PATH_ROW", "OUTCOME"];

/** 语义角色：条件可用的观察/特征，或只能作为结果。 */
export type SemanticRole = "OBSERVATION" | "FEATURE" | "OUTCOME";

// ---------------------------------------------------------------------------
// 3. 声明与展开产物
// ---------------------------------------------------------------------------

/** 研究侧意图：声明**为什么**要研究它（进 metadata / 报告，便于 review）。 */
export interface SemanticResearchIntent {
  /** 人类可读的研究意图。 */
  readonly question: string;
  /** 建议的目标变量（结果视界），便于 Candidate 派生时对齐。 */
  readonly suggestedTarget?: string;
}

/**
 * 策略侧投影元数据 —— **声明**该语义在执行侧如何落地。
 *
 * 🔴 这里**只能**是声明（阈值来源、比较方向、单位），**不能**是函数或任意代码。
 * 具体算子实现由人工审查过的命名扩展点（`strategyProjection.ts`）承担。
 */
export interface SemanticStrategyProjection {
  /** 执行侧特征 id（命名扩展点的键；不存在即拒绝，见 B.10）。 */
  readonly featureId: string;
  /** 比较方向（执行侧「守线」类条件用）。 */
  readonly comparison: "GTE" | "LTE";
  /** 阈值参数名（由策略版本给出具体值；声明里只写名字，不写数值）。 */
  readonly thresholdParam: string;
  /** 与研究侧的已知差异说明（不得抹平，如实登记）。 */
  readonly noteAboutResearchDifference?: string;
}

/**
 * **Pattern 受控语义声明**（纯数据）。
 *
 * Pattern 作者只写这个对象；它不含任何可执行内容。
 */
export interface PatternSemanticDeclaration {
  /** 语义 id（小写 snake_case，全局唯一；决定变量名前缀）。 */
  readonly semanticId: string;
  readonly label: string;
  /** 精确口径（进结果 metadata / 报告；不写清楚会在 review 时无法判断是否 look-ahead）。 */
  readonly definition: string;
  readonly source: SemanticSource;
  /** 来源里的字段名（如 `low` / `volume` / `close`）。 */
  readonly field: string;
  /**
   * 聚合算子。省略 = 单点取值（该来源的**当日**值）。
   * 🔴 必须是白名单内的 operator；且**只能是聚合类**（单点比较由消费方的条件给出）。
   */
  readonly aggregation?: SemanticOperator;
  /**
   * 窗口长度（交易日）。聚合算子**必须**给出（≥1）；单点取值**不得**给出。
   */
  readonly windowDays?: number;
  /**
   * 该值最早在事件后第几个交易日**收盘**可观测（k ≥ 0）。
   *
   * 🔴 这是本机制的 PIT 核心：`EVENT_BAR`/`PREFIX_BAR` ⇒ 0；`POST_BAR` ⇒ 必须等于 windowDays
   * （否则等于声称「T+k 的窗口在更早就能看到」，是 look-ahead）。展开时会强校验。
   */
  readonly availableFromOffset: number;
  readonly intent: SemanticResearchIntent;
  readonly strategyProjection?: SemanticStrategyProjection;
}

/** 展开后的规范化语义（**两侧投影的共同输入**，也是可审计产物）。 */
export interface ExpandedSemantic {
  /** 规范变量名（研究侧变量名 / 策略特征名的共同来源）。 */
  readonly name: string;
  readonly semanticId: string;
  readonly label: string;
  readonly role: SemanticRole;
  readonly source: SemanticSource;
  readonly field: string;
  readonly aggregation: SemanticOperator | null;
  /** 窗口（交易日）；单点取值为 1。 */
  readonly windowDays: number;
  /** 该值最早可观测的交易日偏移（= T + 该值收盘）。 */
  readonly availableFromOffset: number;
  readonly definition: string;
  readonly intent: SemanticResearchIntent;
  readonly strategyProjection: SemanticStrategyProjection | null;
}

/** 校验/展开问题（确定性列表；**不抛错**，由调用方决定响亮程度）。 */
export interface SemanticIssue {
  readonly code:
    | "INVALID_SEMANTIC_ID"
    | "UNKNOWN_OPERATOR"
    | "UNKNOWN_SOURCE"
    | "INVALID_WINDOW"
    | "WINDOW_REQUIRED_MISSING"
    | "WINDOW_NOT_ALLOWED"
    | "INVALID_AVAILABILITY"
    | "AVAILABILITY_MISMATCHES_WINDOW"
    | "OUTCOME_SOURCE_AS_CONDITION"
    | "MISSING_STRATEGY_FEATURE_ID"
    | "DUPLICATE_SEMANTIC_ID";
  readonly semanticId: string;
  readonly message: string;
}

const SEMANTIC_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * 校验单条声明（纯函数）。
 *
 * 🔴 刻意**不做**「未知就放过」：这里挡住的正是「Pattern 声明了一个 Core 不认识的字段」
 * 却一路走到执行的情况 —— 那会让 PIT 与两侧一致性同时失去保障。
 */
export function validateSemanticDeclaration(
  declaration: PatternSemanticDeclaration,
): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const id = declaration.semanticId;

  if (!SEMANTIC_ID_PATTERN.test(id)) {
    issues.push({
      code: "INVALID_SEMANTIC_ID",
      semanticId: id,
      message: `semanticId 必须是 lowercase snake_case（实得 "${id}"）—— 它决定变量名前缀，非法会让两侧命名无法对齐`,
    });
  }
  if (!isSemanticSource(declaration.source)) {
    issues.push({
      code: "UNKNOWN_SOURCE",
      semanticId: id,
      message: `source 非受控取值：${String(declaration.source)}（允许：${SEMANTIC_SOURCES.join(" / ")}）`,
    });
  }
  if (declaration.aggregation !== undefined) {
    if (!isSemanticOperator(declaration.aggregation)) {
      issues.push({
        code: "UNKNOWN_OPERATOR",
        semanticId: id,
        message: `aggregation 不在白名单内：${String(declaration.aggregation)}（禁止 Pattern 自定义 operator）`,
      });
    } else if (!isAggregatingOperator(declaration.aggregation)) {
      issues.push({
        code: "WINDOW_NOT_ALLOWED",
        semanticId: id,
        message: `aggregation=${declaration.aggregation} 不是聚合算子；单点比较应由消费方的条件给出，声明里只标来源字段`,
      });
    }
  }

  const aggregating = declaration.aggregation !== undefined && isAggregatingOperator(declaration.aggregation as SemanticOperator);
  if (aggregating) {
    const w = declaration.windowDays;
    if (typeof w !== "number" || !Number.isInteger(w) || w < 1) {
      issues.push({
        code: "WINDOW_REQUIRED_MISSING",
        semanticId: id,
        message: `聚合算子 ${String(declaration.aggregation)} 必须给出正整数 windowDays（实得 ${String(w)}）`,
      });
    }
  } else if (declaration.windowDays !== undefined) {
    issues.push({
      code: "WINDOW_NOT_ALLOWED",
      semanticId: id,
      message: `单点取值不得声明 windowDays（实得 ${String(declaration.windowDays)}）—— 否则「看到哪一段」会变得不可判定`,
    });
  }

  const offset = declaration.availableFromOffset;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
    issues.push({
      code: "INVALID_AVAILABILITY",
      semanticId: id,
      message: `availableFromOffset 必须是 ≥ 0 的整数（实得 ${String(offset)}）`,
    });
  } else if (declaration.source === "POST_BAR") {
    // 🔴 观察日来源：声称的可见时点必须与窗口末端一致 —— 否则是「T+k 的窗口在更早就能看到」。
    const w = typeof declaration.windowDays === "number" ? declaration.windowDays : null;
    if (w !== null && offset !== w) {
      issues.push({
        code: "AVAILABILITY_MISMATCHES_WINDOW",
        semanticId: id,
        message: `POST_BAR 来源要求 availableFromOffset(${offset}) == windowDays(${w})：`
          + "窗口末端就是最早可见时点，声称更早可见等于把未来数据当成当时已知",
      });
    }
    if (offset === 0) {
      issues.push({
        code: "INVALID_AVAILABILITY",
        semanticId: id,
        message: "POST_BAR 来源的 availableFromOffset 不可能为 0（事件后窗口最早也要到 T+1 收盘）",
      });
    }
  } else if (offset !== 0) {
    issues.push({
      code: "INVALID_AVAILABILITY",
      semanticId: id,
      message: `${declaration.source} 来源在事件日（T）当日即可知，availableFromOffset 必须为 0（实得 ${offset}）`,
    });
  }

  if (isSemanticSource(declaration.source) && OUTCOME_ONLY_SOURCES.includes(declaration.source)) {
    if (declaration.strategyProjection !== undefined) {
      issues.push({
        code: "OUTCOME_SOURCE_AS_CONDITION",
        semanticId: id,
        message: `${declaration.source} 只能作为结果（目标变量）；投影成策略条件即用未来信息决定当日动作`,
      });
    }
  }

  if (declaration.strategyProjection !== undefined) {
    const fid = declaration.strategyProjection.featureId;
    if (typeof fid !== "string" || fid.trim() === "") {
      issues.push({
        code: "MISSING_STRATEGY_FEATURE_ID",
        semanticId: id,
        message: "strategyProjection.featureId 必须非空（它是命名扩展点的键；不存在即拒绝执行）",
      });
    }
  }

  return issues;
}

/**
 * **唯一 Expander**（B.5）：声明 → 规范化语义。
 *
 * 纯函数、无 IO、无时钟；同输入恒同输出（顺序即声明顺序，保证可审计的确定性）。
 * 非法项**不进入**产物，只出现在 `issues` 里 —— 由调用方决定是拒绝整批还是报告。
 */
export function expandPatternSemantics(
  declarations: readonly PatternSemanticDeclaration[],
): { expanded: ExpandedSemantic[]; issues: SemanticIssue[] } {
  const issues: SemanticIssue[] = [];
  const expanded: ExpandedSemantic[] = [];
  const seen = new Map<string, number>();

  for (const declaration of declarations) {
    const id = declaration.semanticId;
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) {
      issues.push({
        code: "DUPLICATE_SEMANTIC_ID",
        semanticId: id,
        message: `同一批声明里 semanticId 重复：${id}（会让变量名冲突、两侧投影无法一一对应）`,
      });
      continue;
    }

    const declarationIssues = validateSemanticDeclaration(declaration);
    if (declarationIssues.length > 0) {
      issues.push(...declarationIssues);
      continue;
    }

    const aggregation = declaration.aggregation ?? null;
    const windowDays = aggregation === null ? 1 : (declaration.windowDays as number);
    const role: SemanticRole = OUTCOME_ONLY_SOURCES.includes(declaration.source)
      ? "OUTCOME"
      : declaration.source === "POST_BAR"
        ? "OBSERVATION"
        : "FEATURE";

    expanded.push({
      name: buildSemanticVariableName(declaration.semanticId, aggregation, windowDays),
      semanticId: declaration.semanticId,
      label: declaration.label,
      role,
      source: declaration.source,
      field: declaration.field,
      aggregation,
      windowDays,
      availableFromOffset: declaration.availableFromOffset,
      definition: declaration.definition,
      intent: declaration.intent,
      strategyProjection: declaration.strategyProjection ?? null,
    });
  }

  return { expanded, issues };
}

/**
 * 规范化变量名（**两侧共用**，禁各自拼名 —— 那是双写的一种）。
 *
 * 约定：`pat_{semanticId}` 或 `pat_{semanticId}_{k}d`（聚合窗口 / 观察日窗口）。
 * 中间不落盘字段名与算子：算子与字段只在 `definition` 里表达，避免「名字变长导致两侧命名漂移」。
 */
export function buildSemanticVariableName(
  semanticId: string,
  aggregation: SemanticOperator | null,
  windowDays: number,
): string {
  if (aggregation !== null && windowDays > 1) return `pat_${semanticId}_${windowDays}d`;
  if (aggregation !== null) return `pat_${semanticId}_1d`;
  return `pat_${semanticId}`;
}
