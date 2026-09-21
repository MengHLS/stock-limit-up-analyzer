/**
 * STRATEGY-RESEARCH-BRIDGE-001 §18.1 / §18.2 —— **Research Evidence 契约**测试。
 *
 * 本文件只碰**纯函数**（`researchEvidence.ts` 零 IO / 零 DB / 零随机）：不装 Service、不连库。
 * 覆盖规格逐条点名的判据：
 *
 * | 规格 | 判据 | 用例 |
 * | --- | --- | --- |
 * | §18.1 | 合法证据通过 | 1-a |
 * | §18.1 | 缺 runId / runId 形态错 | 1-b |
 * | §18.1 | 缺 experimentCode / experimentVersion（= 由 Run 决定，不接受自报） | 1-c |
 * | §18.1 | 缺 datasetVersionId | 1-d |
 * | §18.1 | 非法 reference（非点分路径 / 超长 / 描述超长） | 1-e |
 * | §18.1 | 重复证据 | 1-f |
 * | §12  | reference 在**真实结果**里解析不到 ⇒ 失败（不得虚构 artifact） | 1-g |
 * | §18.2 | 相同证据 ⇒ 相同指纹 | 2-a |
 * | §18.2 | 证据顺序变化 ⇒ 指纹不变（顺序无关） | 2-b |
 * | §18.2 | 任一字段变化 ⇒ 指纹变化 | 2-c / 2-d |
 * | §18.2 | 指纹与执行语义指纹**前缀不同**（同名不同义） | 2-e |
 * | §18.2 | 快照编解码可往返；声明即受校验 | 3-a ~ 3-d |
 * | §18.2 | 多份证据必须同 Dataset | 4-a / 4-b |
 */

import { describe, expect, it } from "vitest";
import {
  RESEARCH_EVIDENCE_ERROR,
  RESEARCH_EVIDENCE_FINGERPRINT_PREFIX,
  RESEARCH_EVIDENCE_KINDS,
  RESEARCH_EVIDENCE_SNAPSHOT_KEY,
  ResearchEvidenceError,
  assertDeclaredResearchEvidence,
  assertResearchEvidenceRefs,
  buildResearchEvidenceSnapshot,
  computeResearchEvidenceFingerprint,
  readResearchEvidenceFingerprint,
  readResearchEvidenceRecords,
  resolveEvidenceReference,
  resolveSingleDatasetVersionId,
  type ResearchEvidenceRecord,
  type ResearchEvidenceRef,
} from "../../../../server/research/strategyCandidate/researchEvidence";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function ref(overrides: Partial<ResearchEvidenceRef> = {}): ResearchEvidenceRef {
  return {
    runId: "RUN-20260921-8557F38A",
    evidenceKind: "RESULT_SUMMARY",
    reference: "sampleSummary.eligibleCount",
    ...overrides,
  };
}

function record(overrides: Partial<ResearchEvidenceRecord> = {}): ResearchEvidenceRecord {
  return {
    experimentCode: "first-board-pullback/fundamental-study",
    experimentVersion: "1.1.0",
    runId: "RUN-20260921-8557F38A",
    datasetVersionId: 390002,
    datasetVersionLabel: "v2",
    evidenceKind: "RESULT_SUMMARY",
    reference: "sampleSummary.eligibleCount",
    resultDigest: "exp-sha256:0123456789abcdef",
    runStatus: "COMPLETED",
    startedAt: "2026-09-21T05:00:00.000Z",
    durationMs: 107341,
    ...overrides,
  };
}

/** 断言抛出的是本模块的领域错误，且 code 命中。**同时**把错误对象交回给用例做进一步断言。 */
function expectEvidenceError(code: string): (error: unknown) => void {
  return (error: unknown) => {
    expect(error).toBeInstanceOf(ResearchEvidenceError);
    expect((error as ResearchEvidenceError).code).toBe(code);
  };
}

// ---------------------------------------------------------------------------
// §18.1 声明面校验
// ---------------------------------------------------------------------------

