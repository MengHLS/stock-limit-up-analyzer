/**
 * P0 · 组合数据集 provider 的**扩展行并集装载**测试（公平性前提）。
 *
 * 融合臂可能选中与纯 3F 臂**不同**的事件。若 provider 只按控制臂选事件装载 rd17..80，
 * 融合臂选中的事件就拿不到 T+17..T+80，会在 rd16 被数据边界截断 —— 与 Runner 语义
 * 不可比，而且**结果看上去仍然正常**（静默失真）。本测试钉住：
 *   1. 缺省（不声明臂集合）⇒ 与既有行为一致：只按纯 3F 控制臂装载；
 *   2. 声明多臂 ⇒ 按**并集**装载，且并集严格大于控制臂集合（夹具里融合确实换了人选）；
 *   3. 传给数据层的 eventId 集合 = 并集本身（不多不少），且控制臂集合是它的子集。
 */
import { describe, expect, it } from "vitest";
import { createDefaultCompositeDatasetProvider } from "../../../server/researchExperiments/compositeDatasetProvider";
import type { CompositeExtensionBar } from "../../../server/research/compositeRunner/index";
import {
  LAST_TRADING_DAY,
  buildTrendFusionArm,
  buildTrendFusionDataset,
  buildTrendFusionGateArm,
  eventIdOfSecurityId,
} from "../research/compositeRunner/trendFusionFixture";

/** 基线窗口之外的交易日：只用于让「扩展行投影确实新增行」可被断言。 */
const EXTENSION_TRADE_DATE = "2026-03-11";

const ARMS = [
  { id: "control", trendWeight: null },
  { id: "trend-w20", trendWeight: 0.2 },
  { id: "trend-w30", trendWeight: 0.3 },
  { id: "trend-w50", trendWeight: 0.5 },
] as const;

interface ExtensionLoader {
  (
    datasetVersionId: number,
    eventIds: readonly string[],
  ): Promise<Map<string, CompositeExtensionBar[]>>;
}

/** 记录每次扩展行读取请求的 eventId（并集断言用）。 */
function recordingLoader(): { requested: string[][]; loader: ExtensionLoader } {
  const requested: string[][] = [];
  return {
    requested,
    loader: async (_datasetVersionId, eventIds) => {
      requested.push([...eventIds]);
      return new Map<string, CompositeExtensionBar[]>();
    },
  };
}

/** 某一支臂（按 rankFusion 声明）会选中哪些**事件 id**（已排序）。 */
function selectedEventIdsOfArm(rankFusion: { readonly trendWeight: number } | null): string[] {
  const arm = buildTrendFusionArm(buildTrendFusionDataset(), rankFusion);
  return [...arm.selectedSecurityIds].map(eventIdOfSecurityId).sort();
}

describe("compositeDatasetProvider · 扩展行并集装载", () => {
  it("缺省臂集合 ⇒ 只按控制臂（纯 3F）装载，与既有行为一致", async () => {
    const recorder = recordingLoader();
    const provider = createDefaultCompositeDatasetProvider({
      loadBaseline: async () => buildTrendFusionDataset(),
      loadExtensionBars: recorder.loader,
    });
    const surface = await provider.build({
      baselineDatasetVersionId: 660001,
      extensionDatasetVersionId: 780001,
      evaluationWindow: null,
    });
    const control = selectedEventIdsOfArm(null);
    expect(recorder.requested).toHaveLength(1);
    expect(recorder.requested[0]).toEqual(control);
    expect(surface.selectedEventCount).toBe(control.length);
  });

  it("声明四条臂 ⇒ 按并集装载，且并集严格大于控制臂集合", async () => {
    const recorder = recordingLoader();
    const provider = createDefaultCompositeDatasetProvider({
      loadBaseline: async () => buildTrendFusionDataset(),
      loadExtensionBars: recorder.loader,
    });
    const surface = await provider.build({
      baselineDatasetVersionId: 660001,
      extensionDatasetVersionId: 780001,
      evaluationWindow: null,
      extensionSelectionArms: [...ARMS],
    });
    const control = selectedEventIdsOfArm(null);
    const union = new Set<string>();
    for (const arm of ARMS) {
      const eventIds = selectedEventIdsOfArm(
        arm.trendWeight === null ? null : { trendWeight: arm.trendWeight },
      );
      for (const eventId of eventIds) union.add(eventId);
    }
    const unionSorted = [...union].sort();
    expect(unionSorted.length).toBeGreaterThan(control.length);
    expect(recorder.requested).toHaveLength(1);
    expect(recorder.requested[0]).toEqual(unionSorted);
    expect(surface.selectedEventCount).toBe(unionSorted.length);
    for (const eventId of control) expect(union.has(eventId)).toBe(true);
  });

  it("声明门槛臂 => 并集必须包含门槛臂选中的事件（只筛不改排序也一样要装载）", async () => {
    const recorder = recordingLoader();
    const provider = createDefaultCompositeDatasetProvider({
      loadBaseline: async () => buildTrendFusionDataset(),
      loadExtensionBars: recorder.loader,
    });
    const gateThreshold = 1 / 3;
    const surface = await provider.build({
      baselineDatasetVersionId: 660001,
      extensionDatasetVersionId: 780001,
      evaluationWindow: null,
      extensionSelectionArms: [
        { id: "control", trendWeight: null },
        { id: "gate-ge1of3", trendWeight: null, minTrendScore: gateThreshold },
      ],
    });
    const control = selectedEventIdsOfArm(null);
    const gate = [...buildTrendFusionGateArm(buildTrendFusionDataset(), gateThreshold).selectedSecurityIds]
      .map(eventIdOfSecurityId)
      .sort();
    const union = new Set<string>([...control, ...gate]);
    const unionSorted = [...union].sort();
    expect(recorder.requested[0]).toEqual(unionSorted);
    expect(surface.selectedEventCount).toBe(unionSorted.length);
    for (const eventId of gate) expect(union.has(eventId)).toBe(true);
  });

  it("执行数据集包含并集事件的扩展行（行数严格大于基线）", async () => {
    const provider = createDefaultCompositeDatasetProvider({
      loadBaseline: async () => buildTrendFusionDataset(),
      loadExtensionBars: async (_datasetVersionId, eventIds) => {
        const map = new Map<string, CompositeExtensionBar[]>();
        for (const eventId of eventIds) {
          map.set(eventId, [
            {
              eventId,
              relativeDay: 17,
              // 必须用基线里不存在的 (tradeDate, securityId)：否则投影会按主键去重、行数不增长。
              tradeDate: EXTENSION_TRADE_DATE,
              open: 10,
              high: 10,
              low: 10,
              close: 10,
              preClose: 10,
              volume: 1_000_000,
              amount: 10_000_000,
            } as unknown as CompositeExtensionBar,
          ]);
        }
        return map;
      },
    });
    const surface = await provider.build({
      baselineDatasetVersionId: 660001,
      extensionDatasetVersionId: 780001,
      evaluationWindow: null,
      extensionSelectionArms: [...ARMS],
    });
    expect(surface.executionDataset.rows.length).toBeGreaterThan(
      surface.baselineDataset.rows.length,
    );
    expect(surface.dateRange.endDate).toBe(LAST_TRADING_DAY);
    expect(surface.extensionDatasetVersionId).toBe(780001);
  });
});