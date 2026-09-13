/**
 * observationFunnel — 「用户策略规格 → 逐条条件分析结果」→ **信号漏斗视图模型**
 * （纯函数、零 IO、零 React）。
 *
 * ## 为什么需要它（与 `researchMatrix` 的分工）
 *
 * `researchMatrix` 回答的是「**某一维度的哪一格**值得看」（决策日 × 回撤桶的二维格）。
 * 但用户的策略不是一张二维表，而是**一条逐级收紧的规则链**：
 *
 *     全部首板事件
 *       → 守住首板日最低价（生命线）
 *       → 且量能萎缩到首板日 50% 以下（缩量洗盘验证）
 *       → 且回调末日放量（企稳启动确认）
 *       → 买入
 *
 * 这条链的价值在于**每一级各自贡献了什么**：如果「守线」单独几乎不筛掉样本（实测 80% 都守住），
 * 那它的作用就不是「筛选」而是「止损定义」；如果「缩量」把样本砍到 15% 但收益没变好，
 * 那它就是无效条件。**这种逐级边际贡献，二维矩阵表达不了**。
 *
 * ## 数据来源与纪律
 *
 * - 漏斗各级的 `n` 与统计量**全部取自落库的 `research_result`**（`CONDITIONAL` 的
 *   `ALL` / `CONDITION` 两组 + `DIFFERENCE` / `P_VALUE_DIFFERENCE`），前端不重算；
 * - 每一级必须能**自证身份**：分析名里带 `T+k`、`未破`/`已破`、`缩量`/`极致缩量`/`未缩量`、
 *   `放量`/`翻红` 这类规则标记；解析不出的分析进 `unclassified` 并附原因，**绝不静默丢弃**；
 * - **不假设单调**：漏斗各级的样本集**不是严格包含关系**（「已破」组与「未破」组互斥，
 *   而「未破+缩量」是「未破」的子集）。因此 `isNested` 标记会如实标注哪几级是真子集，
 *   哪几级是**平行对照组** —— 把对照组画成漏斗的一层会让人误以为样本在层层减少。
 * - **合规内容原样保留**：不显著 / 小样本 / 未校正多重比较的提示一律不删。
 */

import { formatCount, formatMetricValue, type ResultRowLike } from "@/adapters/researchEngineAdapter";

/** 传入漏斗的最小分析契约（`researchEngine.getRun` 的 `analyses` 元素即满足）。 */
export interface FunnelAnalysisLike {
  id: number;
  name: string;
  target?: string | null;
  status?: string | null;
}

/** 漏斗一级的「规则标记」，解析自分析名。 */
export const FUNNEL_STAGE_KINDS = [
  "all", // 全样本基准（引擎内建，不是独立分析）
  "hold", // 守住生命线
  "break", // 破位（对照组）
  "hold_shallow", // 守线 + 浅回撤
  "hold_standard", // 守线 + 标准回撤
  "hold_deep", // 守线 + 深回撤
  "hold_shrink", // 守线 + 缩量 ≤50%
  "hold_shrink_extreme", // 守线 + 极致缩量 ≤30%
  "hold_no_shrink", // 守线 + 未缩量（对照组）
  "hold_shrink_strong", // 守线 + 缩量 + 价强
  "hold_shrink_volume_up", // 守线 + 缩量 + 末日放量（用户「信号B」）
  "hold_flip_green", // 守线 + 翻红
  "hold_early", // 守线（早确认 T+2）
  "hold_long", // 守线（长窗口 T+5）+ 缩量
] as const;
export type FunnelStageKind = (typeof FUNNEL_STAGE_KINDS)[number];

