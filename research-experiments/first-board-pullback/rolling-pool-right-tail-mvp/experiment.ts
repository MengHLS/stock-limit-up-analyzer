/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` · 首板滚动观察池与每日右尾识别（最小研究闭环）
 *
 * 规格：`docs/research/GOAL-FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001.md`。
 *
 * ## 唯一研究问题
 *
 * 「在首板触发的**滚动观察池**中，基于**当天收盘可知**的信息，每天按股票选最多 3 个候选，
 *   能否比**同日同池随机**选择提高**从下一日开始的 20 交易日右尾机会**？代价是多少？」
 *
 * ## 三个臂（单 Run 同面板）
 *
 * | 臂 | 定义 |
 * |---|---|
 * | `R` | `preReturn10` **HIGH**（原冻结定义，右尾候选） |
 * | `M` | `maxAmp5` **LOW**（既有 Strategy Core 定义，近 5 日低振幅参照） |
 * | `RANDOM` | 同日同可评估池、**同人数**均匀**无放回**，200 个固定种子 |
 *
 * ## PIT 纪律（这一段是全部风险所在）
 *
 * 1. **资格与排名只用当天收盘可知的信息**：`preReturn10` 只读 `prefix rd −1/−10`；
 *    `maxAmp5` 由 Core 的 `FeatureDefinition` 计算，经 Core 的日范围可见性访问器
 *    （`createDayScopedBarAccess#barsUpTo`）取 `rd ≤ 15` 的可见序列；
 *    两者对任意可选年龄（`rd ≥ 15`）取值相同 ⇒ **逐日限定到 decisionDate** 成立。
 * 2. **`nextOpenExecutable` 绝不参与资格或排名**：它只写进每日账（规格 §4.6 要求区分）。
 * 3. `freezeSelection` 在**第一次** `observation()` 之前调用；冻结集 = 主研究窗口内
 *    **可能**入池的事件并集（超集，实际成员由投影决定）。
 * 4. 不碰 DB（只有 `context.dataset`）、不复制振幅/成本/顺延公式、不做参数搜索。
 */

import type {
  ExperimentBarRow,
  ExperimentDefinition,
  ExperimentEventRow,
  ExperimentResultPayload,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  EVENT_STATE_AMPLITUDE_FEATURE_IDS,
  createDayScopedBarAccess,
  getDefaultFeatureRegistry,
  makeEvaluationTime,
  type VisibleBar,
} from "@experiments/strategyCoreBridge";
import {
  ARM_LABELS,
  BOOTSTRAP_BLOCK_PRIMARY,
  BOOTSTRAP_BLOCK_SENSITIVITY,
  CI_QUANTILES,
  EXIT_DEFERRAL_MAX_TRADING_DAYS,
  FIRST_BOARD_DATASET_CODE,
  FROZEN_DATASET_VERSION_LABEL,
  HOLDING_DAYS,
  MAIN_WINDOW,
  MAX_POST_RELATIVE_DAY_NEEDED,
  POST_RELATIVE_DAYS,
  PREFIX_RELATIVE_DAYS,
  RANDOM_DRAW_COUNT,
  RANDOM_SEED_BASE,
  SELECTABLE_AGE_LOWER_BOUND,
  TOP_K,
  WATCH_MAX_AGE,
  WATCH_MIN_AGE,
  buildDailyPicks,
  buildDailyPool,
  buildOpportunitySegments,
  deriveEventFactors,
  deriveSignalLabel,
  netReturnsOf,
  slotReturnOf,
  type ArmId,
  type DailyArmStat,
  type DailyPoolRow,
  type EventAccounting,
  type EventFactorValues,
  type MaxAmp5Computer,
  type OpportunitySegment,
  type PairedField,
  type PoolBar,
  type PoolEvent,
  type RawSignalLabel,
  type SegmentSignalInput,
  type SignalLabelRow,
} from "@experiments/shared/rollingPoolRightTail";
import {
  averageDayStats,
  judgeVerdict,
  meanOf,
  pairedDifferenceInterval,
  summarizeDay,
  yearSlices,
} from "@experiments/shared/rollingPoolRightTail/stats";
import { RIGHT_TAIL_MIN_DECISION_DAYS } from "@experiments/shared/singleFactor/rightTailTypes";
import {
  COMPUTATION_VERSION,
  assembleRollingPoolResult,
  rollingPoolCustomPayloadSchema,
  type ArmSummary,
  type ArmVerdict,
  type RollingPoolComputeOutput,
} from "./result";

// ---------------------------------------------------------------------------
// 冻结声明
// ---------------------------------------------------------------------------

/**
 * 事件日下界（**只为限制读取量，不改变研究范围**）。
 *
 * 2024-01-02 往前 40 个交易日 ≈ 2023-11-03；再留 ~43 个自然日缓冲以吸收停牌缺口
 * （实测 `rd11` 距事件日最长 26 自然日）⇒ 2023-09-01 起的事件是**安全超集**。
 * 仍早于窗口的事件不会被扫描进候选，但**不会**被当成「未入池」——
 * 它们记 `EVENT_OUTSIDE_POOL_WINDOW` 并如实进入样本账。
 */
const EVENT_DATE_LOWER_BOUND = "2023-09-01";

