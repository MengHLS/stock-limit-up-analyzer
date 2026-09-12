/**
 * researchMatrix — 「同一 Run 下的一批分析 + 各自的结果行」→ **二维矩阵视图模型**
 * （纯函数、零 IO、零 React）。
 *
 * 为什么需要它：一个用「决策日 × 回撤深度桶」批量建出来的 Run（如 135 个 CONDITIONAL
 * 分析）在现有「结果」页签里只能**逐个点开看**。135 个平铺按钮既看不出横向可比性，
 * 也看不出哪个格子缺了。而这类分析的**全部信息本身就是二维表**，只是被拆成了 N 个独立分析。
 * 本模块把「拆开的格子」重新拼回一张表，让「哪一格有效」变成一眼可见。
 *
 * ## 纪律（与 `researchEngineAdapter.ts` 同源）
 *
 * - **不重算任何统计量**：均值 / 中位数 / 胜率 / 标准差 / 差值 / t / p 一律取自
 *   `research_result` 已落库的行；前端只负责**取用 + 搬运 + 排版**。
 * - **不猜口径**：一个格子只有在结果行**自证**它属于该格子时才被采纳 ——
 *   分析名给出「决策日 + 回撤桶」，`target` 给出「指标族」，两者的**决策日必须一致**；
 *   结果行里 `details.outcomeVariable` / `details.variable` 与 `target` 不一致的行**一律排除**
 *   （`CONDITIONAL` 会自动附送一行 `MAX_DRAWDOWN`，其 `variable` 由 target 名尾推导、
 *   与 target 不是同一个变量 —— 混进来就会让「最深跌幅」那一族读到错误口径）。
 * - **缺格不隐藏**：没有对应分析的格子显示「未建」，有分析但无结果/未跑完显示状态；
 *   解析不出坐标的分析进 `unclassified` 并带原因，**绝不静默丢弃**。
 * - **显著性标注**：`p` 值来自引擎自己落库的 `P_VALUE_DIFFERENCE`（Welch 两样本）。
 *   阈值只是一条**展示红线**，不构成策略结论；多重比较未校正（引擎原文如此）。
 *
 * ## 归组的依据是「分析名」，这是本视图的已知边界
 *
 * 后端 `getRun` 只返回分析元数据（name / target / status），**不带条件行**
 * （条件在单独的表里，逐分析取会再多 135 次请求）。因此本视图按下面两件事归组：
 *   1. `target` —— 结构化字段，给出**指标族**与**决策日起点**（权威）；
 *   2. `name` 里 `→` 左侧的「`T+d`」与「`回撤X~Y%`」—— 给出**列**（桶）。
 * 于是：**给某个分析改名会让它脱离矩阵**（会出现在 `unclassified` 里并说明原因）。
 * 反过来，只要 `target` 不变、名字里的 `T+d` 与桶还在，矩阵就仍然成立。
 */

import {
  formatMetricValue,
  metricLabelOf,
  type ResultRowLike,
} from "@/adapters/researchEngineAdapter";

/** 传入矩阵的最小分析契约（`researchEngine.getRun` 的 `analyses` 元素即满足）。 */
export interface MatrixAnalysisLike {
  id: number;
  name: string;
  target?: string | null;
  status?: string | null;
}

// ---------------------------------------------------------------------------
// 固定维度
// ---------------------------------------------------------------------------

/**
 * 固定业务桶（**非等频**）的展示顺序。
 *
 * 顺序即语义：从「几乎没跌」到「跌得很深」。跨行必须能对齐比较，所以列顺序写死，
 * 不随出现顺序漂移 —— 否则两个 Run 的矩阵看起来是两张不同的表。
 */
export const DEPTH_BUCKET_ORDER: readonly string[] = [
  "0~2%",
  "2~4%",
  "4~6%",
  "6~8%",
  "8%+",
];

/** 「已回撤（不限幅度）」列：`深度 > 0` 的全体，作为各桶的**参照列**。 */
export const ALL_PULLBACK_COLUMN = "已回撤(不限幅度)";

/** 列顺序：参照列在最左（先看整体、再看分桶）。 */
const COLUMN_ORDER: readonly string[] = [ALL_PULLBACK_COLUMN, ...DEPTH_BUCKET_ORDER];

