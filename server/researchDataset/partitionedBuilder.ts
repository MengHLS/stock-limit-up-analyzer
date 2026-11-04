/**
 * STEP 12.6 — Research Dataset：分片（分区）构建器编排。
 *
 * 与 builder.ts（一次性全量进内存）的区别：把窗口按 chunkSize 切成若干时间分片，
 * 每片只加载该片的日级事实（价格/流动性/指数），构建出的标准行立即写入行表
 * （rd_rows_<buildKey>，见 rowsTable.ts），释放内存；静态上下文（securities/status/
 * industry/CA/calendar）仍只加载一次跨片复用。
 *
 * 正确性保证（PIT 铁律 + content-addressed 身份）：
 *   - 逐日循环与 builder.ts 完全一致（universe 决议 → 装配 → T 日条件过滤），
 *     prevLimitUp（首板判定的 T-1 涨停集合）在顺序构建时自然跨分片传递；
 *   - finalUniverseDefinition（含过滤后 members + excludedByReason）在分片构建时内存累积，
 *     直接参与指纹 —— 这是唯一正确来源，不从行表反推；
 *   - datasetVersion / rowsFingerprint 用「流式指纹」（computeDatasetFingerprintsStreaming）
 *     从行表逐行读出计算，内存 O(1)，且与一次性构建（同内容）产出完全一致；
 *   - 职责单一：本函数只做「分片构建 + 落库」（每次覆盖式重建行表）。读取复用（研究绑定
 *     从已建行表读回 rows）是独立读取路径，见 rowsTable.readRowsStreaming + persist.listResearchDatasets。
 *
 * 已知边界（诚实记录）：首板回踩筛选（pullback）依赖 T+1~T+N 跨日价格，暂不支持分片构建，
 *   传入时抛错拒绝（不静默降级）。
 */

import { loadDateFacts, loadResearchDatasetStatic } from "./db";
import { buildStaticContexts, assembleDayRows } from "./assemble";
import { resolveUniverseDefinition } from "./universe";
import { isRowLimitUp, matchesTDayCondition } from "./tDayFilter";
import { assertValidRequest, buildDataSnapshot } from "./builder";
import { computeDatasetFingerprintsStreaming } from "./version";
import { derivePolicySet } from "./policy";
import { normalizeResearchDatasetRequest } from "./validate";
import { computeBuildKey, rowsTableName } from "./buildKey";
import {
  countRows,
  dropRowsTable,
  ensureRowsTable,
  insertPartition,
  readRowsStreaming,
} from "./rowsTable";
import { persistPartitionedDataset } from "./persist";
import type {
  ResearchDatasetGate,
  ResearchDatasetRequest,
  ResearchDatasetRow,
  UniverseDayResult,
} from "./types";

/** 分片构建选项。 */
export interface PartitionedBuildOptions {
  /** 声明数据链已就绪（A~H 全 DATA_READY）；无覆盖缺口时 gate 才可 PASS。 */
  dataReady?: boolean;
  /** 单交易日最大处理证券数护栏（默认不限）。 */
  maxSecuritiesPerDay?: number;
  /** 每片交易日数（默认 20）。 */
  chunkSize?: number;
}

/** 分片构建结果。 */
export interface PartitionedBuildResult {
  buildKey: string;
  rowsTableName: string;
  datasetVersion: string;
  datasetId: string;
  rowCount: number;
  partitionCount: number;
  gate: ResearchDatasetGate;
  gateNotes: string[];
}

/** 把数组按固定大小切片（尾片不足 size 也保留）。 */
function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * 分片构建 Research Dataset 并落库（每数据集一张行表）。
 * @returns 构建结果（含 datasetVersion / datasetId / 行表名 / 行数）。
 */
