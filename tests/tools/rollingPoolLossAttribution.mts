/**
 * `FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001` —— **事后**漏选 / 卖出过早归因工具。
 *
 * ```bash
 * node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs \
 *   tests/tools/rollingPoolLossAttribution.mts
 * ```
 *
 * ## 它做什么
 *
 * 读**已持久化**的 `RUN-20261010-572243F5` 产物（经 `readArtifact(runId, key)`，key 含角色前缀）
 * + Dataset `780004` 的**只读**未来行情，按冻结规格算出五组的：
 *   - 标签 `BIG50_ACTIONABLE` / `BIG50_PATH`（事后口径，**绝不回流**）；
 *   - 8 桶互斥漏斗（首次命中即止）；
 *   - `S7` 的「让出多少」逐笔量化、`S6` 的 `skipCode` 分布、`S1`↔`S6c` 交叉表。
 *
 * ## 它**不**做什么（硬边界）
 *
 *   - **不重跑任何实验**（复用持久化产物）；行情只做 `SELECT`（只读，**绝不写库**）；
 *   - 不碰 `server/**` 执行语义、不碰历史 Run / Dataset / 策略版本、不新增实验或引擎；
 *   - 不据归因结果反改任何规则、阈值、N/L、TopK、仓位或退出参数。
 *
 * ## 两个口径（**必须一起读**）
 *
 * 1. `SPEC_TRIGGER_DAYS`（**规格 §3.1 字面口径**，报告主口径）：
 *    主标签只在该组 `candidate-days`（真实触发日）上判定；
 * 2. `EXTENDED_POOL_DAYS`（**本任务显式声明的扩展，偏离 D1**）：
 *    主标签在本组**确认区间内**的观察账日上判定 ⇒ 「从未触发」的锚点也能被标成机会，
 *    否则规格 §4 的 `S1` / `S2` / `S3` 在结构上不可能有成员（见报告 §4）。
 *
 * 两个口径共用同一套标签函数、排序与 8 桶判定，唯一差别是**准入集合**。
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { defaultExperimentRunService } from "../../server/researchExperiments/defaults";
import {
  booleanOrNull,
  numberOrNull,
  numberRequired,
  parseCsvTable,
  textOrNull,
  toCsvText,
} from "../../research-experiments/shared/rollingPoolLossAttribution/csv";
import {
  ACTIONABLE_HOLDING_DAYS,
  BIG50_THRESHOLD,
  BIG100_THRESHOLD,
  BUCKET_IDS,
  LOSS_ATTRIBUTION_VERSION,
  RANK_TIE_BREAK_KEY,
  confirmMaxRdOf,
  confirmMinRdOf,
  type CandidateDayRow,
  type ClassificationResult,
  type FailedAttemptRow,
  type ForwardBar,
  type ForwardBars,
  type FunnelAggregate,
  type GroupSpecLite,
  type ObservationLedgerRow,
  type OpportunityLabel,
  type PrimaryRejection,
  type S6SubBucketId,
  type TradeRow,
  type TriggerSelection,
} from "../../research-experiments/shared/rollingPoolLossAttribution/types";
import {
  aggregateFunnel,
  buildOpportunityLabel,
  classifyOpportunity,
  coOccurrenceOf,
  derivePrimaryRejection,
  describeStats,
  exitReasonBucketOf,
  firstActionableEntryDay,
  isFunnelOpportunity,
  labelEntryDay,
  pathLabel,
  rankCandidatesPerDay,
  summarizeGiveUp,
  tradeForwardRows,
  triggerSelectionOf,
} from "../../research-experiments/shared/rollingPoolLossAttribution/funnel";

// ---------------------------------------------------------------------------
// 0) 冻结坐标（**只读**；不由本工具改写任何东西）
// ---------------------------------------------------------------------------

const EXPERIMENT_ID = "first-board-pullback/rolling-pool-observation-window";
const RUN_ID = "RUN-20261010-572243F5";
const DATASET_VERSION_ID = 780_004;
const RUN_PREFIX = `experiments/${EXPERIMENT_ID}/runs/${RUN_ID}`;
const OUT_DIR = new URL("../../_scratch/fbp3/", import.meta.url);
/** 主决策窗口（与 003 Run 的 `MAIN_WINDOW` 同源；用于扩展口径的「当日在窗口内」判据）。 */
const MAIN_WINDOW_START = "2024-01-02";
const MAIN_WINDOW_END = "2025-09-30";
/** 只读行情的相对日范围：`fill ≤ 20`，`+20 ⇒ ≤ 40`（多取一日作边界保险）。 */
const PRICE_RD_MIN = 1;
const PRICE_RD_MAX = 41;

/** 五组冻结矩阵（数值与 `rolling-pool-observation-window/result.ts#GROUPS` 同源）。 */
const GROUPS: readonly GroupSpecLite[] = Object.freeze([
  { id: "A", observationDays: 2, entryFillMaxRd: 10, reentryKind: "SIGNAL_REENTRY" },
  { id: "B", observationDays: 2, entryFillMaxRd: 20, reentryKind: "SIGNAL_REENTRY" },
  { id: "C", observationDays: 3, entryFillMaxRd: 20, reentryKind: "SIGNAL_REENTRY" },
  { id: "D", observationDays: 5, entryFillMaxRd: 20, reentryKind: "SIGNAL_REENTRY" },
  { id: "E", observationDays: 5, entryFillMaxRd: 20, reentryKind: "SINGLE_ENTRY" },
]);

type Universe = "SPEC_TRIGGER_DAYS" | "EXTENDED_POOL_DAYS";
const UNIVERSES: readonly Universe[] = Object.freeze(["SPEC_TRIGGER_DAYS", "EXTENDED_POOL_DAYS"]);

let pendingExitCode = 0;
const warnings: string[] = [];
function fail(message: string): void {
  console.error(`[attribution] ✗ ${message}`);
  pendingExitCode = 1;
  warnings.push(message);
}
function log(message: string): void {
  console.log(`[attribution] ${message}`);
}
function pct(value: number | null, digits = 2): string {
  return value === null ? "n/a" : `${value.toFixed(digits)}%`;
}