describe("§18.1 证据引用校验", () => {
  it("1-a) 合法列表通过（闭集 kind 的每一种取值都能通过）", () => {
    const all: ResearchEvidenceRef[] = RESEARCH_EVIDENCE_KINDS.map((kind, index) => ref({
      evidenceKind: kind,
      reference: `customPayload.k${index}`,
    }));
    expect(() => assertResearchEvidenceRefs(all)).not.toThrow();
  });

  it("1-b) 空列表 / runId 形态错 ⇒ EMPTY / RUN_ID_INVALID", () => {
    expect(() => assertResearchEvidenceRefs([])).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.EMPTY }),
    );
    // 手写一个不存在的 Run id 的典型形态：少一位 / 小写 hex / 前缀错
    for (const bad of ["RUN-2026092-8557F38A", "RUN-20260921-8557f38a", "run-20260921-8557F38A", "RUN-20260921-8557F38"]) {
      expect(() => assertResearchEvidenceRefs([ref({ runId: bad })])).toThrowError(
        expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.RUN_ID_INVALID }),
      );
    }
  });

  it("1-c) 缺 experimentCode / experimentVersion 的形态**不是字段缺失** —— 契约上它们不由调用方提供", () => {
    // `ResearchEvidenceRef` 刻意没有 experimentCode / experimentVersion / datasetVersionId：
    // 传进来也会被**原样忽略**（而不是被信任）。此用例把这条契约钉死。
    const smuggled = {
      ...ref(),
      experimentCode: "hacker/forged",
      experimentVersion: "9.9.9",
      datasetVersionId: 999999,
    } as ResearchEvidenceRef;
    expect(() => assertResearchEvidenceRefs([smuggled])).not.toThrow();

    // 且「自报坐标」不会进入记录：记录一律由 Run 读回后构造（见 evidenceRunReader 的职责）。
    const withSmuggled = Object.keys(smuggled).sort();
    expect(withSmuggled).toEqual(
      ["datasetVersionId", "evidenceKind", "experimentCode", "experimentVersion", "reference", "runId"].sort(),
    );
  });

  it("1-d) 缺 datasetVersionId（= 记录由 Run 读回，不由调用方给）—— 记录缺 Dataset 坐标一律非法", () => {
    // 声明面不含该字段；真正会把关的是桥的「Run 必须带 datasetVersionId」闸门。
    // 这里把「记录形态校验」的必要性钉死：datasetVersionId 非 number 的记录会被读取器**过滤掉**。
    const bad = { ...record(), datasetVersionId: "390002" } as unknown as ResearchEvidenceRecord;
    const snapshot = {
      [RESEARCH_EVIDENCE_SNAPSHOT_KEY]: [bad],
      researchEvidenceFingerprint: "evi-sha256:ffffffffffffffff",
    };
    // 读取器宽容过滤 ⇒ 一条都不剩 ⇒ 「声明了却没有合法证据」⇒ EMPTY（而不是静默通过）。
    expect(() => assertDeclaredResearchEvidence(snapshot)).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.EMPTY }),
    );
    expect(readResearchEvidenceRecords(snapshot)).toEqual([]);
  });

  it("1-e) 非法 reference / 超长 description ⇒ REFERENCE_INVALID", () => {
    for (const bad of ["", "..", "a..b", "1abc", "a-b", "a b", "a.", "带中文", ".a", "a.1b"]) {
      expect(() => assertResearchEvidenceRefs([ref({ reference: bad })])).toThrowError(
        expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.REFERENCE_INVALID }),
      );
    }
    expect(() => assertResearchEvidenceRefs([ref({ reference: "a".repeat(200) })])).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.REFERENCE_INVALID }),
    );
    expect(() =>
      assertResearchEvidenceRefs([ref({ description: "x".repeat(600) })]),
    ).toThrowError(expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.REFERENCE_INVALID }));
    // 合法边界值（长度上限恰好通过）—— 免得「拒绝」靠的是长度而不是形态。
    expect(() => assertResearchEvidenceRefs([ref({ reference: `a${"b".repeat(127)}` })])).not.toThrow();
  });

  it("1-f) 同一 (runId, kind, reference) 重复 ⇒ DUPLICATE；仅 reference 不同不算重复", () => {
    expect(() => assertResearchEvidenceRefs([ref(), ref()])).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.DUPLICATE }),
    );
    // 不同 reference / 不同 kind / 不同 run ⇒ 合法（三者是同一事实的三个坐标）。
    expect(() => assertResearchEvidenceRefs([
      ref({ reference: "a.b" }),
      ref({ reference: "a.c" }),
      ref({ evidenceKind: "SAMPLE_ACCOUNTING" }),
      ref({ runId: "RUN-20260921-C95B1D47" }),
    ])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §12 —— reference 必须能在**真实结果**里解析到
// ---------------------------------------------------------------------------

describe("§12 reference 解析（不得虚构 artifact）", () => {
  const result = {
    metadata: { experimentId: "x/y", datasetVersionId: 390002, nullableField: null },
    tables: [{ key: "a" }],
    customPayload: { counts: { stableCount: 15 } },
  };

  it("1-g-1) 存在路径 ⇒ 返回真实值（含 null 值也算**已解析**）", () => {
    expect(resolveEvidenceReference(result, "metadata.experimentId")).toBe("x/y");
    expect(resolveEvidenceReference(result, "metadata.datasetVersionId")).toBe(390002);
    expect(resolveEvidenceReference(result, "customPayload.counts.stableCount")).toBe(15);
    // 字段存在但值为 null ⇒ 坐标存在，解析成功（返回 null），**不算**失败。
    expect(resolveEvidenceReference(result, "metadata.nullableField")).toBeNull();
    // 数组本身可作叶子（段不能是数字索引，但可以停在数组上）。
    expect(resolveEvidenceReference(result, "tables")).toEqual([{ key: "a" }]);
  });

  it("1-g-2) 段不存在 / 中间不是对象 ⇒ REFERENCE_UNRESOLVED", () => {
    for (const bad of [
      "metadata.nope",
      "customPayload.counts.nope",
      "nope.deep.path",
      // 叶子是标量后再往下走 ⇒ 必须失败，而不是静默返回 undefined。
      "metadata.experimentId.deeper",
    ]) {
      expect(() => resolveEvidenceReference(result, bad)).toThrowError(
        expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.REFERENCE_UNRESOLVED }),
      );
    }
  });

  it("1-g-2b) 声明层比解析层**更严**：数字下标永远进不了 reference", () => {
    // 事实：解析器用 `hasOwnProperty`，所以 `tables.0.key` 这种路径**技术上走得到**。
    // 但声明层的文法（RESEARCH_EVIDENCE_REFERENCE_RE）只允许标识符段 ⇒ 带下标的引用
    // **永远不可能被声明出来**。这里把这条不对称显式钉死，免得日后有人以为
    // 「既然解析得到，就能写进 reference」。
    expect(resolveEvidenceReference(result, "tables.0.key")).toBe("a");
    expect(() => assertResearchEvidenceRefs([ref({ reference: "tables.0.key" })])).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.REFERENCE_INVALID }),
    );
  });

  it("1-g-3) 原型链上的键不算命中（constructor / toString / __proto__）", () => {
    for (const bad of ["constructor", "toString", "customPayload.constructor", "metadata.__proto__"]) {
      expect(() => resolveEvidenceReference(result, bad)).toThrowError(
        expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.REFERENCE_UNRESOLVED }),
      );
    }
  });

  it("1-g-4) 错误消息里**列出该层的可用键**（便于定位写错的坐标）", () => {
    try {
      resolveEvidenceReference(result, "metadata.nope");
      throw new Error("期望抛出");
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchEvidenceError);
      const message = (error as Error).message;
      expect(message).toContain("metadata");
      expect(message).toContain("experimentId");
    }
  });
});