interface StageSpec {
  kind: FunnelStageKind;
  label: string;
  /** 规则的可读表述（原样展示，便于对照用户规格）。 */
  rule: string;
  /**
   * 是否为**主链**的一员。`false` = 平行对照组（与主链互斥或无关），
   * UI 上必须与主链视觉区分。
   *
   * ⚠️ 注意这是「属于主链」而不是「是上一级的真子集」——主链起点（`hold`）
   * 同时也是主链成员，但它的上一级是「全样本」（不是分析），所以它没有
   * `shrinkFromPrev`。**「是否嵌套」由 `parent` 表达，不靠这个标记。**
   */
  nested: boolean;
  /**
   * **逻辑上的上一级**（用于算「逐级保留比」）。
   *
   * 🔴 为什么不能直接用「链里前一个元素」：链的排序是**用户思考顺序**，
   * 而「深浅回撤」三个变体被插在 `hold` 与 `hold_shrink` 之间 ——
   * 于是 `hold_shrink` 的前一个元素是 `hold_deep`（n=2,218），
   * 算出来的「保留比」= 2746/2218 = 124%，**荒谬**（子集不可能比父集大）。
   * 语义上的父级是 `hold`。所以父级必须**显式声明**，不能靠相邻位置推断。
   */
  parent: FunnelStageKind | null;
  /** 命中该级的分析名特征（按顺序尝试，全为「与」关系）。 */
  patterns: readonly RegExp[];
}

/**
 * 级次顺序 = **用户思考规则的顺序**（守线 → 量 → 量价共振），而非样本量顺序。
 *
 * ⚠️ `nested` / `parent` 的判据要与 `patterns` 保持自洽：
 * 主链每级都要求「守线」，且后级在前级基础上再加约束 ⇒ 属于同一棵树；
 * 对照组不加「守线」、或加的是互斥条件 ⇒ 不在树上（`parent: null`）。
 */
const STAGE_SPECS: readonly StageSpec[] = [
  {
    kind: "hold",
    label: "① 守住生命线",
    rule: "回调期内最低价 ≥ 首板日最低价（min(low[T+1..T+k]) ≥ low(T)）",
    nested: true, // 主链起点（父级是「全样本」，不是某个分析）
    parent: null,
    patterns: [/未破/, /首板最低价/],
  },
  {
    kind: "hold_shallow",
    label: "①a 守线 · 浅回撤 0~2%",
    rule: "守线 且 回调末日收盘 / 首板日收盘 ∈ [0.98, 1.0]",
    nested: true,
    parent: "hold",
    patterns: [/未破/, /0~2%/],
  },
  {
    kind: "hold_standard",
    label: "①b 守线 · 标准回撤 2~5%",
    rule: "守线 且 回调末日收盘 / 首板日收盘 ∈ [0.95, 0.98]",
    nested: true,
    parent: "hold",
    patterns: [/未破/, /2~5%/],
  },
  {
    kind: "hold_deep",
    label: "①c 守线 · 深回撤 5%+",
    rule: "守线 且 回调末日收盘 / 首板日收盘 < 0.95",
    nested: true,
    parent: "hold",
    patterns: [/未破/, /5%\+/],
  },
  {
    kind: "hold_shrink",
    label: "② 守线 + 缩量 ≤50%",
    rule: "守线 且 回调期最小量能比 ≤ 0.5（相对首板日成交量）",
    nested: true,
    parent: "hold",
    patterns: [/未破/, /缩量≤50%/],
  },
  {
    kind: "hold_shrink_extreme",
    label: "②a 守线 + 极致缩量 ≤30%",
    rule: "守线 且 回调期最小量能比 ≤ 0.3",
    nested: true,
    parent: "hold_shrink",
    patterns: [/未破/, /极致缩量/],
  },
  {
    kind: "hold_shrink_strong",
    label: "③ 守线 + 缩量 + 价强",
    rule: "守线 且 缩量≤50% 且 回调末日收盘 ≥ 首板日收盘",
    nested: true,
    parent: "hold_shrink",
    patterns: [/未破/, /缩量≤50%/, /收盘已高于/],
  },
  {
    kind: "hold_shrink_volume_up",
    label: "③a 守线 + 缩量 + 末日放量（信号B）",
    rule: "守线 且 缩量≤50% 且 回调末日量能比 > 1",
    nested: true,
    parent: "hold_shrink",
    patterns: [/未破/, /缩量≤50%/, /末日放量/],
  },
  {
    kind: "hold_flip_green",
    label: "③b 守线 + 翻红",
    rule: "守线 且 回调末日收盘相对首板日收盘 > 0",
    nested: true,
    parent: "hold",
    patterns: [/未破/, /翻红/],
  },
  {
    kind: "hold_early",
    label: "④ 早确认（T+2 就守住）",
    rule: "min(low[T+1..T+2]) ≥ low(T) —— 观察窗更短，**不是**「守线」的子集",
    nested: true,
    // 🔴 父级是「全样本」而非「守线」：T+2 窗口比 T+3 短 ⇒ 样本反而**更多**（实测 20,527 > 19,080）。
    // 若声明 parent="hold"，会算出 107.6% 的「保留比」—— 子集大于父集，是明显的语义错误。
    // 同一规则换观察长度属于**平行变体**，谈不上「收紧」。
    parent: null,
    patterns: [/T\+2/, /未破/],
  },
  {
    kind: "hold_long",
    label: "④a 长窗口（T+5）+ 缩量",
    rule: "min(low[T+1..T+5]) ≥ low(T) 且 缩量≤50%",
    nested: true,
    parent: "hold", // T+5 窗口 ⊇ T+3 窗口 ⇒ 确是「守线」的子集（实测 4,482 < 19,080）
    patterns: [/T\+5/, /未破/, /缩量≤50%/],
  },
  // ---- 对照组（平行，不在主链树上）----
  {
    kind: "break",
    label: "对照：已破位",
    rule: "回调期内最低价 < 首板日最低价（逻辑证伪组）",
    nested: false,
    parent: null,
    patterns: [/已破/],
  },
  {
    kind: "hold_no_shrink",
    label: "对照：守线但未缩量",
    rule: "守线 且 回调期最小量能比 > 0.5",
    nested: false,
    parent: null,
    patterns: [/未破/, /未缩量/],
  },
];