// ---------------------------------------------------------------------------
// 1) 读产物（**只经 readArtifact**，key 含 tables/ 角色前缀）
// ---------------------------------------------------------------------------

const service = defaultExperimentRunService();
const detail = await service.readRunDetail(RUN_ID);
log(`run=${RUN_ID} experiment=${EXPERIMENT_ID} status=${detail.run.status} artifacts=${detail.artifacts.length}`);
const availableKeys = new Set(detail.artifacts.map((item) => item.ref.key));

async function readTable(name: string): Promise<Record<string, string>[]> {
  const key = `${RUN_PREFIX}/tables/${name}`;
  if (!availableKeys.has(key)) throw new Error(`产物缺失：${key}`);
  const got = await service.readArtifact(RUN_ID, key);
  return parseCsvTable(got.body.toString("utf8"), name);
}

const OBSERVATION_YEARS = [2023, 2024, 2025] as const;

const candidateTables = new Map<string, Record<string, string>[]>();
const tradeTables = new Map<string, Record<string, string>[]>();
const failedTables = new Map<string, Record<string, string>[]>();
const exclusionTables = new Map<string, Record<string, string>[]>();
const p3Tables = new Map<string, Record<string, string>[]>();
for (const group of GROUPS) {
  candidateTables.set(group.id, await readTable(`group-${group.id}-candidate-days.csv`));
  tradeTables.set(group.id, await readTable(`group-${group.id}-trades-R.csv`));
  failedTables.set(group.id, await readTable(`group-${group.id}-reentry-failed-attempts.csv`));
  exclusionTables.set(group.id, await readTable(`group-${group.id}-exclusion-ledger.csv`));
  p3Tables.set(group.id, await readTable(`group-${group.id}-p3-ranking-diagnostics.csv`));
}
const poolDailySummary = await readTable("pool-daily-summary.csv");
const observationTables: Record<string, string>[][] = [];
for (const year of OBSERVATION_YEARS) {
  observationTables.push(await readTable(`observation-ledger-${year}.csv`));
}
log(`产物已读：candidate/trades/failed/exclusion/p3 × ${GROUPS.length} 组 + pool-daily-summary + observation-ledger×${OBSERVATION_YEARS.length}`);

// ---------------------------------------------------------------------------
// 2) 解析（**引号感知**；错列即抛错，不静默错位）
// ---------------------------------------------------------------------------

function toCandidateRow(row: Record<string, string>, source: string): CandidateDayRow {
  return {
    date: row.date as string,
    anchorEventId: row.anchorEventId as string,
    symbol: row.symbol as string,
    securityId: row.securityId as string,
    eventAge: numberRequired(row.eventAge, `${source}.eventAge`),
    confirmRd: numberRequired(row.confirmRd, `${source}.confirmRd`),
    fillRd: numberRequired(row.fillRd, `${source}.fillRd`),
    fillDate: textOrNull(row.fillDate),
    preReturn10: numberOrNull(row.preReturn10, `${source}.preReturn10`),
    triggerOrdinal: numberRequired(row.triggerOrdinal, `${source}.triggerOrdinal`),
    isLaterTriggerDay: row.isLaterTriggerDay === "true",
  };
}

function toTradeRow(row: Record<string, string>, source: string): TradeRow {
  return {
    securityId: row.securityId as string,
    anchorEventId: row.anchorEventId as string,
    symbol: row.symbol as string,
    entryTime: row.entryTime as string,
    entryPrice: numberRequired(row.entryPrice, `${source}.entryPrice`),
    exitTime: textOrNull(row.exitTime),
    exitPrice: numberOrNull(row.exitPrice, `${source}.exitPrice`),
    quantity: numberRequired(row.quantity, `${source}.quantity`),
    returnPct: numberRequired(row.returnPct, `${source}.returnPct`),
    netPnl: numberRequired(row.netPnl, `${source}.netPnl`),
    fees: numberRequired(row.fees, `${source}.fees`),
    holdingPeriod: numberRequired(row.holdingPeriod, `${source}.holdingPeriod`),
    openAtEnd: row.openAtEnd === "true",
    reason: row.reason as string,
  };
}

function toFailedRow(row: Record<string, string>, source: string): FailedAttemptRow {
  return {
    accountId: row.accountId as string,
    group: row.group as string,
    anchorEventId: row.anchorEventId as string,
    symbol: row.symbol as string,
    attemptedConfirmDate: row.attemptedConfirmDate as string,
    plannedFillDate: textOrNull(row.plannedFillDate),
    skipCode: row.skipCode as string,
    reason: row.reason as string,
    priorEntryOrdinalActual: numberOrNull(row.priorEntryOrdinalActual, `${source}.priorEntryOrdinalActual`),
    priorActualExitDate: textOrNull(row.priorActualExitDate),
  };
}

function toObservationRow(row: Record<string, string>, source: string): ObservationLedgerRow {
  const triggerGroups = textOrNull(row.triggerGroups);
  return {
    anchorEventId: row.anchorEventId as string,
    symbol: row.symbol as string,
    eventDate: row.eventDate as string,
    relativeDay: numberRequired(row.relativeDay, `${source}.relativeDay`),
    tradeDate: textOrNull(row.tradeDate),
    support: numberOrNull(row.support, `${source}.support`),
    shrink: numberOrNull(row.shrink, `${source}.shrink`),
    lowStable: numberOrNull(row.lowStable, `${source}.lowStable`),
    closeImprove: numberOrNull(row.closeImprove, `${source}.closeImprove`),
    score: numberOrNull(row.score, `${source}.score`),
    missingReason: textOrNull(row.missingReason),
    supportBreached: booleanOrNull(row.supportBreached, `${source}.supportBreached`),
    triggerGroups: triggerGroups === null ? [] : triggerGroups.split("|"),
    isCandidateAnchor: row.isCandidateAnchor === "true",
  };
}

