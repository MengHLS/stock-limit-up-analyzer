/**
 * DATASET-WINDOW-PROJECTION-001 — 「运行策略从数据集取数」的投影口径测试。
 *
 * 背景（2026-09-14 用户命题「策略运行的时候是需要从数据集中取数据啊」+ 真实库实查）：
 * 旧直读桥只投影 `prefix` 的 rd=0 ⇒ 任何证券在事件日之外**没有行** ⇒ 交易模拟在
 * 决策日下一交易日取不到行情 ⇒ 全单 `SUSPENDED`、0 成交 ⇒ `executionBarsAvailable=false`
 * ⇒ 每次运行都回落 `buildResearchDataset` 回查 `stock_daily_prices` / `liquidity_daily`。
 * 但 `ds_*_post`（rd ∈ [1,20]）**本来就有完整 OHLCV**（实测 471,816 行）⇒ 那是**投影口径过窄**，
 * 不是数据缺失。
 *
 * 本测试钉住新口径的六条判据：
 *   A. 窗口**必须由策略声明**给出，未声明 ⇒ 拒绝（不代猜）；
 *   B. 声明非法 ⇒ **响亮抛错**（不夹取，夹取 = 悄悄改窄策略）；
 *   C. 面板 = rd=0（首板日，特征基准）+ rd ∈ [1, end+1]（观察日 + 次日执行日）；
 *   D. **决策日资格 = rd ∈ [start, end]**；rd=0 与 rd=end+1 **不具资格**；
 *   E. 同一证券的多个事件窗口保留为独立事件级序列，底层同 K 线数值冲突即抛错；
 *   F. 观察日的 turnover / 市值如实为 null（不拿首板日数值冒充观察日）。
 */

import { describe, expect, it } from "vitest";
import {
  DATASET_POST_MAX_RELATIVE_DAY,
  RegistryDatasetBridgeError,
  buildWindowRows,
  resolveObservationWindow,
  resolveSecurityIdsByEvent,
} from "../../../server/runWorkbenchAssembly/datasetFromRegistry";
import { eventScopedSecurityId } from "../../../server/eventIdentity";
import type {
  FirstLimitPullbackEvent,
  FirstLimitPullbackRawBar,
} from "../../../server/datasetRegistry/types";
import type { SecurityIdentifier } from "../../../server/security/types";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<FirstLimitPullbackEvent> = {}): FirstLimitPullbackEvent {
  return {
    datasetVersionId: 390002,
    eventId: "000001.SZ@2025-03-03",
    symbol: "000001.SZ",
    tradeDate: "2025-03-03",
    market: "SZ",
    industryCode: "I001",
    boardType: "main",
    previousClose: 10,
    limitUpPrice: 11,
    turnover: 7.5,
    isFirstLimit: true,
    previousLimitDate: null,
    daysSincePreviousLimit: null,
    historicalLimitCount: 1,
    marketCap: 1000,
    floatMarketCap: 900,
    ...overrides,
  };
}

function makeBar(
  eventId: string,
  symbol: string,
  relativeDay: number,
  tradeDate: string,
  close: number,
  overrides: Partial<FirstLimitPullbackRawBar> = {},
): FirstLimitPullbackRawBar {
  return {
    datasetVersionId: 390002,
    eventId,
    symbol,
    tradeDate,
    relativeDay,
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
    amount: 1000,
    ...overrides,
  };
}

/**
 * 由一个「交易日 → 收盘价」表构造某事件的整段窗口（rd=0 起，逐日 +1）。
 * 两个事件共享同一张价表时，被共同覆盖的交易日**数值一致** ⇒ 应无损合并。
 */
function windowFromDates(
  event: FirstLimitPullbackEvent,
  dates: readonly string[],
  priceOf: (d: string) => number,
): { zero: FirstLimitPullbackRawBar; post: FirstLimitPullbackRawBar[] } {
  const zero = makeBar(event.eventId, event.symbol, 0, dates[0]!, priceOf(dates[0]!));
  const post = dates.slice(1).map((d, i) =>
    makeBar(event.eventId, event.symbol, i + 1, d, priceOf(d)),
  );
  return { zero, post };
}

/** 单事件窗口：rd 0..4（= WINDOW_1_3 的 end + 1）。 */
function window(event: FirstLimitPullbackEvent, baseClose: number) {
  const dates = ["2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07"];
  return windowFromDates(event, dates, (d) => baseClose + dates.indexOf(d));
}

