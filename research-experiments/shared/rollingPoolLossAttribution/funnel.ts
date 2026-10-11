/**
 * `FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001` —— 纯分析函数（标签 / 排序 / 8 桶漏斗）。
 *
 * 🔴 本模块**无 IO、无 DB、无时钟、无随机**：所有输入都是**已解析**的行（`types.ts`），
 *    所有输出都是确定性的纯数据。解析在 `csv.ts`；读产物 / 读行情在 `tests/tools/**`。
 *
 * 🔴 标签是**事后（hindsight）**口径：只用于回答「我们在哪一层失去这条机会」，
 *    **绝不回流**到资格、评分、排序、仓位、退出或任何规则（规格 §7）。
 */

import {
  ACTIONABLE_HOLDING_DAYS,
  BIG100_THRESHOLD,
  BIG50_THRESHOLD,
  BUCKET_IDS,
  DAILY_TOP_K,
  EXIT_REASON_BUCKETS,
  PATH_WINDOW_END_RD,
  PATH_WINDOW_START_RD,
  RANK_TIE_BREAK_KEY,
  S2_REJECTION_CODES,
  S6_SKIP_CODE_TO_SUB_BUCKET,
  S6_SUB_BUCKET_IDS,
  X_CAPTURED_THRESHOLD_PCT,
  confirmMaxRdOf,
  type BucketCountRow,
  type BucketId,
  type CandidateDayRow,
  type CauseCoOccurrence,
  type ClassificationResult,
  type DailyRanking,
  type DescribeStats,
  type EntryDayLabel,
  type ExitReasonBucket,
  type FailedAttemptRow,
  type ForwardBars,
  type FunnelAggregate,
  type GiveUpSummary,
  type GroupSpecLite,
  type ObservationLedgerRow,
  type OpportunityClassificationInput,
  type OpportunityLabel,
  type PathLabel,
  type PrimaryRejection,
  type RankedDayRow,
  type S6SubBucketId,
  type S7GiveUpRow,
  type TradeRow,
  type TriggerSelection,
} from "./types";

/** 浮点比较容差：`>= 阈值` 判据用它吸收表示误差（`+49.99%` 仍判否）。 */
const EPSILON = 1e-12;

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: number | null | undefined): value is number {
  return finiteNumber(value) && value > 0;
}

// ---------------------------------------------------------------------------
// 一、标签计算（规格 §3）
// ---------------------------------------------------------------------------

interface WindowMax {
  readonly maxClose: number | null;
  readonly maxCloseRd: number | null;
  readonly barCount: number;
}

/**
 * 窗口 `[fromRd, fromRd + offsetMax]`（**两端闭**）内的最大收盘与前收盘数量。
 *
 * 🔴 缺失 / 非有限的 bar **直接跳过**：不插值、不前值填充；覆盖度由 `barCount` 如实报告。
 */
export function maxCloseWithin(bars: ForwardBars, fromRd: number, offsetMax: number): WindowMax {
  let maxClose: number | null = null;
  let maxCloseRd: number | null = null;
  let barCount = 0;
  for (let relativeDay = fromRd; relativeDay <= fromRd + offsetMax; relativeDay += 1) {
    const bar = bars.get(relativeDay);
    if (bar === undefined) continue;
    if (!finiteNumber(bar.close)) continue;
    barCount += 1;
    if (maxClose === null || bar.close > maxClose) {
      maxClose = bar.close;
      maxCloseRd = relativeDay;
    }
  }
  return { maxClose, maxCloseRd, barCount };
}

/**
 * 单个「确认日 `d` ⇒ 次日开盘入场」的标签（规格 §3.1 的**口径单元**）。
 *
 * `max(close(rd_{d+1} … rd_{d+1+holdingDays})) / open(rd_{d+1}) − 1 >= threshold`
 * ⇒ `holdingDays = 20` 时窗口 = `[fillRd, fillRd + 20]`（21 根收盘）。
 */