/**
 * 长任务进度输出（**只写 stderr，不改变研究语义**）。
 *
 * `context.log` 只在 Run 结束时随 outcome 下发 ⇒ 长 Run 期间看不到进度。
 * 置 `ROLLING_POOL_PROGRESS=1` 时把「读到第几层相对日 / 池已建多少行」打到 stderr，
 * 由调用方落盘（规格 §S4：长任务日志落盘）。
 */
function progress(message: string): void {
  if (process.env.ROLLING_POOL_PROGRESS === "1") {
    process.stderr.write(`[rolling-pool-progress] ${new Date().toISOString()} ${message}\n`);
  }
}

const PAIRING_FIELDS: readonly PairedField[] = [
  "tail20Rate",
  "tail20Rate50",
  "tail50Rate",
  "tail100Rate",
  "pathTail20Rate",
  "meanNetReturn",
  "meanNetReturn50",
  "medianNetReturn",
  "winRate",
  "loss10Rate",
  "q05",
  "noFillRate",
];

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeBar(row: ExperimentBarRow): PoolBar {
  const values = row.values;
  return {
    relativeDay: row.relativeDay,
    tradeDate: row.tradeDate,
    open: asNumber(values.open),
    high: asNumber(values.high),
    low: asNumber(values.low),
    close: asNumber(values.close),
    preClose: asNumber(values.preClose),
    limitUpPrice: asNumber(values.limitUpPrice),
    limitDownPrice: asNumber(values.limitDownPrice),
    // 旧实验未在 requiredColumns 里声明 `volume` ⇒ 恒为 null；旧实验不读该字段（行为不变）。
    volume: asNumber(values.volume),
    // 同理：旧实验未声明 `amount` ⇒ 恒为 null；旧实验不读它（行为不变）。
    amount: asNumber(values.amount),
    barPresent: asBoolean(values.barPresent) ?? true,
    suspended: asString(values.suspensionStatus) === "SUSPENDED",
    canBuyAtOpen: asBoolean(values.canBuyAtOpen),
    canSellAtClose: asBoolean(values.canSellAtClose),
  };
}

interface EventSeed {
  readonly eventId: string;
  readonly symbol: string;
  readonly eventDate: string;
  readonly year: number;
  readonly market: string;
  readonly boardType: string;
}

// ---------------------------------------------------------------------------
// 权威 maxAmp5（经 Core，不复制公式）
// ---------------------------------------------------------------------------

function featureBarsFor(
  eventDayBar: PoolBar,
  bars: readonly PoolBar[],
): readonly VisibleBar[] {
  const toVisible = (bar: PoolBar): VisibleBar => ({
    date: bar.tradeDate,
    relativeDay: bar.relativeDay,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: null,
    amount: null,
    preClose: bar.preClose,
  });
  return [toVisible(eventDayBar), ...bars.map(toVisible)];
}

/**
 * 构造 Core `maxAmp5` 计算器。
 *
 * 🔴 决策时点 = **rd15**（Core 冻结下界）。对任意可选年龄 `a ≥ 15`，Core 的定义把
 *    rd16..a 全部过滤掉 ⇒ 取值相同；因此「一次算完、逐日复用」**不是**偷看未来。
 */