const obsByAnchor = new Map<string, ObservationLedgerRow[]>();
let observationRowCount = 0;
for (const table of observationTables) {
  for (const row of table) {
    const parsed = toObservationRow(row, "observation-ledger");
    const list = obsByAnchor.get(parsed.anchorEventId) ?? [];
    list.push(parsed);
    obsByAnchor.set(parsed.anchorEventId, list);
    observationRowCount += 1;
  }
}
for (const list of obsByAnchor.values()) list.sort((left, right) => left.relativeDay - right.relativeDay);
log(`观察账：${obsByAnchor.size} 个锚点 / ${observationRowCount} 行`);

interface GroupData {
  readonly spec: GroupSpecLite;
  readonly candidateRows: readonly CandidateDayRow[];
  readonly trades: readonly TradeRow[];
  readonly failedRows: readonly FailedAttemptRow[];
  readonly tradesByAnchor: ReadonlyMap<string, readonly TradeRow[]>;
  readonly failedByAnchor: ReadonlyMap<string, readonly FailedAttemptRow[]>;
  readonly exclusion: readonly Record<string, string>[];
  readonly p3: Record<string, string>;
}

const groupData = new Map<string, GroupData>();
for (const spec of GROUPS) {
  const candidateRows = (candidateTables.get(spec.id) ?? []).map((row) =>
    toCandidateRow(row, `group-${spec.id}-candidate-days`),
  );
  const trades = (tradeTables.get(spec.id) ?? []).map((row) => toTradeRow(row, `group-${spec.id}-trades-R`));
  const failedRows = (failedTables.get(spec.id) ?? []).map((row) =>
    toFailedRow(row, `group-${spec.id}-reentry-failed-attempts`),
  );
  const rAccountId = `${spec.id}#0`;
  const tradesByAnchor = new Map<string, TradeRow[]>();
  for (const trade of trades) {
    const list = tradesByAnchor.get(trade.anchorEventId) ?? [];
    list.push(trade);
    tradesByAnchor.set(trade.anchorEventId, list);
  }
  const failedByAnchor = new Map<string, FailedAttemptRow[]>();
  for (const failed of failedRows) {
    if (failed.accountId !== rAccountId) continue;
    const list = failedByAnchor.get(failed.anchorEventId) ?? [];
    list.push(failed);
    failedByAnchor.set(failed.anchorEventId, list);
  }
  groupData.set(spec.id, {
    spec,
    candidateRows,
    trades,
    failedRows,
    tradesByAnchor,
    failedByAnchor,
    exclusion: exclusionTables.get(spec.id) ?? [],
    p3: (p3Tables.get(spec.id) ?? [])[0] ?? {},
  });
  log(
    `组 ${spec.id}：N=${spec.observationDays} L=${spec.entryFillMaxRd} / `
    + `候选行 ${candidateRows.length} / R 成交 ${trades.length} / R 被阻断尝试 ${[...failedByAnchor.values()].reduce((sum, list) => sum + list.length, 0)}`,
  );
}

// ---------------------------------------------------------------------------
// 3) 只读行情（`ds_first_limit_pullback_post` rd1..41 + `prefix` rd0 收盘）
// ---------------------------------------------------------------------------

const eventIds = [...obsByAnchor.keys()].sort();
const barsByAnchor = new Map<string, ForwardBars>();
const rd0CloseByAnchor = new Map<string, number>();

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  fail("缺少 DATABASE_URL（只读行情无法读取）。");
} else {
  const connection = await mysql.createConnection({ uri: databaseUrl, dateStrings: true });
  const selectOnly = async (sql: string, params: readonly unknown[]): Promise<unknown[]> => {
    if (!sql.trimStart().toUpperCase().startsWith("SELECT")) {
      throw new Error(`只读纪律：本工具只允许 SELECT，拒绝执行「${sql.slice(0, 24)}…」`);
    }
    const [rows] = await connection.query(sql, params as unknown[]);
    return rows as unknown[];
  };
  const chunkSize = 2_000;
  for (let start = 0; start < eventIds.length; start += chunkSize) {
    const slice = eventIds.slice(start, start + chunkSize);
    const placeholders = slice.map(() => "?").join(",");
    const postRows = await selectOnly(
      `SELECT eventId, relativeDay, tradeDate, open, high, low, close
         FROM ds_first_limit_pullback_post
        WHERE datasetVersionId = ? AND relativeDay BETWEEN ? AND ? AND eventId IN (${placeholders})`,
      [DATASET_VERSION_ID, PRICE_RD_MIN, PRICE_RD_MAX, ...slice],
    );
    for (const raw of postRows) {
      const row = raw as {
        eventId: string;
        relativeDay: number;
        tradeDate: string | null;
        open: number | null;
        high: number | null;
        low: number | null;
        close: number | null;
      };
      const map =
        (barsByAnchor.get(row.eventId) as Map<number, ForwardBar> | undefined)
        ?? new Map<number, ForwardBar>();
      map.set(Number(row.relativeDay), {
        relativeDay: Number(row.relativeDay),
        tradeDate: row.tradeDate ?? null,
        open: row.open === null ? null : Number(row.open),
        high: row.high === null ? null : Number(row.high),
        low: row.low === null ? null : Number(row.low),
        close: row.close === null ? null : Number(row.close),
      });
      barsByAnchor.set(row.eventId, map);
    }
    const prefixRows = await selectOnly(
      `SELECT eventId, close FROM ds_first_limit_pullback_prefix
        WHERE datasetVersionId = ? AND relativeDay = 0 AND eventId IN (${placeholders})`,
      [DATASET_VERSION_ID, ...slice],
    );
    for (const raw of prefixRows) {
      const row = raw as { eventId: string; close: number | null };
      if (row.close !== null && Number.isFinite(Number(row.close))) {
        rd0CloseByAnchor.set(row.eventId, Number(row.close));
      }
    }
  }
  await connection.end();
  log(
    `只读行情：${barsByAnchor.size} 个锚点的 rd${PRICE_RD_MIN}..${PRICE_RD_MAX} 收盘 + `
    + `${rd0CloseByAnchor.size} 个锚点的 close(rd0)（**未写库**）`,
  );
}

