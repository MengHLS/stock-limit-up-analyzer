/**
 * STEP STRATEGY-003 — Domain Model 的持久化 / 投影 / clone 测试（SPEC §36 清单 + §15 幂等三态）。
 *
 * 覆盖范围：
 *   A. `buildStrategyProjections`：Canonical Definition → 5 类投影的单向派生（含行形状契约）；
 *   B. `verifyStrategyProjections`：漂移检测（缺失 / 多余 / 字段漂移）；
 *   C. `checkStoredVersionConsistency`：F1「双份定义」三方指纹一致性（不一致 = FAIL，不修复）；
 *   D. Service 编排：create / read / list / bundle / validateVersion（canonical vs projection）；
 *   E. `cloneVersion`：任意源版本 / parentVersionId / 指纹重算 / 幂等三态 / 冲突不覆盖；
 *   F. 版本不可变性 + 状态迁移（唯一允许的 UPDATE）。
 *
 * ⚠️ 诚实边界：本文件用 InMemoryStrategyRepository 验证**契约逻辑**，
 * **不能**证明「持久化 / 同事务 / 7 张表真实存在」。后者由 `scripts/verifyStrategyDomainModel.mts`
 * 在真实 TiDB 上验收（§21 禁止用 mock 证明持久化）。
 */

import { describe, expect, it } from "vitest";
import { canonicalStringify } from "../../researchDataset/version";
import {
  cloneStrategyDocumentToVersion,
  createStrategyDocument,
  createStrategyDocumentFromDefinition,
  createStrategyVersionRecord,
} from "../strategySchema/map";
import {
  computeStrategyDefinitionFingerprint,
  computeStrategyVersionRecordFingerprint,
  serializeStrategyDocument,
  serializeStrategyVersionRecord,
} from "../strategySchema/serialize";
import {
  STRATEGY_ENTRY_OBSERVATION_RULE_ID,
  buildStrategyProjections,
  verifyStrategyProjections,
  type StrategyProjections,
} from "../strategySchema/projection";
import { normalizeStrategyDefinition, type StrategyDefinition } from "../strategySchema/definition";
import {
  FIRST_BOARD_PULLBACK_DATASET_VERSION,
  FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
} from "../strategySchema/goldenSample";
import type { StrategyDocument } from "../strategySchema/types";
import { assertStoredVersionConsistency, checkStoredVersionConsistency } from "./consistency";
import { InMemoryStrategyRepository } from "./inMemory";
import { StrategyService } from "./service";

const CODE_VERSION = "1.0.0+g0000000";
const NOW = "2026-09-12T00:00:00.000Z";

/** Golden Sample（SPEC §25）：首板回踩。 */
const GOLDEN_DOCUMENT: StrategyDocument = createStrategyDocumentFromDefinition(FIRST_BOARD_PULLBACK_DOCUMENT_INPUT);
const GOLDEN_DEFINITION: StrategyDefinition = GOLDEN_DOCUMENT.definition as StrategyDefinition;

function makeService(): { repo: InMemoryStrategyRepository; service: StrategyService } {
  const repo = new InMemoryStrategyRepository(() => NOW);
  const service = new StrategyService(repo, { codeVersion: CODE_VERSION, now: () => NOW });
  return { repo, service };
}

/** 文档 → wire（Service 入口要求的 Record 形状）。 */
function asWire(document: StrategyDocument): Record<string, unknown> {
  return document as unknown as Record<string, unknown>;
}

/** 克隆 golden 文档但**去掉 definition**，模拟历史 v1 文档（无富定义）。 */
function legacyWire(): Record<string, unknown> {
  const wire = { ...GOLDEN_DOCUMENT } as Record<string, unknown>;
  delete wire.definition;
  return wire;
}

/** 历史 v1 文档本体（必须走 createStrategyDocument；createStrategyDocumentFromDefinition 要求 definition）。 */
function createLegacyDocument(): StrategyDocument {
  return createStrategyDocument(legacyWire() as unknown as Parameters<typeof createStrategyDocument>[0]);
}

const EMPTY_PROJECTIONS: StrategyProjections = {
  parameters: [],
  entryRules: [],
  exitRules: [],
  datasetBindings: [],
  executionRule: {
    signalTiming: "",
    executionTiming: "",
    priceType: "",
    quantityMethod: "",
    lotSize: 0,
    slippageModel: null,
    commissionModel: null,
    executionConstraintsJson: null,
  },
};

// ---------------------------------------------------------------------------
// A. Projection 由 Canonical Definition 单向派生
// ---------------------------------------------------------------------------