export function makeCoreMaxAmp5Computer(experimentId: string): MaxAmp5Computer {
  const feature = getDefaultFeatureRegistry().get(EVENT_STATE_AMPLITUDE_FEATURE_IDS.maxAmp5);
  if (feature === null) {
    throw new Error(
      `实验 "${experimentId}" 需要 Strategy Core 特征 "${EVENT_STATE_AMPLITUDE_FEATURE_IDS.maxAmp5}"，` +
        "但默认特征注册表里不存在 —— 拒绝静默降级。",
    );
  }
  return ({ eventDayBar, barsThroughRd15 }) => {
    const visible = featureBarsFor(eventDayBar, barsThroughRd15);
    const access = createDayScopedBarAccess(
      { bars: visible },
      SELECTABLE_AGE_LOWER_BOUND,
    );
    const barsUpTo = access.barsUpTo(SELECTABLE_AGE_LOWER_BOUND);
    if (access.violations().length > 0) {
      throw new Error(
        `实验 "${experimentId}" 在计算 maxAmp5 时发生 PIT 越界读取（Core 访问器已记录违规）—— 拒绝继续。`,
      );
    }
    const value = feature.compute({
      asOf: makeEvaluationTime(eventDayBar.tradeDate, "close"),
      bars: barsUpTo,
      eventDayBar: barsUpTo[0] ?? null,
      eventField: () => null,
      parameters: {},
    });
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
}

// ---------------------------------------------------------------------------
// 实验定义
// ---------------------------------------------------------------------------

export const rollingPoolRightTailMvpExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/rolling-pool-right-tail-mvp",
    name: "首板滚动观察池 × 每日右尾识别（最小研究闭环）",
    version: COMPUTATION_VERSION,
    description:
      "首板事件入池后逐日观察（rd1..40），同股票只保留最早未过期成员作为锚点；" +
      "每天基于**当天收盘可知**的信息按 preReturn10 HIGH / maxAmp5 LOW 各选最多 3 只，" +
      "与同日同池同人数的均匀无放回 Random（200 固定种子）对照，" +
      "看「从下一交易日开盘起的 20 交易日右尾机会」是否有增量、代价是多少。" +
      "这是**研究标签**口径，不是平台 NEXT_OPEN 策略回测，也不是盈利承诺。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: ["rolling-pool", "right-tail", "event-state", "pre-return", "mvp"],
    /**
     * `PLAN-RESEARCH-DESIGN-001` P2 —— 靶指标必须是**尾部**，并强制与均值并列报告。
     * 这里只声明 M 臂（主臂定义见 `preRegisteredCriteria`）。
     */
    targetMetric: {
      code: "tail20RateDifferenceVsSameDayRandom",
      label: "20 日固定持有净收益 ≥ +20% 的概率 − 同日同池 Random 的对应概率",
      rationale:
        "尾部目标是「抓到右尾」，而组合总收益是少数几笔的统计量（151% = 9 笔）；" +
        "把尾部概率列为主判据、并同时报净均值与左尾，才不会得出方向相反的结论。",
      kind: "TAIL",
      reportMeanAlongside: true,
    },
    /** `PLAN-RESEARCH-DESIGN-001` P5 —— 事前判据；**事后不得修改**。 */
    preRegisteredCriteria: {
      criteria: [
        "主右尾判据 = 20bps 口径下「20 日固定持有净收益 ≥ +20%」的逐日概率，与同日同池 Random 的配对差。",
        "两预声明主臂（R = preReturn10 HIGH；M = maxAmp5 LOW）用 Bonferroni 同时区间：每臂 97.5% 双侧 CI。",
        "差值区间用日期移动块 bootstrap：主 block20、敏感性 block40，固定 1000 次。",
        "2024 与 2025 两个片段的点估计必须**同向**。",
        "至少 50 个唯一机会段（同 symbol 相邻信号标签窗共享交易日）包含该臂的主右尾命中。",
        "NO_FILL / 右删失 / 未退出 MTM 必须与结果一并披露，且不得因此删除样本或递补第 4 名。",
      ],
      abortConditions: [
        "Dataset 不是 READY，或 `postRelativeDayRange.max < 70`（标签视界不足）⇒ 中止，不跑。",
        "`freezeSelection` 之前的任何 `observation()` 调用 ⇒ 结构级拒绝（平台闸门）。",
        "计算 maxAmp5 时 Core 日范围访问器记录到 PIT 越界 ⇒ 中止，不出结论。",
        "冻结集为空 / 决策日 < 2 ⇒ 中止，不出结论。",
      ],
      stoppingRule:
        "两条主臂都按上述规则收口；结果为负或证据不足即关闭本方向，" +
        "**不追加变量、期限、TopK 或门槛**，也不因结果难看而删样本。",
    },
    parameters: [],
    datasetRequirement: {
      datasetCode: FIRST_BOARD_DATASET_CODE,
      requiredDatasetVersionLabel: FROZEN_DATASET_VERSION_LABEL,
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "market"],
        feature: ["open", "high", "low", "close", "preClose"],
        observation: [
          "open",
          "high",
          "low",
          "close",
          "preClose",
          "limitUpPrice",
          "limitDownPrice",
          "barPresent",
          "suspensionStatus",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [...PREFIX_RELATIVE_DAYS],
      postRelativeDays: [...POST_RELATIVE_DAYS],
      /**
       * 🔴 契约缺口：本字段是**单标量**，无法表达滚动池**逐日变化**的决策坐标。
       * 这里声明 `40` = 资格判定使用的相对日**上界**（任何一天的资格判定都不会用到 rd ≥ 41），
       * 是**上界声明**，不是逐日精确坐标。逐日坐标由内存投影表达（见模块头注释与 contractGaps）。
       */
      decisionOffsetDays: WATCH_MAX_AGE,
      usesForwardData: true,
      forwardDataPurpose:
        "逐日观察账里「下一交易日是否可买」的执行事实；以及决策后下一交易日开盘入场、" +
        "持有 20 交易日的收益标签（含顺延与右删失）。未来数据**只用于已冻结样本的结果观察**，" +
        "绝不参与资格判定或排名。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/rolling-pool-right-tail-mvp",
    pageTitle: "首板滚动观察池 × 每日右尾识别",
  },

  resultSchema: rollingPoolCustomPayloadSchema,

  async run(context: ExperimentRunContext): Promise<ExperimentResultPayload> {
    const { dataset, log, artifact, freezeSelection } = context;
    const facts = dataset.facts;
    const wanted = new Set<string>();

    // ── 1) 事件扫描（FULL_DATASET，逐页消费；不静默截断）──────────────────
    const excludedByReason: Record<string, number> = {};
    const bump = (code: string, count = 1): void => {
      if (count <= 0) return;
      excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };
    const seen = new Set<string>();
    const seeds: EventSeed[] = [];
    let scannedEventCount = 0;
    for await (const page of dataset.eventPages()) {
      for (const row of page as readonly ExperimentEventRow[]) {
        scannedEventCount += 1;
        if (seen.has(row.eventId)) {
          bump("DUPLICATE_EVENT_ID");
          continue;
        }
        seen.add(row.eventId);
        if (row.values.isFirstLimit !== true) {
          bump("NOT_FIRST_LIMIT");
          continue;
        }
        const market = asString(row.values.market);
        const boardType = asString(row.values.boardType);
        if (boardType !== "main" || (market !== "SH" && market !== "SZ")) {
          bump("NOT_MAIN_BOARD");
          continue;
        }
        if (row.tradeDate < EVENT_DATE_LOWER_BOUND || row.tradeDate > MAIN_WINDOW.endDate) {
          bump("EVENT_OUTSIDE_POOL_WINDOW");
          continue;
        }
        seeds.push({
          eventId: row.eventId,
          symbol: row.symbol,
          eventDate: row.tradeDate,
          year: Number(row.tradeDate.slice(0, 4)),
          market: market!,
          boardType: boardType!,
        });
        wanted.add(row.eventId);
      }
    }
    log(
      `事件扫描：候选池 ${seeds.length} / 扫描 ${scannedEventCount}（数据集声明 ${facts.totalEvents ?? "未知"}）；` +
        `剔除 ${JSON.stringify(excludedByReason)}`,
    );

    // ── 2) 冻结样本资格（必须在第一次 observation() 之前）───────────────
    freezeSelection([...wanted]);

    // ── 3) prefix：rd −10 / −1 / 0 ─────────────────────────────────────
    const prefixByEvent = new Map<string, Map<number, PoolBar>>();
    for (const relativeDay of PREFIX_RELATIVE_DAYS) {
      const rows = await dataset.feature(relativeDay);
      for (const row of rows) {
        if (!wanted.has(row.eventId)) continue;
        let map = prefixByEvent.get(row.eventId);
        if (map === undefined) {
          map = new Map<number, PoolBar>();
          prefixByEvent.set(row.eventId, map);
        }
        map.set(relativeDay, normalizeBar(row));
      }
      log(`prefix rd=${relativeDay} 读入 ${rows.length} 行`);
      progress(`prefix rd=${relativeDay} rows=${rows.length}`);
    }

    // ── 4) post：rd 1..70（滚动池窗口 + 持有 20 + 顺延 10）──────────────
    const postByEvent = new Map<string, Map<number, PoolBar>>();
    for (const relativeDay of POST_RELATIVE_DAYS) {
      const rows = await dataset.observation(relativeDay);
      for (const row of rows) {
        if (!wanted.has(row.eventId)) continue;
        let map = postByEvent.get(row.eventId);
        if (map === undefined) {
          map = new Map<number, PoolBar>();
          postByEvent.set(row.eventId, map);
        }
        map.set(relativeDay, normalizeBar(row));
      }
      if (relativeDay % 10 === 0 || relativeDay === MAX_POST_RELATIVE_DAY_NEEDED) {
        log(`post rd=${relativeDay}/${MAX_POST_RELATIVE_DAY_NEEDED} 累计事件 ${postByEvent.size}`);
      }
      progress(`post rd=${relativeDay}/${MAX_POST_RELATIVE_DAY_NEEDED} rows=${rows.length} events=${postByEvent.size}`);
    }

    // ── 5) 事件归一化 ────────────────────────────────────────────────
    const poolEvents: PoolEvent[] = [];
    for (const seed of seeds) {
      const post = postByEvent.get(seed.eventId);
      if (post === undefined || post.size === 0) continue;
      poolEvents.push({
        ...seed,
        isFirstLimit: true,
        prefix: prefixByEvent.get(seed.eventId) ?? new Map<number, PoolBar>(),
        post,
      });
    }

    // ── 6) 两个固定因子（maxAmp5 走 Core 权威实现）───────────────────────
    const computeMaxAmp5 = makeCoreMaxAmp5Computer(context.descriptor.id);
    const factors: ReadonlyMap<string, EventFactorValues> = deriveEventFactors(
      poolEvents,
      computeMaxAmp5,
    );

    // ── 7) 逐日池 + 三臂 ─────────────────────────────────────────────
    const pool = buildDailyPool({ events: poolEvents, factors });
    progress(`daily pool built: rows=${pool.dailyRows.length} dates=${pool.decisionDates.length}`);
    for (const eventId of pool.pooledEventIds) wanted.delete(eventId);
    // `wanted` 剩下的 = 通过日期粗筛但窗口内从未进入观察池的事件。
    bump("NEVER_IN_WATCH_POOL", wanted.size);

    const picks = buildDailyPicks({
      dailyRows: pool.dailyRows,
      eligibleEventIdsByDate: pool.eligibleEventIdsByDate,
      decisionDates: pool.decisionDates,
    });

    const eventById = new Map(poolEvents.map((event) => [event.eventId, event]));
    const rowByDateEvent = new Map<string, DailyPoolRow>();
    for (const row of pool.dailyRows) rowByDateEvent.set(`${row.date}|${row.anchorEventId}`, row);

    const labelCache = new Map<string, RawSignalLabel>();
    const labelFor = (eventId: string, age: number): RawSignalLabel => {
      const key = `${eventId}@${age}`;
      let cached = labelCache.get(key);
      if (cached === undefined) {
        const event = eventById.get(eventId);
        cached =
          event === undefined
            ? deriveSignalLabel(
                { eventId, symbol: "", eventDate: "", year: 0, market: "", boardType: "", isFirstLimit: true, prefix: new Map(), post: new Map() },
                age,
              )
            : deriveSignalLabel(event, age);
        labelCache.set(key, cached);
      }
      return cached;
    };

    const signalRows: SignalLabelRow[] = [];
    const segmentsInput: SegmentSignalInput[] = [];
    const armDDays: Record<"R" | "M", DailyArmStat[]> = { R: [], M: [] };
    const randomDays: DailyArmStat[] = [];
    const poolSizes: number[] = [];
    const randomDrawRows: string[] = [];

    const pushSignal = (args: {
      date: string;
      arm: ArmId;
      drawIndex: number;
      row: DailyPoolRow;
      label: RawSignalLabel;
    }): void => {
      const nets = netReturnsOf(args.label);
      const tail20Hit = nets.net20bps !== null && nets.net20bps >= 0.2;
      const windowEnd = args.label.exitDate ?? args.label.entryDate;
      signalRows.push({
        date: args.date,
        arm: args.arm,
        drawIndex: args.drawIndex,
        symbol: args.row.symbol,
        anchorEventId: args.row.anchorEventId,
        eventAge: args.row.eventAge,
        labelCode: args.label.labelCode,
        entryDate: args.label.entryDate,
        entryRelativeDay: args.label.entryRelativeDay,
        exitDate: args.label.exitDate,
        exitRelativeDay: args.label.exitRelativeDay,
        deferredTradingDays: args.label.deferredTradingDays,
        grossReturn: args.label.grossReturn,
        netReturn20bps: nets.net20bps,
        netReturn50bps: nets.net50bps,
        pathMaxReturn: args.label.pathMaxReturn,
        pathPlus20TradingDay: args.label.pathPlus20TradingDay,
      });
      segmentsInput.push({
        symbol: args.row.symbol,
        date: args.date,
        arm: args.arm,
        windowStart: args.label.entryDate,
        windowEnd,
        tail20Hit,
      });
    };

    for (const pick of picks) {
      poolSizes.push(pick.poolSize);
      if (pick.poolSize === 0) {
        for (const arm of ["R", "M"] as const) {
          armDDays[arm].push(summarizeDay({ date: pick.date, poolSize: 0, signals: [] }));
        }
        randomDays.push(summarizeDay({ date: pick.date, poolSize: 0, signals: [] }));
        continue;
      }
      const readoutOf = (eventId: string): ReturnType<typeof readoutFor> | null => {
        const row = rowByDateEvent.get(`${pick.date}|${eventId}`);
        if (row === undefined) return null;
        return readoutFor(row, labelFor(eventId, row.eventAge));
      };
      for (const arm of ["R", "M"] as const) {
        const ids = arm === "R" ? pick.armR : pick.armM;
        const readouts: ReturnType<typeof readoutFor>[] = [];
        for (const eventId of ids) {
          const row = rowByDateEvent.get(`${pick.date}|${eventId}`);
          if (row === undefined) continue;
          const label = labelFor(eventId, row.eventAge);
          readouts.push(readoutFor(row, label));
          pushSignal({ date: pick.date, arm, drawIndex: -1, row, label });
        }
        armDDays[arm].push(
          summarizeDay({ date: pick.date, poolSize: pick.poolSize, signals: readouts }),
        );
      }

      const drawStats: DailyArmStat[] = [];
      for (let draw = 0; draw < pick.randomDraws.length; draw += 1) {
        const drawn = pick.randomDraws[draw]!;
        const readouts: ReturnType<typeof readoutFor>[] = [];
        for (const eventId of drawn) {
          const readout = readoutOf(eventId);
          if (readout !== null) readouts.push(readout);
        }
        drawStats.push(summarizeDay({ date: pick.date, poolSize: pick.poolSize, signals: readouts }));
        randomDrawRows.push(
          `${pick.date},${draw},${RANDOM_SEED_BASE + draw},${pick.poolSize},"${drawn.join("|")}"`,
        );
      }
      randomDays.push(
        averageDayStats({ date: pick.date, poolSize: pick.poolSize, draws: drawStats }),
      );
    }

    function readoutFor(row: DailyPoolRow, label: RawSignalLabel) {
      const nets = netReturnsOf(label);
      const censored = label.labelCode === "RIGHT_CENSORED";
      return {
        slotNet20: censored ? null : slotReturnOf(label, nets.net20bps),
        slotNet50: censored ? null : slotReturnOf(label, nets.net50bps),
        fillNet20: label.labelCode === "EXECUTABLE" || label.labelCode === "UNEXITED_MTM" ? nets.net20bps : null,
        fillNet50: label.labelCode === "EXECUTABLE" || label.labelCode === "UNEXITED_MTM" ? nets.net50bps : null,
        pathMax: label.pathMaxReturn,
        noFill: label.labelCode === "NO_FILL",
      };
    }

    // ── 8) 臂汇总 + 判定 ─────────────────────────────────────────────
    const arms: ArmSummary[] = [];
    const verdicts: ArmVerdict[] = [];
    for (const arm of ["R", "M"] as const) {
      const days = armDDays[arm];
      const rows = signalRows.filter((row) => row.arm === arm);
      const summary = summarizeArm({
        arm,
        days,
        randomDays,
        rows,
        segments: buildOpportunitySegments(segmentsInput, arm),
        targetMetricField: "tail20Rate",
      });
      arms.push(summary.summary);
      verdicts.push(summary.verdict);
    }
    const randomSummary = summarizeRandomArm({ days: randomDays });

    // ── 9) 产物（大表落对象存储；信封只放摘要）─────────────────────────
    // 🔴 每日账在完整窗口下可达数十万行（≈68 万），超过单产物 64MB 上限
    //    ⇒ 按**日历季度**分片（确定性、可重建），每片远低于上限，总预算仍远低于 256MB。
    const ledgerHeader = [
      "date", "symbol", "anchorEventId", "eventAge", "relatedEventIds", "anchorChanged",
      "signalEligible", "rejectionReasons", "preReturn10", "maxAmp5",
      "limitUpCount3", "limitUpCount5", "consecutiveLimitUp", "daysSinceLastLimitUp",
      "limitDownStreak", "canBuyAtOpenToday", "canSellAtCloseToday", "nextOpenExecutable",
      "dailyStStatus",
    ];
    const ledgerShards = new Map<string, DailyPoolRow[]>();
    for (const row of pool.dailyRows) {
      const month = Number(row.date.slice(5, 7));
      const shard = `${row.date.slice(0, 4)}Q${Math.floor((month - 1) / 3) + 1}`;
      const list = ledgerShards.get(shard) ?? [];
      list.push(row);
      ledgerShards.set(shard, list);
    }
    for (const shard of [...ledgerShards.keys()].sort()) {
      artifact({
        name: `daily-pool-ledger-${shard}.csv`,
        role: "table",
        body: toCsv(ledgerHeader, ledgerShards.get(shard)!),
        contentType: "text/csv",
        label: `每日股票级观察账 ${shard}（CSV）`,
        description:
          "date/symbol/anchorEventId/eventAge/relatedEventIds/状态可用性/两因子值与缺失原因/资格与拒绝原因/" +
          "路径状态（仅描述）/nextOpenExecutable（下一交易日真实执行结果，绝不参与排名）。" +
          "按日历季度分片，避免单产物超过 64MB。",
      });
    }
    artifact({
      name: "signal-ledger.csv",
      role: "table",
      body: toCsv(
        [
          "date", "arm", "drawIndex", "symbol", "anchorEventId", "eventAge", "labelCode",
          "entryDate", "entryRelativeDay", "exitDate", "exitRelativeDay", "deferredTradingDays",
          "grossReturn", "netReturn20bps", "netReturn50bps", "pathMaxReturn", "pathPlus20TradingDay",
        ],
        signalRows,
      ),
      contentType: "text/csv",
      label: "信号账（CSV）",
      description:
        "R/M 逐信号；NO_FILL / 右删失 / 未退出 MTM 全部保留，不递补第 4 名、不删样本。Random 臂为 200 次抽样的均值口径（逐次成员见 random-draws.csv）。",
    });
    artifact({
      name: "random-draws.csv",
      role: "table",
      body: [
        "date,drawIndex,seedIndex,poolSize,eventIds",
        ...randomDrawRows,
      ].join("\n"),
      contentType: "text/csv",
      label: "随机对照抽样明细（CSV）",
      description:
        `同日同池、同人数、均匀无放回；种子规则 = FNV-1a("uniform-random"|seedIndex|date)，seedIndex = ${RANDOM_SEED_BASE} + drawIndex。`,
    });
    artifact({
      name: "daily-arm-stats.csv",
      role: "table",
      body: toCsv(
        [
          "date", "arm", "poolSize", "signalCount", "meanNetReturn", "medianNetReturn", "winRate",
          "loss10Rate", "q05", "tail20Rate", "tail50Rate", "tail100Rate", "pathTail20Rate", "noFillRate",
        ],
        [
          ...armDDays.R.map((day) => ({ ...day, arm: "R" })),
          ...armDDays.M.map((day) => ({ ...day, arm: "M" })),
          ...randomDays.map((day) => ({ ...day, arm: "RANDOM" })),
        ],
      ),
      contentType: "text/csv",
      label: "逐日逐臂统计（CSV）",
      description: "配对差序列的输入：每天每种臂的当日统计量（Random 为 200 次抽样的均值）。",
    });
    artifact({
      name: "opportunity-segments.csv",
      role: "table",
      body: toCsv(
        ["arm", "symbol", "startDate", "endDate", "signalCount", "tail20Hit", "firstSignalDate"],
        (["R", "M"] as const).flatMap((arm) =>
          buildOpportunitySegments(segmentsInput, arm).map((segment) => ({
            arm,
            symbol: segment.symbol,
            startDate: segment.startDate,
            endDate: segment.endDate,
            signalCount: segment.signalDates.length,
            tail20Hit: segment.tail20Hit,
            firstSignalDate: segment.firstSignalDate,
          })),
        ),
      ),
      contentType: "text/csv",
      label: "唯一机会段（CSV）",
      description:
        "同 symbol 的相邻信号标签窗**共享交易日**即同一机会段（离线合并口径）。段边界用了未来信息，**不得**用于实时选择；段数**不是**独立样本数。",
    });
    artifact({
      name: "rolling-pool-config.json",
      role: "artifact",
      body: JSON.stringify(
        {
          computationVersion: COMPUTATION_VERSION,
          experimentId: context.descriptor.id,
          codeDigest: context.codeDigest,
          datasetVersionId: facts.datasetVersionId,
          datasetVersionLabel: facts.datasetVersionLabel,
          datasetStatusCode: facts.status,
          mainWindow: MAIN_WINDOW,
          watchAgeRange: [WATCH_MIN_AGE, WATCH_MAX_AGE],
          selectableLowerBound: SELECTABLE_AGE_LOWER_BOUND,
          topK: TOP_K,
          randomDrawCount: RANDOM_DRAW_COUNT,
          randomSeedBase: RANDOM_SEED_BASE,
          holdingDays: HOLDING_DAYS,
          exitDeferralMaxTradingDays: EXIT_DEFERRAL_MAX_TRADING_DAYS,
          maxPostRelativeDayNeeded: MAX_POST_RELATIVE_DAY_NEEDED,
          decisionOffsetDaysDeclared: WATCH_MAX_AGE,
          anchorSwitchCount: pool.anchorSwitchCount,
          scannedEventCount,
          pooledEventCount: pool.pooledEventIds.size,
          decisionDateCount: pool.decisionDates.length,
        },
        null,
        2,
      ),
      contentType: "application/json",
      label: "冻结配置与坐标（JSON）",
      description: "本 Run 的固定配置、Dataset 坐标与规模，供复现核对。",
    });

    // ── 10) 样本账 + 信封 ────────────────────────────────────────────
    const eligibleEventCount = pool.pooledEventIds.size;
    const accounting: EventAccounting = {
      scannedEventCount,
      eligibleEventCount,
      excludedByReason,
      unscannedEventCount:
        facts.totalEvents === null ? 0 : Math.max(0, facts.totalEvents - scannedEventCount),
      datasetDeclaredEventCount: facts.totalEvents,
    };

    const ageHistogram = buildAgeHistogram(pool.dailyRows);
    const output: RollingPoolComputeOutput = {
      accounting,
      anchorSwitchCount: pool.anchorSwitchCount,
      decisionDateCount: pool.decisionDates.length,
      dailyLedgerRowCount: pool.dailyRows.length,
      calibrationNote:
        "区间估计口径：逐日先配对求差（臂 − 同日 Random），再对日序列做日期移动块 bootstrap；" +
        "主 block20、敏感性 block40、1000 次、固定种子；97.5% 双侧分位点用于 Bonferroni 同时区间。" +
        "禁用 sd/√n（同日依赖主导：既有实测同日 ICC ≈ +0.19）。",
      coverageNotes: [
        `每日可评估池大小：最小 ${minOf(poolSizes) ?? 0} / 中位 ${medianOf(poolSizes) ?? 0} / 最大 ${maxOf(poolSizes) ?? 0}。`,
        `Random 种子：seedIndex = ${RANDOM_SEED_BASE} + drawIndex（0..${RANDOM_DRAW_COUNT - 1}），逐次留档于 random-draws.csv。`,
        `成本口径：固定往返 ${20}bps 为主、${50}bps 为敏感性；两者是**标签诊断**，不是真实账户费率或冲击模型。`,
      ],
      arms: [...arms, randomSummary],
      verdicts,
      segments: buildOpportunitySegments(segmentsInput, "R"),
      pairingFields: PAIRING_FIELDS,
      poolSizeByDate: {
        min: minOf(poolSizes) ?? 0,
        median: medianOf(poolSizes) ?? 0,
        max: maxOf(poolSizes) ?? 0,
      },
      ageHistogram,
      repeatSignalNote:
        "重复信号 = 同一股票在不同决策日被再次选中；跨日重复**照实记录**，" +
        "但「唯一赢家」按离线机会段口径计数，不把同一次上涨每天算成新赢家。",
    };

    log(
      `完成：决策日 ${output.decisionDateCount}；每日账 ${output.dailyLedgerRowCount} 行；` +
        `锚点切换 ${output.anchorSwitchCount}；信号 ${signalRows.length}；判定 ` +
        verdicts.map((item) => `${item.arm}=${item.verdict}`).join(" / "),
    );

    return assembleRollingPoolResult({
      output,
      datasetVersionId: facts.datasetVersionId,
      datasetVersionLabel: facts.datasetVersionLabel,
    });
  },
};