// ---------------------------------------------------------------------------
// 4) 机会构建 + 分类（两个口径共用同一套判定）
// ---------------------------------------------------------------------------

/** 池级别的背景标签计数（锚点级、与组无关；规格 §3.2 / §3.3）。 */
let pooledBig50PathCount = 0;
let pooledBig100PathCount = 0;
for (const anchorEventId of obsByAnchor.keys()) {
  const bars = barsByAnchor.get(anchorEventId);
  if (bars === undefined) continue;
  const rd0Close = rd0CloseByAnchor.get(anchorEventId) ?? null;
  if (pathLabel(bars, rd0Close, BIG50_THRESHOLD).reached) pooledBig50PathCount += 1;
  if (pathLabel(bars, rd0Close, BIG100_THRESHOLD).reached) pooledBig100PathCount += 1;
}
log(
  `池级背景标签：锚点 ${obsByAnchor.size} / BIG50_PATH ${pooledBig50PathCount} / BIG100_PATH ${pooledBig100PathCount}`,
);

interface OpportunityRecord {
  readonly group: string;
  readonly universe: Universe;
  readonly anchorEventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly label: OpportunityLabel;
  readonly triggerDays: readonly CandidateDayRow[];
  readonly actionableRow: CandidateDayRow | null;
  readonly rejection: PrimaryRejection | null;
  readonly selection: TriggerSelection;
  readonly trades: readonly TradeRow[];
  readonly failedAttempts: readonly FailedAttemptRow[];
  readonly classification: ClassificationResult;
  readonly primarySkipCode: string | null;
}

interface UniverseResult {
  readonly universe: Universe;
  readonly opportunities: readonly OpportunityRecord[];
  readonly funnel: FunnelAggregate;
  readonly universeCandidateCount: number;
  readonly pathHitAmongUniverse: number;
  readonly pathOnlyCount: number;
  readonly primaryRejectionCounts: Readonly<Record<string, number>>;
}

function allowedObservationDays(
  spec: GroupSpecLite,
  rows: readonly ObservationLedgerRow[],
): ObservationLedgerRow[] {
  const min = confirmMinRdOf(spec);
  const max = confirmMaxRdOf(spec);
  return rows.filter(
    (row) =>
      row.relativeDay >= min
      && row.relativeDay <= max
      && row.tradeDate !== null
      && row.tradeDate >= MAIN_WINDOW_START
      && row.tradeDate <= MAIN_WINDOW_END,
  );
}

function buildUniverse(
  spec: GroupSpecLite,
  data: GroupData,
  ranking: ReturnType<typeof rankCandidatesPerDay>,
  universe: Universe,
): UniverseResult {
  const byAnchor = new Map<string, CandidateDayRow[]>();
  for (const row of data.candidateRows) {
    const list = byAnchor.get(row.anchorEventId) ?? [];
    list.push(row);
    byAnchor.set(row.anchorEventId, list);
  }
  const anchorSet = new Set<string>();
  if (universe === "SPEC_TRIGGER_DAYS") {
    for (const anchorEventId of byAnchor.keys()) anchorSet.add(anchorEventId);
  } else {
    for (const anchorEventId of obsByAnchor.keys()) anchorSet.add(anchorEventId);
  }

  const opportunities: OpportunityRecord[] = [];
  let pathHitAmongUniverse = 0;
  let pathOnlyCount = 0;
  const rejectionCounts: Record<string, number> = {};

  for (const anchorEventId of [...anchorSet].sort()) {
    const observationRows = obsByAnchor.get(anchorEventId) ?? [];
    if (observationRows.length === 0) continue;
    const bars = barsByAnchor.get(anchorEventId);
    if (bars === undefined) continue;
    const triggerDays = [...(byAnchor.get(anchorEventId) ?? [])].sort(
      (left, right) => left.confirmRd - right.confirmRd,
    );
    const triggerConfirmRds = [...new Set(triggerDays.map((row) => row.confirmRd))].sort(
      (left, right) => left - right,
    );
    const allowedRds = allowedObservationDays(spec, observationRows).map((row) => row.relativeDay);
    /**
     * 🔴 扩展口径（偏离 D1）**只加机会，不改**已触发锚点的可入场日参照：
     *   若该锚点存在「触发日即达标」的情形 ⇒ 与 SPEC 口径**逐字节相同**；
     *   否则退回到「本组确认区间内的观察账日」。
     *   只有这样，扩展漏斗才等于「SPEC 漏斗 + 新增机会」，而不是把已成交的机会
     *   误判成「不可排序」（`S4` 会吞掉 `S5`/`S6`/`S7`/`X`）。
     */
    const labelInputDays =
      universe === "SPEC_TRIGGER_DAYS"
        ? triggerConfirmRds
        : triggerConfirmRds.some((confirmRd) => labelEntryDay(bars, confirmRd, BIG50_THRESHOLD).reached)
          ? triggerConfirmRds
          : allowedRds;
    if (labelInputDays.length === 0) continue;

    const label = buildOpportunityLabel({
      bars,
      rd0Close: rd0CloseByAnchor.get(anchorEventId) ?? null,
      candidateConfirmRds: labelInputDays,
    });
    if (label.big50Path.reached) pathHitAmongUniverse += 1;
    if (!isFunnelOpportunity(label)) {
      if (label.big50Path.reached) pathOnlyCount += 1;
      continue;
    }
    const actionable = label.actionableDay;
    if (actionable === null) continue;
    const actionableRow = triggerDays.find((row) => row.confirmRd === actionable.confirmRd) ?? null;
    const rejection =
      triggerDays.length === 0
        ? derivePrimaryRejection({
            spec,
            observationRows,
            bars,
            rd0Close: rd0CloseByAnchor.get(anchorEventId) ?? null,
          })
        : null;
    if (rejection !== null) {
      rejectionCounts[rejection.code] = (rejectionCounts[rejection.code] ?? 0) + 1;
    }
    const selection = triggerSelectionOf({
      anchorEventId,
      triggerDays,
      ranking,
      actionableDate: actionableRow?.date ?? null,
    });
    const trades = data.tradesByAnchor.get(anchorEventId) ?? [];
    const failedAttempts = data.failedByAnchor.get(anchorEventId) ?? [];
    const classification = classifyOpportunity({
      group: spec.id,
      anchorEventId,
      symbol: (triggerDays[0]?.symbol ?? observationRows[0]?.symbol ?? anchorEventId.split("@")[0]) as string,
      eventDate: observationRows[0]?.eventDate ?? "",
      label,
      triggerDays,
      actionableRow,
      observationRows,
      rejection,
      selection,
      trades,
      failedAttempts,
    });
    const firstFailed = [...failedAttempts].sort((left, right) =>
      left.attemptedConfirmDate.localeCompare(right.attemptedConfirmDate),
    )[0];
    opportunities.push({
      group: spec.id,
      universe,
      anchorEventId,
      symbol: (triggerDays[0]?.symbol ?? observationRows[0]?.symbol ?? anchorEventId.split("@")[0]) as string,
      eventDate: observationRows[0]?.eventDate ?? "",
      label,
      triggerDays,
      actionableRow,
      rejection,
      selection,
      trades,
      failedAttempts,
      classification,
      primarySkipCode: firstFailed?.skipCode ?? null,
    });
  }

  opportunities.sort(
    (left, right) => left.anchorEventId.localeCompare(right.anchorEventId),
  );
  return {
    universe,
    opportunities,
    funnel: aggregateFunnel(opportunities.map((item) => item.classification)),
    universeCandidateCount: anchorSet.size,
    pathHitAmongUniverse,
    pathOnlyCount,
    primaryRejectionCounts: rejectionCounts,
  };
}