const WINDOW_1_3 = { start: 1, end: 3 };

/** 取出抛出错误的稳定错误码（`RegistryDatasetBridgeError.code`）。 */
function readErrorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof RegistryDatasetBridgeError ? error.code : null;
  }
}

// ---------------------------------------------------------------------------
// 身份（canonical securityId）夹具
// ---------------------------------------------------------------------------

/**
 * 测试用 canonical 身份（`sec_<uuid>` 形态）。
 *
 * 🔴 刻意**不等于** `symbol`：`buildWindowRows` 的键必须是身份而非代码，
 * 若有人把 `securityId` 退回成 `event.symbol`，本文件的 E/J 两例会立刻变红。
 */
function sid(symbol: string): string {
  return `sec_test-${symbol}`;
}

/** eventId → canonical 身份（与生产桥同一映射方向：身份 ≠ 代码）。 */
function idsOf(...events: readonly FirstLimitPullbackEvent[]): Map<string, string> {
  return new Map(events.map((e) => [e.eventId, sid(e.symbol)]));
}

/** identifier history 行夹具（默认 primary / SZ / 覆盖到 2025-03-03）。 */
function makeIdentifier(
  overrides: Partial<SecurityIdentifier> & { securityId: string; code: string },
): SecurityIdentifier {
  return {
    exchange: "SZ",
    identifierType: "primary",
    effectiveFrom: "2000-01-01",
    effectiveTo: null,
    source: "test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("resolveObservationWindow — 观察窗口只能来自策略声明", () => {
  it("A. 未声明 ⇒ null（调用方据此拒绝直读，**不代猜窗口**）", () => {
    expect(resolveObservationWindow(undefined)).toBeNull();
    expect(resolveObservationWindow(null)).toBeNull();
  });

  it("B. 合法声明 ⇒ {start, end}（实库 cand-36000x 就是 {1,3,TRADING_DAY}）", () => {
    expect(resolveObservationWindow({ start: 1, end: 3, unit: "TRADING_DAY" })).toEqual({
      start: 1,
      end: 3,
    });
  });

  it("C. 非 TRADING_DAY 单位 ⇒ 响亮抛错", () => {
    expect(() => resolveObservationWindow({ start: 1, end: 3, unit: "CALENDAR_DAY" })).toThrow(
      RegistryDatasetBridgeError,
    );
    expect(readErrorCode(() => resolveObservationWindow({ start: 1, end: 3, unit: "CALENDAR_DAY" }))).toBe(
      "REGISTRY_OBSERVATION_WINDOW_INVALID",
    );
  });

  it("D. start < 1 / end < start / 非整数 / 超 post 上限 ⇒ 一律抛错（**不夹取**）", () => {
    for (const bad of [
      { start: 0, end: 3, unit: "TRADING_DAY" },
      { start: 3, end: 1, unit: "TRADING_DAY" },
      { start: 1.5, end: 3, unit: "TRADING_DAY" },
      { start: 1, end: DATASET_POST_MAX_RELATIVE_DAY + 1, unit: "TRADING_DAY" },
      { start: 1, end: "3", unit: "TRADING_DAY" },
    ]) {
      expect(() => resolveObservationWindow(bad)).toThrow(RegistryDatasetBridgeError);
    }
  });

  it("E. 声明了但不是对象 ⇒ 抛错（不是「当作未声明」）", () => {
    expect(readErrorCode(() => resolveObservationWindow([1, 3]))).toBe(
      "REGISTRY_OBSERVATION_WINDOW_INVALID",
    );
  });
});