// ---------------------------------------------------------------------------
// 统计量提取（复用现有 adapter 的格式化，口径一致）
// ---------------------------------------------------------------------------

/** 一级的统计视图。 */
export interface FunnelStageVm {
  kind: FunnelStageKind;
  label: string;
  rule: string;
  /** 是否属于主链（`false` = 平行对照组）。 */
  nested: boolean;
  /**
   * 逻辑上的上一级（用于读「逐级保留比」）。
   * `null` = 主链起点（上一级是全样本）或对照组。
   */
  parent: FunnelStageKind | null;
  analysisId: number;
  analysisName: string;
  status: string | null;
  /** 该级条件组的样本数（`SAMPLE_COUNT@CONDITION`）。 */
  conditionSampleCount: number | null;
  /** 全样本数（`SAMPLE_COUNT@ALL`）。 */
  allSampleCount: number | null;
  /** 占全样本的比例（**保留原始比值**，不四舍五入成整数百分比以免小样本失真）。 */
  shareOfAll: number | null;
  /**
   * 相对**逻辑父级**样本的缩减比例。
   *
   * 🔴 父级取 `parent` 声明的那一级，**不是链里前一个元素** ——
   * 链按「用户思考顺序」排，深浅回撤变体插在中间，用相邻位置会算出 >100% 的荒谬值。
   * 父级在该 Run 没建分析时，回落到「链上最近的有结果的前驱」，并在 UI 上如实标注。
   */
  shrinkFromPrev: number | null;
  /** `shrinkFromPrev` 的实际比较对象（用于 tooltip：证明这个比值到底跟谁比）。 */
  shrinkBaselineLabel: string | null;
  /** 该级条件组的主指标值（原始数，未格式化）。 */
  value: number | null;
  valueDisplay: string;
  /** 全样本的主指标值 —— 每级都带，便于横向对齐。 */
  allValue: number | null;
  allValueDisplay: string;
  /** 与全样本的差值（`DIFFERENCE`）。 */
  difference: number | null;
  pValue: number | null;
  tStat: number | null;
  /** 中位数 / 胜率 / 标准差（有则显示）。 */
  medianDisplay: string;
  winRateDisplay: string;
  stdDisplay: string;
  /** 该级的条件规则文本（引擎落库的 `details.conditionRule`）。 */
  conditionRule: string | null;
  /** 小样本标记（`SAMPLE_COUNT < minSampleCount`）。 */
  lowSample: boolean;
  /** 解析该级指标时被排除的行数（口径不一致的保护网）。 */
  excludedRowCount: number;
}

