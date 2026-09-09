/**
 * STEP 12.6 — Research Dataset 策略元数据 / 一致性 / 版本快照测试（C-12.6.2）。
 *
 * 风格对齐既有 researchDataset 测试：纯内存 fixture、确定性断言、不连 DB。
 * 覆盖：
 *   - policySet 9 类齐备 + 派生确定性（同输入同指纹）；
 *   - 一致性校验：合法 fixture 零 issue；缺 asOf / PIT 声明与 universe 不符 /
 *     adjustment 声明与 schema 不符 / value 口径篡改 冲突检测；
 *   - 版本快照产物 serialize/parse round-trip + 指纹确定性；
 *   - 小型手工 fixture 演示 policySet 与 dataset 绑定（version+rowsFingerprint+universe 摘要）。
 */

import { describe, expect, it } from "vitest";
import {
  derivePolicySet,
  deriveExpectedPolicyValue,
  computePolicySetFingerprint,
  RESEARCH_DATASET_POLICY_ORDER,
} from "./policy";
import {
  validateResearchDatasetPolicyConsistency,
  type PolicyConsistencyContext,
} from "./policyValidate";
import {
  buildDatasetVersionSnapshot,
  parseVersionSnapshot,
  serializeVersionSnapshot,
  computeVersionSnapshotFingerprint,
  summarizeUniverseDefinition,
  summarizeDataSnapshot,
} from "./versionSnapshot";
import { computeDatasetVersion, computeRowsFingerprint } from "./version";
import type {
  DataSnapshot,
  NormalizedResearchDatasetRequest,
  ResearchDatasetPolicySet,
  ResearchDatasetRow,
  UniverseDefinition,
} from "./types";

// ---------------------------------------------------------------------------
// fixture（小型手工 dataset：2 交易日 × 2 证券，逐日 PIT）
// ---------------------------------------------------------------------------

const REQUEST: NormalizedResearchDatasetRequest = {
  name: "universe-tradable-daily",
  startDate: "2025-06-03",
  endDate: "2025-06-04",
  asOfPerTradeDate: true,
  asOf: null,
  coreIndexCodes: ["000300.SH"],
  universeFilter: { boards: [], excludeSt: false, tDayCondition: "none" },
};

const D1 = "2025-06-03";
const D2 = "2025-06-04";

const SEC_A = "sec_00000000-0000-4000-8000-000000000001";
const SEC_B = "sec_00000000-0000-4000-8000-000000000002";

const UNIVERSE: UniverseDefinition = {
  rule: "STEP 11 resolveHistoricalUniverse：LISTING/TRADING 正向确认，SUSPENSION/DELISTING 显式阻断，UNKNOWN 默认拒绝",
  asOfDescription: "逐日 PIT（每交易日 asOf = 该日 tradeDate）",
  days: [
    { tradeDate: D1, isTradingDay: true, members: [SEC_A, SEC_B], excludedByReason: { NOT_YET_LISTED: 1 } },
    { tradeDate: D2, isTradingDay: true, members: [SEC_A, SEC_B], excludedByReason: {} },
  ],
};

function row(
  tradeDate: string,
  securityId: string,
  code: string,
  overrides: Partial<ResearchDatasetRow> = {},
): ResearchDatasetRow {
  return {
    tradeDate,
    asOf: tradeDate,
    securityId,
    code,
    securityType: "stock",
    exchange: code.endsWith(".SH") ? "SH" : "SZ",
    lifecycleVerdict: "LISTED",
    eligible: true,
    exclusionReason: null,
    st: "NORMAL",
    industryCode: "801780",
    industryName: "银行",
    turnoverRate: 0.5,
    circulationMarketCap: 1_000_000_000,
    totalMarketCap: 1_200_000_000,
    liquidityAmount: 800_000,
    liquidityVolume: 200_000,
    open: 10,
    high: 10.5,
    low: 9.8,
    close: 10.2,
    preClose: 10,
    volume: 200_000,
    amount: 800_000,
    corporateActionsEffectiveCount: 0,
    corporateActionsKnownCount: 0,
    indexClose: { "000300.SH": 4010 },
    knowledge: {
      policy: "PIT",
      listing: "KNOWN",
      delisting: "KNOWN",
      tradability: "KNOWN",
      industry: "KNOWN",
      liquidity: "KNOWN",
      price: "KNOWN",
      corporateActions: "KNOWN",
      marketState: "KNOWN",
    },
    ...overrides,
  };
}

