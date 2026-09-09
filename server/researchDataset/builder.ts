/**
 * STEP 12.6 — Research Dataset：构建器编排（C-12.6.1）。
 *
 * 流程：normalize+validate 请求 → DB 静态加载（B/C/D/F/G 全量 + calendar）
 *   → resolveUniverseDefinition（逐交易日 universe，PIT asOf）
 *   → 逐交易日批量拉 price/liquidity/index daily → assembleDayRows 组装标准行
 *   → data_snapshot（真实加载事实）→ policySet（§12 策略元数据，见 policy.ts）
 *   → dataset_version → gate。
 *
 * gate 语义（与 C-12.5.2 runAudit 同构）：
 *   - FAIL：dataReady=true 但存在覆盖缺口/限制命中（诚实：声明就绪却拿不出完整数据集）；
 *   - PASS：dataReady=true 且无缺口、rows>0；
 *   - INCONCLUSIVE：其余（dataReady=false 冒烟口径 / DB 不可用 / 域部分覆盖）。
 */

import { loadDateFacts, loadResearchDatasetStatic, type StaticDatasetLoad } from "./db";
import { buildStaticContexts, assembleDayRows } from "./assemble";
import { resolveUniverseDefinition } from "./universe";
import { computeDatasetVersion } from "./version";
import { derivePolicySet } from "./policy";
import { normalizeResearchDatasetRequest, validateNormalizedResearchDatasetRequest } from "./validate";
import { RESEARCH_DATASET_BUILDER_VERSION, RESEARCH_DATASET_ROW_SCHEMA_VERSION } from "./types";
import type {
  BuildResearchDatasetOptions,
  DataSnapshot,
  DomainSnapshot,
  NormalizedResearchDatasetRequest,
  ResearchDataset,
  ResearchDatasetGate,
  ResearchDatasetRequest,
  ResearchDatasetRow,
} from "./types";

/** 域顺序（快照输出确定性）。 */
const DOMAIN_ORDER = ["A OHLCV", "B Master", "C Status", "D CA", "E Liquidity", "F Index", "G Industry"] as const;

function countOverlappingIntervals(
  rows: readonly { effectiveFrom: string; effectiveTo: string | null }[],
  startDate: string,
  endDate: string,
): number {
  let count = 0;
  for (const row of rows) {
    if (row.effectiveFrom <= endDate && (row.effectiveTo === null || row.effectiveTo >= startDate)) count += 1;
  }
  return count;
}

function distinctSecurityCount(
  rows: readonly { securityId: string }[],
): number {
  return new Set(rows.map((row) => row.securityId)).size;
}