/** 解析结果：主链 + 对照组 + 未归类。 */
export interface FunnelIndex {
  /** 主链（`nested === true` 或起点），按 `STAGE_SPECS` 顺序。 */
  chain: FunnelStageVm[];
  /** 平行对照组。 */
  controls: FunnelStageVm[];
  /** 解析不出的分析（附原因）。 */
  unclassified: { analysisId: number; analysisName: string; reason: string }[];
  /** 参与归组的指标族（来自 target），用于提示漏斗读的是哪个指标。 */
  targetVariable: string | null;
  metricLabel: string;
}

/** 从结果行里取「按 group 分立的某指标」的原始值与 sampleCount。 */
function pickGrouped(
  rows: readonly ResultRowLike[],
  metricCode: string,
  group: "ALL" | "CONDITION",
): { value: number | null; sampleCount: number | null } {
  for (const row of rows) {
    if (row.metricCode !== metricCode) continue;
    const dim = row.dimension as { group?: string } | null | undefined;
    if (dim?.group !== group) continue;
    const value = typeof row.metricValue === "number" ? row.metricValue : null;
    const sampleCount = typeof row.sampleCount === "number" ? row.sampleCount : null;
    return { value, sampleCount };
  }
  return { value: null, sampleCount: null };
}

/** 取无分组的标量指标（`DIFFERENCE` / `P_VALUE_DIFFERENCE` / `T_STAT_DIFFERENCE`）。 */
function pickScalar(rows: readonly ResultRowLike[], metricCode: string): number | null {
  for (const row of rows) {
    if (row.metricCode !== metricCode) continue;
    return typeof row.metricValue === "number" ? row.metricValue : null;
  }
  return null;
}

/** 取值的第一顺位：CONDITIONAL 用 `MEAN_RETURN`（与 target 同口径），退回 `MEAN`。 */
const PRIMARY_METRICS: readonly string[] = ["MEAN_RETURN", "MEAN"];

function pickPrimary(rows: readonly ResultRowLike[], group: "ALL" | "CONDITION") {
  for (const code of PRIMARY_METRICS) {
    const hit = pickGrouped(rows, code, group);
    if (hit.value !== null) return { code, ...hit };
  }
  return { code: PRIMARY_METRICS[0]!, value: null, sampleCount: null };
}

