/**
 * researchMatrix 单测。
 *
 * 覆盖重点是**归组纪律**（哪些分析能进矩阵、哪些必须进 `unclassified`）与
 * **口径纪律**（哪些结果行会被排除），以及矩阵的**行列固定顺序与缺格上报**。
 *
 * 不锁定格式化细节（`—` / `+1.23%` 之类由 `researchEngineAdapter` 自己的单测负责）。
 */

import { describe, expect, it } from "vitest";
import {
  ALL_PULLBACK_COLUMN,
  buildMatrix,
  buildMatrixIndex,
  DEPTH_BUCKET_ORDER,
  extractMatrixCell,
  parseMatrixCoordinate,
  pickDefaultSelection,
  summarizeRows,
  type MatrixAnalysisLike,
} from "./researchMatrix";
import type { ResultRowLike } from "@/adapters/researchEngineAdapter";

// ---------------------------------------------------------------------------
// 构造器
// ---------------------------------------------------------------------------

function analysis(id: number, name: string, target: string | null, status = "COMPLETED"): MatrixAnalysisLike {
  return { id, name, target, status };
}

/** 组 B 风格的格子：`T+d 回撤X~Y% → 之后5日收益`，target = segment_return_{d}_{d+5}d。 */
function bucketCell(id: number, d: number, bucket: string, target?: string): MatrixAnalysisLike {
  return analysis(id, `首板后回撤·T+${d} 回撤${bucket} → 之后5日收益`, target ?? `segment_return_${d}_${d + 5}d`);
}

type RowOpts = {
  group?: "CONDITION" | "ALL";
  /** `details.variable`（该指标实际作用的变量）。 */
  variable?: string | null;
  /** `details.outcomeVariable`。 */
  outcomeVariable?: string | null;
  lowSample?: boolean;
};

function groupedRow(
  metricCode: string,
  metricValue: number | null,
  sampleCount: number | null,
  opts: RowOpts = {},
): ResultRowLike {
  const details: Record<string, unknown> = {};
  if (opts.variable !== undefined) details.variable = opts.variable;
  if (opts.outcomeVariable !== undefined) details.outcomeVariable = opts.outcomeVariable;
  if (opts.lowSample !== undefined) details.lowSample = opts.lowSample;
  return {
    resultType: "GROUPED",
    metricCode,
    metricValue,
    sampleCount,
    dimension: opts.group !== undefined ? { group: opts.group } : null,
    details: Object.keys(details).length > 0 ? details : null,
  };
}

function scalarRow(metricCode: string, metricValue: number | null, details?: Record<string, unknown>): ResultRowLike {
  return { resultType: "SCALAR", metricCode, metricValue, sampleCount: null, dimension: null, details: details ?? null };
}