function buildDataSnapshot(
  load: StaticDatasetLoad,
  tradingDays: readonly string[],
  factsCounts: { tradeDate: string; price: number; liquidity: number; index: number }[],
  priceCodes: ReadonlySet<string>,
  liquidityCodes: ReadonlySet<string>,
  rowsBuilt: number,
  request: NormalizedResearchDatasetRequest,
  notes: { domain: string; note: string }[],
): DataSnapshot {
  const capturedAt = new Date().toISOString();
  const datesExpected = tradingDays.length;
  const priceDates = factsCounts.filter((f) => f.price > 0).length;
  const liquidityDates = factsCounts.filter((f) => f.liquidity > 0).length;
  const indexDates = factsCounts.filter((f) => f.index > 0).length;

  const domainRows: DomainSnapshot[] = [];
  const addDomain = (
    domain: string,
    rowsLoaded: number,
    securitiesCovered: number,
    datesCovered: number,
    note: string,
  ) => {
    domainRows.push({ domain, rowsLoaded, securitiesCovered, datesCovered, datesExpected, note });
  };

  addDomain(
    "A OHLCV",
    factsCounts.reduce((sum, f) => sum + f.price, 0),
    priceCodes.size,
    priceDates,
    "stock_daily_prices 逐日批量（raw 未复权）；code 键按完整代码计。A 域已 FULL（§44.1）",
  );
  addDomain(
    "B Master",
    load.securities.length,
    load.securities.length,
    datesExpected,
    "research_securities 全表加载（身份层，整窗口适用）",
  );
  addDomain(
    "C Status",
    countOverlappingIntervals(load.statusIntervals, request.startDate, request.endDate),
    distinctSecurityCount(load.statusIntervals),
    datesExpected,
    "research_security_status_history 区间与窗口重叠计数；未全量时 universe 成员受限（默认拒绝）",
  );
  addDomain(
    "D CA",
    load.corporateActions.filter((a) => a.effectiveDate <= request.endDate).length,
    new Set(load.corporateActions.filter((a) => a.effectiveDate <= request.endDate).map((a) => a.securityCode)).size,
    datesExpected,
    "corporate_actions effectiveDate<=endDate 的事件计数（announcementDate PIT 由 reconstruct 过滤）",
  );
  addDomain(
    "E Liquidity",
    factsCounts.reduce((sum, f) => sum + f.liquidity, 0),
    liquidityCodes.size,
    liquidityDates,
    "liquidity_daily 逐日批量；code 键按完整代码计。E 域回填中（§44.2 CODE_READY）",
  );
  addDomain(
    "F Index",
    factsCounts.reduce((sum, f) => sum + f.index, 0),
    load.indexMaster.length,
    indexDates,
    "index_daily 逐日批量（coreIndexCodes）",
  );
  addDomain(
    "G Industry",
    countOverlappingIntervals(load.industryAssignments, request.startDate, request.endDate),
    new Set(load.industryAssignments.map((a) => a.securityId)).size,
    datesExpected,
    "industry_assignments 区间与窗口重叠计数（归属按 securityId=完整代码计）",
  );

  // 域级附加说明（排序稳定）。
  for (const note of notes.sort((a, b) => a.domain.localeCompare(b.domain))) {
    const existing = domainRows.find((d) => d.domain === note.domain);
    if (existing) existing.note = `${existing.note}；${note.note}`;
  }

  const coverageGaps: string[] = [];
  for (const f of factsCounts) {
    if (f.price === 0) coverageGaps.push(`PRICE_MISSING_${f.tradeDate}`);
    if (f.index === 0) coverageGaps.push(`INDEX_MISSING_${f.tradeDate}`);
  }
  if (rowsBuilt === 0 && tradingDays.length > 0) coverageGaps.push("NO_ROWS_BUILT");

  return {
    capturedAt,
    request,
    calendarName: load.calendar?.name ?? "research-dataset-calendar",
    calendarFirstDate: load.calendar?.tradingDays[0] ?? "",
    calendarLastDate: load.calendar?.tradingDays[load.calendar.tradingDays.length - 1] ?? "",
    tradingDays: tradingDays.length,
    domains: domainRows,
    coverageGaps,
  };
}

/** 抛错式请求校验（供 CLI/上层断言；结构化校验见 validate.ts）。 */
function assertValidRequest(request: NormalizedResearchDatasetRequest): void {
  const issues = validateNormalizedResearchDatasetRequest(request);
  if (issues.length > 0) {
    throw new Error(`Research Dataset 请求非法：${issues.map((i) => `[${i.code}] ${i.message}`).join("；")}`);
  }
}

/**
 * 构建 Research Dataset。
 * @returns 完整产出物；DB 不可用（无 calendar/无 securities）时返回空 rows + INCONCLUSIVE。
 */