/** 指标族的展示顺序；未登记的族排在已登记之后（按 key 字典序）。 */
const FAMILY_ORDER: readonly string[] = [
  "return_1",
  "return_3",
  "return_5",
  "max_return_5",
  "max_drawdown_5",
];

/** 结构化推导的族名（**权威**：来自 `target` 变量名，不是分析名文本）。 */
const FAMILY_LABELS: Readonly<Record<string, string>> = {
  return_1: "之后 1 日收益",
  return_3: "之后 3 日收益",
  return_5: "之后 5 日收益",
  max_return_5: "之后 5 日最大有利偏移",
  max_drawdown_5: "之后 5 日最深跌幅",
};

/** 口径（scope）：是否附加「截至决策日未破首板日最低价」的资格约束。 */
export interface MatrixScope {
  key: string;
  label: string;
  /** 该口径的口径说明（UI 原样展示，避免读者把两种口径混为一谈）。 */
  description: string;
}

const SCOPES: Readonly<Record<string, MatrixScope>> = {
  BARE: {
    key: "BARE",
    label: "无资格约束",
    description:
      "只要「相对首板收盘已回撤」即入格，不要求回撤过程中没破位。计算前提是这批量分析里确实没有加破位条件（本视图只能读到分析名与 target，读不到条件行）。",
  },
  EVENT_LOW_GUARD: {
    key: "EVENT_LOW_GUARD",
    label: "加「未破首板日最低价」资格",
    description:
      "额外要求「截至决策日，历史最低价没有跌破首板日最低价」（引擎变量 holds_event_low_*，基准是**首板日最低价**，不是首板日开盘价）。与「不跌破首板日开盘价」不是同一个口径，不要混用。",
  },
};

const SCOPE_KEYWORD = "未破";
const ALL_PULLBACK_KEYWORD = "已回撤";

/** 显著性红线（**展示用**，不是研究结论）。 */
export const SIGNIFICANCE_LEVEL = 0.05;
export const STRONG_SIGNIFICANCE_LEVEL = 0.01;

// ---------------------------------------------------------------------------
// 解析：分析 → 二维坐标
// ---------------------------------------------------------------------------

export interface MatrixCoordinate {
  /** 决策日 d（`T+d`）。 */
  day: number;
  dayKey: string;
  /** 列 key（桶标签或参照列）。 */
  columnKey: string;
  scope: MatrixScope;
  /** 指标族 key（结构化，来自 target）。 */
  familyKey: string;
  /** 指标族中文名（结构化推导）。 */
  familyLabel: string;
  /** `target` 变量名（该格子在算哪个变量）。 */
  target: string;
}

export interface MatrixEntry {
  analysisId: number;
  analysisName: string;
  status: string | null;
  coordinate: MatrixCoordinate;
}

export interface MatrixUnclassified {
  analysisId: number;
  analysisName: string;
  reason: string;
}

export interface MatrixFamily {
  key: string;
  label: string;
  /** 该族下可归组的分析数（**不是**格数：一格一族一个分析）。 */
  entryCount: number;
}

export interface MatrixIndex {
  entries: MatrixEntry[];
  unclassified: MatrixUnclassified[];
  scopes: MatrixScope[];
  families: MatrixFamily[];
  /** 归组过程中的如实说明（族名冲突、口径说明等）。 */
  notes: string[];
}

/** `segment_return_1_6d` → kind / start / end。 */
const SEGMENT_TARGET = /^segment_(return|max_return|max_drawdown)_(\d+)_(\d+)d$/;
const DAY_IN_NAME = /T\+(\d+)/;
const RANGE_BUCKET_IN_NAME = /回撤\s*([0-9.]+~[0-9.]+%)/;
const OPEN_BUCKET_IN_NAME = /回撤\s*([0-9.]+%\+)/;

function splitName(name: string): { condition: string; outcome: string } | null {
  const idx = name.lastIndexOf("→");
  if (idx < 0) return null;
  const outcome = name.slice(idx + 1).trim();
  if (outcome.length === 0) return null;
  return { condition: name.slice(0, idx), outcome };
}