export function labelEntryDay(
  bars: ForwardBars,
  confirmRd: number,
  threshold: number,
  holdingDays: number = ACTIONABLE_HOLDING_DAYS,
): EntryDayLabel {
  const fillRd = confirmRd + 1;
  const fillBar = bars.get(fillRd);
  const entryOpen = fillBar !== undefined && finitePositive(fillBar.open) ? fillBar.open : null;
  const window = maxCloseWithin(bars, fillRd, holdingDays);
  const maxReturn =
    entryOpen !== null && window.maxClose !== null ? window.maxClose / entryOpen - 1 : null;
  return {
    confirmRd,
    fillRd,
    fillDate: fillBar?.tradeDate ?? null,
    entryOpen,
    windowBarCount: window.barCount,
    maxClose: window.maxClose,
    maxCloseRd: window.maxCloseRd,
    maxReturn,
    reached: maxReturn !== null && maxReturn >= threshold - EPSILON,
  };
}

/**
 * 首个满足阈值的入场日（**最早可入场时点**；规格 §3.1「每个锚点最多贡献 1 条机会」）。
 *
 * `confirmRds` 必须按**升序**给出（调用方负责排序 / 去重）。
 */
export function firstActionableEntryDay(
  bars: ForwardBars,
  confirmRds: readonly number[],
  threshold: number,
  holdingDays: number = ACTIONABLE_HOLDING_DAYS,
): EntryDayLabel | null {
  for (const confirmRd of confirmRds) {
    const label = labelEntryDay(bars, confirmRd, threshold, holdingDays);
    if (label.reached) return label;
  }
  return null;
}

/** 背景标签 `BIG50_PATH`（规格 §3.2：`max(close(rd1 … rd40)) / close(rd0) − 1`）。 */
export function pathLabel(
  bars: ForwardBars,
  rd0Close: number | null,
  threshold: number,
): PathLabel {
  const window = maxCloseWithin(
    bars,
    PATH_WINDOW_START_RD,
    PATH_WINDOW_END_RD - PATH_WINDOW_START_RD,
  );
  const base = finitePositive(rd0Close) ? rd0Close : null;
  const maxReturn = base !== null && window.maxClose !== null ? window.maxClose / base - 1 : null;
  return {
    base,
    windowBarCount: window.barCount,
    maxClose: window.maxClose,
    maxCloseRd: window.maxCloseRd,
    maxReturn,
    reached: maxReturn !== null && maxReturn >= threshold - EPSILON,
  };
}

/**
 * 一个锚点的两个标签。
 *
 * `candidateConfirmRds` = 该锚点在该组下的**全部确认日**（升序）——
 * **主标签（`BIG50_ACTIONABLE`）的判定集合由调用方给出**：
 *   - 规格 §3.1 字面口径 ⇒ 传 `candidate-days` 的确认日（**默认**）；
 *   - 扩展口径（本任务显式声明的偏离 D1）⇒ 传观察账在**本组确认区间内**的观察日。
 * 两种口径共用同一套标签函数，避免出现第二套实现。
 */
export function buildOpportunityLabel(args: {
  readonly bars: ForwardBars;
  readonly rd0Close: number | null;
  readonly candidateConfirmRds: readonly number[];
}): OpportunityLabel {
  const actionableDay = firstActionableEntryDay(
    args.bars,
    args.candidateConfirmRds,
    BIG50_THRESHOLD,
  );
  const big100Day = firstActionableEntryDay(args.bars, args.candidateConfirmRds, BIG100_THRESHOLD);
  return {
    big50Actionable: actionableDay !== null,
    actionableDay,
    big100Actionable: big100Day !== null,
    big50Path: pathLabel(args.bars, args.rd0Close, BIG50_THRESHOLD),
    big100Path: pathLabel(args.bars, args.rd0Close, BIG100_THRESHOLD),
  };
}

/**
 * **漏斗准入**判据：只有 `BIG50_ACTIONABLE` 成立的机会进入漏斗。
 *
 * 🔴 `BIG50_PATH`（背景标签）**永不**单独进入漏斗（只用来说明「大涨的股票里有多少
 *    根本不在我们的可入场集合内」）。
 */
export function isFunnelOpportunity(label: OpportunityLabel): boolean {
  return label.big50Actionable && label.actionableDay !== null;
}

// ---------------------------------------------------------------------------
// 二、逐日 R 排序（规格 §4 第 5 行；与 003 Run 的 `sortCandidates` 同口径）
// ---------------------------------------------------------------------------