interface GroupResult {
  readonly group: string;
  readonly spec: GroupSpecLite;
  readonly rankingBoundaryTieDayCount: number;
  readonly universes: ReadonlyMap<Universe, UniverseResult>;
  readonly s7GiveUpRows: readonly ReturnType<typeof tradeForwardRows>[number][];
  readonly s7GiveUpSummary: ReturnType<typeof summarizeGiveUp>;
  readonly extendedS7GiveUpSummary: ReturnType<typeof summarizeGiveUp>;
  readonly crossChecks: readonly CrossCheck[];
}

interface CrossCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const groupResults = new Map<string, GroupResult>();
for (const spec of GROUPS) {
  const data = groupData.get(spec.id) as GroupData;
  const ranking = rankCandidatesPerDay(data.candidateRows);
  const universes = new Map<Universe, UniverseResult>();
  for (const universe of UNIVERSES) {
    universes.set(universe, buildUniverse(spec, data, ranking, universe));
  }

  // S7 让出量化：**主口径**（SPEC_TRIGGER_DAYS）× S7 桶的机会，逐笔算。
  const specUniverse = universes.get("SPEC_TRIGGER_DAYS") as UniverseResult;
  const s7Trades = specUniverse.opportunities
    .filter((item) => item.classification.bucket === "S7_BOUGHT_EXITED_EARLY")
    .flatMap((item) => [...item.trades]);
  const s7GiveUpRows = tradeForwardRows({
    group: spec.id,
    trades: s7Trades,
    barsByAnchor,
    holdingDays: ACTIONABLE_HOLDING_DAYS,
  });
  const s7GiveUpSummary = summarizeGiveUp(s7GiveUpRows);
  const extendedUniverse = universes.get("EXTENDED_POOL_DAYS") as UniverseResult;
  const extendedS7Trades = extendedUniverse.opportunities
    .filter((item) => item.classification.bucket === "S7_BOUGHT_EXITED_EARLY")
    .flatMap((item) => [...item.trades]);
  const extendedS7GiveUpSummary = summarizeGiveUp(
    tradeForwardRows({ group: spec.id, trades: extendedS7Trades, barsByAnchor, holdingDays: ACTIONABLE_HOLDING_DAYS }),
  );
  // ---- 对账（**只读交叉校验**，不参与任何判定） ----
  const crossChecks: CrossCheck[] = [];
  const triggerDayCount = Number(
    data.exclusion.find((row) => row.layer === "candidate" && row.code === "TRIGGER_DAY")?.count ?? "NaN",
  );
  const droppedAtSignal = data.exclusion
    .filter((row) => row.layer === "signal")
    .reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  crossChecks.push({
    name: "候选行数 = exclusion-ledger(candidate/TRIGGER_DAY) − signal 层丢弃",
    ok: triggerDayCount - droppedAtSignal === data.candidateRows.length,
    detail:
      `candidate-days ${data.candidateRows.length} = TRIGGER_DAY ${triggerDayCount} − signal 丢弃 ${droppedAtSignal}`
      + `（` + data.exclusion
        .filter((row) => row.layer === "signal")
        .map((row) => `${row.code}=${row.count}`)
        .join("+") + `）；`
      + "🔴 这些被丢弃的触发日**只有计数、没有 rd** ⇒ SPEC 口径下 S4 无法逐机会定位。",
  });

  const ledgerTriggerKeys = new Set<string>();
  for (const [anchorEventId, rows] of obsByAnchor) {
    for (const row of rows) {
      if (row.triggerGroups.includes(spec.id)) ledgerTriggerKeys.add(`${anchorEventId}|${row.relativeDay}`);
    }
  }
  const candidateKeys = new Set(data.candidateRows.map((row) => `${row.anchorEventId}|${row.confirmRd}`));
  const onlyLedger = [...ledgerTriggerKeys].filter((key) => !candidateKeys.has(key));
  const onlyCandidate = [...candidateKeys].filter((key) => !ledgerTriggerKeys.has(key));
  crossChecks.push({
    name: "observation-ledger.triggerGroups ↔ candidate-days 确认日集合",
    ok: onlyLedger.length === 0 && onlyCandidate.length === 0,
    detail:
      `ledger ${ledgerTriggerKeys.size} / candidate ${candidateKeys.size}；`
      + `仅 ledger ${onlyLedger.length}（样例 ${onlyLedger.slice(0, 3).join(";") || "-"}）；`
      + `仅 candidate ${onlyCandidate.length}（样例 ${onlyCandidate.slice(0, 3).join(";") || "-"}）`,
  });

  const perDaySelected = [...ranking.topKAnchors.values()].reduce((sum, set) => sum + set.size, 0);
  const rSelectedTotal = poolDailySummary.reduce((sum, row) => sum + Number(row.rSelected ?? 0), 0);
  crossChecks.push({
    name: "逐日 TopK 选中数 = pool-daily-summary.rSelected 合计（该列仅代表 basePlanning = B）",
    ok: spec.id !== "B" ? true : perDaySelected === rSelectedTotal,
    detail: `本组 TopK 合计 ${perDaySelected} vs rSelected 合计 ${rSelectedTotal}（rSelected 由 basePlanning=B 生成）`,
  });

  const p3Candidates = Number(data.p3.candidateRowCount ?? "NaN");
  const p3Days = Number(data.p3.candidateDayCount ?? "NaN");
  const p3Distinct = Number(data.p3.distinctPreReturn10Count ?? "NaN");
  const distinctValues = new Set(
    data.candidateRows
      .map((row) => row.preReturn10)
      .filter((value): value is number => value !== null),
  ).size;
  crossChecks.push({
    name: "p3-ranking-diagnostics（候选行 / 候选日 / 不同取值数 / 边界并列日）",
    ok:
      p3Candidates === data.candidateRows.length
      && p3Days === ranking.byDate.size
      && p3Distinct === distinctValues
      && Number(data.p3.boundaryTieDayCount ?? "NaN") === ranking.boundaryTieDayCount,
    detail:
      `p3 rows=${p3Candidates}/${data.candidateRows.length} days=${p3Days}/${ranking.byDate.size} `
      + `distinct=${p3Distinct}/${distinctValues} boundaryTie=${data.p3.boundaryTieDayCount}/${ranking.boundaryTieDayCount}`
      + `（破平键：${RANK_TIE_BREAK_KEY}）`,
  });

  let ledgerMaxRd = 0;
  for (const rows of obsByAnchor.values()) {
    for (const row of rows) if (row.relativeDay > ledgerMaxRd) ledgerMaxRd = row.relativeDay;
  }
  crossChecks.push({
    name: "观察账 rd 上界 ≥ 本组 confirmMaxRd",
    ok: ledgerMaxRd >= confirmMaxRdOf(spec),
    detail: `ledger maxRd=${ledgerMaxRd} / confirmMaxRd=${confirmMaxRdOf(spec)}`,
  });

  if (!crossChecks.every((check) => check.ok)) {
    fail(`组 ${spec.id} 对账未全部通过：${crossChecks.filter((check) => !check.ok).map((check) => check.name).join("；")}`);
  }

  groupResults.set(spec.id, {
    group: spec.id,
    spec,
    rankingBoundaryTieDayCount: ranking.boundaryTieDayCount,
    universes,
    s7GiveUpRows,
    s7GiveUpSummary,
    extendedS7GiveUpSummary,
    crossChecks,
  });
}

