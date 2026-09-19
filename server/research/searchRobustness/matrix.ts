/**
 * ROBUSTNESS-001 §7 / §18 — 多参数二维稳定性矩阵。
 *
 * ## 形态
 *
 * ```text
 *                pullbackDepth
 *              0.03    0.05    0.07
 * entryDay 2   ●        ●       ·
 *          3   ●        ●       ·
 *          4   ·        ·       ·
 * ```
 *
 * 单元格 = 该 (rowValue, columnValue) 组合的 `stabilityRatio` 与稳定状态；
 * `·` = 源 Search 中不存在该组合 ⇒ `MISSING`（**不补值**，规格 §7）。
 *
 * ## 诚实边界（比图形好看更重要）
 *
 * - 搜索空间里**多于两个**可变参数时，一个单元格会命中多条组合（其余参数在不同取值上）
 *   ⇒ 如实标 `AMBIGUOUS` 并给出 `matchedCount`，**不挑一条当代表**；被略过的参数名
 *   列在 `omittedParameters` 里；
 * - 单元格**不禁用**「好坏」语义的单一颜色：本层只给 `status` / `stabilityRatio` / 原始指标，
 *   「配色」由前端按「状态种类」而非「数值高低」决定（规格 §18）。
 */

import type { NeighborhoodAxis } from "./neighborhood";
import { combinationLookupKey } from "./neighborhood";
import type { SourceIndex } from "./neighborhood";
import {
  type RobustnessMatrix,
  type RobustnessMatrixAxis,
  type RobustnessMatrixCell,
  type RobustnessParameterValue,
  type SearchRobustnessResult,
} from "./types";

/** 矩阵最多占用的参数轴数（规格 §7：至少两个参数 P1 × P2）。 */
export const ROBUSTNESS_MATRIX_AXIS_COUNT = 2;

/** 构造矩阵（纯函数；消费与单组合判定**同一份**结果，不重算任何指标）。 */
export function buildRobustnessMatrix(input: {
  readonly axes: readonly NeighborhoodAxis[];
  readonly results: readonly SearchRobustnessResult[];
  readonly index: SourceIndex;
}): RobustnessMatrix {
  const usedAxes = input.axes.slice(0, ROBUSTNESS_MATRIX_AXIS_COUNT);
  const omittedParameters = input.axes
    .slice(ROBUSTNESS_MATRIX_AXIS_COUNT)
    .map((axis) => axis.parameter);

  if (usedAxes.length < ROBUSTNESS_MATRIX_AXIS_COUNT) {
    // 少于两个可变参数 ⇒ 无法构成二维矩阵。返回 0×0 形态，由前端如实展示「不适用」。
    const [axis] = usedAxes;
    const rowAxis: RobustnessMatrixAxis =
      axis === undefined
        ? { parameter: "(无)", domainMode: "(无)", values: [] }
        : { parameter: axis.parameter, domainMode: axis.domainMode, values: axis.values };
    return {
      rowAxis,
      columnAxis: { parameter: "(无)", domainMode: "(无)", values: [] },
      cells: [],
      parameterCount: input.axes.length,
      omittedParameters,
    };
  }

  const [rowAxisSource, columnAxisSource] = usedAxes as [NeighborhoodAxis, NeighborhoodAxis];

  const resultByHash = new Map<string, SearchRobustnessResult>();
  for (const result of input.results) resultByHash.set(result.parameterHash, result);

  // 按 (rowValue, columnValue) 归并源组合（**唯一权威 = 源组合的参数取值**）。
  const matchedHashes = new Map<string, string[]>();
  for (const [key, combination] of input.index.combinationByKey) {
    const rowValue = combination.parameters[rowAxisSource.parameter] ?? null;
    const columnValue = combination.parameters[columnAxisSource.parameter] ?? null;
    const cellKey = cellKeyOf(rowValue, columnValue);
    const list = matchedHashes.get(cellKey);
    if (list === undefined) matchedHashes.set(cellKey, [combination.parameterHash]);
    else list.push(combination.parameterHash);
    void key;
  }

  const cells: RobustnessMatrixCell[] = [];
  rowAxisSource.values.forEach((rowValue, rowIndex) => {
    columnAxisSource.values.forEach((columnValue, columnIndex) => {
      const hashes = matchedHashes.get(cellKeyOf(rowValue, columnValue)) ?? [];
      const matchedCount = hashes.length;
      if (matchedCount === 0) {
        cells.push({
          rowIndex,
          columnIndex,
          rowValue,
          columnValue,
          parameterHash: null,
          present: false,
          status: "MISSING",
          stable: null,
          stabilityRatio: null,
          totalReturnPct: null,
          tradeCount: null,
          matchedCount: 0,
        });
        return;
      }
      if (matchedCount > 1) {
        cells.push({
          rowIndex,
          columnIndex,
          rowValue,
          columnValue,
          parameterHash: null,
          present: true,
          status: "AMBIGUOUS",
          stable: null,
          stabilityRatio: null,
          totalReturnPct: null,
          tradeCount: null,
          matchedCount,
        });
        return;
      }
      const hash = hashes[0] as string;
      const result = resultByHash.get(hash);
      cells.push({
        rowIndex,
        columnIndex,
        rowValue,
        columnValue,
        parameterHash: hash,
        present: true,
        status: result?.status ?? "SOURCE_RESULT_UNAVAILABLE",
        stable: result?.stable ?? null,
        stabilityRatio: result?.stabilityRatio ?? null,
        totalReturnPct: result?.metrics.totalReturnPct ?? null,
        tradeCount: result?.metrics.tradeCount ?? null,
        matchedCount: 1,
      });
    });
  });

  return {
    rowAxis: {
      parameter: rowAxisSource.parameter,
      domainMode: rowAxisSource.domainMode,
      values: rowAxisSource.values,
    },
    columnAxis: {
      parameter: columnAxisSource.parameter,
      domainMode: columnAxisSource.domainMode,
      values: columnAxisSource.values,
    },
    cells,
    parameterCount: input.axes.length,
    omittedParameters,
  };
}

/** 单元格键（两个取值 → 稳定键；`null` 参与键但**不会**与「缺失」混同 —— 缺失靠 `matchedCount=0`）。 */
function cellKeyOf(row: RobustnessParameterValue, column: RobustnessParameterValue): string {
  return combinationLookupKey({ __row: row, __column: column });
}