function readBucket(condition: string): string | null {
  const range = RANGE_BUCKET_IN_NAME.exec(condition);
  if (range) return range[1]!.replace(/\s+/g, "");
  const open = OPEN_BUCKET_IN_NAME.exec(condition);
  if (open) return open[1]!.replace(/\s+/g, "");
  return null;
}

/** 归一化比较（只用于判断「分析名文本」与「结构化推导」是否矛盾，不用于取值）。 */
function foldLabel(text: string): string {
  return text.replace(/\s+/g, "");
}

export type CoordinateParse = { ok: true; coordinate: MatrixCoordinate } | { ok: false; reason: string };

/**
 * 单个分析 → 二维坐标。解析不出时返回**具体原因**（进 `unclassified`，由 UI 如实展示）。
 */
export function parseMatrixCoordinate(analysis: MatrixAnalysisLike): CoordinateParse {
  const parts = splitName(analysis.name);
  if (parts === null) {
    return { ok: false, reason: "分析名里没有「→」，无法拆出「条件 → 结果」两段" };
  }

  const dayMatch = DAY_IN_NAME.exec(parts.condition);
  if (dayMatch === null) {
    return { ok: false, reason: "条件段里没有 `T+d` 形式的决策日" };
  }
  const day = Number(dayMatch[1]);
  if (!Number.isInteger(day) || day <= 0) {
    return { ok: false, reason: `决策日无法解析为合法整数（读到 T+${dayMatch[1]}）` };
  }

  const target = typeof analysis.target === "string" ? analysis.target.trim() : "";
  if (target.length === 0) {
    return { ok: false, reason: "分析没有 `target` 变量，无法确定指标族" };
  }
  const segment = SEGMENT_TARGET.exec(target);
  if (segment === null) {
    return {
      ok: false,
      reason: `target「${target}」不是 \`segment_*_{d}_{d+h}d\` 形态，无法确定指标族`,
    };
  }

  const start = Number(segment[2]);
  const end = Number(segment[3]);
  if (start !== day) {
    return {
      ok: false,
      reason: `分析名的决策日 T+${day} 与 target（${target}）的起始日 T+${start} 不一致`,
    };
  }
  if (!(end > start)) {
    return { ok: false, reason: `target「${target}」的视界区间不是正长度` };
  }

  const scope = parts.condition.includes(SCOPE_KEYWORD) ? SCOPES.EVENT_LOW_GUARD! : SCOPES.BARE!;
  const bucket = readBucket(parts.condition);
  let columnKey: string;
  if (bucket !== null) {
    columnKey = bucket;
  } else if (parts.condition.includes(ALL_PULLBACK_KEYWORD)) {
    columnKey = ALL_PULLBACK_COLUMN;
  } else {
    return {
      ok: false,
      reason: "条件段既没有「回撤X~Y%」桶、也没有「已回撤」字样，无法定位列",
    };
  }

  const kind = segment[1]!;
  const familyKey = `${kind}_${end - start}`;
  return {
    ok: true,
    coordinate: {
      day,
      dayKey: `T+${day}`,
      columnKey,
      scope,
      familyKey,
      familyLabel: FAMILY_LABELS[familyKey] ?? `${target}`,
      target,
    },
  };
}

/**
 * 一批分析 → 矩阵索引（坐标 + 族清单 + 未归类清单）。纯解析，不碰结果行。
 */