// ---------------------------------------------------------------------------
// 5) 输出
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

function max20ValuesOf(result: UniverseResult, bucket: string): (number | null)[] {
  return result.opportunities
    .filter((item) => item.classification.bucket === bucket)
    .map((item) => {
      const value = item.label.actionableDay?.maxReturn ?? null;
      return value === null ? null : value * 100;
    });
}

const bucketCsvRows: Record<string, string | number | boolean | null>[] = [];
const opportunityCsvRows: Record<string, string | number | boolean | null>[] = [];
const jsonGroups: Record<string, unknown> = {};

for (const spec of GROUPS) {
  const result = groupResults.get(spec.id) as GroupResult;
  const groupPayload: Record<string, unknown> = {
    spec: {
      id: spec.id,
      observationDays: spec.observationDays,
      entryFillMaxRd: spec.entryFillMaxRd,
      reentryKind: spec.reentryKind,
      confirmMinRd: confirmMinRdOf(spec),
      confirmMaxRd: confirmMaxRdOf(spec),
    },
    crossChecks: result.crossChecks,
    universes: {},
  };
  const universePayload: Record<string, unknown> = {};

  for (const universe of UNIVERSES) {
    const universeResult = result.universes.get(universe) as UniverseResult;
    const funnel = universeResult.funnel;
    for (const row of funnel.rows) {
      const stats = describeStats(max20ValuesOf(universeResult, row.bucket));
      bucketCsvRows.push({
        group: spec.id,
        universe,
        bucket: row.bucket,
        bucketOrder: row.order,
        parentBucket: "",
        count: row.count,
        total: funnel.total,
        sharePct: funnel.total === 0 ? 0 : (row.count / funnel.total) * 100,
        max20Count: stats.count,
        max20MedianPct: stats.median,
        max20MeanPct: stats.mean,
        max20P25Pct: stats.p25,
        max20P75Pct: stats.p75,
      });
    }
    for (const sub of Object.keys(funnel.s6SubCounts) as S6SubBucketId[]) {
      const count = funnel.s6SubCounts[sub];
      bucketCsvRows.push({
        group: spec.id,
        universe,
        bucket: sub,
        bucketOrder: BUCKET_IDS.indexOf("S6_ACCOUNT_UNABLE_TO_BUY") + 1,
        parentBucket: "S6_ACCOUNT_UNABLE_TO_BUY",
        count,
        total: funnel.total,
        sharePct: funnel.total === 0 ? 0 : (count / funnel.total) * 100,
        max20Count: null,
        max20MedianPct: null,
        max20MeanPct: null,
        max20P25Pct: null,
        max20P75Pct: null,
      });
    }

    const coOccurrence = coOccurrenceOf(
      universeResult.opportunities.map((item) => ({
        bucket: item.classification.bucket,
        s6SubBucket: item.classification.s6SubBucket,
        hasTrades: item.trades.length > 0,
        hasPriorActualExit: item.failedAttempts.some((failed) => failed.priorActualExitDate !== null),
      })),
    );
    const skipCodeCounts: Record<string, number> = {};
    for (const item of universeResult.opportunities) {
      if (item.classification.bucket !== "S6_ACCOUNT_UNABLE_TO_BUY") continue;
      const codes = item.failedAttempts.map((failed) => failed.skipCode);
      const keys = codes.length === 0 ? ["NO_SKIP_RECORD"] : codes;
      for (const code of keys) skipCodeCounts[code] = (skipCodeCounts[code] ?? 0) + 1;
    }

    universePayload[universe] = {
      universeCandidateAnchors: universeResult.universeCandidateCount,
      funnelTotal: funnel.total,
      funnel: funnel.rows.map((row) => ({
        bucket: row.bucket,
        order: row.order,
        count: row.count,
        sharePct: funnel.total === 0 ? 0 : (row.count / funnel.total) * 100,
      })),
      s6SubCounts: funnel.s6SubCounts,
      s6SkipCodeCounts: skipCodeCounts,
      max20ByBucket: Object.fromEntries(
        universeResult.funnel.rows.map((row) => [row.bucket, describeStats(max20ValuesOf(universeResult, row.bucket))]),
      ),
      big50PathAmongUniverse: universeResult.pathHitAmongUniverse,
      big50PathOnlyAmongUniverse: universeResult.pathOnlyCount,
      big100ActionableCount: universeResult.opportunities.filter((item) => item.label.big100Actionable).length,
      primaryRejectionCounts: universeResult.primaryRejectionCounts,
      coOccurrence,
    };

    for (const item of universeResult.opportunities) {
      const firstTrade = [...item.trades].sort((left, right) => left.entryTime.localeCompare(right.entryTime))[0];
      const forwardRows =
        firstTrade === undefined
          ? []
          : tradeForwardRows({
              group: spec.id,
              trades: [firstTrade],
              barsByAnchor,
              holdingDays: ACTIONABLE_HOLDING_DAYS,
            });
      const forward = forwardRows[0];
      opportunityCsvRows.push({
        anchorEventId: item.anchorEventId,
        symbol: item.symbol,
        eventDate: item.eventDate,
        big50Path: item.label.big50Path.reached,
        big50Actionable: item.label.big50Actionable,
        bucket: item.classification.bucket,
        subReason: item.classification.subReason,
        triggerDays: item.triggerDays.length,
        rRankBest: item.selection.bestRank,
        rSelectedDays: item.selection.selectedConfirmRds.length,
        tradeEntryDate: firstTrade?.entryTime ?? null,
        tradeExitDate: firstTrade?.exitTime ?? null,
        tradeReturnPct: firstTrade?.returnPct ?? null,
        exitReason: firstTrade === undefined ? null : exitReasonBucketOf(firstTrade.reason),
        maxForwardFromEntryPct: forward?.maxForwardFromEntryPct ?? null,
        giveUpPct: forward?.giveUpPct ?? null,
        // ---- 以下为**追加**列（规格 §6.5 的列一个不少、顺序不变） ----
        group: spec.id,
        universe,
        bucketOrder: BUCKET_IDS.indexOf(item.classification.bucket) + 1,
        s6SubBucket: item.classification.s6SubBucket,
        big50PathReturnPct:
          item.label.big50Path.maxReturn === null ? null : item.label.big50Path.maxReturn * 100,
        big100Path: item.label.big100Path.reached,
        big100Actionable: item.label.big100Actionable,
        actionableConfirmRd: item.label.actionableDay?.confirmRd ?? null,
        actionableEntryRd: item.label.actionableDay?.fillRd ?? null,
        actionableMaxReturnPct:
          item.label.actionableDay?.maxReturn === null || item.label.actionableDay === null
            ? null
            : item.label.actionableDay.maxReturn * 100,
        max20Pct:
          item.label.actionableDay?.maxReturn === null || item.label.actionableDay === null
            ? null
            : item.label.actionableDay.maxReturn * 100,
        everTriggered: item.triggerDays.length > 0,
        primaryRejection: item.rejection === null ? null : `${item.rejection.layer}/${item.rejection.code}`,
        actionableDayInCandidatePool: item.actionableRow !== null,        rankOnActionableDay: item.selection.rankOnActionableDay,
        selectedOnActionableDay: item.selection.selectedOnActionableDay,
        tradeCount: item.trades.length,
        bestTradeReturnPct:
          item.trades.length === 0 ? null : Math.max(...item.trades.map((trade) => trade.returnPct)),
        s6SkipCodes: item.failedAttempts.map((failed) => failed.skipCode).join("|"),
        triggerDayDetail: item.triggerDays
          .map((row) => `rd${row.confirmRd}(rank=${item.selection.bestRank ?? "?"},pre=${row.preReturn10 ?? "null"})`)
          .join(";"),
        detail: item.classification.detail,
      });
    }
  }

  groupPayload.universes = universePayload;
  groupPayload.s7GiveUp = {
    universe: "SPEC_TRIGGER_DAYS",
    tradeCount: result.s7GiveUpSummary.tradeCount,
    evaluableCount: result.s7GiveUpSummary.evaluableCount,
    totalGiveUpPct: result.s7GiveUpSummary.totalGiveUpPct,
    medianGiveUpPct: result.s7GiveUpSummary.medianGiveUpPct,
    meanGiveUpPct: result.s7GiveUpSummary.meanGiveUpPct,
    byExitReason: result.s7GiveUpSummary.byExitReason,
    rows: result.s7GiveUpRows,
  };
  groupPayload.s7GiveUpExtended = {
    universe: "EXTENDED_POOL_DAYS",
    tradeCount: result.extendedS7GiveUpSummary.tradeCount,
    evaluableCount: result.extendedS7GiveUpSummary.evaluableCount,
    totalGiveUpPct: result.extendedS7GiveUpSummary.totalGiveUpPct,
    medianGiveUpPct: result.extendedS7GiveUpSummary.medianGiveUpPct,
    meanGiveUpPct: result.extendedS7GiveUpSummary.meanGiveUpPct,
    byExitReason: result.extendedS7GiveUpSummary.byExitReason,
  };
  jsonGroups[spec.id] = groupPayload;
}