describe("buildWindowRows — 事件窗口 → 逐日面板", () => {
  it("A. 面板 = rd 0..4（end+1），序号/日期/OHLCV 一一对应", () => {
    const event = makeEvent();
    const { zero, post } = window(event, 10);
    const projection = buildWindowRows([event], [zero], post, WINDOW_1_3, idsOf(event));

    expect(projection.candidateCount).toBe(5);
    expect(projection.rows.map((r) => r.tradeDate)).toEqual([
      "2025-03-03",
      "2025-03-04",
      "2025-03-05",
      "2025-03-06",
      "2025-03-07",
    ]);
    expect(projection.rows.map((r) => r.close)).toEqual([10, 11, 12, 13, 14]);
    // PIT：asOf === tradeDate（bindResearchDataset 强校验此项）。
    for (const row of projection.rows) expect(row.asOf).toBe(row.tradeDate);
  });

  it("B. 决策日资格 = rd ∈ [start,end]：rd=0 与 rd=end+1(=4) 都**不是**决策日", () => {
    const event = makeEvent();
    const { zero, post } = window(event, 10);
    const projection = buildWindowRows([event], [zero], post, WINDOW_1_3, idsOf(event));

    const key = (d: string) =>
      `${d}\u0000${eventScopedSecurityId(sid(event.symbol), event.eventId)}`;
    expect(projection.memberKeys.has(key("2025-03-03"))).toBe(false); // rd=0 首板日
    expect(projection.memberKeys.has(key("2025-03-04"))).toBe(true); // rd=1
    expect(projection.memberKeys.has(key("2025-03-05"))).toBe(true); // rd=2
    expect(projection.memberKeys.has(key("2025-03-06"))).toBe(true); // rd=3
    expect(projection.memberKeys.has(key("2025-03-07"))).toBe(false); // rd=4 仅供执行
    expect(projection.memberKeys.size).toBe(3);
  });

  it("C. preClose 链式：rd=0 用事件前收，rd≥1 用上一相对日收盘", () => {
    const event = makeEvent({ previousClose: 9.5 });
    const { zero, post } = window(event, 10);
    const projection = buildWindowRows([event], [zero], post, WINDOW_1_3, idsOf(event));

    expect(projection.rows.map((r) => r.preClose)).toEqual([9.5, 10, 11, 12, 13]);
  });

  it("D. 观察日行的 turnover / 市值如实为 null（首板日数值不得外推）", () => {
    const event = makeEvent();
    const { zero, post } = window(event, 10);
    const projection = buildWindowRows([event], [zero], post, WINDOW_1_3, idsOf(event));

    const day0 = projection.rows[0]!;
    expect(day0.turnoverRate).toBe(7.5);
    expect(day0.totalMarketCap).toBe(1000);
    expect(day0.knowledge.liquidity).toBe("KNOWN");

    for (const row of projection.rows.slice(1)) {
      expect(row.turnoverRate).toBeNull();
      expect(row.totalMarketCap).toBeNull();
      expect(row.circulationMarketCap).toBeNull();
      expect(row.knowledge.liquidity).toBe("UNKNOWN");
    }
  });

  it("E. 重叠窗口保留为事件级序列，且行序按 (tradeDate, eventScopedSecurityId) 升序", () => {
    // 同一证券两个事件：E1 首板 2025-03-03、E2 首板 2025-03-05 ⇒ 03-05..03-07 被两者共同覆盖。
    // 价表按**交易日**给定 ⇒ 重叠日数值天然一致（同一根 K 线）。
    const price: Record<string, number> = {
      "2025-03-03": 10,
      "2025-03-04": 11,
      "2025-03-05": 12,
      "2025-03-06": 13,
      "2025-03-07": 14,
      "2025-03-10": 15,
      "2025-03-11": 16,
    };
    const priceOf = (d: string) => price[d]!;

    const e1 = makeEvent({ eventId: "E1", symbol: "000001.SZ", tradeDate: "2025-03-03" });
    const e2 = makeEvent({
      eventId: "E2",
      symbol: "000001.SZ",
      tradeDate: "2025-03-05",
      previousClose: 11,
    });
    const w1 = windowFromDates(
      e1,
      ["2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06", "2025-03-07"],
      priceOf,
    );
    const w2 = windowFromDates(
      e2,
      ["2025-03-05", "2025-03-06", "2025-03-07", "2025-03-10", "2025-03-11"],
      priceOf,
    );

    const projection = buildWindowRows(
      [e1, e2],
      [w1.zero, w2.zero],
      [...w1.post, ...w2.post],
      WINDOW_1_3,
      idsOf(e1, e2),
    );

    const dates = projection.rows.map((r) => r.tradeDate);
    expect(dates).toEqual([
      "2025-03-03",
      "2025-03-04",
      "2025-03-05",
      "2025-03-05",
      "2025-03-06",
      "2025-03-06",
      "2025-03-07",
      "2025-03-07",
      "2025-03-10",
      "2025-03-11",
    ]); // 事件级序列保留重叠日，两个事件各自拥有独立 bars[0]
    expect(projection.mergedKeys).toBe(3); // 底层证券/交易日重叠键数，仅用于一致性审计
    expect(projection.rows.map((r) => r.close)).toEqual([10, 11, 12, 12, 13, 13, 14, 14, 15, 16]);

    // 决策日资格取自**原始相对日**（任一个事件给出 rd ∈ [1,3] 即具备资格）：
    //   E1：03-03=rd0（否）/ 03-04=rd1 / 03-05=rd2 / 03-06=rd3 / 03-07=rd4（否）
    //   E2：03-05=rd0（否）/ 03-06=rd1 / 03-07=rd2 / 03-10=rd3 / 03-11=rd4（否）
    // ⇒ 03-07 由 E1 看「不具资格」、由 E2 看「具资格」，**任一命中即具资格**（事件池语义）。
    const member = (d: string, eventId: "E1" | "E2") =>
      projection.memberKeys.has(`${d}\u0000${eventScopedSecurityId(sid("000001.SZ"), eventId)}`);
    expect(member("2025-03-03", "E1")).toBe(false); // E1 rd=0
    expect(member("2025-03-04", "E1")).toBe(true); //  E1 rd=1
    expect(member("2025-03-05", "E1")).toBe(true); //  E1 rd=2
    expect(member("2025-03-06", "E1")).toBe(true); //  E1 rd=3
    expect(member("2025-03-07", "E1")).toBe(false); // E1 rd=4（仅供执行）
    expect(member("2025-03-05", "E2")).toBe(false); // E2 rd=0
    expect(member("2025-03-06", "E2")).toBe(true); //  E2 rd=1
    expect(member("2025-03-07", "E2")).toBe(true); //  E2 rd=2
    expect(member("2025-03-10", "E2")).toBe(true); //  E2 rd=3
    expect(member("2025-03-11", "E2")).toBe(false); // E2 rd=4（仅供执行）
  });

  it("F. 同一根 K 线数值冲突 ⇒ 响亮抛错（不编造取舍）", () => {
    const e1 = makeEvent({ eventId: "E1", symbol: "000001.SZ", tradeDate: "2025-03-03" });
    const e2 = makeEvent({ eventId: "E2", symbol: "000001.SZ", tradeDate: "2025-03-05" });
    const w1 = window(e1, 10);
    // E2 的 rd=0（2025-03-05，与 E1 的 rd=2 同日）故意给一个不同的收盘价
    const conflicting = makeBar("E2", "000001.SZ", 0, "2025-03-05", 99);
    expect(
      readErrorCode(() =>
        buildWindowRows([e1, e2], [w1.zero, conflicting], w1.post, WINDOW_1_3, idsOf(e1, e2)),
      ),
    ).toBe("REGISTRY_WINDOW_ROW_CONFLICT");
  });

  it("G. 缺中间相对日 ⇒ 该日无行（不补齐、不插值）", () => {
    const event = makeEvent();
    const { zero, post } = window(event, 10);
    const projection = buildWindowRows(
      [event],
      [zero],
      post.filter((b) => b.relativeDay !== 2),
      WINDOW_1_3,
      idsOf(event),
    );

    const dates = projection.rows.map((r) => r.tradeDate);
    expect(dates).not.toContain("2025-03-05"); // rd=2 缺失
    // 缺失日的「上一相对日收盘」如实为 null，而非拿更早的值冒充。
    expect(projection.rows.find((r) => r.tradeDate === "2025-03-06")!.preClose).toBeNull();
  });

  it("H. securityId 取自身份映射（canonical），code 才是 event.symbol —— 两字段不可互换", () => {
    const event = makeEvent();
    const { zero, post } = window(event, 10);
    const projection = buildWindowRows([event], [zero], post, WINDOW_1_3, idsOf(event));

    for (const row of projection.rows) {
      expect(row.securityId).toBe(eventScopedSecurityId(sid("000001.SZ"), event.eventId));
      expect(row.code).toBe("000001.SZ"); // 该日生效完整代码
      expect(row.securityId).not.toBe(row.code);
    }
    // 行序的唯一键也是身份域：`(tradeDate, securityId)` 升序。
    expect(projection.rows.every((r, i, all) => i === 0 || all[i - 1]!.securityId <= r.securityId)).toBe(
      true,
    );
  });

  it("I. 事件缺身份 ⇒ 响亮抛错（不退回用代码冒充身份）", () => {
    const event = makeEvent();
    const { zero, post } = window(event, 10);
    expect(
      readErrorCode(() => buildWindowRows([event], [zero], post, WINDOW_1_3, new Map())),
    ).toBe("REGISTRY_SECURITY_IDENTITY_UNRESOLVED");
  });
});