export function buildMatrixIndex(analyses: readonly MatrixAnalysisLike[]): MatrixIndex {
  const entries: MatrixEntry[] = [];
  const unclassified: MatrixUnclassified[] = [];
  const notes: string[] = [];
  const familyNameSeen = new Map<string, Set<string>>();

  for (const a of analyses) {
    const parsed = parseMatrixCoordinate(a);
    if (!parsed.ok) {
      unclassified.push({ analysisId: a.id, analysisName: a.name, reason: parsed.reason });
      continue;
    }
    const { coordinate } = parsed;
    entries.push({
      analysisId: a.id,
      analysisName: a.name,
      status: a.status ?? null,
      coordinate,
    });
    // 分析名文本 vs 结构化族名的矛盾：不阻断（结构化优先），但必须上报
    const parts = splitName(a.name);
    if (parts !== null) {
      const set = familyNameSeen.get(coordinate.familyKey) ?? new Set<string>();
      set.add(foldLabel(parts.outcome));
      familyNameSeen.set(coordinate.familyKey, set);
    }
  }

  for (const [familyKey, names] of familyNameSeen) {
    if (names.size <= 1) continue;
    const expected = foldLabel(FAMILY_LABELS[familyKey] ?? familyKey);
    const mismatch = [...names].filter((n) => n !== expected);
    if (mismatch.length > 0) {
      notes.push(
        `指标族「${familyKey}」在不同分析里的结果段文本不一致（${[...names].join(" / ")}）——` +
          `列头一律采用由 target 变量推导的名称「${FAMILY_LABELS[familyKey] ?? familyKey}」，` +
          `文本差异不影响取值（取值以 target 变量为准）。`,
      );
    }
  }

  const scopes: MatrixScope[] = [];
  for (const scope of Object.values(SCOPES)) {
    if (entries.some((e) => e.coordinate.scope.key === scope.key)) scopes.push(scope);
  }

  const familyCounts = new Map<string, number>();
  for (const e of entries) {
    familyCounts.set(e.coordinate.familyKey, (familyCounts.get(e.coordinate.familyKey) ?? 0) + 1);
  }
  const familyKeys = [...familyCounts.keys()].sort((x, y) => {
    const ix = FAMILY_ORDER.indexOf(x);
    const iy = FAMILY_ORDER.indexOf(y);
    if (ix >= 0 && iy >= 0) return ix - iy;
    if (ix >= 0) return -1;
    if (iy >= 0) return 1;
    return x.localeCompare(y);
  });
  const families: MatrixFamily[] = familyKeys.map((key) => ({
    key,
    label: FAMILY_LABELS[key] ?? key,
    entryCount: familyCounts.get(key) ?? 0,
  }));

  return { entries, unclassified, scopes, families, notes };
}

/** 默认展示：优先「无资格约束 × 之后 5 日收益」，否则第一个族。 */
export function pickDefaultSelection(index: MatrixIndex): { scopeKey: string; familyKey: string } | null {
  if (index.families.length === 0) return null;
  const has = (scopeKey: string, familyKey: string) =>
    index.entries.some((e) => e.coordinate.scope.key === scopeKey && e.coordinate.familyKey === familyKey);
  if (has("BARE", "return_5")) return { scopeKey: "BARE", familyKey: "return_5" };
  const first = index.entries[0]!;
  return { scopeKey: first.coordinate.scope.key, familyKey: first.coordinate.familyKey };
}

function columnSortIndex(key: string): number {
  const i = COLUMN_ORDER.indexOf(key);
  return i >= 0 ? i : COLUMN_ORDER.length + 1;
}

// ---------------------------------------------------------------------------
// 结果行 → 格子统计
// ---------------------------------------------------------------------------

export interface MatrixCellStats {
  /** 主指标码（均值型：`MEAN_RETURN` / `MEAN` …）。 */
  metricCode: string;
  metricLabel: string;
  value: number | null;
  valueDisplay: string;
  medianDisplay: string;
  winRateDisplay: string;
  stdDisplay: string;
  /** 条件组样本数（该格子的分母）。 */
  conditionSampleCount: number | null;
  /** 全样本（不施加条件）的同指标值与样本数 —— 差值的参照系。 */
  allSampleCount: number | null;
  allValueDisplay: string;
  /** `DIFFERENCE = 条件组 − 全样本`（引擎口径）：数值（用于符号判定）。 */
  difference: number | null;
  /** `DIFFERENCE = 条件组 − 全样本`（引擎口径）：展示串。 */
  differenceDisplay: string;
  differenceDefinition: string | null;
  tStat: number | null;
  pValue: number | null;
  /** `p < 0.05` 且样本未被引擎标记为小样本。 */
  significant: boolean;
  /** `p < 0.01` 且样本未被引擎标记为小样本。 */
  stronglySignificant: boolean;
  lowSample: boolean;
  /** 引擎自己渲染的条件文本（这一格到底筛了什么）—— 原样展示。 */
  conditionRule: string | null;
  /** 因口径不一致被排除的结果行数（如 `CONDITIONAL` 附送的 `MAX_DRAWDOWN`）。 */
  excludedRowCount: number;
}