/** 一个完整的条件分析结果（CONDITION + ALL + 4 个标量）。 */
function conditionalRows(opts: {
  target: string;
  condMean: number;
  allMean: number;
  condN?: number;
  allN?: number;
  pValue?: number;
  tStat?: number;
  lowSample?: boolean;
  extraDrawdownRow?: boolean;
}): ResultRowLike[] {
  const condN = opts.condN ?? 1814;
  const allN = opts.allN ?? 23668;
  const rows: ResultRowLike[] = [
    groupedRow("MEAN_RETURN", opts.condMean, condN, {
      group: "CONDITION",
      outcomeVariable: opts.target,
      ...(opts.lowSample !== undefined ? { lowSample: opts.lowSample } : {}),
    }),
    groupedRow("MEDIAN_RETURN", opts.condMean - 0.01, condN, { group: "CONDITION", outcomeVariable: opts.target }),
    groupedRow("STD_RETURN", 0.11, condN, { group: "CONDITION", outcomeVariable: opts.target }),
    groupedRow("WIN_RATE", 0.41, condN, { group: "CONDITION", outcomeVariable: opts.target }),
    groupedRow("SAMPLE_COUNT", condN, condN, { group: "CONDITION", outcomeVariable: opts.target }),
    groupedRow("MEAN_RETURN", opts.allMean, allN, { group: "ALL", outcomeVariable: opts.target }),
    groupedRow("MEDIAN_RETURN", opts.allMean - 0.01, allN, { group: "ALL", outcomeVariable: opts.target }),
    groupedRow("SAMPLE_COUNT", allN, allN, { group: "ALL", outcomeVariable: opts.target }),
    scalarRow("DIFFERENCE", opts.condMean - opts.allMean, {
      differenceDefinition: "DIFFERENCE = mean(条件样本) − mean(全样本)。",
      conditionRule: `future_return_1d < -0.04 AND future_return_1d > -0.06`,
    }),
    scalarRow("RELATIVE_DIFFERENCE", -1.7),
    scalarRow("T_STAT_DIFFERENCE", opts.tStat ?? -2.54),
    scalarRow("P_VALUE_DIFFERENCE", opts.pValue ?? 0.011),
  ];
  if (opts.extraDrawdownRow) {
    // `CONDITIONAL` 自动附送的一行：variable 由 target 名尾推导，与 target 不是同一变量
    rows.push(groupedRow("MAX_DRAWDOWN", -0.047, condN, { group: "CONDITION", variable: "max_drawdown_5d" }));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

describe("parseMatrixCoordinate", () => {
  it("组 B 格子：T+d + 桶 + target 一致 → 坐标正确", () => {
    const parsed = parseMatrixCoordinate(bucketCell(480041, 2, "4~6%"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.coordinate.day).toBe(2);
    expect(parsed.coordinate.dayKey).toBe("T+2");
    expect(parsed.coordinate.columnKey).toBe("4~6%");
    expect(parsed.coordinate.scope.key).toBe("BARE");
    expect(parsed.coordinate.familyKey).toBe("return_5");
    expect(parsed.coordinate.target).toBe("segment_return_2_7d");
  });

  it("组 A：无桶但写「已回撤」→ 参照列", () => {
    const parsed = parseMatrixCoordinate(
      analysis(480001, "首板后回撤·T+1 已回撤(相对首板收盘) → 之后5日收益", "segment_return_1_6d"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.coordinate.columnKey).toBe(ALL_PULLBACK_COLUMN);
    expect(parsed.coordinate.scope.key).toBe("BARE");
  });

  it("组 C：带「未破」→ 独立口径，仍保留桶", () => {
    const parsed = parseMatrixCoordinate(
      analysis(480131, "首板后回撤·T+5 未破首板最低价 且 回撤0~2% → 之后5日收益", "segment_return_5_10d"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.coordinate.scope.key).toBe("EVENT_LOW_GUARD");
    expect(parsed.coordinate.columnKey).toBe("0~2%");
  });

  it("组 C 的参照列：「未破」与「已回撤」同现 → 加资格口径 × 参照列（不被误判成桶）", () => {
    const parsed = parseMatrixCoordinate(
      analysis(510023, "首板后回撤·T+5 未破首板最低价 且 已回撤(相对首板收盘) → 之后5日收益", "segment_return_5_10d"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.coordinate.scope.key).toBe("EVENT_LOW_GUARD");
    expect(parsed.coordinate.columnKey).toBe(ALL_PULLBACK_COLUMN);
    expect(parsed.coordinate.familyKey).toBe("return_5");
  });

  it("其他指标族：max_return_5 / max_drawdown_5 / horizon=1", () => {
    const a = parseMatrixCoordinate(bucketCell(1, 3, "2~4%", "segment_max_return_3_8d"));
    const b = parseMatrixCoordinate(bucketCell(2, 3, "2~4%", "segment_max_drawdown_3_8d"));
    const c = parseMatrixCoordinate(bucketCell(3, 3, "2~4%", "segment_return_3_4d"));
    expect(a.ok && a.coordinate.familyKey).toBe("max_return_5");
    expect(b.ok && b.coordinate.familyKey).toBe("max_drawdown_5");
    expect(c.ok && c.coordinate.familyKey).toBe("return_1");
  });

  it("名称决策日与 target 起始日不一致 → 拒绝（并说明原因）", () => {
    const parsed = parseMatrixCoordinate(bucketCell(9, 1, "4~6%", "segment_return_2_7d"));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("不一致");
  });

  it("没有 target / 名称无箭头 → 拒绝", () => {
    const noTarget = parseMatrixCoordinate(analysis(10, "首板后回撤·T+1 回撤4~6% → 之后5日收益", null));
    const noArrow = parseMatrixCoordinate(analysis(11, "某种描述统计", "segment_return_1_6d"));
    expect(noTarget.ok).toBe(false);
    expect(noArrow.ok).toBe(false);
  });
});

describe("buildMatrixIndex", () => {
  it("归类 + 未归类分别落表，族清单按固定顺序", () => {
    const index = buildMatrixIndex([
      bucketCell(1, 1, "0~2%", "segment_max_drawdown_1_6d"),
      bucketCell(2, 1, "0~2%", "segment_return_1_2d"),
      bucketCell(3, 1, "0~2%", "segment_return_1_6d"),
      analysis(4, "无法解析的分析", null),
    ]);
    expect(index.entries).toHaveLength(3);
    expect(index.unclassified).toHaveLength(1);
    expect(index.unclassified[0]!.analysisId).toBe(4);
    // 固定顺序：return_1 在 return_5 之前，max_drawdown_5 最后
    expect(index.families.map((f) => f.key)).toEqual(["return_1", "return_5", "max_drawdown_5"]);
  });

  it("口径清单只收录实际存在的口径", () => {
    const bare = buildMatrixIndex([bucketCell(1, 1, "0~2%")]);
    expect(bare.scopes.map((s) => s.key)).toEqual(["BARE"]);
    const guarded = buildMatrixIndex([
      analysis(1, "首板后回撤·T+5 未破首板最低价 且 回撤0~2% → 之后5日收益", "segment_return_5_10d"),
    ]);
    expect(guarded.scopes.map((s) => s.key)).toEqual(["EVENT_LOW_GUARD"]);
  });

  it("默认选择优先「无资格约束 × 之后 5 日收益」", () => {
    const index = buildMatrixIndex([bucketCell(1, 2, "2~4%"), bucketCell(2, 2, "2~4%", "segment_return_2_3d")]);
    expect(pickDefaultSelection(index)).toEqual({ scopeKey: "BARE", familyKey: "return_5" });
  });
});

// ---------------------------------------------------------------------------
// 结果行 → 格子统计
// ---------------------------------------------------------------------------

describe("extractMatrixCell", () => {
  const TARGET = "segment_return_1_6d";

  it("取条件组主指标与全样本参照，并原样带出差值口径", () => {
    const stats = extractMatrixCell(conditionalRows({ target: TARGET, condMean: -0.0105, allMean: -0.0038 }), TARGET);
    expect(stats).not.toBeNull();
    expect(stats!.value).toBeCloseTo(-0.0105, 6);
    expect(stats!.conditionSampleCount).toBe(1814);
    expect(stats!.allSampleCount).toBe(23668);
    expect(stats!.difference).toBeCloseTo(-0.0105 + 0.0038, 6);
    expect(stats!.differenceDefinition).toContain("条件样本");
    expect(stats!.pValue).toBeCloseTo(0.011, 6);
    expect(stats!.conditionRule).toContain("future_return_1d");
    expect(stats!.excludedRowCount).toBe(0);
  });

  it("排除 variable 与 target 不一致的附送行（MAX_DRAWDOWN）并计数", () => {
    const rows = conditionalRows({
      target: TARGET,
      condMean: -0.0105,
      allMean: -0.0038,
      extraDrawdownRow: true,
    });
    const stats = extractMatrixCell(rows, TARGET);
    expect(stats).not.toBeNull();
    // 附送行被排除，且**不会**污染主指标取值
    expect(stats!.excludedRowCount).toBe(1);
    expect(stats!.value).toBeCloseTo(-0.0105, 6);
  });

  it("outcomeVariable 与 target 不同 → 该行不计入", () => {
    const rows = [
      groupedRow("MEAN_RETURN", -0.5, 10, { group: "CONDITION", outcomeVariable: "segment_return_2_7d" }),
    ];
    expect(extractMatrixCell(rows, TARGET)).toBeNull();
  });

  it("显著性：p<0.05 且非小样本才标显著；小样本一律不标", () => {
    const significant = extractMatrixCell(
      conditionalRows({ target: TARGET, condMean: -0.0105, allMean: -0.0038, pValue: 0.011 }),
      TARGET,
    );
    expect(significant!.significant).toBe(true);
    expect(significant!.stronglySignificant).toBe(false);

    const strong = extractMatrixCell(
      conditionalRows({ target: TARGET, condMean: -0.0105, allMean: -0.0038, pValue: 0.0004 }),
      TARGET,
    );
    expect(strong!.stronglySignificant).toBe(true);

    const notSignificant = extractMatrixCell(
      conditionalRows({ target: TARGET, condMean: -0.0105, allMean: -0.0038, pValue: 0.42 }),
      TARGET,
    );
    expect(notSignificant!.significant).toBe(false);

    const lowSample = extractMatrixCell(
      conditionalRows({ target: TARGET, condMean: -0.0105, allMean: -0.0038, pValue: 0.001, lowSample: true }),
      TARGET,
    );
    expect(lowSample!.lowSample).toBe(true);
    expect(lowSample!.significant).toBe(false);
  });

  it("没有条件组统计 → null（不补 0）", () => {
    expect(extractMatrixCell([groupedRow("MEAN_RETURN", -0.0038, 23668, { group: "ALL" })], TARGET)).toBeNull();
    expect(extractMatrixCell([], TARGET)).toBeNull();
  });

  it("条件组为空（主指标全为 null）→ null", () => {
    const rows = conditionalRows({ target: TARGET, condMean: -0.01, allMean: -0.0038 }).map((r) =>
      r.resultType === "GROUPED" && (r.dimension as { group?: string } | null)?.group === "CONDITION"
        ? { ...r, metricValue: null }
        : r,
    );
    expect(extractMatrixCell(rows, TARGET)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 组装
// ---------------------------------------------------------------------------

describe("buildMatrix", () => {
  it("行列固定顺序 + 缺格上报 + coverage", () => {
    const analyses = [
      bucketCell(1, 1, "0~2%"),
      bucketCell(2, 1, "8%+"),
      bucketCell(3, 2, "0~2%"),
      analysis(4, "首板后回撤·T+1 已回撤(相对首板收盘) → 之后5日收益", "segment_return_1_6d"),
    ];
    const index = buildMatrixIndex(analyses);
    const rowsById = new Map<number, readonly ResultRowLike[]>([
      [1, conditionalRows({ target: "segment_return_1_6d", condMean: -0.0021, allMean: -0.0038 })],
      [2, conditionalRows({ target: "segment_return_1_6d", condMean: -0.0412, allMean: -0.0038 })],
      // 3 号已建、结果已拉到但为空（引擎跑过、这一格没有可用样本）
      [3, []],
      [4, conditionalRows({ target: "segment_return_1_6d", condMean: -0.005, allMean: -0.0038 })],
    ]);
    const vm = buildMatrix(index, { scopeKey: "BARE", familyKey: "return_5" }, rowsById);

    expect(vm.rows.map((r) => r.rowKey)).toEqual(["T+1", "T+2"]);
    // 参照列在最左，桶按固定顺序（2~4% 未建，故不出现该列）
    expect(vm.columns.map((c) => c.key)).toEqual([ALL_PULLBACK_COLUMN, "0~2%", "8%+"]);
    expect(vm.metricCode).toBe("MEAN_RETURN");
    expect(vm.coverage.cells).toBe(6);
    expect(vm.coverage.built).toBe(4);
    expect(vm.coverage.withResult).toBe(3);
    expect(vm.coverage.missing).toBe(2);

    const t2 = vm.rows[1]!;
    const zeroTwo = t2.cells.find((c) => c.columnKey === "0~2%")!;
    expect(zeroTwo.analysisId).toBe(3);
    expect(zeroTwo.resultLoaded).toBe(true);
    expect(zeroTwo.stats).toBeNull(); // 已建但无结果 ≠ 未建
    const eight = t2.cells.find((c) => c.columnKey === "8%+")!;
    expect(eight.analysisId).toBeNull(); // 未建
    expect(eight.resultLoaded).toBe(false);
  });

  it("口径隔离：EVENT_LOW_GUARD 的格子不混进 BARE 矩阵", () => {
    const analyses = [
      bucketCell(1, 5, "0~2%", "segment_return_5_10d"),
      analysis(2, "首板后回撤·T+5 未破首板最低价 且 回撤0~2% → 之后5日收益", "segment_return_5_10d"),
    ];
    const index = buildMatrixIndex(analyses);
    const rowsById = new Map<number, readonly ResultRowLike[]>([
      [1, conditionalRows({ target: "segment_return_5_10d", condMean: -0.001, allMean: -0.003 })],
      [2, conditionalRows({ target: "segment_return_5_10d", condMean: 0.004, allMean: -0.003 })],
    ]);
    const bare = buildMatrix(index, { scopeKey: "BARE", familyKey: "return_5" }, rowsById);
    const guarded = buildMatrix(index, { scopeKey: "EVENT_LOW_GUARD", familyKey: "return_5" }, rowsById);
    const cellOf = (vm: typeof bare, rowKey: string, columnKey: string) =>
      vm.rows.find((r) => r.rowKey === rowKey)!.cells.find((c) => c.columnKey === columnKey)!;
    // 只有 T+5 有分析（另 4 行是「未建」行）—— 缺格不被隐藏
    expect(bare.rows.map((r) => r.rowKey)).toEqual(["T+1", "T+2", "T+3", "T+4", "T+5"]);
    expect(cellOf(bare, "T+1", "0~2%").analysisId).toBeNull();
    expect(cellOf(bare, "T+5", "0~2%").analysisId).toBe(1);
    expect(cellOf(guarded, "T+5", "0~2%").analysisId).toBe(2);
    expect(guarded.scope.key).toBe("EVENT_LOW_GUARD");
  });

  it("族与口径缺失时给出空矩阵而不是抛错", () => {
    const index = buildMatrixIndex([bucketCell(1, 1, "0~2%")]);
    const vm = buildMatrix(index, { scopeKey: "NOPE", familyKey: "NOPE" }, new Map());
    expect(vm.coverage.withResult).toBe(0);
    expect(vm.rows).toEqual([]);
    expect(vm.columns).toEqual([]);
  });

  it("未归类清单随矩阵一起带出（不静默丢弃）", () => {
    const index = buildMatrixIndex([bucketCell(1, 1, "0~2%"), analysis(2, "改过名字的分析", "segment_return_1_5d")]);
    const vm = buildMatrix(index, { scopeKey: "BARE", familyKey: "return_5" }, new Map());
    expect(vm.unclassified.map((u) => u.analysisId)).toEqual([2]);
  });
});

describe("summarizeRows", () => {
  it("样本数求和与显著格计数（不做加权平均）", () => {
    const analyses = [bucketCell(1, 1, "0~2%"), bucketCell(2, 1, "2~4%")];
    const index = buildMatrixIndex(analyses);
    const rowsById = new Map<number, readonly ResultRowLike[]>([
      [1, conditionalRows({ target: "segment_return_1_6d", condMean: -0.02, allMean: -0.0038, condN: 100, pValue: 0.01 })],
      [2, conditionalRows({ target: "segment_return_1_6d", condMean: 0.01, allMean: -0.0038, condN: 300, pValue: 0.02 })],
    ]);
    const vm = buildMatrix(index, { scopeKey: "BARE", familyKey: "return_5" }, rowsById);
    const summary = summarizeRows(vm);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.cellCount).toBe(2);
    expect(summary[0]!.totalSampleCount).toBe(400);
    expect(summary[0]!.negativeSignificant).toBe(1);
    expect(summary[0]!.positiveSignificant).toBe(1);
  });

  it("有格缺样本数 → 不给合计（宁可缺，不给可疑数）", () => {
    const analyses = [bucketCell(1, 1, "0~2%"), bucketCell(2, 1, "2~4%")];
    const index = buildMatrixIndex(analyses);
    const rows = conditionalRows({ target: "segment_return_1_6d", condMean: 0.01, allMean: -0.0038 });
    const rowsById = new Map<number, readonly ResultRowLike[]>([
      [1, rows],
      // 第二格的主指标行缺样本数 → 合计不可得
      [2, rows.map((r) => (r.metricCode === "MEAN_RETURN" && (r.dimension as { group?: string })?.group === "CONDITION" ? { ...r, sampleCount: null } : r))],
    ]);
    const vm = buildMatrix(index, { scopeKey: "BARE", familyKey: "return_5" }, rowsById);
    expect(summarizeRows(vm)[0]!.totalSampleCount).toBeNull();
  });
});

describe("固定桶顺序", () => {
  it("桶顺序常量与解析结果一致（含 8%+）", () => {
    const index = buildMatrixIndex([
      bucketCell(1, 1, "8%+"),
      bucketCell(2, 1, "0~2%"),
      bucketCell(3, 1, "6~8%"),
    ]);
    const vm = buildMatrix(index, { scopeKey: "BARE", familyKey: "return_5" }, new Map());
    expect(vm.columns.map((c) => c.key)).toEqual(["0~2%", "6~8%", "8%+"]);
    expect(DEPTH_BUCKET_ORDER).toEqual(["0~2%", "2~4%", "4~6%", "6~8%", "8%+"]);
  });
});