/** 排序比较器：`preReturn10` 降序 → `symbol` 升序 → `anchorEventId` 升序（**冻结破平键**）。 */
export function compareCandidates(left: CandidateDayRow, right: CandidateDayRow): number {
  const leftValue = left.preReturn10 ?? Number.NEGATIVE_INFINITY;
  const rightValue = right.preReturn10 ?? Number.NEGATIVE_INFINITY;
  if (rightValue !== leftValue) return rightValue - leftValue;
  return (
    left.symbol.localeCompare(right.symbol) ||
    left.anchorEventId.localeCompare(right.anchorEventId)
  );
}

/**
 * 逐日横截面排序 + TopK 选中。
 *
 * 🔴 `preReturn10 === null` 的行**不参与排序**（它们在 Run 里根本没进候选池）⇒
 *    `rankOf` 里**没有**它们的键（调用方据此判 `S4_NOT_RANKABLE`）。
 */
export function rankCandidatesPerDay(
  rows: readonly CandidateDayRow[],
  topK: number = DAILY_TOP_K,
): DailyRanking {
  const byDate = new Map<string, CandidateDayRow[]>();
  for (const row of rows) {
    if (row.preReturn10 === null) continue;
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  const rankedByDate = new Map<string, readonly RankedDayRow[]>();
  const rankOf = new Map<string, number>();
  const topKAnchors = new Map<string, ReadonlySet<string>>();
  let boundaryTieDayCount = 0;
  for (const [date, list] of byDate) {
    const sorted = [...list].sort(compareCandidates);
    const ranked: RankedDayRow[] = sorted.map((row, index) => ({
      date,
      anchorEventId: row.anchorEventId,
      rank: index + 1,
      inTopK: index + 1 <= topK,
      preReturn10: row.preReturn10 as number,
    }));
    rankedByDate.set(date, ranked);
    for (const row of ranked) rankOf.set(`${date}|${row.anchorEventId}`, row.rank);
    topKAnchors.set(date, new Set(ranked.filter((row) => row.inTopK).map((row) => row.anchorEventId)));
    // 边界并列：当日前 TopK 与第 TopK+1 名的因子值相同 ⇒ 排序实质由破平键决定（P3 同口径）。
    if (ranked.length > topK) {
      const boundary = ranked[topK - 1];
      const next = ranked[topK];
      if (boundary !== undefined && next !== undefined && boundary.preReturn10 === next.preReturn10) {
        boundaryTieDayCount += 1;
      }
    }
  }
  return { byDate: rankedByDate, rankOf, topKAnchors, boundaryTieDayCount };
}

/** 某锚点在 R 侧的选中情况（用于 `S5` 与「可排序」诊断）。 */
export function triggerSelectionOf(args: {
  readonly anchorEventId: string;
  readonly triggerDays: readonly CandidateDayRow[];
  readonly ranking: DailyRanking;
  readonly actionableDate: string | null;
  readonly topK?: number;
}): TriggerSelection {
  const topK = args.topK ?? DAILY_TOP_K;
  const selected: CandidateDayRow[] = [];
  let bestRank: number | null = null;
  for (const day of args.triggerDays) {
    const rank = args.ranking.rankOf.get(`${day.date}|${args.anchorEventId}`) ?? null;
    if (rank === null) continue;
    if (bestRank === null || rank < bestRank) bestRank = rank;
    if (rank <= topK) selected.push(day);
  }
  selected.sort((left, right) => left.confirmRd - right.confirmRd);
  const actionableRank =
    args.actionableDate === null
      ? null
      : args.ranking.rankOf.get(`${args.actionableDate}|${args.anchorEventId}`) ?? null;
  return {
    selectedConfirmRds: selected.map((row) => row.confirmRd),
    selectedDates: selected.map((row) => row.date),
    bestRank,
    rankOnActionableDay: actionableRank,
    selectedOnActionableDay: actionableRank !== null && actionableRank <= topK,
  };
}

// ---------------------------------------------------------------------------
// 三、「从未触发」的首要拒绝原因（依**规则库顺序**；只用于 S2/S3 分流）
// ---------------------------------------------------------------------------

function rowsByRelativeDay(
  rows: readonly ObservationLedgerRow[],
): Map<number, ObservationLedgerRow> {
  const map = new Map<number, ObservationLedgerRow>();
  for (const row of rows) if (!map.has(row.relativeDay)) map.set(row.relativeDay, row);
  return map;
}

/** 该观察日**可评估**（观察账口径：`score !== null` ⇒ bar 存在、非停牌、OHLCV 有效）。 */
function scorableAt(byRd: ReadonlyMap<number, ObservationLedgerRow>, relativeDay: number): boolean {
  const row = byRd.get(relativeDay);
  return row !== undefined && row.score !== null;
}

/**
 * 「从未触发」锚点的**首要拒绝原因**：把规则库的**逐日判定顺序**在
 * `d = confirmMaxRd`（= 规则循环的最后一日）上重放一遍，首次不成立即返回。
 *
 * 依据（仅用产物 + 只读行情，**不重跑实验**）：
 *   - 支撑层：`observation-ledger.supportBreached` / `score === null`（= 路径不可评估）；
 *   - 回撤层：`close(rd0)`（Dataset prefix rd0）+ post 收盘；
 *   - 观察分：`observation-ledger.score`（N 日窗口逐日 ≥3）；
 *   - 突破层：post 收盘 / 高点（前两日高点参照）。
 *
 * 🔴 **量能层不在判据内**：`VOLUME_NOT_RECOVERED` 与 `NO_CLOSE_BREAKOUT` 在规格 §4 里
 *    同属 `S3`，因此**不需要**区分它们（也不需要读 volume 列）。
 */
export function derivePrimaryRejection(args: {
  readonly spec: GroupSpecLite;
  readonly observationRows: readonly ObservationLedgerRow[];
  readonly bars: ForwardBars;
  readonly rd0Close: number | null;
}): PrimaryRejection {
  const day = confirmMaxRdOf(args.spec);
  const observationDays = args.spec.observationDays;
  const byRd = rowsByRelativeDay(args.observationRows);

  let breachRd: number | null = null;
  let pathIncomplete = false;
  for (let rd = 1; rd <= day; rd += 1) {
    const row = byRd.get(rd);
    if (row === undefined || row.score === null) {
      if (breachRd === null) pathIncomplete = true;
      continue;
    }
    if (row.supportBreached === true && breachRd === null) breachRd = rd;
  }
  const base = {
    evaluatedConfirmRd: day,
  };
  if (breachRd !== null) {
    return {
      ...base,
      layer: "support",
      code: "SUPPORT_BREACHED",
      note: `支撑在 rd${breachRd} 永久作废（终态 INVALIDATED_SUPPORT，不恢复）。`,
    };
  }
  if (pathIncomplete) {
    return {
      ...base,
      layer: "support",
      code: "SUPPORT_PATH_INCOMPLETE",
      note: "rd1..d 内存在不可评估的观察日 ⇒ 不能声称「全程未破位」。",
    };
  }

  const close0 = finitePositive(args.rd0Close) ? args.rd0Close : null;
  if (close0 === null) {
    return {
      ...base,
      layer: "pullback",
      code: "RD0_CLOSE_UNAVAILABLE",
      note: "缺少 close(rd0)（Dataset prefix rd0）⇒ 回撤层不可评估。",
    };
  }
  let pullbackFirstRd: number | null = null;
  for (let rd = 1; rd <= day - 1; rd += 1) {
    if (!scorableAt(byRd, rd)) continue;
    const bar = args.bars.get(rd);
    if (bar === undefined || !finiteNumber(bar.close)) continue;
    if (bar.close < close0 - 1e-9) {
      pullbackFirstRd = rd;
      break;
    }
  }
  if (pullbackFirstRd === null) {
    return {
      ...base,
      layer: "pullback",
      code: "NO_PULLBACK_YET",
      note: "到 d−1 为止尚未出现 C_j < C_0。",
    };
  }

  for (let cursor = day - observationDays; cursor <= day - 1; cursor += 1) {
    const row = byRd.get(cursor);
    if (row === undefined || row.score === null || row.score < 3) {
      return {
        ...base,
        layer: "score",
        code: "PREV_TWO_DAY_SCORE_INSUFFICIENT",
        note: `N=${observationDays} 日窗口 rd${day - observationDays}..rd${day - 1} 中，rd${cursor} 不足 3 分或不可评估。`,
      };
    }
  }

  const current = args.bars.get(day);
  const previous1 = args.bars.get(day - 1);
  const previous2 = args.bars.get(day - 2);
  if (
    current === undefined
    || previous1 === undefined
    || previous2 === undefined
    || !finiteNumber(current.close)
    || !finiteNumber(previous1.high)
    || !finiteNumber(previous2.high)
    || !scorableAt(byRd, day)
    || !scorableAt(byRd, day - 1)
    || !scorableAt(byRd, day - 2)
  ) {
    return {
      ...base,
      layer: "score",
      code: "PREV_TWO_DAY_SCORE_INSUFFICIENT",
      note: "确认日 / 前两日的 bar 不可用于突破判定（规则库同一分支）。",
    };
  }
  const reference = Math.max(previous2.high, previous1.high);
  if (!(current.close > reference)) {
    return {
      ...base,
      layer: "breakout",
      code: "NO_CLOSE_BREAKOUT",
      note: `C_d=${current.close} 未突破前两日高点参照 ${reference}。`,
    };
  }
  return {
    ...base,
    layer: "breakout",
    code: "TRIGGER_SHAPE_OK_BUT_NOT_TRIGGERED",
    note:
      "可导出的条件在 d 全部成立，却没有任何候选行 ⇒ 归因账与权威触发判定不一致"
      + "（诊断级；按 S3 如实归类，不静默丢弃）。",
  };
}

// ---------------------------------------------------------------------------
// 四、8 桶分类（规格 §4：互斥，1→8 首次命中即止）
// ---------------------------------------------------------------------------

/** `S6` 子桶：取**最早**一次被阻断 / 未成交尝试的 `skipCode`；没有尝试 ⇒ 残差 `S6d_NO_FILL`。 */
export function s6SubBucketOf(failedAttempts: readonly FailedAttemptRow[]): {
  readonly subBucket: S6SubBucketId;
  readonly subReason: string;
  readonly note: string;
} {
  if (failedAttempts.length === 0) {
    return {
      subBucket: "S6d_NO_FILL",
      subReason: "NO_SKIP_RECORD",
      note:
        "进入 R 的 TopK、无成交、且没有任何 skip 记录 ⇒ 意图在下单/撮合层被拒"
        + "（涨停 / 停牌 / 无流动性 / 无次一交易日）；逐账户拒单不在本 Run 产物里，只能残差归类。",
    };
  }
  const ordered = [...failedAttempts].sort(
    (left, right) =>
      left.attemptedConfirmDate.localeCompare(right.attemptedConfirmDate)
      || (left.plannedFillDate ?? "").localeCompare(right.plannedFillDate ?? ""),
  );
  const first = ordered[0] as FailedAttemptRow;
  const subBucket = S6_SKIP_CODE_TO_SUB_BUCKET[first.skipCode] ?? "S6e_OTHER";
  const mapped = S6_SKIP_CODE_TO_SUB_BUCKET[first.skipCode] !== undefined;
  return {
    subBucket,
    subReason: first.skipCode,
    note: mapped
      ? `首次建仓尝试（${first.attemptedConfirmDate}）被阻断：${first.skipCode} —— ${first.reason}`
      : `未在冻结映射里的 skipCode「${first.skipCode}」⇒ 归入 S6e_OTHER（如实披露，不猜）。`,
  };
}

/**
 * 单条机会的桶归属。**首次命中即止**，顺序 = 规格 §4 的 1→8。
 *
 * 🔴 未进入漏斗（`BIG50_PATH`-only）的机会调用本函数会**响亮抛错** ——
 *    「背景标签不得进入漏斗」是规格 §3.2 的硬判据，不能靠调用方自律。
 */
export function classifyOpportunity(
  input: OpportunityClassificationInput,
): ClassificationResult {
  if (!isFunnelOpportunity(input.label) || input.label.actionableDay === null) {
    throw new Error(
      `BIG50_PATH_ONLY：锚点 ${input.anchorEventId}（组 ${input.group}）不满足 BIG50_ACTIONABLE，`
      + "不得进入漏斗（规格 §3.2）。",
    );
  }
  const actionable = input.label.actionableDay;

  // ---- 桶 1：S1_SUPPORT_INVALIDATED（首个可入场日之前支撑已永久作废） ----
  let breachBefore: number | null = null;
  for (const row of input.observationRows) {
    if (row.relativeDay >= actionable.confirmRd) continue;
    if (row.supportBreached !== true) continue;
    if (breachBefore === null || row.relativeDay < breachBefore) breachBefore = row.relativeDay;
  }
  if (breachBefore !== null) {
    return {
      bucket: "S1_SUPPORT_INVALIDATED",
      s6SubBucket: null,
      subReason: `SUPPORT_BREACHED@rd${breachBefore}`,
      detail:
        `首个可入场确认日 rd${actionable.confirmRd} 之前，rd${breachBefore} 支撑已永久作废`
        + "（规则本身导致，与账户是否买过无关）。",
    };
  }

  // ---- 桶 2 / 3：从未触发（观察分不足 vs 其它层） ----
  if (input.triggerDays.length === 0) {
    const rejection = input.rejection;
    if (rejection === null) {
      return {
        bucket: "S3_NO_OTHER_TRIGGER",
        s6SubBucket: null,
        subReason: "REJECTION_UNOBSERVABLE",
        detail: "从未触发且无法从产物导出首要拒绝原因 ⇒ 按 S3 归类并如实披露。",
      };
    }
    if (S2_REJECTION_CODES.includes(rejection.code)) {
      return {
        bucket: "S2_SCORE_INSUFFICIENT",
        s6SubBucket: null,
        subReason: rejection.code,
        detail: `未破位，但 N 日观察分不足（${rejection.layer}/${rejection.code}）：${rejection.note}`,
      };
    }
    return {
      bucket: "S3_NO_OTHER_TRIGGER",
      s6SubBucket: null,
      subReason: rejection.code,
      detail: `未触发，首要拒绝原因 ${rejection.layer}/${rejection.code}：${rejection.note}`,
    };
  }

  // ---- 桶 4：S4_NOT_RANKABLE（该可入场日未进入排序） ----
  if (input.actionableRow === null || input.actionableRow.preReturn10 === null) {
    return {
      bucket: "S4_NOT_RANKABLE",
      s6SubBucket: null,
      subReason:
        input.actionableRow === null ? "ACTIONABLE_DAY_NOT_IN_CANDIDATE_POOL" : "PRE_RETURN10_MISSING",
      detail:
        input.actionableRow === null
          ? `可入场确认日 rd${actionable.confirmRd} 没有任何候选行（当日未通过资格 / 越界 / 未在池内）⇒ 无法进入排序。`
          : `可入场确认日 rd${actionable.confirmRd} 的 preReturn10 缺失 ⇒ 无法进入排序。`,
    };
  }

  // ---- 桶 5：S5_RANK_NOT_SELECTED（所有触发日的排名都 > TopK） ----
  if (input.selection.selectedConfirmRds.length === 0) {
    return {
      bucket: "S5_RANK_NOT_SELECTED",
      s6SubBucket: null,
      subReason:
        input.selection.bestRank === null
          ? "NOT_RANKED_ON_ANY_TRIGGER_DAY"
          : `BEST_RANK=${input.selection.bestRank}`,
      detail:
        `触发 ${input.triggerDays.length} 次，全部落在 R 的当日横截面 TopK 之外`
        + `（最好名次 ${input.selection.bestRank ?? "不可排序"}；破平键 ${RANK_TIE_BREAK_KEY}）。`,
    };
  }

  // ---- 桶 6：S6_ACCOUNT_UNABLE_TO_BUY（进过 TopK，但账户该锚点无成交） ----
  if (input.trades.length === 0) {
    const sub = s6SubBucketOf(input.failedAttempts);
    return {
      bucket: "S6_ACCOUNT_UNABLE_TO_BUY",
      s6SubBucket: sub.subBucket,
      subReason: sub.subReason,
      detail:
        `至少一次进入 R 的 TopK（确认日 rd ${input.selection.selectedConfirmRds.join(",")}），`
        + `但 R 账户该锚点无成交。${sub.note}`,
    };
  }

  // ---- 桶 7 / 8：买过 ⇒ 提前退出（对照：确实抓到） ----
  const bestReturnPct = Math.max(...input.trades.map((trade) => trade.returnPct));
  if (bestReturnPct >= X_CAPTURED_THRESHOLD_PCT - EPSILON) {
    return {
      bucket: "X_CAPTURED",
      s6SubBucket: null,
      subReason: `BEST_TRADE_RETURN=${bestReturnPct.toFixed(2)}%`,
      detail: `R 买过该锚点，且已有单笔实现收益 ≥ +${X_CAPTURED_THRESHOLD_PCT}%（对照桶）。`,
    };
  }
  return {
    bucket: "S7_BOUGHT_EXITED_EARLY",
    s6SubBucket: null,
    subReason: exitReasonBucketOf(input.trades[0]?.reason ?? ""),
    detail:
      `R 买过该锚点，${input.trades.length} 笔全部 < +${X_CAPTURED_THRESHOLD_PCT}%`
      + `（最好 ${bestReturnPct.toFixed(2)}%），而该锚点事后确有 ≥+50% 的可入场窗口。`,
  };
}

// ---------------------------------------------------------------------------
// 五、聚合（空桶也出行）
// ---------------------------------------------------------------------------

/** 桶 × 计数 × 占比；**恒返回 8 行**（`count = 0` 的桶也出现，绝不静默省略）。 */
export function aggregateFunnel(
  classifications: readonly ClassificationResult[],
): FunnelAggregate {
  const counts = new Map<BucketId, number>();
  for (const bucket of BUCKET_IDS) counts.set(bucket, 0);
  const subCounts = new Map<S6SubBucketId, number>();
  for (const sub of S6_SUB_BUCKET_IDS) subCounts.set(sub, 0);
  for (const item of classifications) {
    counts.set(item.bucket, (counts.get(item.bucket) ?? 0) + 1);
    if (item.s6SubBucket !== null) {
      subCounts.set(item.s6SubBucket, (subCounts.get(item.s6SubBucket) ?? 0) + 1);
    }
  }
  const total = classifications.length;
  const rows: BucketCountRow[] = BUCKET_IDS.map((bucket, index) => ({
    bucket,
    order: index + 1,
    count: counts.get(bucket) ?? 0,
    share: total === 0 ? 0 : (counts.get(bucket) ?? 0) / total,
  }));
  return {
    total,
    rows,
    s6SubCounts: Object.fromEntries(S6_SUB_BUCKET_IDS.map((sub) => [sub, subCounts.get(sub) ?? 0])) as Record<
      S6SubBucketId,
      number
    >,
  };
}

/** 描述统计（中位 / 均值 / 四分位）；`null` 值只计入 `missing`。 */
export function describeStats(values: readonly (number | null)[]): DescribeStats {
  const present = values.filter((value): value is number => finiteNumber(value));
  const sorted = [...present].sort((left, right) => left - right);
  const quantile = (q: number): number | null => {
    if (sorted.length === 0) return null;
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const low = sorted[lower] as number;
    const high = sorted[upper] as number;
    return low + (high - low) * (position - lower);
  };
  return {
    count: present.length,
    missing: values.length - present.length,
    median: quantile(0.5),
    mean: sorted.length === 0 ? null : sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p25: quantile(0.25),
    p75: quantile(0.75),
    min: sorted.length === 0 ? null : (sorted[0] as number),
    max: sorted.length === 0 ? null : (sorted[sorted.length - 1] as number),
  };
}

// ---------------------------------------------------------------------------
// 六、S7「让出多少」逐笔量化（规格 §6.3）
// ---------------------------------------------------------------------------

/** 退出原因自由文本 → 规格点名的分组（顺序敏感：`强势续持…持有满…` 先判 strongHold）。 */
export function exitReasonBucketOf(reason: string): ExitReasonBucket {
  if (reason.includes("止损")) return "止损";
  if (reason.includes("MA")) return "MA_CROSS";
  if (reason.includes("强势续持")) return "strongHold";
  if (reason.includes("持有满")) return "时间退出";
  if (reason.includes("期末") || reason.includes("MTM") || reason.includes("未平仓")) return "期末";
  return "其他";
}

/** 由 `entryTime`（交易日）反查该 bar 的相对日；找不到 ⇒ `null`（不猜）。 */
export function entryRdOfTrade(bars: ForwardBars, entryTime: string): number | null {
  for (const [relativeDay, bar] of bars) {
    if (bar.tradeDate === entryTime) return relativeDay;
  }
  return null;
}

/** 逐笔「让出多少」：`realized`（实际）vs `max forward`（自**实际入场**起 20 日最大收盘涨幅）。 */
export function tradeForwardRows(args: {
  readonly group: string;
  readonly trades: readonly TradeRow[];
  readonly barsByAnchor: ReadonlyMap<string, ForwardBars>;
  readonly holdingDays?: number;
}): readonly S7GiveUpRow[] {
  const holdingDays = args.holdingDays ?? ACTIONABLE_HOLDING_DAYS;
  const out: S7GiveUpRow[] = [];
  for (const trade of args.trades) {
    const bars = args.barsByAnchor.get(trade.anchorEventId);
    const entryRd = bars === undefined ? null : entryRdOfTrade(bars, trade.entryTime);
    const window =
      bars === undefined || entryRd === null
        ? { maxClose: null, maxCloseRd: null, barCount: 0 }
        : maxCloseWithin(bars, entryRd, holdingDays);
    const maxForwardFromEntryPct =
      window.maxClose !== null && finitePositive(trade.entryPrice)
        ? (window.maxClose / trade.entryPrice - 1) * 100
        : null;
    out.push({
      group: args.group,
      anchorEventId: trade.anchorEventId,
      symbol: trade.symbol,
      entryTime: trade.entryTime,
      entryRd,
      entryPrice: trade.entryPrice,
      exitTime: trade.exitTime,
      holdingPeriod: trade.holdingPeriod,
      realizedReturnPct: trade.returnPct,
      maxForwardFromEntryPct,
      giveUpPct:
        maxForwardFromEntryPct === null ? null : maxForwardFromEntryPct - trade.returnPct,
      forwardBarCount: window.barCount,
      exitReason: trade.reason,
      exitReasonBucket: exitReasonBucketOf(trade.reason),
    });
  }
  return out;
}

/** 让出额的合计 / 中位 / 均值（总体 + 按退出原因分组）。 */
export function summarizeGiveUp(rows: readonly S7GiveUpRow[]): GiveUpSummary {
  const evaluable = rows.filter((row) => row.giveUpPct !== null);
  const values = evaluable.map((row) => row.giveUpPct as number);
  const stats = describeStats(values);
  const byExitReason = EXIT_REASON_BUCKETS.map((bucket) => {
    const groupRows = evaluable.filter((row) => row.exitReasonBucket === bucket);
    const groupValues = groupRows.map((row) => row.giveUpPct as number);
    const groupStats = describeStats(groupValues);
    return {
      exitReasonBucket: bucket,
      tradeCount: rows.filter((row) => row.exitReasonBucket === bucket).length,
      totalGiveUpPct:
        groupValues.length === 0 ? null : groupValues.reduce((sum, value) => sum + value, 0),
      medianGiveUpPct: groupStats.median,
      meanGiveUpPct: groupStats.mean,
    };
  }).filter((row) => row.tradeCount > 0);
  return {
    tradeCount: rows.length,
    evaluableCount: evaluable.length,
    totalGiveUpPct: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0),
    medianGiveUpPct: stats.median,
    meanGiveUpPct: stats.mean,
    byExitReason,
  };
}