const PRIMARY_METRIC_PRIORITY: readonly string[] = [
  "MEAN_RETURN",
  "MEAN",
  "MEDIAN_RETURN",
  "MEDIAN",
];

const CONDITION_GROUP = "CONDITION";
const ALL_GROUP = "ALL";

function stringFieldOf(details: unknown, key: string): string | null {
  if (!details || typeof details !== "object") return null;
  const v = (details as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * 在一批结果行里找第一个非空的 `details[key]`。
 *
 * 为什么需要：引擎把同一份 `meta`（含 `conditionRule`）**逐行**写进 `resultJson`，
 * 但不同分析的落库行不完全一致（GROUPED / SCALAR 各自带一份）。取「第一行」会漏，
 * 所以按序扫描整批 —— 它是**如实搬运**，不是推断。
 */
function firstStringField(rows: readonly ResultRowLike[], key: string): string | null {
  for (const r of rows) {
    const v = stringFieldOf(r.details, key);
    if (v !== null) return v;
  }
  return null;
}

function groupOf(row: ResultRowLike): string | null {
  const d = row.dimension;
  if (!d || typeof d !== "object") return null;
  const g = (d as Record<string, unknown>).group;
  return typeof g === "string" ? g : null;
}

/**
 * 该结果行是否真的在描述 `target` 这个变量。
 *
 * 两道校验（任一不通过即排除）：
 *   - `details.outcomeVariable`（引擎写入的目标变量）必须等于 `target`；
 *   - `details.variable`（该指标实际作用的变量）**若存在**必须等于 `target`。
 *
 * 第二道是为了挡住 `CONDITIONAL` 自动附送的 `MAX_DRAWDOWN` 行：它的 `variable` 由
 * `drawdownVariableFor(target)` 从 target 名尾部推导（`segment_return_2_7d` → `max_drawdown_7d`），
 * **与 target 不是同一个变量** —— 混进「最深跌幅」那一族就会读到错误口径。
 */
function describesTarget(row: ResultRowLike, target: string | null): boolean {
  const declared = stringFieldOf(row.details, "outcomeVariable");
  if (declared !== null && target !== null && declared !== target) return false;
  const variable = stringFieldOf(row.details, "variable");
  if (variable !== null) {
    if (target === null) return false;
    if (variable !== target) return false;
  }
  return true;
}

function pickMetric(rows: readonly ResultRowLike[], code: string): ResultRowLike | undefined {
  return rows.find((r) => r.metricCode === code);
}

/**
 * 一个格子的结果行 → 统计量。返回 `null` = 该格子**没有可用的条件组统计**
 * （没有结果、条件组为空、或没有均值型主指标）—— UI 如实显示「无结果」，不补 0。
 */
export function extractMatrixCell(
  rows: readonly ResultRowLike[],
  target: string | null,
): MatrixCellStats | null {
  const grouped = rows.filter((r) => r.resultType === "GROUPED");
  if (grouped.length === 0) return null;

  const accepted = grouped.filter((r) => describesTarget(r, target));
  const excludedRowCount = grouped.length - accepted.length;
  const conditionRows = accepted.filter((r) => groupOf(r) === CONDITION_GROUP);
  const allRows = accepted.filter((r) => groupOf(r) === ALL_GROUP);
  if (conditionRows.length === 0) return null;

  const metricCode = PRIMARY_METRIC_PRIORITY.find((code) =>
    conditionRows.some((r) => r.metricCode === code && r.metricValue !== null && r.metricValue !== undefined),
  );
  if (metricCode === undefined) return null;

  const condPrimary = pickMetric(conditionRows, metricCode);
  const allPrimary = pickMetric(allRows, metricCode);
  const value = condPrimary?.metricValue ?? null;
  const allValue = allPrimary?.metricValue ?? null;
  const variable = target;

  const scalar = (code: string): ResultRowLike | undefined =>
    rows.find((r) => r.resultType === "SCALAR" && r.metricCode === code);
  const differenceRow = scalar("DIFFERENCE");
  const pRow = scalar("P_VALUE_DIFFERENCE");
  const tRow = scalar("T_STAT_DIFFERENCE");

  const pValue = pRow?.metricValue ?? null;
  const lowSample = conditionRows.some(
    (r) => !!r.details && typeof r.details === "object" && (r.details as { lowSample?: unknown }).lowSample === true,
  );
  const significant = pValue !== null && pValue < SIGNIFICANCE_LEVEL && !lowSample;
  const stronglySignificant = pValue !== null && pValue < STRONG_SIGNIFICANCE_LEVEL && !lowSample;

  const medianRow = pickMetric(conditionRows, "MEDIAN_RETURN") ?? pickMetric(conditionRows, "MEDIAN");
  const winRow = pickMetric(conditionRows, "WIN_RATE");
  const stdRow = pickMetric(conditionRows, "STD_RETURN") ?? pickMetric(conditionRows, "STD");
  const conditionRule = firstStringField(rows, "conditionRule");

  return {
    metricCode,
    metricLabel: metricLabelOf(metricCode),
    value,
    valueDisplay: formatMetricValue(metricCode, value, variable),
    medianDisplay: formatMetricValue(medianRow?.metricCode ?? "MEDIAN_RETURN", medianRow?.metricValue ?? null, variable),
    winRateDisplay: formatMetricValue("WIN_RATE", winRow?.metricValue ?? null, variable),
    stdDisplay: formatMetricValue(stdRow?.metricCode ?? "STD_RETURN", stdRow?.metricValue ?? null, variable),
    conditionSampleCount: condPrimary?.sampleCount ?? null,
    allSampleCount: allPrimary?.sampleCount ?? null,
    allValueDisplay: formatMetricValue(metricCode, allValue, variable),
    difference: differenceRow?.metricValue ?? null,
    differenceDisplay: formatMetricValue("DIFFERENCE", differenceRow?.metricValue ?? null, variable),
    differenceDefinition: stringFieldOf(differenceRow?.details, "differenceDefinition"),
    tStat: tRow?.metricValue ?? null,
    pValue,
    significant,
    stronglySignificant,
    lowSample,
    conditionRule,
    excludedRowCount,
  };
}

// ---------------------------------------------------------------------------
// 组装矩阵
// ---------------------------------------------------------------------------

export interface MatrixColumnVm {
  key: string;
  label: string;
}

export interface MatrixCellVm {
  rowKey: string;
  columnKey: string;
  /** `null` = 该 Run 里**没有**这一格的分析。 */
  analysisId: number | null;
  analysisName: string | null;
  status: string | null;
  /** 是否已拿到结果行（用于区分「未跑」与「跑了但没值」）。 */
  resultLoaded: boolean;
  stats: MatrixCellStats | null;
}

export interface MatrixRowVm {
  rowKey: string;
  cells: MatrixCellVm[];
}

export interface MatrixCoverage {
  /** 矩阵格总数（行 × 列）。 */
  cells: number;
  /** 其中有对应分析的格数。 */
  built: number;
  /** 其中拿到了可用条件组统计的格数。 */
  withResult: number;
  /** 未建格数。 */
  missing: number;
}

export interface MatrixVm {
  scope: MatrixScope;
  family: MatrixFamily;
  metricCode: string | null;
  metricLabel: string;
  columns: MatrixColumnVm[];
  rows: MatrixRowVm[];
  coverage: MatrixCoverage;
  unclassified: MatrixUnclassified[];
  notes: string[];
}

export interface MatrixSelection {
  scopeKey: string;
  familyKey: string;
}

/**
 * 组装选中「口径 × 指标族」的矩阵。
 *
 * 行列集合由**该选择下实际存在的分析**推导：
 *   - 行 = `min(day) … max(day)`（缺的天如实成为「未建」行，不隐藏 —— 缺格本身是信息）；
 *   - 列 = 该选择下出现过的列 key，按 `COLUMN_ORDER` 固定顺序。
 */
export function buildMatrix(
  index: MatrixIndex,
  selection: MatrixSelection,
  rowsByAnalysisId: ReadonlyMap<number, readonly ResultRowLike[]>,
): MatrixVm {
  const scope = Object.values(SCOPES).find((s) => s.key === selection.scopeKey) ?? SCOPES.BARE!;
  const family =
    index.families.find((f) => f.key === selection.familyKey) ??
    ({ key: selection.familyKey, label: selection.familyKey, entryCount: 0 } satisfies MatrixFamily);

  const entries = index.entries.filter(
    (e) => e.coordinate.scope.key === selection.scopeKey && e.coordinate.familyKey === selection.familyKey,
  );

  const days = entries.map((e) => e.coordinate.day);
  const maxDay = days.length > 0 ? Math.max(...days) : 0;
  const rowKeys = Array.from({ length: maxDay }, (_, i) => `T+${i + 1}`);

  const columnKeys = [...new Set(entries.map((e) => e.coordinate.columnKey))].sort((a, b) => {
    const ia = columnSortIndex(a);
    const ib = columnSortIndex(b);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
  const columns: MatrixColumnVm[] = columnKeys.map((key) => ({ key, label: key }));

  const byCoordinate = new Map<string, MatrixEntry>();
  for (const e of entries) {
    byCoordinate.set(`${e.coordinate.dayKey}|${e.coordinate.columnKey}`, e);
  }

  let built = 0;
  let withResult = 0;
  let metricCode: string | null = null;
  const rows: MatrixRowVm[] = rowKeys.map((rowKey) => {
    const cells: MatrixCellVm[] = columns.map((col) => {
      const entry = byCoordinate.get(`${rowKey}|${col.key}`);
      if (entry === undefined) {
        return {
          rowKey,
          columnKey: col.key,
          analysisId: null,
          analysisName: null,
          status: null,
          resultLoaded: false,
          stats: null,
        };
      }
      built += 1;
      const rowsForAnalysis = rowsByAnalysisId.get(entry.analysisId);
      const stats = rowsForAnalysis === undefined ? null : extractMatrixCell(rowsForAnalysis, entry.coordinate.target);
      if (stats !== null) {
        withResult += 1;
        metricCode = metricCode ?? stats.metricCode;
      }
      return {
        rowKey,
        columnKey: col.key,
        analysisId: entry.analysisId,
        analysisName: entry.analysisName,
        status: entry.status,
        resultLoaded: rowsForAnalysis !== undefined,
        stats,
      };
    });
    return { rowKey, cells };
  });

  const notes = index.notes.filter((n) => n.includes(`「${selection.familyKey}」`));

  return {
    scope,
    family,
    metricCode,
    metricLabel: metricCode === null ? family.label : metricLabelOf(metricCode),
    columns,
    rows,
    coverage: {
      cells: rowKeys.length * columns.length,
      built,
      withResult,
      missing: rowKeys.length * columns.length - built,
    },
    unclassified: index.unclassified,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 派生展示量（纯搬运，不产生新统计）
// ---------------------------------------------------------------------------

export interface RowSummary {
  rowKey: string;
  /** 该行有结果的格数。 */
  cellCount: number;
  /** 条件组样本数之和（纯加法）。 */
  totalSampleCount: number | null;
  /** 显著（`p < 0.05`）且为正的格数。 */
  positiveSignificant: number;
  /** 显著（`p < 0.05`）且为负的格数。 */
  negativeSignificant: number;
}

/**
 * 行小结。
 *
 * 只做**加法与计数**（样本数求和、显著格数统计）—— 不做「按样本数加权平均」这类
 * 需要额外假设的派生量：各格样本是否互斥、并集是否等于全集，由建批方式决定，
 * 前端无从校验，宁可不算。
 */
export function summarizeRows(vm: MatrixVm): RowSummary[] {
  return vm.rows.map((row) => {
    const withStats = row.cells.filter((c) => c.stats !== null).map((c) => c.stats!);
    const counts = withStats.map((s) => s.conditionSampleCount).filter((n): n is number => n !== null);
    return {
      rowKey: row.rowKey,
      cellCount: withStats.length,
      totalSampleCount:
        counts.length === withStats.length && counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null,
      positiveSignificant: withStats.filter((s) => s.significant && s.difference !== null && s.difference > 0).length,
      negativeSignificant: withStats.filter((s) => s.significant && s.difference !== null && s.difference < 0).length,
    };
  });
}