const ROWS: readonly ResearchDatasetRow[] = [
  row(D1, SEC_A, "600000.SH"),
  row(D1, SEC_B, "000001.SZ"),
  row(D2, SEC_A, "600000.SH"),
  row(D2, SEC_B, "000001.SZ"),
];

function dataSnapshot(request: NormalizedResearchDatasetRequest, overrides: Partial<DataSnapshot> = {}): DataSnapshot {
  return {
    capturedAt: "2025-06-04T15:00:00.000Z",
    request,
    calendarName: "fixture-calendar",
    calendarFirstDate: "2025-06-02",
    calendarLastDate: "2025-06-06",
    tradingDays: 2,
    domains: [],
    coverageGaps: [],
    ...overrides,
  };
}

function buildContext(overrides: Partial<PolicyConsistencyContext> = {}): PolicyConsistencyContext {
  const snapshot = dataSnapshot(REQUEST);
  const context: PolicyConsistencyContext = {
    request: REQUEST,
    universeDefinition: UNIVERSE,
    dataSnapshot: snapshot,
    rows: ROWS,
    policySet: derivePolicySet(REQUEST, snapshot),
  };
  return { ...context, ...overrides };
}

/** 替换 policySet 中某条 policy 的 value（构造冲突用例）。 */
function withPolicyValue(
  policySet: ResearchDatasetPolicySet,
  policyId: string,
  value: unknown,
): ResearchDatasetPolicySet {
  return policySet.map((policy) =>
    policy.policyId === policyId
      ? { ...policy, value: value as ResearchDatasetPolicySet[number]["value"] }
      : policy,
  );
}

/** 丢弃某条 policy（构造缺类用例）。 */
function withoutPolicy(policySet: ResearchDatasetPolicySet, policyId: string): ResearchDatasetPolicySet {
  return policySet.filter((policy) => policy.policyId !== policyId);
}

// ---------------------------------------------------------------------------
// 1. policySet 集齐性 / 结构
// ---------------------------------------------------------------------------

describe("derivePolicySet", () => {
  it("派生 9 类、顺序与 POLICY_ORDER 一致、policyId===class、含结构化五要素", () => {
    const policySet = derivePolicySet(REQUEST, dataSnapshot(REQUEST));
    expect(policySet.map((p) => p.policyId)).toEqual(RESEARCH_DATASET_POLICY_ORDER);
    expect(new Set(policySet.map((p) => p.policyId)).size).toBe(9);
    for (const policy of policySet) {
      expect(policy.policyId).toBe(policy.class);
      expect(policy.name.trim().length).toBeGreaterThan(0);
      expect(policy.description.trim().length).toBeGreaterThan(0);
      expect(policy.evidence.length).toBeGreaterThan(0);
      expect(policy.value).toEqual(deriveExpectedPolicyValue(policy.policyId, REQUEST, dataSnapshot(REQUEST)));
    }
  });

  it("派生值是确定性的：两次调用 canonical 指纹一致", () => {
    const a = derivePolicySet(REQUEST, dataSnapshot(REQUEST));
    const b = derivePolicySet({ ...REQUEST }, dataSnapshot(REQUEST));
    expect(computePolicySetFingerprint(a)).toBe(computePolicySetFingerprint(b));
    expect(a).toEqual(b);
  });

  it("口径变化（固定快照 vs 逐日 PIT）→ pit 声明与指纹变化", () => {
    const frozen: NormalizedResearchDatasetRequest = { ...REQUEST, asOfPerTradeDate: false, asOf: "2025-06-05" };
    const perDay = derivePolicySet(REQUEST, dataSnapshot(REQUEST));
    const fixed = derivePolicySet(frozen, dataSnapshot(frozen));
    expect(computePolicySetFingerprint(perDay)).not.toBe(computePolicySetFingerprint(fixed));
    const pitPerDay = perDay.find((p) => p.policyId === "pit")!;
    const pitFixed = fixed.find((p) => p.policyId === "pit")!;
    expect(pitPerDay.value).toEqual({ mode: "asOfPerTradeDate", asOf: null });
    expect(pitFixed.value).toEqual({ mode: "fixed", asOf: "2025-06-05" });
  });
});

// ---------------------------------------------------------------------------
// 2. 一致性校验：合法 / 冲突
// ---------------------------------------------------------------------------