describe("A. Projection 派生（Definition → 投影，单向）", () => {
  const projections = buildStrategyProjections(GOLDEN_DEFINITION);

  it("参数投影按 code 升序，ordinal 连续编号（确定性，便于 diff 与分页）", () => {
    const codes = projections.parameters.map((row) => row.code);
    expect(codes).toEqual([...codes].sort());
    expect(projections.parameters.map((row) => row.ordinal)).toEqual(codes.map((_, index) => index));
    expect(codes.length).toBe(GOLDEN_DEFINITION.parameters.length);
  });

  it("参数投影保留 parameterRole（FIXED / TUNABLE / DERIVED），供 Parameter Search 消费", () => {
    const roles = new Set(projections.parameters.map((row) => row.parameterRole));
    expect(roles.has("TUNABLE")).toBe(true);
    expect(roles.has("FIXED")).toBe(true);
    for (const role of roles) {
      expect(["FIXED", "TUNABLE", "DERIVED"]).toContain(role);
    }
  });

  it("TUNABLE 参数必须带搜索边界（min/max 或 allowedValues），否则投影表无从开展参数搜索", () => {
    for (const row of projections.parameters) {
      if (row.parameterRole !== "TUNABLE") continue;
      const hasRange = row.minValue !== null && row.maxValue !== null;
      const hasStep = row.stepValue !== null;
      expect(hasRange || hasStep).toBe(true);
    }
  });

  it("entry 每条 condition 一行，priority = 求值顺序，且每行都携带 event/window/trigger", () => {
    const { entry } = GOLDEN_DEFINITION;
    expect(entry.conditions.length).toBeGreaterThan(0);
    expect(projections.entryRules).toHaveLength(entry.conditions.length);
    expect(projections.entryRules.map((row) => row.priority)).toEqual(entry.conditions.map((_, index) => index));

    for (const row of projections.entryRules) {
      expect(row.ruleType).toBe("CONDITION");
      expect(row.eventType).toBe(entry.event.type);
      expect(row.windowStart).toBe(entry.observationWindow.start);
      expect(row.windowEnd).toBe(entry.observationWindow.end);
      expect(row.windowUnit).toBe(entry.observationWindow.unit);
      expect(row.triggerType).toBe(entry.trigger.type);
      expect(row.conditionCount).toBe(entry.conditions.length);
      expect(row.conditionJson).not.toBeNull();
    }
  });

  it("conditionJson 是条件本身的 canonical JSON（查询方可直接回读条件语义）", () => {
    const first = projections.entryRules[0];
    expect(first).toBeDefined();
    expect(first?.conditionJson).toBe(canonicalStringify(GOLDEN_DEFINITION.entry.conditions[0]));
  });

  it("无 condition 时仍写一行 EVENT_OBSERVATION，保留 event/window/trigger（不因无条件而丢失研究事实）", () => {
    const noConditions = normalizeStrategyDefinition({
      ...GOLDEN_DEFINITION,
      entry: { ...GOLDEN_DEFINITION.entry, conditions: [] },
    });
    const rows = buildStrategyProjections(noConditions).entryRules;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ruleId).toBe(STRATEGY_ENTRY_OBSERVATION_RULE_ID);
    expect(rows[0]?.ruleType).toBe("EVENT_OBSERVATION");
    expect(rows[0]?.eventType).toBe(GOLDEN_DEFINITION.entry.event.type);
    expect(rows[0]?.windowStart).toBe(GOLDEN_DEFINITION.entry.observationWindow.start);
    expect(rows[0]?.triggerType).toBe(GOLDEN_DEFINITION.entry.trigger.type);
    expect(rows[0]?.conditionJson).toBeNull();
    expect(rows[0]?.conditionCount).toBe(0);
  });

  it("exitRules 按规范化 priority 升序，ordinal 连续；parameter 驱动时 thresholdValue=null", () => {
    const rows = projections.exitRules;
    expect(rows.map((row) => row.ruleId)).toEqual(GOLDEN_DEFINITION.exit.rules.map((rule) => rule.id));
    expect(rows.map((row) => row.ordinal)).toEqual(rows.map((_, index) => index));

    for (const row of rows) {
      expect(row.parameterCode).not.toBeNull();
      expect(row.thresholdValue).toBeNull();
      // 阈值由 parameter 提供时，阈值**单位**仍必须落库（值 / 单位是两件事）。
      expect(row.thresholdUnit).not.toBeNull();
    }
  });

  it("execution 投影 1:1，且 signalTiming 与 executionTiming 分离（时序不可合并）", () => {
    const row = projections.executionRule;
    expect(row.signalTiming).toBe(GOLDEN_DEFINITION.execution.signalTiming);
    expect(row.executionTiming).toBe(GOLDEN_DEFINITION.execution.executionTiming);
    expect(row.signalTiming).not.toBe(row.executionTiming);
    expect(row.lotSize).toBe(GOLDEN_DEFINITION.execution.lotSize);
  });

  it("dataset 投影只落引用，不复制任何 Dataset 数据（避免第二份数据事实）", () => {
    const rows = projections.datasetBindings;
    expect(rows).toHaveLength(GOLDEN_DEFINITION.datasets.length);
    expect(rows[0]?.datasetVersion).toBe(FIRST_BOARD_PULLBACK_DATASET_VERSION);
    expect(rows[0]?.role).toBe("PRIMARY");
    expect(rows.map((row) => row.ordinal)).toEqual(rows.map((_, index) => index));
  });

  it("投影行字段形状与 5 张表逐列对应（列增删必须同步改 migration，不能被静默吞掉）", () => {
    expect(Object.keys(projections.parameters[0] ?? {}).sort()).toEqual([
      "code", "dataType", "defaultValueJson", "description", "maxValue", "minValue",
      "name", "ordinal", "parameterRole", "required", "stepValue", "unit",
    ]);
    expect(Object.keys(projections.entryRules[0] ?? {}).sort()).toEqual([
      "conditionCount", "conditionJson", "enabled", "eventType", "priority", "ruleId",
      "ruleType", "triggerType", "windowEnd", "windowStart", "windowUnit",
    ]);
    expect(Object.keys(projections.exitRules[0] ?? {}).sort()).toEqual([
      "conditionJson", "enabled", "ordinal", "parameterCode", "priority", "ruleId",
      "ruleType", "thresholdUnit", "thresholdValue", "triggerType",
    ]);
    expect(Object.keys(projections.executionRule).sort()).toEqual([
      "commissionModel", "executionConstraintsJson", "executionTiming", "lotSize",
      "priceType", "quantityMethod", "signalTiming", "slippageModel",
    ]);
    expect(Object.keys(projections.datasetBindings[0] ?? {}).sort()).toEqual([
      "datasetId", "datasetVersion", "datasetVersionId", "note", "ordinal", "role",
    ]);
  });

  it("派生是纯函数：同一定义两次派生 canonical 串完全相同", () => {
    expect(canonicalStringify(buildStrategyProjections(GOLDEN_DEFINITION)))
      .toBe(canonicalStringify(buildStrategyProjections(GOLDEN_DEFINITION)));
  });
});