// ---------------------------------------------------------------------------
// 七、S1 ↔ S6c 交叉表（规格 §5：两个原因并存时必须拆开）
// ---------------------------------------------------------------------------

/** 交叉表输入：每条机会的桶 + 是否曾真实成交 + 是否有 `priorActualExitDate` 证据。 */
export interface CoOccurrenceEntry {
  readonly bucket: BucketId;
  readonly s6SubBucket: S6SubBucketId | null;
  readonly hasTrades: boolean;
  readonly hasPriorActualExit: boolean;
}

export function coOccurrenceOf(entries: readonly CoOccurrenceEntry[]): CauseCoOccurrence {
  const s1 = entries.filter((entry) => entry.bucket === "S1_SUPPORT_INVALIDATED");
  const s6c = entries.filter(
    (entry) => entry.bucket === "S6_ACCOUNT_UNABLE_TO_BUY" && entry.s6SubBucket === "S6c_REENTRY_BLOCKED",
  );
  return {
    s1Count: s1.length,
    s1WithTrades: s1.filter((entry) => entry.hasTrades).length,
    s1WithPriorExit: s1.filter((entry) => entry.hasPriorActualExit).length,
    s1WithPriorExitOrTrades: s1.filter((entry) => entry.hasTrades || entry.hasPriorActualExit).length,
    s6cCount: s6c.length,
    s6cWithPriorExit: s6c.filter((entry) => entry.hasPriorActualExit).length,
    note:
      "`S1` = 规则导致的**永久失效**（与账户是否买过无关）；`S6c` = 账户政策导致的阻断"
      + "（仅 SINGLE_ENTRY，即 E 组）。两者并存的机会单独计数，不得把「后续上涨」直接说成「因为买过而错过」。",
  };
}
