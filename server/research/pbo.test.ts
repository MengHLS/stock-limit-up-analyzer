/**
 * STEP 6.5 — PBO / CSCV 测试。
 *
 * 覆盖（§三十八 PBO）：N=4、N=6、odd partition reject、insufficient candidate、invalid metrics、
 * tied metrics、deterministic ordering、明显过拟合合成数据、相对稳定合成数据、PBO 范围 [0,1]、
 * CSCV 划分、序列化 round-trip。
 */

import { describe, expect, it } from "vitest";
import {
  computePbo,
  deserializePboResult,
  generateCscvSplits,
  serializePboResult,
  type PboCandidate,
  type PboInput,
} from "./pbo";

function candidate(experimentId: string, partitionMetrics: number[]): PboCandidate {
  return { experimentId, parameterSet: { id: experimentId }, partitionMetrics };
}

function input(overrides: Partial<PboInput> = {}): PboInput {
  return {
    numPartitions: 4,
    candidates: [],
    selectionMetric: "sharpeRatio",
    selectionDirection: "maximize",
    ...overrides,
  };
}

describe("CSCV 划分生成", () => {
  it("N=4 产生 3 个去对称划分（与 §十九 一致）", () => {
    const splits = generateCscvSplits(4);
    expect(splits).toHaveLength(3);
    expect(splits).toContainEqual({ trainPartitions: [1, 2], testPartitions: [3, 4] });
    expect(splits).toContainEqual({ trainPartitions: [1, 3], testPartitions: [2, 4] });
    expect(splits).toContainEqual({ trainPartitions: [1, 4], testPartitions: [2, 3] });
  });

  it("N=6 产生 C(6,3)/2 = 10 个划分", () => {
    expect(generateCscvSplits(6)).toHaveLength(10);
  });

  it("奇数分区 → 抛错", () => {
    expect(() => generateCscvSplits(5)).toThrow(/偶数|CSCV_PARTITIONS_ODD/);
  });

  it("N < 4 → 抛错", () => {
    expect(() => generateCscvSplits(2)).toThrow(/>= 4|CSCV_PARTITIONS_TOO_SMALL/);
  });
});

describe("PBO — 明显过拟合合成数据", () => {
  it("极端集中在单一分区 → PBO = 1.0", () => {
    const result = computePbo(input({
      candidates: [
        candidate("SPIKE", [100, -1, -1, -1]),
        candidate("STABLE", [1, 1, 1, 1]),
        candidate("ZERO", [0, 0, 0, 0]),
      ],
    }));
    expect(result.status).toBe("computed");
    expect(result.evaluatedCombinations).toBe(3);
    expect(result.overfitCount).toBe(3);
    expect(result.pbo).toBe(1);
    expect(result.pbo).toBeGreaterThanOrEqual(0);
    expect(result.pbo).toBeLessThanOrEqual(1);
  });
});

describe("PBO — 相对稳定合成数据", () => {
  it("稳定单调占优 → PBO = 0.0", () => {
    const result = computePbo(input({
      candidates: [
        candidate("BEST", [10, 10, 10, 10]),
        candidate("MID", [5, 5, 5, 5]),
        candidate("WORST", [0, 0, 0, 0]),
      ],
    }));
    expect(result.status).toBe("computed");
    expect(result.pbo).toBe(0);
  });
});

describe("PBO — 数据不足 / 非法 metric", () => {
  it("候选 < 2 → insufficient_data（pbo null）", () => {
    const result = computePbo(input({ candidates: [candidate("A", [1, 1, 1, 1])] }));
    expect(result.status).toBe("insufficient_data");
    expect(result.pbo).toBe(null);
  });

  it("全 NaN/Infinity → insufficient_data", () => {
    const result = computePbo(input({
      candidates: [
        candidate("A", [NaN, NaN, NaN, NaN]),
        candidate("B", [Infinity, Infinity, Infinity, Infinity]),
        candidate("C", [null, null, null, null]),
      ],
    }));
    expect(result.status).toBe("insufficient_data");
    expect(result.pbo).toBe(null);
  });

  it("非法 metric 不得参与排名", () => {
    // A 在分区 1 全 NaN → A 被排除；B/C 有效。
    const result = computePbo(input({
      candidates: [
        candidate("A", [NaN, NaN, NaN, NaN]),
        candidate("B", [10, 10, 10, 10]),
        candidate("C", [0, 0, 0, 0]),
      ],
    }));
    expect(result.status).toBe("computed");
    expect(result.pbo).toBe(0); // B 恒占优
    expect(result.splitResults.every((s) => s.selectedExperimentId === "B")).toBe(true);
  });

  it("奇数 numPartitions → 抛错（不返回 PBO=0）", () => {
    expect(() => computePbo(input({
      numPartitions: 5,
      candidates: [candidate("A", [1, 1, 1, 1, 1]), candidate("B", [0, 0, 0, 0, 0])],
    }))).toThrow(/偶数|CSCV_PARTITIONS_ODD/);
  });
});

describe("PBO — tie-break 与确定性", () => {
  it("同 metric 按 experimentId 字典序 tie-break（deterministic）", () => {
    const make = () => input({
      candidates: [
        candidate("EXP-C", [5, 5, 5, 5]),
        candidate("EXP-A", [5, 5, 5, 5]),
        candidate("EXP-B", [5, 5, 5, 5]),
      ],
    });
    const first = computePbo(make());
    const second = computePbo(make());
    expect(first).toEqual(second);
    // 全并列 → IS 最优恒为 EXP-A（字典序最小），其 OOS 也恒排名第 1 → PBO=0
    expect(first.pbo).toBe(0);
    expect(first.splitResults.every((s) => s.selectedExperimentId === "EXP-A")).toBe(true);
  });

  it("候选顺序打乱不影响 PBO（deterministic ordering）", () => {
    const candidates = [
      candidate("SPIKE", [100, -1, -1, -1]),
      candidate("STABLE", [1, 1, 1, 1]),
      candidate("ZERO", [0, 0, 0, 0]),
    ];
    const a = computePbo(input({ candidates }));
    const b = computePbo(input({ candidates: [...candidates].reverse() }));
    expect(a.pbo).toBe(b.pbo);
    expect(a.fingerprint).toBe(a.fingerprint);
  });

  it("相同输入 → 相同 fingerprint 与相同 PBO", () => {
    const make = () => input({ candidates: [candidate("A", [1, 2, 3, 4]), candidate("B", [4, 3, 2, 1])] });
    const a = computePbo(make());
    const b = computePbo(make());
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.pbo).toBe(b.pbo);
  });
});

describe("PBO — 序列化", () => {
  it("serialize → deserialize round-trip 语义一致", () => {
    const result = computePbo(input({
      candidates: [
        candidate("SPIKE", [100, -1, -1, -1]),
        candidate("STABLE", [1, 1, 1, 1]),
        candidate("ZERO", [0, 0, 0, 0]),
      ],
    }));
    const restored = deserializePboResult(serializePboResult(result));
    expect(restored).toEqual(result);
  });

  it("deserialize 返回独立副本", () => {
    const result = computePbo(input({
      candidates: [candidate("A", [1, 2, 3, 4]), candidate("B", [4, 3, 2, 1])],
    }));
    const json = serializePboResult(result);
    const r1 = deserializePboResult(json);
    r1.splitResults.push({ trainPartitions: [], testPartitions: [], selectedExperimentId: "X", trainMetric: 0, trainRank: 1, testRank: 1, testPercentile: 0, isOverfit: false });
    const r2 = deserializePboResult(json);
    expect(r2.splitResults.length).toBe(result.splitResults.length);
  });
});