describe("resolveSecurityIdsByEvent — symbol（代码域）→ canonical sec_<uuid>", () => {
  it("A. 事件日落在生效区间内 ⇒ 解析到该 identity；区间外 ⇒ 抛错（PIT，不用「当前」猜）", () => {
    const identifier = makeIdentifier({
      securityId: "sec_A",
      code: "000001",
      effectiveFrom: "2025-01-01",
      effectiveTo: "2025-02-28",
    });
    // 事件日在区间内
    expect(
      resolveSecurityIdsByEvent([makeEvent({ tradeDate: "2025-02-20" })], [identifier]).get(
        "000001.SZ@2025-03-03",
      ),
    ).toBe("sec_A");
    // 事件日在区间后（旧代码已被复用）⇒ 无生效标识符 ⇒ 响亮抛错
    expect(
      readErrorCode(() => resolveSecurityIdsByEvent([makeEvent()], [identifier])),
    ).toBe("REGISTRY_SECURITY_IDENTITY_UNRESOLVED");
  });

  it("B. code reuse：同一代码在不同区间归属不同证券 ⇒ 各自按事件日解析到各自身份", () => {
    const oldOwner = makeIdentifier({
      securityId: "sec_OLD",
      code: "000001",
      effectiveFrom: "2000-01-01",
      effectiveTo: "2024-12-31",
    });
    const newOwner = makeIdentifier({
      securityId: "sec_NEW",
      code: "000001",
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
    });
    const ids = resolveSecurityIdsByEvent(
      [
        makeEvent({ eventId: "E_OLD", tradeDate: "2024-06-03" }),
        makeEvent({ eventId: "E_NEW", tradeDate: "2025-03-03" }),
      ],
      [oldOwner, newOwner],
    );
    expect(ids.get("E_OLD")).toBe("sec_OLD");
    expect(ids.get("E_NEW")).toBe("sec_NEW");
  });

  it("C. 同区间多行指向不同 identity（数据错误）⇒ 歧义即抛错，不静默取第一条", () => {
    const a = makeIdentifier({ securityId: "sec_A", code: "000001", effectiveTo: null });
    const b = makeIdentifier({ securityId: "sec_B", code: "000001", effectiveTo: null });
    expect(readErrorCode(() => resolveSecurityIdsByEvent([makeEvent()], [a, b]))).toBe(
      "REGISTRY_SECURITY_IDENTITY_UNRESOLVED",
    );
    // 多行同 identity（非重叠区间片段）不构成歧义。
    const c = makeIdentifier({
      securityId: "sec_A",
      code: "000001",
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
    });
    const d = makeIdentifier({
      securityId: "sec_A",
      code: "000001",
      effectiveFrom: "2000-01-01",
      effectiveTo: "2024-12-31",
    });
    expect(
      resolveSecurityIdsByEvent([makeEvent()], [d, c]).get("000001.SZ@2025-03-03"),
    ).toBe("sec_A");
  });

  it("D. symbol 无法解析成完整代码 ⇒ 抛错；裸 6 位码按既有前缀推断（不额外加码）", () => {
    expect(
      readErrorCode(() =>
        resolveSecurityIdsByEvent([makeEvent({ symbol: "NOT-A-CODE" })], [
          makeIdentifier({ securityId: "sec_A", code: "000001" }),
        ]),
      ),
    ).toBe("REGISTRY_SECURITY_IDENTITY_UNRESOLVED");
    // `parseSecurityCode` 对裸 6 位码走 `inferExchange`（既有语义：000001 → SZ），
    // 故 `000001` 与 `000001.SZ` 等价可用。
    expect(
      resolveSecurityIdsByEvent([makeEvent({ symbol: "000001" })], [
        makeIdentifier({ securityId: "sec_A", code: "000001" }),
      ]).get("000001.SZ@2025-03-03"),
    ).toBe("sec_A");
  });
});