// ---------------------------------------------------------------------------
// §18.2 指纹：确定性 + 顺序无关 + 敏感性
// ---------------------------------------------------------------------------

describe("§18.2 证据指纹", () => {
  it("2-a) 相同证据 ⇒ 相同指纹（且是纯函数：连算两次相同）", () => {
    const a = computeResearchEvidenceFingerprint([record()]);
    const b = computeResearchEvidenceFingerprint([record()]);
    expect(a).toBe(b);
    expect(a).toBe(computeResearchEvidenceFingerprint([record()]));
  });

  it("2-b) 证据顺序变化 ⇒ 指纹**不变**（先按稳定键排序）", () => {
    const r1 = record({ runId: "RUN-20260921-8557F38A", reference: "a.b" });
    const r2 = record({ runId: "RUN-20260921-C95B1D47", reference: "c.d" });
    const r3 = record({ runId: "RUN-20260921-A95F5B48", reference: "e.f" });
    const forward = computeResearchEvidenceFingerprint([r1, r2, r3]);
    expect(computeResearchEvidenceFingerprint([r3, r1, r2])).toBe(forward);
    expect(computeResearchEvidenceFingerprint([r2, r3, r1])).toBe(forward);
  });

  it("2-c) 任一**参与身份**的字段变化 ⇒ 指纹变化（逐字段遍历，一个都不漏）", () => {
    const base = computeResearchEvidenceFingerprint([record()]);
    const mutations: Array<Partial<ResearchEvidenceRecord>> = [
      { experimentCode: "first-board-pullback/stability-validation" },
      { experimentVersion: "1.0.0" },
      { runId: "RUN-20260921-A95F5B48" },
      { datasetVersionId: 390001 },
      { datasetVersionLabel: "v1" },
      { evidenceKind: "SAMPLE_ACCOUNTING" },
      { reference: "sampleSummary.candidateCount" },
      { resultDigest: "exp-sha256:fedcba9876543210" },
    ];
    for (const mutation of mutations) {
      const changed = computeResearchEvidenceFingerprint([record(mutation)]);
      expect(changed, `字段 ${Object.keys(mutation).join(",")} 变化后指纹必须变`).not.toBe(base);
    }
  });

  it("2-d) 「多一条证据」也算变化（列表长度进身份）", () => {
    const one = computeResearchEvidenceFingerprint([record()]);
    const two = computeResearchEvidenceFingerprint([record(), record({ runId: "RUN-20260921-C95B1D47" })]);
    expect(two).not.toBe(one);
  });

  it("2-e) 指纹前缀与执行语义指纹**刻意不同**（同名不同义在肉眼与 grep 层面都不可混）", () => {
    const fingerprint = computeResearchEvidenceFingerprint([record()]);
    expect(fingerprint.startsWith(`${RESEARCH_EVIDENCE_FINGERPRINT_PREFIX}:`)).toBe(true);
    // 执行语义指纹是裸 64 位 hex（无前缀）—— 两者不可能长得一样。
    expect(fingerprint).not.toMatch(/^[0-9a-f]{64}$/u);
  });

  it("2-f) 不参与身份的字段（runStatus / startedAt / durationMs / description）变化**不改**指纹", () => {
    // 这是刻意的：身份 = 「引用了哪一次运行的哪一部分 + 那次结果是什么」，
    // 运行耗时 / 开始时间这些**非内容**事实不该让身份漂移。
    const base = computeResearchEvidenceFingerprint([record()]);
    for (const mutation of [
      { runStatus: "SOMETHING_ELSE" },
      { startedAt: null },
      { durationMs: 1 },
      { description: "换一段人读备注" },
    ] as Array<Partial<ResearchEvidenceRecord>>) {
      expect(computeResearchEvidenceFingerprint([record(mutation)])).toBe(base);
    }
  });
});