writeFileSync(
  new URL("attribution-buckets.csv", OUT_DIR),
  toCsvText(
    [
      "group", "universe", "bucket", "bucketOrder", "parentBucket", "count", "total", "sharePct",
      "max20Count", "max20MedianPct", "max20MeanPct", "max20P25Pct", "max20P75Pct",
    ],
    bucketCsvRows,
  ),
);
writeFileSync(
  new URL("attribution-opportunities.csv", OUT_DIR),
  toCsvText(
    [
      "anchorEventId", "symbol", "eventDate", "big50Path", "big50Actionable", "bucket", "subReason",
      "triggerDays", "rRankBest", "rSelectedDays", "tradeEntryDate", "tradeExitDate", "tradeReturnPct",
      "exitReason", "maxForwardFromEntryPct", "giveUpPct",
      "group", "universe", "bucketOrder", "s6SubBucket", "big50PathReturnPct", "big100Path",
      "big100Actionable", "actionableConfirmRd", "actionableEntryRd", "actionableMaxReturnPct", "max20Pct",
      "everTriggered", "primaryRejection", "actionableDayInCandidatePool", "rankOnActionableDay",
      "selectedOnActionableDay", "tradeCount", "bestTradeReturnPct", "s6SkipCodes", "triggerDayDetail", "detail",
    ],
    opportunityCsvRows,
  ),
);