/** 从 `details` 里读一个字符串字段（容错：details 可能是字符串 JSON）。 */
function detailString(details: unknown, key: string): string | null {
  if (details === null || details === undefined) return null;
  let obj: unknown = details;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

/** 从 `details` 里读一个数字字段。 */
function detailNumber(details: unknown, key: string): number | null {
  if (details === null || details === undefined) return null;
  let obj: unknown = details;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

/**
 * 判定一个分析属于哪一级。
 *
 * 回归顺序**从最具体到最宽松**：「守线 + 缩量 + 末日放量」必须排在「守线 + 缩量」之前，
 * 否则前者会被后者先吃掉，漏斗里就永远看不到最具体的那一级。
 */
function classify(name: string): StageSpec | null {
  const ordered = [...STAGE_SPECS].sort((a, b) => b.patterns.length - a.patterns.length);
  for (const spec of ordered) {
    if (spec.patterns.every((re) => re.test(name))) return spec;
  }
  return null;
}

/** 把一条分析的落库结果行装成一级 VM。 */
export function toStageVm(
  spec: StageSpec,
  analysis: FunnelAnalysisLike,
  rows: readonly ResultRowLike[],
): FunnelStageVm {
  const primary = pickPrimary(rows, "CONDITION");
  const allPrimary = pickPrimary(rows, "ALL");
  const condCount = pickGrouped(rows, "SAMPLE_COUNT", "CONDITION").sampleCount;
  const allCount = pickGrouped(rows, "SAMPLE_COUNT", "ALL").sampleCount;

  // 口径一致性保护：target 与结果行自报的 outcomeVariable 必须一致，
  // 否则这一行可能来自另一族（如 CONDITIONAL 附带的那行 MAX_DRAWDOWN）。
  const reported = rows
    .map((r) => detailString(r.details, "outcomeVariable"))
    .filter((v): v is string => v !== null);
  const target = analysis.target ?? null;
  const mismatch =
    target !== null && reported.length > 0 && reported.every((v) => v !== target);

  const excludedRowCount = mismatch ? rows.length : 0;
  const usable = mismatch ? [] : rows;

  const pValue = pickScalar(usable, "P_VALUE_DIFFERENCE");
  const minSample = rows
    .map((r) => detailNumber(r.details, "minSampleCount"))
    .find((v): v is number => v !== null) ?? null;

  return {
    kind: spec.kind,
    label: spec.label,
    rule: spec.rule,
    nested: spec.nested,
    parent: spec.parent,
    analysisId: analysis.id,
    analysisName: analysis.name,
    status: analysis.status ?? null,
    conditionSampleCount: mismatch ? null : condCount,
    allSampleCount: mismatch ? null : allCount,
    shareOfAll: condCount !== null && allCount !== null && allCount > 0 ? condCount / allCount : null,
    shrinkFromPrev: null,
    shrinkBaselineLabel: null,
    value: mismatch ? null : primary.value,
    valueDisplay: primary.value === null ? "—" : formatMetricValue(primary.code, primary.value),
    allValue: mismatch ? null : allPrimary.value,
    allValueDisplay: allPrimary.value === null ? "—" : formatMetricValue(allPrimary.code, allPrimary.value),
    difference: pickScalar(usable, "DIFFERENCE"),
    pValue,
    tStat: pickScalar(usable, "T_STAT_DIFFERENCE"),
    medianDisplay: (() => {
      const v = pickGrouped(usable, "MEDIAN_RETURN", "CONDITION").value;
      return v === null ? "—" : formatMetricValue("MEDIAN_RETURN", v);
    })(),
    winRateDisplay: (() => {
      const v = pickGrouped(usable, "WIN_RATE", "CONDITION").value;
      return v === null ? "—" : formatMetricValue("WIN_RATE", v);
    })(),
    stdDisplay: (() => {
      const v = pickGrouped(usable, "STD_RETURN", "CONDITION").value;
      return v === null ? "—" : formatMetricValue("STD_RETURN", v);
    })(),
    conditionRule: rows.map((r) => detailString(r.details, "conditionRule")).find((v) => v !== null) ?? null,
    lowSample: condCount !== null && minSample !== null ? condCount < minSample : false,
    excludedRowCount,
  };
}

/**
 * 组装漏斗索引。
 *
 * `rowsById` 只包含**已取到结果**的分析；没取到的分析仍会出现在漏斗里（`status` 如实显示），
 * 因为「哪一级还没跑」本身就是用户要的信息。
 */
export function buildFunnelIndex(
  analyses: readonly FunnelAnalysisLike[],
  rowsById: ReadonlyMap<number, readonly ResultRowLike[]>,
): FunnelIndex {
  const chain: FunnelStageVm[] = [];
  const controls: FunnelStageVm[] = [];
  const unclassified: FunnelIndex["unclassified"] = [];

  for (const analysis of analyses) {
    const spec = classify(analysis.name);
    if (spec === null) {
      unclassified.push({
        analysisId: analysis.id,
        analysisName: analysis.name,
        reason: "分析名里没有可识别的规则标记（未破 / 已破 / 缩量 / 放量 / 翻红 / T+k）",
      });
      continue;
    }
    const rows = rowsById.get(analysis.id) ?? [];
    const vm = toStageVm(spec, analysis, rows);
    // 同名级重复时保留有结果的，避免「重跑前建的旧分析」把有效的那条挤掉。
    const bucket = spec.nested ? chain : controls;
    const existing = bucket.findIndex((s) => s.kind === spec.kind);
    if (existing >= 0) {
      if (bucket[existing]!.value === null && vm.value !== null) bucket[existing] = vm;
      continue;
    }
    bucket.push(vm);
  }

  // 主链按 STAGE_SPECS 顺序稳定排序（而非出现顺序），确保两次打开漏斗的顺序一致。
  const orderOf = (k: FunnelStageKind) => STAGE_SPECS.findIndex((s) => s.kind === k);
  chain.sort((a, b) => orderOf(a.kind) - orderOf(b.kind));
  controls.sort((a, b) => orderOf(a.kind) - orderOf(b.kind));

  // 逐级算出「相对**逻辑父级**的保留比」。
  //
  // 🔴 为什么不能遍历「链里前一个」：链按用户思考顺序排，深浅回撤三个变体被插在
  // `hold` 与 `hold_shrink` 之间 ⇒ `hold_shrink` 的前一个是 `hold_deep`(2,218)，
  // 会算出 2746/2218 = 124% 的荒谬值（子集不可能大于父集）。
  // 父级必须按 `parent` 声明去找。
  //
  // 父级在本 Run **没建分析**时（用户可能只建了「守线+缩量」而没建「守线」），
  // 回落到「链上最近的有结果的前驱」，并在 `shrinkBaselineLabel` 里如实写明比较对象 ——
  // 宁可让用户看到「这个比值不是跟父级比的」，也不要静默给一个错误分母。
  const byKind = new Map<FunnelStageKind, FunnelStageVm>();
  for (const s of chain) byKind.set(s.kind, s);

  for (let i = 0; i < chain.length; i += 1) {
    const cur = chain[i]!;
    if (cur.conditionSampleCount === null) continue;

    // `parent === null` = 语义上的父级是「全样本」而不是某个分析
    // （主链起点、以及 T+2 这类**平行窗口变体**）⇒ 不该有「保留比」。
    // 🔴 绝不能回落到「链上前一个」：T+2 的前驱是「深回撤」(2,218)，
    // 会算出 20527/2218 = 925% 的荒谬值。
    if (cur.parent === null) continue;

    const declared = byKind.get(cur.parent) ?? null;
    if (declared !== null && declared.conditionSampleCount !== null) {
      cur.shrinkFromPrev = cur.conditionSampleCount / declared.conditionSampleCount;
      cur.shrinkBaselineLabel = declared.label;
      continue;
    }

    // 父级在本 Run **没建分析**时（用户可能只建了子级），回落到链上最近的有结果前驱，
    // 并在 `shrinkBaselineLabel` 里如实写明「这不是父级」—— 宁可让用户看到口径差异，
    // 也不要静默给一个错误分母。
    for (let j = i - 1; j >= 0; j -= 1) {
      const cand = chain[j]!;
      if (cand.conditionSampleCount !== null && cand.conditionSampleCount > 0) {
        cur.shrinkFromPrev = cur.conditionSampleCount / cand.conditionSampleCount;
        cur.shrinkBaselineLabel = `${cand.label}（父级「${cur.parent}」本 Run 未建分析，改为与前驱比较）`;
        break;
      }
    }
  }

  const targetVariable = analyses.map((a) => a.target).find((t): t is string => typeof t === "string" && t.length > 0) ?? null;

  return {
    chain,
    controls,
    unclassified,
    targetVariable,
    metricLabel: targetVariable ?? "(未声明 target)",
  };
}

/** 漏斗的一行摘要统计（供表头显示）。 */
export interface FunnelSummary {
  /** 全样本基准数（取有结果的分析里最大的 ALL 数）。 */
  allSampleCount: number | null;
  /** 主链最末端一级的样本数。 */
  finalSampleCount: number | null;
  /** 从全样本到末端总共保留的比例。 */
  finalShareOfAll: number | null;
  /** 有结果的主链级数 / 主链总级数。 */
  resolvedChain: number;
  chainSize: number;
}

export function summarizeFunnel(index: FunnelIndex): FunnelSummary {
  const allCounts = [...index.chain, ...index.controls]
    .map((s) => s.allSampleCount)
    .filter((v): v is number => v !== null);
  const allSampleCount = allCounts.length > 0 ? Math.max(...allCounts) : null;

  const last = [...index.chain].reverse().find((s) => s.conditionSampleCount !== null) ?? null;
  const finalSampleCount = last?.conditionSampleCount ?? null;

  return {
    allSampleCount,
    finalSampleCount,
    finalShareOfAll:
      allSampleCount !== null && finalSampleCount !== null && allSampleCount > 0
        ? finalSampleCount / allSampleCount
        : null,
    resolvedChain: index.chain.filter((s) => s.value !== null).length,
    chainSize: index.chain.length,
  };
}

/** 百分比显示（保留 1 位小数；极小值不显示成 0.0%）。 */
export function formatShare(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  if (pct > 0 && pct < 0.05) return "<0.05%";
  return `${pct.toFixed(1)}%`;
}

/** 比率显示（≥0.1 保留 2 位，否则保留 4 位 —— 小样本的缩减比需要精度）。 */
export function formatRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  return ratio >= 0.1 ? `${(ratio * 100).toFixed(1)}%` : `${(ratio * 100).toFixed(4)}%`;
}

export { formatCount };