// ---------------------------------------------------------------------------
// 快照编解码 + 「声明即受校验」
// ---------------------------------------------------------------------------

describe("§18.2 快照编解码与声明校验", () => {
  it("3-a) build → read 往返一致（列表 + 指纹）", () => {
    const records = [record(), record({ runId: "RUN-20260921-C95B1D47", evidenceKind: "STABILITY_VERDICT" })];
    const snapshot = buildResearchEvidenceSnapshot(records);
    expect(readResearchEvidenceRecords(snapshot)).toEqual(records);
    expect(readResearchEvidenceFingerprint(snapshot)).toBe(computeResearchEvidenceFingerprint(records));
  });

  it("3-b) 宽容读取：JSON 字符串输入 / 形态不符 / 缺键 ⇒ [] 与 null（读路径不失败）", () => {
    const records = [record()];
    const snapshot = buildResearchEvidenceSnapshot(records);
    // JSON 列的真实形态不稳定（对象或字符串）—— 两条路都必须走得通。
    expect(readResearchEvidenceRecords(JSON.stringify(snapshot))).toEqual(records);
    expect(readResearchEvidenceFingerprint(JSON.stringify(snapshot))).toBe(
      computeResearchEvidenceFingerprint(records),
    );

    for (const bad of [null, undefined, 42, "not json", [], {}, { kind: "INDEPENDENT_EXPERIMENT" }]) {
      expect(readResearchEvidenceRecords(bad)).toEqual([]);
      expect(readResearchEvidenceFingerprint(bad)).toBeNull();
    }
    expect(readResearchEvidenceRecords({ [RESEARCH_EVIDENCE_SNAPSHOT_KEY]: "不是数组" })).toEqual([]);
  });

  it("3-c) 「声明即受校验」：不带证据段的快照**逐字不变**（历史行零回归）", () => {
    for (const untouched of [
      null,
      undefined,
      {},
      { kind: "INDEPENDENT_EXPERIMENT", experimentRef: "x/y" },
      { kind: "RESEARCH_CONCLUSION", sourceConclusionId: 30001 },
      "not json",
    ]) {
      expect(() => assertDeclaredResearchEvidence(untouched), `不应校验 ${JSON.stringify(untouched)}`).not.toThrow();
    }
  });

  it("3-d) 声明了证据段 ⇒ 必须自洽（缺指纹 / 指纹不符 / 列表不合法 都失败）", () => {
    const records = [record()];

    // 缺指纹键
    expect(() => assertDeclaredResearchEvidence({ [RESEARCH_EVIDENCE_SNAPSHOT_KEY]: records })).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.FINGERPRINT_MISMATCH }),
    );

    // 指纹与列表不符（声明与事实不符）
    const snapshot = buildResearchEvidenceSnapshot(records);
    expect(() =>
      assertDeclaredResearchEvidence({ ...snapshot, researchEvidenceFingerprint: "evi-sha256:0000000000000000" }),
    ).toThrowError(expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.FINGERPRINT_MISMATCH }));

    // 空列表被声明
    expect(() => assertDeclaredResearchEvidence({ [RESEARCH_EVIDENCE_SNAPSHOT_KEY]: [] })).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.EMPTY }),
    );

    // 列表里混进 runId 形态非法的记录（读取器会留下它，因为只校验字段类型）
    const forged = { ...record(), runId: "forged" };
    const forgedSnapshot = {
      [RESEARCH_EVIDENCE_SNAPSHOT_KEY]: [forged],
      researchEvidenceFingerprint: computeResearchEvidenceFingerprint([forged]),
    };
    expect(() => assertDeclaredResearchEvidence(forgedSnapshot)).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.RUN_ID_INVALID }),
    );

    // 自洽的快照通过
    expect(() => assertDeclaredResearchEvidence(snapshot)).not.toThrow();
    expect(() => assertDeclaredResearchEvidence(JSON.stringify(snapshot))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 多份证据必须同 Dataset
// ---------------------------------------------------------------------------

describe("§18.2 唯一 Dataset 坐标", () => {
  it("4-a) 同 Dataset ⇒ 返回该坐标；乱序无关", () => {
    expect(resolveSingleDatasetVersionId([record(), record({ runId: "RUN-20260921-C95B1D47" })])).toBe(390002);
  });

  it("4-b) 异 Dataset ⇒ DATASET_MISMATCH；空列表 ⇒ 不得静默返回（抛错）", () => {
    expect(() =>
      resolveSingleDatasetVersionId([record(), record({ datasetVersionId: 390001 })]),
    ).toThrowError(expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.DATASET_MISMATCH }));

    // 空列表：`ids.length !== 1` ⇒ 同样抛 DATASET_MISMATCH（绝不返回 undefined / 0）。
    expect(() => resolveSingleDatasetVersionId([])).toThrowError(
      expect.objectContaining({ code: RESEARCH_EVIDENCE_ERROR.DATASET_MISMATCH }),
    );
  });
});