const attributionJson = {
  schemaVersion: "1.0.0",
  attributionVersion: LOSS_ATTRIBUTION_VERSION,
  direction: "HINDSIGHT_ONLY",
  directionNote:
    "标签为事后口径，只用于回答「我们在哪一层失去这条机会」，绝不回流到资格 / 评分 / 排序 / 仓位 / 退出或任何规则。",
  source: {
    runId: RUN_ID,
    experimentId: EXPERIMENT_ID,
    datasetVersionId: DATASET_VERSION_ID,
    runStatus: detail.run.status,
    artifactKeys: [...availableKeys].filter((key) => key.includes("/tables/")).sort(),
    priceReadOnly: {
      statement: "SELECT-only（本工具拒绝非 SELECT 语句）",
      postTable: "ds_first_limit_pullback_post",
      prefixTable: "ds_first_limit_pullback_prefix (relativeDay = 0)",
      relativeDayRange: [PRICE_RD_MIN, PRICE_RD_MAX],
    },
  },
  labels: {
    big50Actionable: {
      rule: "max(close(rd_{d+1} … rd_{d+1+20})) / open(rd_{d+1}) − 1 ≥ +50%",
      threshold: BIG50_THRESHOLD,
      holdingDays: ACTIONABLE_HOLDING_DAYS,
      windowBars: ACTIONABLE_HOLDING_DAYS + 1,
    },
    big50Path: {
      rule: "max(close(rd1 … rd40)) / close(rd0) − 1 ≥ +50%",
      threshold: BIG50_THRESHOLD,
      entersFunnel: false,
    },
    big100Variants: "同口径 +100%（稀疏性检查）",
    xCapturedThresholdPct: 20,
  },
  universes: {
    SPEC_TRIGGER_DAYS: "规格 §3.1 字面：主标签只在 candidate-days 的真实触发日上判定",
    EXTENDED_POOL_DAYS: "偏离 D1（扩展）：主标签在本组确认区间内的观察账日上判定，使 §4 的 S1/S2/S3 可达",
  },
  poolLabels: {
    pooledAnchors: obsByAnchor.size,
    observationRows: observationRowCount,
    big50Path: pooledBig50PathCount,
    big100Path: pooledBig100PathCount,
  },
  groups: jsonGroups,
  warnings,
  exitCode: pendingExitCode,
};
writeFileSync(new URL("attribution.json", OUT_DIR), `${JSON.stringify(attributionJson, null, 2)}\n`);
log("写了 _scratch/fbp3/attribution.json / attribution-opportunities.csv / attribution-buckets.csv");

// ---------------------------------------------------------------------------
// 6) 控制台摘要（报告直接引用）
// ---------------------------------------------------------------------------

for (const spec of GROUPS) {
  const result = groupResults.get(spec.id) as GroupResult;
  for (const universe of UNIVERSES) {
    const universeResult = result.universes.get(universe) as UniverseResult;
    const counts = universeResult.funnel.rows
      .map((row) => `${row.bucket.split("_")[0]}=${row.count}`)
      .join(" ");
    log(
      `[${spec.id}|${universe}] 机会 ${universeResult.funnel.total}（池内锚点 ${universeResult.universeCandidateCount}，`
      + `BIG50_PATH ${universeResult.pathHitAmongUniverse}，其中仅 PATH ${universeResult.pathOnlyCount}）⇒ ${counts}`,
    );
    log(
      `   S6 细分 ${JSON.stringify(universeResult.funnel.s6SubCounts)}`
      + `；S6 skipCode 计数 ${JSON.stringify(
        (jsonGroups[spec.id] as { universes: Record<string, { s6SkipCodeCounts: Record<string, number> }> })
          .universes[universe]?.s6SkipCodeCounts ?? {},
      )}`,
    );
  }
  log(
    `[${spec.id}] S7 让出（SPEC 口径，逐笔）：笔数 ${result.s7GiveUpSummary.tradeCount}`
    + `（可评估 ${result.s7GiveUpSummary.evaluableCount}）/ 合计 ${pct(result.s7GiveUpSummary.totalGiveUpPct)}`
    + ` / 中位 ${pct(result.s7GiveUpSummary.medianGiveUpPct)} / 均值 ${pct(result.s7GiveUpSummary.meanGiveUpPct)}`,
  );
  for (const check of result.crossChecks) {
    log(`   对账 ${check.ok ? "✓" : "✗"} ${check.name} —— ${check.detail}`);
  }
}

if (pendingExitCode !== 0) {
  console.error(`[attribution] 退出码 ${pendingExitCode}；warnings=${JSON.stringify(warnings)}`);
}
process.exit(pendingExitCode);