// ---------------------------------------------------------------------------
// 汇总辅助（本文件内私有）
// ---------------------------------------------------------------------------

function summarizeArm(args: {
  arm: "R" | "M";
  days: readonly DailyArmStat[];
  randomDays: readonly DailyArmStat[];
  rows: readonly SignalLabelRow[];
  segments: readonly OpportunitySegment[];
  targetMetricField: PairedField;
}): { summary: ArmSummary; verdict: ArmVerdict } {
  const dayValues = (field: PairedField): number[] =>
    args.days
      .map((day) => day[field])
      .filter((value): value is number => value !== null);

  const differences: Record<string, ReturnType<typeof pairedDifferenceInterval>> = {};
  for (const field of PAIRING_FIELDS) {
    differences[`${field}|${BOOTSTRAP_BLOCK_PRIMARY}`] = pairedDifferenceInterval({
      armDays: args.days,
      randomDays: args.randomDays,
      field,
      blockLength: BOOTSTRAP_BLOCK_PRIMARY,
      quantiles: CI_QUANTILES,
    });
    differences[`${field}|${BOOTSTRAP_BLOCK_SENSITIVITY}`] = pairedDifferenceInterval({
      armDays: args.days,
      randomDays: args.randomDays,
      field,
      blockLength: BOOTSTRAP_BLOCK_SENSITIVITY,
      quantiles: CI_QUANTILES,
    });
  }

  const primary = differences[`${args.targetMetricField}|${BOOTSTRAP_BLOCK_PRIMARY}`]!;
  const primaryBlock40 = differences[`${args.targetMetricField}|${BOOTSTRAP_BLOCK_SENSITIVITY}`]!;
  const yearly = yearSlices({ armDays: args.days, randomDays: args.randomDays, field: args.targetMetricField });
  const tailHitSegments = args.segments.filter((segment) => segment.tail20Hit).length;
  const signalCount = args.rows.length;
  const uniqueSymbols = new Set(args.rows.map((row) => row.symbol)).size;
  const executableCount = args.rows.filter(
    (row) => row.labelCode === "EXECUTABLE" || row.labelCode === "UNEXITED_MTM",
  ).length;
  const noFillCount = args.rows.filter((row) => row.labelCode === "NO_FILL").length;
  const censoredCount = args.rows.filter((row) => row.labelCode === "RIGHT_CENSORED").length;
  const mtmCount = args.rows.filter((row) => row.labelCode === "UNEXITED_MTM").length;

  const coverageSufficient =
    primary.dayCount >= RIGHT_TAIL_MIN_DECISION_DAYS &&
    (signalCount === 0 || censoredCount / signalCount <= 0.2);

  const verdict = judgeVerdict({
    primary,
    primaryBlock40,
    yearly,
    uniqueOpportunitySegmentsWithTailHit: tailHitSegments,
    loss10: differences[`loss10Rate|${BOOTSTRAP_BLOCK_PRIMARY}`]!,
    mean: differences[`meanNetReturn|${BOOTSTRAP_BLOCK_PRIMARY}`]!,
    coverageSufficient,
  });

  const summary: ArmSummary = {
    arm: args.arm,
    label: ARM_LABELS[args.arm],
    decisionDayCount: args.days.filter((day) => day.signalCount > 0).length,
    signalCount,
    uniqueSymbolCount: uniqueSymbols,
    noFillCount,
    rightCensoredCount: censoredCount,
    unexitedMtmCount: mtmCount,
    executableCount,
    meanNet20: meanOf(dayValues("meanNetReturn")),
    meanNet50: meanOf(dayValues("meanNetReturn50")),
    medianNet20: meanOf(dayValues("medianNetReturn")),
    winRate: meanOf(dayValues("winRate")),
    loss10Rate: meanOf(dayValues("loss10Rate")),
    q05: meanOf(dayValues("q05")),
    tail20Rate: meanOf(dayValues("tail20Rate")),
    tail50Rate: meanOf(dayValues("tail50Rate")),
    tail100Rate: meanOf(dayValues("tail100Rate")),
    tail20Rate50: meanOf(dayValues("tail20Rate50")),
    pathTail20Rate: meanOf(dayValues("pathTail20Rate")),
    noFillRate: meanOf(dayValues("noFillRate")),
    repeatedSignalRate: signalCount === 0 ? null : (signalCount - uniqueSymbols) / signalCount,
    differences,
    yearly,
    opportunitySegmentCount: args.segments.length,
    opportunitySegmentsWithTailHit: tailHitSegments,
  };

  return {
    summary,
    verdict: {
      arm: args.arm,
      verdict: verdict.verdict,
      reasons: verdict.reasons,
      rightTailEvidence: verdict.rightTailEvidence,
      riskTradeoff: verdict.riskTradeoff,
    },
  };
}