describe("validateResearchDatasetPolicyConsistency", () => {
  it("合法 fixture（逐日 PIT + raw + 全 9 类）→ 零 issue", () => {
    expect(validateResearchDatasetPolicyConsistency(buildContext())).toEqual([]);
  });

  it("合法固定快照 fixture → 零 issue", () => {
    const frozen: NormalizedResearchDatasetRequest = { ...REQUEST, asOfPerTradeDate: false, asOf: "2025-06-05" };
    const ctx = buildContext({
      request: frozen,
      dataSnapshot: dataSnapshot(frozen),
      universeDefinition: {
        ...UNIVERSE,
        asOfDescription: "固定快照 asOf = 2025-06-05",
      },
      rows: ROWS.map((r) => ({ ...r, asOf: "2025-06-05" })),
      policySet: derivePolicySet(frozen, dataSnapshot(frozen)),
    });
    expect(validateResearchDatasetPolicyConsistency(ctx)).toEqual([]);
  });

  it("空壳（DB 不可用路径：days=[] rows=[]）→ 不误报", () => {
    const snapshot = dataSnapshot(REQUEST, { tradingDays: 0 });
    const ctx = buildContext({
      universeDefinition: { rule: "", asOfDescription: "", days: [] },
      rows: [],
      dataSnapshot: snapshot,
      policySet: derivePolicySet(REQUEST, snapshot),
    });
    expect(validateResearchDatasetPolicyConsistency(ctx)).toEqual([]);
  });

  it("冲突①：asOfPerTradeDate=false 且未给 asOf → MISSING_AS_OF", () => {
    const invalid: NormalizedResearchDatasetRequest = { ...REQUEST, asOfPerTradeDate: false, asOf: null };
    const snapshot = dataSnapshot(invalid, { tradingDays: 0 });
    const ctx = buildContext({
      request: invalid,
      dataSnapshot: snapshot,
      universeDefinition: { rule: "", asOfDescription: "", days: [] },
      rows: [],
      policySet: derivePolicySet(invalid, snapshot),
    });
    const issues = validateResearchDatasetPolicyConsistency(ctx);
    expect(issues.length).toBeGreaterThan(0);
    for (const item of issues) expect(item.code).toBe("MISSING_AS_OF");
  });

  it("冲突②：PIT mode 声明与 universeDefinition.asOfDescription 不符 → PIT_MODE_UNIVERSE_MISMATCH", () => {
    // request/policy 均为逐日 PIT，但 universe 声明被改成固定快照 → 不一致。
    const ctx = buildContext({
      universeDefinition: { ...UNIVERSE, asOfDescription: "固定快照 asOf = 2025-06-05" },
    });
    const codes = validateResearchDatasetPolicyConsistency(ctx).map((i) => i.code);
    expect(codes).toContain("PIT_MODE_UNIVERSE_MISMATCH");
  });

  it("冲突③：adjustment 声明 priceBasis=adjusted 与行 schema（raw）不符 → ADJUSTMENT_BASIS_MISMATCH", () => {
    const ctx = buildContext({
      policySet: withPolicyValue(derivePolicySet(REQUEST, dataSnapshot(REQUEST)), "adjustment", {
        priceBasis: "adjusted",
        priceFields: ["open", "high", "low", "close", "preClose"],
        corporateActionAdjustmentIntoPrice: true,
      }),
    });
    const codes = validateResearchDatasetPolicyConsistency(ctx).map((i) => i.code);
    expect(codes).toContain("ADJUSTMENT_BASIS_MISMATCH");
  });

  it("冲突④：universe-membership 声明口径被篡改（defaultOnUnknown=allow）→ POLICY_VALUE_CONFLICT", () => {
    const original = derivePolicySet(REQUEST, dataSnapshot(REQUEST)).find(
      (p) => p.policyId === "universe-membership",
    )!;
    const ctx = buildContext({
      policySet: withPolicyValue(derivePolicySet(REQUEST, dataSnapshot(REQUEST)), "universe-membership", {
        ...original.value,
        defaultOnUnknown: "allow",
      }),
    });
    const codes = validateResearchDatasetPolicyConsistency(ctx).map((i) => i.code);
    expect(codes).toContain("POLICY_VALUE_CONFLICT");
  });

  it("冲突⑤：缺类 → POLICY_MISSING；重复 → POLICY_DUPLICATE", () => {
    const snapshot = dataSnapshot(REQUEST);
    const missing = buildContext({ policySet: withoutPolicy(derivePolicySet(REQUEST, snapshot), "liquidity") });
    expect(validateResearchDatasetPolicyConsistency(missing).map((i) => i.code)).toContain("POLICY_MISSING");

    const full = derivePolicySet(REQUEST, snapshot);
    const duplicated: ResearchDatasetPolicySet = [...full, full[8]!];
    const dup = buildContext({ policySet: duplicated });
    expect(validateResearchDatasetPolicyConsistency(dup).map((i) => i.code)).toContain("POLICY_DUPLICATE");
  });

  it("确定性：同输入两次 → 相同 issue 序列（code 升序）", () => {
    const ctx = buildContext({
      universeDefinition: { ...UNIVERSE, asOfDescription: "固定快照 asOf = 2025-06-05" },
    });
    expect(validateResearchDatasetPolicyConsistency(ctx)).toEqual(validateResearchDatasetPolicyConsistency(ctx));
  });
});