export async function buildResearchDataset(
  rawRequest: ResearchDatasetRequest,
  options: BuildResearchDatasetOptions = {},
): Promise<ResearchDataset> {
  const request = normalizeResearchDatasetRequest(rawRequest);
  assertValidRequest(request);
  const dataReady = options.dataReady ?? false;
  const maxTradingDays = options.maxTradingDays ?? Number.POSITIVE_INFINITY;
  const maxSecuritiesPerDay = options.maxSecuritiesPerDay ?? Number.POSITIVE_INFINITY;

  const staticLoad = await loadResearchDatasetStatic();
  const calendar = staticLoad.calendar;
  const notes: { domain: string; note: string }[] = [];

  // DB 不可用或日历为空 → 诚实 INCONCLUSIVE（不伪造空数据集为成功）。
  if (calendar === null || staticLoad.securities.length === 0) {
  const snapshot = buildDataSnapshot(staticLoad, [], [], new Set(), new Set(), 0, request, notes);
  snapshot.coverageGaps.push("DB_UNAVAILABLE_OR_EMPTY_CALENDAR");
  return {
      datasetVersion: computeDatasetVersion(request, { rule: "", asOfDescription: "", days: [] }, []),
      universeDefinition: { rule: "", asOfDescription: "", days: [] },
      policySet: derivePolicySet(request, snapshot),
      dataSnapshot: snapshot,
      rows: [],
      gate: "INCONCLUSIVE",
      gateNotes: ["DB 不可用或无交易日历（index_daily 为空），无法构建数据集"],
    };
  }

  const tradingDays = calendar.tradingDaysBetween(request.startDate, request.endDate);
  const limitedDates = tradingDays.slice(0, maxTradingDays);
  if (limitedDates.length < tradingDays.length) {
    notes.push({ domain: "A OHLCV", note: `maxTradingDays 限制：处理 ${limitedDates.length}/${tradingDays.length} 日` });
  }

  const universeDefinition = resolveUniverseDefinition(
    {
      securities: staticLoad.securities,
      identifiers: staticLoad.identifiers,
      statusIntervals: staticLoad.statusIntervals,
    },
    calendar,
    limitedDates,
    request,
  );

  const contexts = buildStaticContexts({
    securities: staticLoad.securities,
    identifiers: staticLoad.identifiers,
    statusIntervals: staticLoad.statusIntervals,
    industryAssignments: staticLoad.industryAssignments,
    corporateActions: staticLoad.corporateActions,
  });

  const rows: ResearchDatasetRow[] = [];
  const factsCounts: { tradeDate: string; price: number; liquidity: number; index: number }[] = [];
  const priceCodes = new Set<string>();
  const liquidityCodes = new Set<string>();
  let securitiesCappedHit = false;

  for (const day of universeDefinition.days) {
    const facts = await loadDateFacts(day.tradeDate, request.coreIndexCodes);
    for (const code of Array.from(facts.priceByCode.keys())) priceCodes.add(code);
    for (const code of Array.from(facts.liquidityByCode.keys())) liquidityCodes.add(code);
    factsCounts.push({
      tradeDate: day.tradeDate,
      price: facts.priceByCode.size,
      liquidity: facts.liquidityByCode.size,
      index: facts.indexBars.length,
    });
    const members = day.members;
    const limited = members.slice(0, maxSecuritiesPerDay);
    if (limited.length < members.length) securitiesCappedHit = true;
    const asOf = request.asOfPerTradeDate ? day.tradeDate : request.asOf;
    const dayRows = assembleDayRows(
      contexts,
      limited,
      day.tradeDate,
      asOf,
      facts.priceByCode,
      facts.liquidityByCode,
      facts.indexBars,
      staticLoad.indexMaster,
    );
    rows.push(...dayRows);
  }

  if (securitiesCappedHit) {
    notes.push({ domain: "A OHLCV", note: `maxSecuritiesPerDay 限制命中（单日仅处理前 ${maxSecuritiesPerDay} 成员）` });
  }

  const dataSnapshot = buildDataSnapshot(
    staticLoad,
    limitedDates,
    factsCounts,
    priceCodes,
    liquidityCodes,
    rows.length,
    request,
    notes,
  );
  const datasetVersion = computeDatasetVersion(request, universeDefinition, rows);
  const policySet = derivePolicySet(request, dataSnapshot);
  const gateNotes: string[] = [];
  let gate: ResearchDatasetGate;

  if (dataSnapshot.coverageGaps.length > 0) {
    gateNotes.push(`覆盖缺口：${dataSnapshot.coverageGaps.join(", ")}`);
    gate = dataReady ? "FAIL" : "INCONCLUSIVE";
    if (!dataReady) gateNotes.push("dataReady=false（冒烟口径）；缺口在 dataReady=true 时判 FAIL");
  } else if (rows.length === 0) {
    gateNotes.push("无行产出");
    gate = "INCONCLUSIVE";
  } else {
    gate = dataReady ? "PASS" : "INCONCLUSIVE";
    if (!dataReady) gateNotes.push("dataReady=false：构建成功但未声明数据链就绪，仅冒烟口径");
  }

  return {
    datasetVersion,
    universeDefinition,
    policySet,
    dataSnapshot,
    rows,
    gate,
    gateNotes,
  };
}

/** 导出构建器版本常量（供 CLI/报告引用）。 */
export { RESEARCH_DATASET_BUILDER_VERSION, RESEARCH_DATASET_ROW_SCHEMA_VERSION };