export async function buildPartitionedDataset(
  rawRequest: ResearchDatasetRequest,
  options: PartitionedBuildOptions = {},
): Promise<PartitionedBuildResult> {
  const request = normalizeResearchDatasetRequest(rawRequest);
  assertValidRequest(request);
  const dataReady = options.dataReady ?? false;
  const maxSecuritiesPerDay = options.maxSecuritiesPerDay ?? Number.POSITIVE_INFINITY;
  const chunkSize = Math.max(1, options.chunkSize ?? 20);

  // 回踩筛选依赖跨日观察窗口，暂不支持分片（诚实拒绝，不静默降级）。
  if (request.universeFilter.pullback) {
    throw new Error("分片构建暂不支持首板回踩筛选（pullback）；请改用非分片 buildResearchDataset");
  }

  const buildKey = computeBuildKey(request);
  const tableName = rowsTableName(buildKey);

  const staticLoad = await loadResearchDatasetStatic();
  const calendar = staticLoad.calendar;

  // DB 不可用或日历为空 → 诚实 INCONCLUSIVE（不伪造空数据集为成功）。
  if (calendar === null || staticLoad.securities.length === 0) {
    return {
      buildKey,
      rowsTableName: tableName,
      datasetVersion: "",
      datasetId: "",
      rowCount: 0,
      partitionCount: 0,
      gate: "INCONCLUSIVE",
      gateNotes: ["DB 不可用或无交易日历（index_daily 为空），无法构建数据集"],
    };
  }

  const tradingDays = calendar.tradingDaysBetween(request.startDate, request.endDate);
  const notes: { domain: string; note: string }[] = [];

  // 全窗口 universe 决议（纯内存，逐日 PIT，不查 DB）。
  const universeDefinition = resolveUniverseDefinition(
    {
      securities: staticLoad.securities,
      identifiers: staticLoad.identifiers,
      statusIntervals: staticLoad.statusIntervals,
    },
    calendar,
    tradingDays,
    request,
  );
  const contexts = buildStaticContexts({
    securities: staticLoad.securities,
    identifiers: staticLoad.identifiers,
    statusIntervals: staticLoad.statusIntervals,
    industryAssignments: staticLoad.industryAssignments,
    corporateActions: staticLoad.corporateActions,
  });

  const tDayCondition = request.universeFilter.tDayCondition;

  // 覆盖式重建行表（同一 buildKey 重跑 = 重建）。
  await dropRowsTable(buildKey);
  await ensureRowsTable(buildKey);

  const dayChunks = chunkArray(universeDefinition.days, chunkSize);
  const factsCounts: { tradeDate: string; price: number; liquidity: number; index: number }[] = [];
  const finalDays: UniverseDayResult[] = [];
  const priceCodes = new Set<string>();
  const liquidityCodes = new Set<string>();
  let securitiesCappedHit = false;
  let prevLimitUpBySecurity = new Set<string>();

  for (let ci = 0; ci < dayChunks.length; ci += 1) {
    const chunkRows: ResearchDatasetRow[] = [];
    for (const day of dayChunks[ci]!) {
      const facts = await loadDateFacts(day.tradeDate, request.coreIndexCodes);
      for (const code of Array.from(facts.priceByCode.keys())) priceCodes.add(code);
      for (const code of Array.from(facts.liquidityByCode.keys())) liquidityCodes.add(code);
      factsCounts.push({
        tradeDate: day.tradeDate,
        price: facts.priceByCode.size,
        liquidity: facts.liquidityByCode.size,
        index: facts.indexBars.length,
      });

      const asOf = request.asOfPerTradeDate ? day.tradeDate : request.asOf;
      // 扫描集：T 日条件需遍历全 universe（否则会漏掉排序靠后的首板），故仅「无 T 日条件」时
      // 才在装配前截断（快路径）；有 T 日条件时先全量扫描、再对结果限流。
      const filterActive = tDayCondition !== "none";
      const scanMembers = filterActive
        ? day.members
        : day.members.slice(0, maxSecuritiesPerDay);
      if (!filterActive && scanMembers.length < day.members.length) securitiesCappedHit = true;

      const dayRows = assembleDayRows(
        contexts,
        scanMembers,
        day.tradeDate,
        asOf,
        facts.priceByCode,
        facts.liquidityByCode,
        facts.indexBars,
        staticLoad.indexMaster,
      );

      // T 日条件过滤（价格依赖，逐日滚动 prevLimitUp，PIT 安全）。
      const keptRows: ResearchDatasetRow[] = [];
      const keptMembers: string[] = [];
      const todayLimitUp = new Set<string>();
      let tDayExcluded = 0;
      for (const row of dayRows) {
        const limitUp = isRowLimitUp(row);
        if (limitUp) todayLimitUp.add(row.securityId);
        if (matchesTDayCondition(tDayCondition, limitUp, prevLimitUpBySecurity.has(row.securityId))) {
          keptRows.push(row);
          keptMembers.push(row.securityId);
        } else {
          tDayExcluded += 1;
        }
      }

      // 结果限流（对过滤后的最终行集生效）。
      const finalRows = keptRows.slice(0, maxSecuritiesPerDay);
      const finalMembers = keptMembers.slice(0, maxSecuritiesPerDay);
      if (keptRows.length > maxSecuritiesPerDay) securitiesCappedHit = true;
      chunkRows.push(...finalRows);

      const excludedByReason: Record<string, number> = { ...day.excludedByReason };
      if (tDayExcluded > 0) {
        excludedByReason.TDAY_CONDITION_EXCLUDED =
          (excludedByReason.TDAY_CONDITION_EXCLUDED ?? 0) + tDayExcluded;
      }
      finalDays.push({ ...day, members: finalMembers, excludedByReason });

      prevLimitUpBySecurity.clear();
      for (const id of todayLimitUp) prevLimitUpBySecurity.add(id);
    }

    // 本片写完，立即落表（释放内存）；partitionSeq = 片序号，供断点续跑判断。
    await insertPartition(buildKey, ci, chunkRows);
  }

  if (securitiesCappedHit) {
    notes.push({ domain: "A OHLCV", note: `maxSecuritiesPerDay 限制命中（单日结果截断至前 ${maxSecuritiesPerDay} 行）` });
  }
  if (dayChunks.length > 1) {
    notes.push({ domain: "A OHLCV", note: `分片构建：${dayChunks.length} 片 × 每片 ≤${chunkSize} 交易日` });
  }

  // 过滤后 universe 定义（与 builder.ts 一致：T 日条件 append 到 rule）。
  const finalUniverseDefinition = {
    ...universeDefinition,
    rule:
      tDayCondition !== "none"
        ? `${universeDefinition.rule}；T日条件=${tDayCondition}`
        : universeDefinition.rule,
    days: finalDays,
  };

  const rowCount = await countRows(buildKey);
  const dataSnapshot = buildDataSnapshot(
    staticLoad,
    tradingDays,
    factsCounts,
    priceCodes,
    liquidityCodes,
    rowCount,
    request,
    notes,
  );
  const policySet = derivePolicySet(request, dataSnapshot);

  // 流式指纹：从行表逐行读出（确定性排序），内存 O(1)。
  const fingerprints = await computeDatasetFingerprintsStreaming(
    request,
    finalUniverseDefinition,
    readRowsStreaming(buildKey),
  );

  // gate 判定（与 builder.ts 同构）。
  const gateNotes: string[] = [];
  let gate: ResearchDatasetGate;
  if (dataSnapshot.coverageGaps.length > 0) {
    gateNotes.push(`覆盖缺口：${dataSnapshot.coverageGaps.join(", ")}`);
    gate = dataReady ? "FAIL" : "INCONCLUSIVE";
    if (!dataReady) gateNotes.push("dataReady=false（冒烟口径）；缺口在 dataReady=true 时判 FAIL");
  } else if (rowCount === 0) {
    gateNotes.push("无行产出");
    gate = "INCONCLUSIVE";
  } else {
    gate = dataReady ? "PASS" : "INCONCLUSIVE";
    if (!dataReady) gateNotes.push("dataReady=false：构建成功但未声明数据链就绪，仅冒烟口径");
  }

  // 落库（分片版，带 rowsTableName + 流式指纹）。
  const persisted = await persistPartitionedDataset({
    request,
    universeDefinition: finalUniverseDefinition,
    dataSnapshot,
    policySet,
    datasetVersion: fingerprints.datasetVersion,
    rowsFingerprint: fingerprints.rowsFingerprint,
    rowsTableName: tableName,
    rowCount,
    gate,
    gateNotes,
  });

  return {
    buildKey,
    rowsTableName: tableName,
    datasetVersion: fingerprints.datasetVersion,
    datasetId: persisted.datasetId,
    rowCount,
    partitionCount: dayChunks.length,
    gate,
    gateNotes,
  };
}