// ---------------------------------------------------------------------------
// 3. 版本快照产物：round-trip / 指纹 / 绑定
// ---------------------------------------------------------------------------

describe("ResearchDatasetVersionSnapshot", () => {
  function buildArtifact() {
    const snapshot = dataSnapshot(REQUEST);
    const policySet = derivePolicySet(REQUEST, snapshot);
    const datasetVersion = computeDatasetVersion(REQUEST, UNIVERSE, ROWS);
    const rowsFingerprint = computeRowsFingerprint(ROWS);
    return buildDatasetVersionSnapshot({
      datasetVersion,
      rowsFingerprint,
      universeDefinition: UNIVERSE,
      dataSnapshot: snapshot,
      policySet,
    });
  }

  it("绑定：artifact 含 datasetVersion + rowsFingerprint + policySet + universe/snapshot 摘要 + 版本号", () => {
    const artifact = buildArtifact();
    expect(artifact.artifactType).toBe("research-dataset-version-snapshot");
    expect(artifact.datasetVersion).toMatch(/^rd-1\.0\.0-1-[0-9a-f]{16}$/);
    expect(artifact.rowsFingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(artifact.policySetFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(artifact.policySet.map((p) => p.policyId)).toEqual(RESEARCH_DATASET_POLICY_ORDER);
    expect(artifact.universeDefinition).toEqual(summarizeUniverseDefinition(UNIVERSE));
    expect(artifact.dataSnapshot).toEqual(summarizeDataSnapshot(dataSnapshot(REQUEST)));
    expect(artifact.builderVersion).toBe("1.0.0");
    expect(artifact.rowSchemaVersion).toBe("1");
    expect(artifact.policySchemaVersion).toBe("1");
  });

  it("round-trip：serialize → parse → 深等 + 再序列化稳定；指纹确定", () => {
    const artifact = buildArtifact();
    const text = serializeVersionSnapshot(artifact);
    const parsed = parseVersionSnapshot(text);
    expect(parsed).toEqual(artifact);
    expect(serializeVersionSnapshot(parsed)).toBe(text);
    expect(computeVersionSnapshotFingerprint(artifact)).toBe(computeVersionSnapshotFingerprint(parsed));
    // 同内容重造 → 同指纹（确定性，不含瞬时字段）。
    expect(computeVersionSnapshotFingerprint(buildArtifact())).toBe(computeVersionSnapshotFingerprint(artifact));
  });

  it("内容变化（行数据）→ 版本/指纹变化；policySet 变化 → policySetFingerprint 变化", () => {
    const artifact = buildArtifact();
    const changedRows: readonly ResearchDatasetRow[] = [row(D1, SEC_A, "600000.SH", { close: 10.99 }), ...ROWS.slice(1)];
    const changed = buildDatasetVersionSnapshot({
      datasetVersion: computeDatasetVersion(REQUEST, UNIVERSE, changedRows),
      rowsFingerprint: computeRowsFingerprint(changedRows),
      universeDefinition: UNIVERSE,
      dataSnapshot: dataSnapshot(REQUEST),
      policySet: derivePolicySet(REQUEST, dataSnapshot(REQUEST)),
    });
    expect(changed.datasetVersion).not.toBe(artifact.datasetVersion);
    expect(changed.rowsFingerprint).not.toBe(artifact.rowsFingerprint);
    expect(changed.policySetFingerprint).toBe(artifact.policySetFingerprint);
  });

  it("parse 非法输入 → 响亮抛错（不静默降级）", () => {
    expect(() => parseVersionSnapshot('{"foo":1}')).toThrow();
    expect(() => parseVersionSnapshot("not-json")).toThrow();
  });
});