// ---------------------------------------------------------------------------
// B. 漂移检测（verifyStrategyProjections）
// ---------------------------------------------------------------------------

describe("B. Projection 漂移检测", () => {
  const expected = buildStrategyProjections(GOLDEN_DEFINITION);
  const clone = (): StrategyProjections => structuredClone(expected);

  it("与自身比对 → 无漂移", () => {
    expect(verifyStrategyProjections(expected, clone())).toEqual([]);
  });

  it("参数行字段漂移 → 精确定位到 行[code].字段", () => {
    const actual = clone();
    const target = actual.parameters[0];
    expect(target).toBeDefined();
    actual.parameters = actual.parameters.map((row, index) => (index === 0 ? { ...row, defaultValueJson: JSON.stringify(999) } : row));

    const drifts = verifyStrategyProjections(expected, actual);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toContain(`strategy_parameters[${target?.code}].defaultValueJson`);
  });

  it("投影缺行 → 报『缺失』（canonical 有、投影表没有）", () => {
    const actual = clone();
    actual.parameters = actual.parameters.slice(1);
    const drifts = verifyStrategyProjections(expected, actual);
    expect(drifts.some((line) => line.includes("缺失"))).toBe(true);
  });

  it("投影多行 → 报『多余』（投影表有、canonical 没有）", () => {
    const actual = clone();
    actual.datasetBindings = [
      ...actual.datasetBindings,
      { datasetId: "ghost", datasetVersion: FIRST_BOARD_PULLBACK_DATASET_VERSION, role: "AUXILIARY", note: null, ordinal: 9 },
    ];
    const drifts = verifyStrategyProjections(expected, actual);
    expect(drifts.some((line) => line.includes("多余"))).toBe(true);
  });

  it("entry 规则顺序/priority 漂移 → 报出（priority 即求值顺序，变形会改变策略语义）", () => {
    const actual = clone();
    const first = actual.entryRules[0];
    expect(first).toBeDefined();
    actual.entryRules = actual.entryRules.map((row, index) => (index === 0 ? { ...row, priority: 42 } : row));

    const drifts = verifyStrategyProjections(expected, actual);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toContain("strategy_entry_rules");
    expect(drifts[0]).toContain(".priority");
    expect(first?.priority).not.toBe(42);
  });

  it("execution 时序漂移 → 报出（signalTiming / executionTiming 必须与 canonical 一致）", () => {
    const actual = clone();
    actual.executionRule = { ...actual.executionRule, executionTiming: "T_PLUS_2_OPEN" };
    const drifts = verifyStrategyProjections(expected, actual);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toContain("strategy_execution_rules");
    expect(drifts[0]).toContain("executionTiming");
  });

  it("dataset 绑定漂移 → 按 (datasetId|datasetVersion|role) 定位", () => {
    const actual = clone();
    actual.datasetBindings = actual.datasetBindings.map((row) => ({ ...row, note: "被改写" }));
    const drifts = verifyStrategyProjections(expected, actual);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toContain("strategy_version_datasets");
    expect(drifts[0]).toContain(".note");
  });

  it("投影整体为空（历史 v1 文档）→ 全部报缺失，而不是被当成『该版本没有参数』", () => {
    const drifts = verifyStrategyProjections(expected, structuredClone(EMPTY_PROJECTIONS));
    expect(drifts.length).toBeGreaterThan(0);
    expect(drifts.every((line) => line.includes("缺失") || line.includes("漂移"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. F1：双份定义的三方指纹一致性（不一致 = FAIL，不修复）
// ---------------------------------------------------------------------------

describe("C. F1 已落库版本行一致性审计", () => {
  const record = createStrategyVersionRecord({
    document: GOLDEN_DOCUMENT,
    context: { codeVersion: CODE_VERSION, createdAt: NOW },
  });

  const consistentRow = {
    strategyId: GOLDEN_DOCUMENT.strategyId,
    version: GOLDEN_DOCUMENT.version,
    strategyDocumentJson: serializeStrategyDocument(GOLDEN_DOCUMENT),
    versionRecordJson: serializeStrategyVersionRecord(record),
    fingerprint: GOLDEN_DOCUMENT.fingerprint,
  };

  it("正常行 → 无漂移，且 assert 返回解析结果", () => {
    expect(checkStoredVersionConsistency(consistentRow)).toEqual([]);
    const parsed = assertStoredVersionConsistency(consistentRow);
    expect(parsed.document.fingerprint).toBe(GOLDEN_DOCUMENT.fingerprint);
    expect(parsed.versionRecord.strategy.fingerprint).toBe(GOLDEN_DOCUMENT.fingerprint);
  });

  it("列 fingerprint 与 canonical 重算不一致 → 报漂移", () => {
    const drifts = checkStoredVersionConsistency({ ...consistentRow, fingerprint: "0".repeat(64) });
    expect(drifts.length).toBeGreaterThan(0);
    expect(drifts.some((line) => line.includes("列 fingerprint"))).toBe(true);
  });

  it("strategyDocumentJson 被篡改 → 解析/指纹复核失败被报为漂移（不静默通过）", () => {
    const tampered = JSON.parse(consistentRow.strategyDocumentJson) as Record<string, unknown>;
    tampered.name = "被篡改的策略名";
    const drifts = checkStoredVersionConsistency({
      ...consistentRow,
      strategyDocumentJson: JSON.stringify(tampered),
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toContain("strategyDocumentJson");
  });

  it("JSON 解析失败 → 报漂移而不是抛错（审计脚本要能一次列全所有问题）", () => {
    const drifts = checkStoredVersionConsistency({ ...consistentRow, strategyDocumentJson: "{不是 JSON" });
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toContain("JSON 解析错误");
  });

  it("🔴 双份定义漂移（doc.definition 与 versionRecord.strategy.definition 不同）→ 报『双份定义漂移』", () => {
    // 模拟写入 bug：同一版本行里两份定义各自内部自洽，但内容不同。
    const variant = createStrategyDocumentFromDefinition({
      ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
      definition: {
        ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.definition,
        entry: {
          ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.definition.entry,
          observationWindow: { start: 1, end: 3, unit: "TRADING_DAY" },
        },
      },
    });
    expect(canonicalStringify(variant.definition)).not.toBe(canonicalStringify(GOLDEN_DEFINITION));

    const variantRecord = createStrategyVersionRecord({
      document: variant,
      context: { codeVersion: CODE_VERSION, createdAt: NOW },
    });
    const selfConsistentRecord = {
      ...variantRecord,
      fingerprint: computeStrategyVersionRecordFingerprint(variantRecord),
    };

    const drifts = checkStoredVersionConsistency({
      ...consistentRow,
      versionRecordJson: serializeStrategyVersionRecord(selfConsistentRecord),
    });
    expect(drifts.some((line) => line.includes("双份定义漂移"))).toBe(true);
    expect(() => assertStoredVersionConsistency({
      ...consistentRow,
      versionRecordJson: serializeStrategyVersionRecord(selfConsistentRecord),
    })).toThrow(/不自动修复/);
  });

  it("两侧 definition 存在性不一致 → 各自报漂移（不视为等价）", () => {
    const legacyDoc = createLegacyDocument();

    const drifts = checkStoredVersionConsistency({
      ...consistentRow,
      strategyDocumentJson: serializeStrategyDocument(legacyDoc),
      fingerprint: legacyDoc.fingerprint,
    });
    expect(drifts.some((line) => line.includes("definition 缺失"))).toBe(true);
  });

  it("🔴 双份定义的内容指纹必须相等（definition 级 sha256，与文档级指纹分层）", () => {
    expect(computeStrategyDefinitionFingerprint(GOLDEN_DEFINITION))
      .toBe(computeStrategyDefinitionFingerprint(record.strategy.definition as StrategyDefinition));
  });
});

// ---------------------------------------------------------------------------
// D. Service 编排：create / read / list / bundle / validateVersion
// ---------------------------------------------------------------------------

describe("D. Service 编排（含投影落库与读回校验）", () => {
  it("create 落库后：currentVersionId 指向版本行、latestVersion 与之一致", async () => {
    const { repo, service } = makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    const summary = await repo.getStrategy(GOLDEN_DOCUMENT.strategyId);
    expect(summary).toBeDefined();
    expect(summary?.latestVersion).toBe(GOLDEN_DOCUMENT.version);
    const rowId = await repo.getVersionRowId(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version);
    expect(rowId).toBeDefined();
    expect(summary?.currentVersionId).toBe(rowId);
  });

  it("create 落库时由 canonical Definition 派生投影（projectionRowCount = 参数+条件+出场+1+绑定）", async () => {
    const { repo, service } = makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    const bundle = await service.loadBundle(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version);
    const expected = buildStrategyProjections(GOLDEN_DEFINITION);
    const expectedCount = expected.parameters.length + expected.entryRules.length
      + expected.exitRules.length + 1 + expected.datasetBindings.length;

    expect(bundle.hasDefinition).toBe(true);
    expect(bundle.projections.parameters).toHaveLength(expected.parameters.length);
    expect(bundle.projections.entryRules).toHaveLength(expected.entryRules.length);
    expect(bundle.projections.exitRules).toHaveLength(expected.exitRules.length);
    expect(bundle.projections.datasetBindings).toHaveLength(expected.datasetBindings.length);
    expect(expectedCount).toBeGreaterThan(0);
  });

  it("读回的 definition 与写入前逐字段一致（canonical 往返不退化）", async () => {
    const { service } = makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    const loaded = await service.load(GOLDEN_DOCUMENT.strategyId);
    expect(loaded.fingerprint).toBe(GOLDEN_DOCUMENT.fingerprint);
    expect(canonicalStringify(loaded.definition)).toBe(canonicalStringify(GOLDEN_DEFINITION));
  });

  it("🔴 F1：bundle 内 versionRecord.strategy.definition 与 document.definition 逐字段一致", async () => {
    const { service } = makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    const bundle = await service.loadBundle(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version);
    expect(canonicalStringify(bundle.versionRecord.strategy.definition)).toBe(canonicalStringify(bundle.document.definition));
    expect(bundle.versionRecord.strategy.fingerprint).toBe(bundle.fingerprint);
  });

  it("validateVersion：Golden Sample 落库后 valid=true 且投影零漂移", async () => {
    const { service } = makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    const report = await service.validateVersion(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version);
    expect(report.valid).toBe(true);
    expect(report.definitionPresent).toBe(true);
    expect(report.projectionDrifts).toEqual([]);
    expect(report.document.issues).toEqual([]);
    expect(report.definition.valid).toBe(true);
  });

  it("validateVersion 的 definition issue 路径统一为 `definition.…`（与 document 校验路径同语义）", async () => {
    const { service } = makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    const report = await service.validateVersion(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version);
    for (const issue of report.definition.issues) {
      expect(issue.path.startsWith("definition.")).toBe(true);
    }
    for (const issue of report.document.issues) {
      expect(issue.path.startsWith("definition.definition.")).toBe(false);
    }
  });

  it("历史 v1 文档（无 definition）→ hasDefinition=false、投影全空、validateVersion 不报漂移", async () => {
    const { repo, service } = makeService();
    await service.create({ document: legacyWire() });

    const bundle = await service.loadBundle(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version);
    expect(bundle.hasDefinition).toBe(false);
    expect(bundle.projections.parameters).toEqual([]);
    expect(bundle.projections.entryRules).toEqual([]);
    expect(bundle.projections.datasetBindings).toEqual([]);

    const report = await service.validateVersion(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version);
    expect(report.definitionPresent).toBe(false);
    expect(report.projectionDrifts).toEqual([]);
    expect(report.valid).toBe(true);
    expect(await repo.getVersionRowId(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version)).toBeDefined();
  });

  it("list / listVersions 返回 STRATEGY-003 新字段（status / parentVersionId / currentVersionId）", async () => {
    const { service } = makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    const strategies = await service.list();
    expect(strategies).toHaveLength(1);
    expect(strategies[0]?.currentVersionId).toBeTypeOf("number");

    const versions = await service.listVersions(GOLDEN_DOCUMENT.strategyId);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.status).toBe("Draft");
    expect(versions[0]?.parentVersionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E. cloneVersion（任意源版本 / 演进链 / 幂等三态）
// ---------------------------------------------------------------------------

describe("E. cloneVersion", () => {
  /** 落库 Golden Sample，返回可用的 repo/service。 */
  async function withGolden() {
    const ctx = makeService();
    await ctx.service.create({ document: asWire(GOLDEN_DOCUMENT) });
    return ctx;
  }

  it("缺省目标版本 = 源版本 major bump；parentVersionId 指向源版本行", async () => {
    const { repo, service } = await withGolden();
    const sourceRowId = await repo.getVersionRowId(GOLDEN_DOCUMENT.strategyId, GOLDEN_DOCUMENT.version);

    const result = await service.cloneVersion({
      strategyId: GOLDEN_DOCUMENT.strategyId,
      fromVersion: GOLDEN_DOCUMENT.version,
    });

    expect(result.outcome).toBe("inserted");
    expect(result.version).toBe("2.0.0");
    expect(result.parentVersionId).toBe(sourceRowId);
    expect(result.versionRowId).toBeTypeOf("number");

    const bundle = await service.loadBundle(GOLDEN_DOCUMENT.strategyId, "2.0.0");
    expect(bundle.parentVersionId).toBe(sourceRowId);
  });

  it("clone 复制完整 Definition（params / entry / exit / execution / dataset 绑定），定义级指纹不变", async () => {
    const { service } = await withGolden();
    const result = await service.cloneVersion({
      strategyId: GOLDEN_DOCUMENT.strategyId,
      fromVersion: GOLDEN_DOCUMENT.version,
      targetVersion: "2.0.0",
      description: "从 1.0.0 派生：不改规则，仅建立演进链",
    });

    const bundle = await service.loadBundle(GOLDEN_DOCUMENT.strategyId, result.version);
    const cloned = bundle.document.definition as StrategyDefinition;
    expect(canonicalStringify(cloned)).toBe(canonicalStringify(GOLDEN_DEFINITION));
    expect(computeStrategyDefinitionFingerprint(cloned)).toBe(computeStrategyDefinitionFingerprint(GOLDEN_DEFINITION));

    // 文档级指纹必然变化（version / description 参与指纹）—— 这是「新版本」而非「同一版本」。
    expect(bundle.fingerprint).not.toBe(GOLDEN_DOCUMENT.fingerprint);

    // 投影随新版本重新派生，且与 canonical 零漂移。
    const drifts = verifyStrategyProjections(buildStrategyProjections(cloned), bundle.projections);
    expect(drifts).toEqual([]);
    expect(bundle.projections.parameters).toHaveLength(GOLDEN_DEFINITION.parameters.length);
    expect(bundle.projections.datasetBindings).toHaveLength(GOLDEN_DEFINITION.datasets.length);
  });

  it("🔴 可从任意历史版本 clone（源不必是 latest）；parentVersionId 指向该历史版本", async () => {
    const { repo, service } = await withGolden();
    const base = GOLDEN_DOCUMENT.strategyId;
    const row100 = await repo.getVersionRowId(base, "1.0.0");

    const mid = await service.cloneVersion({ strategyId: base, fromVersion: "1.0.0", targetVersion: "2.0.0" });
    expect(mid.outcome).toBe("inserted");
    const row200 = await repo.getVersionRowId(base, "2.0.0");
    expect(row200).not.toBe(row100);

    // 从 1.0.0（非 latest）再 clone 一次
    const branch = await service.cloneVersion({ strategyId: base, fromVersion: "1.0.0", targetVersion: "3.0.0" });
    expect(branch.outcome).toBe("inserted");
    expect(branch.parentVersionId).toBe(row100);
    expect(branch.parentVersionId).not.toBe(row200);

    const bundle = await service.loadBundle(base, "3.0.0");
    expect(bundle.parentVersionId).toBe(row100);
  });

  it("clone 不改变源版本（源版本内容与投影保持原样）", async () => {
    const { service } = await withGolden();
    const before = await service.loadBundle(GOLDEN_DOCUMENT.strategyId, "1.0.0");
    await service.cloneVersion({ strategyId: GOLDEN_DOCUMENT.strategyId, fromVersion: "1.0.0" });
    const after = await service.loadBundle(GOLDEN_DOCUMENT.strategyId, "1.0.0");

    expect(after.fingerprint).toBe(before.fingerprint);
    expect(canonicalStringify(after.projections)).toBe(canonicalStringify(before.projections));
  });

  it("幂等：同源同目标重复 clone → idempotent-skip，不产生重复版本", async () => {
    const { service } = await withGolden();
    const input = { strategyId: GOLDEN_DOCUMENT.strategyId, fromVersion: "1.0.0", targetVersion: "2.0.0" };

    const first = await service.cloneVersion(input);
    const second = await service.cloneVersion(input);

    expect(first.outcome).toBe("inserted");
    expect(second.outcome).toBe("idempotent-skip");
    expect(second.versionRowId).toBeUndefined();
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(await service.listVersions(GOLDEN_DOCUMENT.strategyId)).toHaveLength(2);
  });

  it("🔴 冲突：同目标版本但内容不同 → conflict，且**不覆盖**既有版本", async () => {
    const { service } = await withGolden();
    const base = GOLDEN_DOCUMENT.strategyId;

    const first = await service.cloneVersion({
      strategyId: base, fromVersion: "1.0.0", targetVersion: "2.0.0", description: "说明 A",
    });
    const conflict = await service.cloneVersion({
      strategyId: base, fromVersion: "1.0.0", targetVersion: "2.0.0", description: "说明 B",
    });

    expect(conflict.outcome).toBe("conflict");
    expect(conflict.existingFingerprint).toBe(first.fingerprint);
    expect(conflict.fingerprint).not.toBe(first.fingerprint);

    const bundle = await service.loadBundle(base, "2.0.0");
    expect(bundle.description).toBe("说明 A");
    expect(bundle.fingerprint).toBe(first.fingerprint);
  });

  it("clone 默认状态 Draft；显式传入合法八态生效", async () => {
    const { service } = await withGolden();
    const base = GOLDEN_DOCUMENT.strategyId;

    const draft = await service.cloneVersion({ strategyId: base, fromVersion: "1.0.0", targetVersion: "2.0.0" });
    expect((await service.loadBundle(base, draft.version)).status).toBe("Draft");

    const researching = await service.cloneVersion({
      strategyId: base, fromVersion: "1.0.0", targetVersion: "3.0.0", status: "Research",
    });
    expect((await service.loadBundle(base, researching.version)).status).toBe("Research");
  });

  it("非法状态（不在 C-21.1 八态内）→ 响亮抛错，不落库", async () => {
    const { service } = await withGolden();
    await expect(service.cloneVersion({
      strategyId: GOLDEN_DOCUMENT.strategyId, fromVersion: "1.0.0", targetVersion: "2.0.0", status: "ARCHIVED",
    })).rejects.toThrow(/版本状态非法/);
    expect(await service.listVersions(GOLDEN_DOCUMENT.strategyId)).toHaveLength(1);
  });

  it("源版本不存在 → 响亮抛错", async () => {
    const { service } = await withGolden();
    await expect(service.cloneVersion({
      strategyId: GOLDEN_DOCUMENT.strategyId, fromVersion: "9.9.9",
    })).rejects.toThrow(/未找到源版本/);
  });

  it("clone 出更高版本后，实体 currentVersionId 指向新版本（权威指针不漂移）", async () => {
    const { repo, service } = await withGolden();
    const base = GOLDEN_DOCUMENT.strategyId;

    await service.cloneVersion({ strategyId: base, fromVersion: "1.0.0", targetVersion: "2.0.0" });

    const summary = await repo.getStrategy(base);
    const row200 = await repo.getVersionRowId(base, "2.0.0");
    expect(summary?.latestVersion).toBe("2.0.0");
    expect(summary?.currentVersionId).toBe(row200);
  });

  it("clone 出的版本可直接通过 validateVersion（无 Look-Ahead / 视图 / 投影问题）", async () => {
    const { service } = await withGolden();
    const result = await service.cloneVersion({
      strategyId: GOLDEN_DOCUMENT.strategyId, fromVersion: "1.0.0", targetVersion: "2.0.0",
    });
    const report = await service.validateVersion(GOLDEN_DOCUMENT.strategyId, result.version);
    expect(report.valid).toBe(true);
    expect(report.projectionDrifts).toEqual([]);
  });

  it("cloneStrategyDocumentToVersion 对无 definition 的历史文档透传 v1 字段（不伪造富定义）", () => {
    const legacyDoc = createLegacyDocument();
    const cloned = cloneStrategyDocumentToVersion(legacyDoc, "2.0.0");
    expect(cloned.definition).toBeUndefined();
    expect(cloned.entryRules).toEqual(legacyDoc.entryRules);
    expect(cloned.version).toBe("2.0.0");
    expect(cloned.fingerprint).not.toBe(legacyDoc.fingerprint);
  });

  it("createStrategyDocumentFromDefinition 缺少 definition 时响亮失败（不留 `Cannot read properties of undefined`）", () => {
    const withoutDefinition = { ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT, definition: undefined };
    expect(() => createStrategyDocumentFromDefinition(
      withoutDefinition as unknown as Parameters<typeof createStrategyDocumentFromDefinition>[0],
    )).toThrow(/要求提供 definition/);
  });
});

// ---------------------------------------------------------------------------
// F. 版本不可变性 + 状态迁移（唯一允许的 UPDATE）
// ---------------------------------------------------------------------------

describe("F. 版本不可变性与状态迁移", () => {
  it("setVersionStatus 迁移状态后：指纹 / 投影 / 定义全不变（status 是唯一可变列）", async () => {
    const { service } = await makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });
    const base = GOLDEN_DOCUMENT.strategyId;

    const before = await service.loadBundle(base, "1.0.0");
    await service.setVersionStatus(base, "1.0.0", "Research");
    const after = await service.loadBundle(base, "1.0.0");

    expect(after.status).toBe("Research");
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(canonicalStringify(after.document)).toBe(canonicalStringify(before.document));
    expect(canonicalStringify(after.projections)).toBe(canonicalStringify(before.projections));
  });

  it("状态迁移在 listVersions 中可见", async () => {
    const { service } = await makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });
    await service.setVersionStatus(GOLDEN_DOCUMENT.strategyId, "1.0.0", "Validated");

    const versions = await service.listVersions(GOLDEN_DOCUMENT.strategyId);
    expect(versions[0]?.status).toBe("Validated");
  });

  it("非法状态迁移 → 响亮抛错，状态保持原值", async () => {
    const { service } = await makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    await expect(service.setVersionStatus(GOLDEN_DOCUMENT.strategyId, "1.0.0", "DRAFT"))
      .rejects.toThrow(/版本状态非法/);
    const bundle = await service.loadBundle(GOLDEN_DOCUMENT.strategyId, "1.0.0");
    expect(bundle.status).toBe("Draft");
  });

  it("迁移不存在的版本 → 抛错", async () => {
    const { service } = await makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });
    await expect(service.setVersionStatus(GOLDEN_DOCUMENT.strategyId, "9.9.9", "Research"))
      .rejects.toThrow(/未找到策略版本/);
  });

  it("🔴 版本不可变：同 version 换一份 definition 重存 → conflict 抛错，既有行未被覆盖", async () => {
    const { service } = await makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });
    const base = GOLDEN_DOCUMENT.strategyId;

    const variant = createStrategyDocumentFromDefinition({
      ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT,
      definition: {
        ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.definition,
        position: { ...FIRST_BOARD_PULLBACK_DOCUMENT_INPUT.definition.position, maxPositions: 3 },
      },
    });

    await expect(service.save({ document: asWire(variant) })).rejects.toThrow(/不可变/);

    const bundle = await service.loadBundle(base, "1.0.0");
    expect(canonicalStringify(bundle.document.definition)).toBe(canonicalStringify(GOLDEN_DEFINITION));
  });

  it("getVersion / getLatestVersion 读路径经一致性断言（F1 不会在读取时被静默放过）", async () => {
    const { service } = await makeService();
    await service.create({ document: asWire(GOLDEN_DOCUMENT) });

    const record = await service.loadVersion(GOLDEN_DOCUMENT.strategyId, "1.0.0");
    expect(record.strategy.fingerprint).toBe(GOLDEN_DOCUMENT.fingerprint);
    const latest = await service.load(GOLDEN_DOCUMENT.strategyId);
    expect(latest.version).toBe("1.0.0");
  });
});