function summarizeRandomArm(args: {
  days: readonly DailyArmStat[];
}): ArmSummary {
  const dayValues = (field: PairedField): number[] =>
    args.days
      .map((day) => day[field])
      .filter((value): value is number => value !== null);
  const expectedSignals = args.days.reduce((sum, day) => sum + day.signalCount, 0);
  const expectedNoFill = args.days.reduce(
    (sum, day) => sum + (day.noFillRate ?? 0) * day.signalCount,
    0,
  );
  return {
    arm: "RANDOM",
    label: ARM_LABELS.RANDOM,
    decisionDayCount: args.days.filter((day) => day.signalCount > 0).length,
    signalCount: Math.round(expectedSignals),
    uniqueSymbolCount: 0,
    noFillCount: Math.round(expectedNoFill),
    rightCensoredCount: 0,
    unexitedMtmCount: 0,
    executableCount: Math.round(expectedSignals - expectedNoFill),
    meanNet20: meanOf(dayValues("meanNetReturn")),
    meanNet50: meanOf(dayValues("meanNetReturn50")),
    medianNet20: meanOf(dayValues("medianNetReturn")),
    winRate: meanOf(dayValues("winRate")),
    loss10Rate: meanOf(dayValues("loss10Rate")),
    q05: meanOf(dayValues("q05")),
    tail20Rate: meanOf(dayValues("tail20Rate")),
    tail50Rate: meanOf(dayValues("tail50Rate")),
    tail100Rate: meanOf(dayValues("tail100Rate")),
    tail20Rate50: meanOf(dayValues("tail20Rate50")),
    pathTail20Rate: meanOf(dayValues("pathTail20Rate")),
    noFillRate: meanOf(dayValues("noFillRate")),
    repeatedSignalRate: null,
    differences: {},
    yearly: [],
    opportunitySegmentCount: 0,
    opportunitySegmentsWithTailHit: 0,
  };
}

function buildAgeHistogram(
  rows: readonly DailyPoolRow[],
): readonly { age: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.eventAge, (counts.get(row.eventAge) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([age, count]) => ({ age, count }))
    .sort((left, right) => left.age - right.age);
}

function toCsv(
  header: readonly string[],
  rows: readonly object[],
): string {
  const lines = [header.join(",")];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    lines.push(
      header
        .map((key) => {
          const value = record[key];
          if (value === null || value === undefined) return "";
          if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
          if (typeof value === "boolean") return value ? "true" : "false";
          const text = String(value);
          return text.includes(",") || text.includes('"') || text.includes("\n")
            ? `"${text.replace(/"/g, '""')}"`
            : text;
        })
        .join(","),
    );
  }
  return lines.join("\n");
}

function minOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

function maxOf(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export default rollingPoolRightTailMvpExperiment;
