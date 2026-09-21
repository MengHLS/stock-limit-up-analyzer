/**
 * EXP-001 · 首板后回踩第一性研究（`first-board-pullback/fundamental-study`）。
 *
 * ## 研究问题
 *
 * 一只股票**首次涨停**（首板）之后，未来 T+1～T+5 的价格路径、回踩行为、回踩深度、
 * **是否跌破首板日开盘价**，以及不同观察 / 入场时点之后的后续表现 ——
 * 「这个现象到底存不存在、强不强、在哪些维度上存在、哪些地方值得进一步策略化」。
 *
 * ## 本实验**不是** Parameter Search
 *
 * 研究范围参数（观察日上限 / 后续视界 / 回撤分桶边界）都是**研究口径**，不是待寻优的参数。
 * 本实验刻意**不输出** best / worst / rank，不选「最优买入日」，不选「最优回撤区间」，
 * 也**不自动创建 Strategy** —— 参数空间探索属于 Parameter Search，策略选择属于后续阶段。
 *
 * ## 本文件演示的六件事（外部 AI 生成本类实验时照这个骨架写）
 *
 * 1. `descriptor` 是**唯一**元数据来源：参数定义、Dataset 需求、页面键都在里面；
 * 2. **不碰 DB**：只通过 `context.dataset` 按声明取数（列投影 + 相对日白名单 + PIT 闸门）；
 * 3. **声明面 ⊇ 使用面**是可执行的不变量：参数上界派生自声明，缺声明就**响亮失败**；
 * 4. **样本账必须平**：`candidate = eligible + excluded`，且 `Σ excludedByReason === excluded`；
 * 5. **缺数据一律剔除并登记原因**，绝不用 0 兜底、绝不静默丢样本；
 * 6. 结果结构与组装在 `result.ts`（口径与呈现分离；`resultSchema` 与产物不可能漂移）。
 */

import type {
  ExperimentBarRow,
  ExperimentDefinition,
  ExperimentEventRow,
  ExperimentRunContext,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  DECLARED_DECISION_OFFSET_DAYS,
  DECLARED_POST_RELATIVE_DAYS,
  EXCLUSION_REASON_LABELS,
  FULL_DATASET_EVENT_SCAN_LIMIT,
  GROUP_LABELS,
  MAX_DECLARED_POST_RELATIVE_DAY,
  PLATFORM_EVENT_SCAN_LIMIT,
  assembleFundamentalStudyResult,
  buildArtifacts,
  buildDrawdownBuckets,
  buildObservations,
  buildPotentialHypotheses,
  deriveSample,
  fundamentalStudyCustomPayloadSchema,
  isExclusionReasonCode,
  isValidOhlc,
  renderBarChartSvg,
  renderGroupedBarChartSvg,
  renderLineChartSvg,
  summarizeDailyPath,
  summarizeDecisionConditionByDay,
  summarizeDrawdownBuckets,
  summarizeEntryDay,
  summarizeFutureHorizons,
  summarizeNonBreakVsBreak,
  toFiniteNumber,
  type SampleDerived,
  type StudyBar,
  type StudySample,
  type StudyTable,
} from "./result";

/** 首板日收盘价与 `limitUpPrice` 的交叉核对容差（信息性计数用，不触发剔除）。 */
const CLOSE_MISMATCH_TOLERANCE_RATIO = 0.005;

/** 六位小数展示 / 四位小数展示用的百分号格式化（仅用于日志与 SVG 轴标签）。 */
const percentText = (ratio: number | null, digits = 2): string =>
  ratio === null || !Number.isFinite(ratio) ? "—" : `${(ratio * 100).toFixed(digits)}%`;

export const fundamentalStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/fundamental-study",
    name: "首板后回踩第一性研究",
    version: COMPUTATION_VERSION,
    description:
      "首板之后 T+1～T+maxObservationDay 的价格路径、逐日回踩率、回踩深度、是否跌破首板日开盘价，" +
      "以及不同观察日 / 入场日的后续表现与分布。**纯描述性研究**：不排序、不评级、不判定最优，" +
      "不产出策略对象，也不做参数搜索。",
    source: "stock-limit-up-analyzer",
    tags: ["first-board", "pullback", "event-study", "distribution"],
    parameters: [
      {
        code: "maxObservationDay",
        label: "观察窗口上限（T+N）",
        description:
          "研究「截至 T+N」的路径条件与分组。上界刻意等于本实验声明的信息边界 " +
          `decisionOffsetDays = ${DECLARED_DECISION_OFFSET_DAYS}` + " —— 观察窗口一旦超过它，" +
          "「是否跌破首板日开盘价」就会用上尚未「当时可见」的数据。",
        kind: "INT",
        required: false,
        defaultValue: 5,
        bounds: { min: 1, max: DECLARED_DECISION_OFFSET_DAYS },
        unit: "个交易日",
      },
      {
        code: "futureHorizons",
        label: "后续研究视界（T+n）",
        description:
          "要统计的后续视界（事件日锚定）。这些是**事后研究结果**，不参与任何样本资格或分组判定。" +
          "超过数据集真实视界的视界会在结果里如实为 null（不夹取）。",
        kind: "INT_LIST",
        required: false,
        defaultValue: [5, 10, 20],
        bounds: { min: 1, max: MAX_DECLARED_POST_RELATIVE_DAY },
        unit: "个交易日",
      },
      {
        code: "drawdownBucketEdgesBps",
        label: "回撤分桶边界（基点）",
        description:
          "回撤深度的**研究观察桶**边界，单位基点（-200 = -2%）。必须严格递减、首项为 0、全部 ≤ 0。" +
          "这是观察口径而非寻优参数 —— 本实验不输出「最佳回撤区间」。",
        kind: "INT_LIST",
        required: false,
        defaultValue: [0, -200, -500, -800, -1000],
        bounds: { min: -10000, max: 0 },
        unit: "基点（1bp = 0.01%）",
      },
      {
        code: "maxEvents",
        label: "最大事件数",
        description:
          "本实验最多统计多少个首板事件（按事件日升序取前 N 个）。超出部分逐条登记为 " +
          "MAX_EVENTS_LIMIT，不静默丢弃。缺省 = 平台事件扫描**硬阀** " +
          `${FULL_DATASET_EVENT_SCAN_LIMIT}（即「不额外裁剪」）—— 本实验声明了 FULL_DATASET ` +
          "全量扫描策略，所以这个参数只用来**主动缩小**研究范围，不是用来突破扫描上限的。",
        kind: "INT",
        required: false,
        defaultValue: FULL_DATASET_EVENT_SCAN_LIMIT,
        bounds: { min: 100, max: FULL_DATASET_EVENT_SCAN_LIMIT },
        unit: "个事件",
      },
    ],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      /**
       * 🔴 本实验声明**全量扫描**：`candidateCount` 必须等于数据集声明的事件数
       *    （正式 Run = 23978），且 `unscannedEventCount` 必须为 0。
       *
       * 平台的安全阀**没有被删掉**：缺省策略仍是 `EXPERIMENT_EVENT_SCAN_LIMIT`（20000），
       * 只有显式声明 `FULL_DATASET` 的实验才升到硬阀，并因此**承担**「扫描量 = 声明量」
       * 的可解释性责任（账目缺口必须自己出数）。
       */
      eventScanPolicy: "FULL_DATASET",
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "limitUpPrice", "previousClose"],
        // rd = 0 = 首板日本身：基准价（开盘 / 收盘）的唯一来源，PIT 安全。
        feature: ["open", "high", "low", "close"],
        // rd ≥ 1 的观察日行情：路径 / 回踩 / 后续表现。
        observation: ["open", "high", "low", "close"],
      },
      prefixRelativeDays: [0],
      postRelativeDays: [...DECLARED_POST_RELATIVE_DAYS],
      // 分组条件（截至 T+N 是否跌破首板日开盘价）只使用 rd ∈ [1, 5]，与参数的观察窗口上界一致。
      decisionOffsetDays: DECLARED_DECISION_OFFSET_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        "研究首板事件之后 T+1…T+20 的价格路径、回踩与回踩深度、是否跌破首板日开盘价，" +
        "以及各观察日 / 入场日的后续收益分布 —— **事后描述性研究**，不是可交易决策；" +
        "本实验不产出信号、参数、候选或策略结论。",
    },
    pageKey: "first-board-pullback/fundamental-study",
    pageTitle: "首板后回踩第一性研究",
  },

  /** 本实验自有结果结构（信封由平台校验）。 */
  resultSchema: fundamentalStudyCustomPayloadSchema,

  async run(context: ExperimentRunContext): Promise<ExperimentResultPayload> {
    const { dataset, parameters, log, artifact } = context;

    // ---- 1) 参数（默认值已由 Runner 归并、越界已被拒；这里只做**跨参数**守恒检查）----
    const maxObservationDay = parameters.maxObservationDay as number;
    const maxEvents = parameters.maxEvents as number;
    const drawdownBucketEdgesBps = [...(parameters.drawdownBucketEdgesBps as number[])];
    const rawHorizons = parameters.futureHorizons as number[];
    const futureHorizons = [...rawHorizons].sort((a, b) => a - b);
    for (let i = 1; i < futureHorizons.length; i += 1) {
      if (futureHorizons[i] === futureHorizons[i - 1]) {
        throw new Error(
          `futureHorizons 含重复元素 ${futureHorizons[i]}（去重会静默改变结果的列结构，因此在此拒绝）`,
        );
      }
    }

    if (maxObservationDay > DECLARED_DECISION_OFFSET_DAYS) {
      throw new Error(
        `maxObservationDay=${maxObservationDay} 超过本实验声明的信息边界 ` +
          `decisionOffsetDays=${DECLARED_DECISION_OFFSET_DAYS}：这会让「截至 T+N 是否跌破首板日开盘价」` +
          `用到超出声明边界的未来数据。请同步扩声明，而不是静默越界。`,
      );
    }

    // ---- 2) 声明面 ⊇ 使用面（改声明而忘记改参数界时立刻失败，不静默少读）----
    const requiredMaxRelativeDay = Math.max(maxObservationDay, futureHorizons[futureHorizons.length - 1]!);
    const declaredPostDays = context.descriptor.datasetRequirement.postRelativeDays ?? [];
    const requiredPostDays = Array.from({ length: requiredMaxRelativeDay }, (_, i) => i + 1);
    const unmet = requiredPostDays.filter((day) => !declaredPostDays.includes(day));
    if (unmet.length > 0) {
      throw new Error(
        `descriptor 只声明了 post 相对日 [${declaredPostDays.join(", ")}]，但本次参数需要 ` +
          `[1…${requiredMaxRelativeDay}]（缺失：${unmet.join(", ")}）—— 请同步扩声明，不要静默少读数据`,
      );
    }

    // ---- 3) 分桶边界（写错边界会让整张「深度 → 后续表现」表失去意义，因此当场失败）----
    const { buckets, edgesRatio } = buildDrawdownBuckets(drawdownBucketEdgesBps);

    // ---- 4) 取数（全部经声明面；未声明的列 / 相对日读不到）----
    //
    // 🔴 本实验声明了 `FULL_DATASET` ⇒ 事件扫描必须覆盖数据集声明的**全部**事件
    //    （正式 Run = 23978）。这里**逐页消费** `dataset.eventPages()`（keyset 游标续读），
    //    而不是调 `events()` 一次性拿回：差别在于「分页真的发生了」这件事**可见且可断言**
    //    （页数进日志与结果），而不是藏在实现里当承诺。
    const events: ExperimentEventRow[] = [];
    let eventPageCount = 0;
    for await (const page of dataset.eventPages()) {
      eventPageCount += 1;
      for (const row of page) events.push(row);
    }
    /** 本实验声明 `FULL_DATASET` ⇒ 生效上限 = 平台硬阀（不是默认阀 20000）。 */
    const scanLimitApplied = FULL_DATASET_EVENT_SCAN_LIMIT;
    log(
      `读取事件行 ${events.length} 条（${eventPageCount} 轮分页；数据集声明事件总数 ` +
        `${String(dataset.facts.totalEvents)}；扫描策略 FULL_DATASET，生效上限 ${scanLimitApplied}）`,
    );

    const eventDayBars = await dataset.feature(0);
    log(`读取首板日（rd=0）行情 ${eventDayBars.length} 行`);

    // 逐观察日批量读取（Dataset 侧一次查一天，**不是** N×M 逐事件查询）。
    //
    // 🔴 存的是**整行**而不是 `row.values`：`tradeDate` 是**行身份字段**
    //    （`ExperimentBarRow.tradeDate`），**不在** `values` 里 ——
    //    `values` 只含 `requiredColumns` 里声明过的列。
    //    踩过的坑：读 `values.tradeDate` 恒得 `undefined` ⇒ 每一天都被判成
    //    「行身份缺失」⇒ **全部样本被误剔**，而结果看起来只是「样本量为 0」。
    const observationByDay = new Map<number, Map<string, ExperimentBarRow>>();
    let observationBarRowsRead = 0;
    for (const day of requiredPostDays) {
      const rows = await dataset.observation(day);
      observationBarRowsRead += rows.length;
      const byEvent = new Map<string, ExperimentBarRow>();
      for (const row of rows) {
        // 同一 (eventId, rd) 在物理表上有唯一索引；若真出现重复，保留**更完整**的一根（字段非空更多）。
        const existing = byEvent.get(row.eventId);
        if (existing === undefined || countNonNull(row.values) > countNonNull(existing.values)) {
          byEvent.set(row.eventId, row);
        }
      }
      observationByDay.set(day, byEvent);
    }
    log(`读取观察日行情合计 ${observationBarRowsRead} 行（rd=1…${requiredMaxRelativeDay}）`);

    // ---- 5) 候选裁剪（按事件日升序 + eventId 保证确定性；被裁掉的一律登记原因）----
    const scannedRowCount = events.length;
    const deduped = new Map<string, (typeof events)[number]>();
    let duplicateEventIdCount = 0;
    for (const event of events) {
      if (deduped.has(event.eventId)) {
        duplicateEventIdCount += 1;
        continue;
      }
      deduped.set(event.eventId, event);
    }
    const uniqueEvents = [...deduped.values()].sort((a, b) =>
      a.tradeDate === b.tradeDate ? a.eventId.localeCompare(b.eventId) : a.tradeDate.localeCompare(b.tradeDate),
    );

    const candidateCount = uniqueEvents.length;
    const usedEvents = uniqueEvents.slice(0, maxEvents);
    const droppedByMaxEvents = candidateCount - usedEvents.length;
    log(
      `候选 ${scannedRowCount} 行 → 去重 ${candidateCount} 个事件（重复 ${duplicateEventIdCount}）→ ` +
        `使用 ${usedEvents.length}（maxEvents=${maxEvents}）`,
    );

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (code: string, count: number): void => {
      if (!isExclusionReasonCode(code)) {
        // 闭集守卫：未登记的原因不得进账（否则账目无法解释）。
        throw new Error(`未登记的剔除原因码 "${code}"，请先在 EXCLUSION_REASON_LABELS 里登记`);
      }
      excludedByReason[code] = (excludedByReason[code] ?? 0) + count;
    };
    if (droppedByMaxEvents > 0) addExclusion("MAX_EVENTS_LIMIT", droppedByMaxEvents);

    const eventDayBarByEvent = new Map<string, Readonly<Record<string, number | boolean | string | null>>>();
    for (const bar of eventDayBars) eventDayBarByEvent.set(bar.eventId, bar.values);

    // ---- 6) 逐事件评估（每个候选恰好归入一个原因 ⇒ 账目自动守恒）----
    const samples: StudySample[] = [];
    let missingEventDayBarCount = 0;
    let missingObservationBarCount = 0;
    let invalidOhlcBarCount = 0;
    let closeDiffersCount = 0;
    /**
     * 非法 OHLC 按**相对日**分档（规格 §4）。
     *
     * 分档的意义：把「1353 个坏 Bar」拆成「首板日 / 核心窗口 / 中段 / 长视界」四块，
     * 才能回答「这其中有多少真的影响了样本资格」—— 只有 `eventDay` 与 `observationCore`
     * 会剔除事件，后两块只让对应视界不可用。
     */
    const invalidOhlcByRelativeDay = {
      eventDay: 0,
      observationCore: 0,
      observationMid: 0,
      observationLong: 0,
    };
    /** 至少有一根坏 Bar 的事件集合（**事件口径**，与 Bar 口径是两回事）。 */
    const invalidOhlcEventIds = new Set<string>();
    const noteInvalidOhlc = (eventId: string, relativeDay: number): void => {
      invalidOhlcBarCount += 1;
      invalidOhlcEventIds.add(eventId);
      if (relativeDay === 0) invalidOhlcByRelativeDay.eventDay += 1;
      else if (relativeDay <= maxObservationDay) invalidOhlcByRelativeDay.observationCore += 1;
      else if (relativeDay <= 10) invalidOhlcByRelativeDay.observationMid += 1;
      else invalidOhlcByRelativeDay.observationLong += 1;
    };

    for (const event of usedEvents) {
      const base = eventDayBarByEvent.get(event.eventId);
      if (base === undefined) {
        addExclusion("MISSING_EVENT_DAY_BAR", 1);
        missingEventDayBarCount += 1;
        continue;
      }
      const open0 = toFiniteNumber(base.open);
      const close0 = toFiniteNumber(base.close);
      const high0 = toFiniteNumber(base.high);
      const low0 = toFiniteNumber(base.low);
      if (open0 === null || !(open0 > 0)) {
        addExclusion("INVALID_EVENT_DAY_OPEN", 1);
        noteInvalidOhlc(event.eventId, 0);
        continue;
      }
      if (close0 === null || !(close0 > 0)) {
        addExclusion("INVALID_EVENT_DAY_CLOSE", 1);
        noteInvalidOhlc(event.eventId, 0);
        continue;
      }
      if (!isValidOhlc({ open: open0, high: high0, low: low0, close: close0 })) {
        addExclusion("INVALID_EVENT_DAY_OHLC", 1);
        noteInvalidOhlc(event.eventId, 0);
        continue;
      }
      const limitUpPrice = toFiniteNumber(event.values.limitUpPrice);
      if (limitUpPrice === null || !(limitUpPrice > 0)) {
        addExclusion("MISSING_LIMIT_UP_PRICE", 1);
        continue;
      }
      if (Math.abs(close0 - limitUpPrice) > Math.max(0.011, CLOSE_MISMATCH_TOLERANCE_RATIO * limitUpPrice)) {
        closeDiffersCount += 1;
      }

      // 观察窗口（rd 1..maxObservationDay）必须完整：不完整就无法做「截至 T+N」的路径判定。
      const bars: StudyBar[] = [];
      /** 本事件「有行但非法」与「整行缺失」的逐日记录（逐视界样本账的分母来源）。 */
      const invalidRelativeDays = new Set<number>();
      const missingRelativeDays = new Set<number>();
      let windowFailure: "MISSING_OBSERVATION_BAR" | "INVALID_OBSERVATION_OHLC" | null = null;
      for (let day = 1; day <= requiredMaxRelativeDay; day += 1) {
        const row = observationByDay.get(day)?.get(event.eventId);
        if (row === undefined) {
          missingRelativeDays.add(day);
          if (day <= maxObservationDay) windowFailure = "MISSING_OBSERVATION_BAR";
          continue;
        }
        const values = row.values;
        const bar = {
          relativeDay: day,
          // 交易日取自**行身份**（`values` 里没有它，见上面 observationByDay 的注释）。
          tradeDate: row.tradeDate,
          open: toFiniteNumber(values.open),
          high: toFiniteNumber(values.high),
          low: toFiniteNumber(values.low),
          close: toFiniteNumber(values.close),
        };
        if (bar.tradeDate === "") {
          // 行身份缺失 ⇒ 无法把该 K 线锚到某个交易日（`tradeDate` 属于骨架列，理论上必到）。
          if (day <= maxObservationDay) windowFailure = "INVALID_OBSERVATION_OHLC";
          invalidRelativeDays.add(day);
          noteInvalidOhlc(event.eventId, day);
          continue;
        }
        if (!isValidOhlc(bar)) {
          invalidRelativeDays.add(day);
          noteInvalidOhlc(event.eventId, day);
          if (day <= maxObservationDay) windowFailure = "INVALID_OBSERVATION_OHLC";
          continue;
        }
        bars.push(bar as StudyBar);
      }
      if (windowFailure !== null) {
        addExclusion(windowFailure, 1);
        if (windowFailure === "MISSING_OBSERVATION_BAR") missingObservationBarCount += 1;
        continue;
      }

      samples.push({
        eventId: event.eventId,
        symbol: event.symbol,
        eventDate: event.tradeDate,
        firstLimitUpOpen: open0,
        firstLimitUpClose: close0,
        firstLimitUpPrice: limitUpPrice,
        bars,
        maxAvailableRelativeDay: bars.length === 0 ? 0 : bars[bars.length - 1]!.relativeDay,
        invalidRelativeDays,
        missingRelativeDays,
      });
    }

    const eligibleCount = samples.length;
    log(`入池样本 ${eligibleCount} / 候选事件 ${candidateCount}（剔除 ${candidateCount - eligibleCount}）`);

    // ---- 7) 派生量（一次算好，所有表共用）----
    const derived: SampleDerived[] = samples.map((sample) =>
      deriveSample(sample, { maxObservationDay, futureHorizons }),
    );

    const longestHorizon = futureHorizons[futureHorizons.length - 1]!;
    const insufficientForwardBarsEventCount = derived.filter(
      (item) => item.byHorizon.get(longestHorizon)?.available !== true,
    ).length;

    /**
     * 🔴 用**独立于构造路径**的方式核验「坏 Bar 没被用于未来收益」。
     *
     * 只写「因为 `bars` 只 push 合法 bar 所以恒为 0」是同义反复、证明不了任何事。
     * 这里反过来查：每个样本**实际用于**视界 / 决策时点窗口的每一天，是否都能在
     * 「已校验合法」的 `sample.bars` 里按 rd 找到。找不到即计数 +1 —— 于是
     * 「实现绕过 `contiguousWindow` 拿坏 Bar 凑数」这类回归会立刻把它顶成非 0。
     */
    let invalidOhlcUsedInFutureOutcomeCount = 0;
    for (const item of derived) {
      const validDays = new Set(item.sample.bars.map((bar) => bar.relativeDay));
      const checkWindow = (from: number, to: number): void => {
        for (let day = from; day <= to; day += 1) {
          if (!validDays.has(day)) invalidOhlcUsedInFutureOutcomeCount += 1;
        }
      };
      for (const horizon of futureHorizons) {
        if (item.byHorizon.get(horizon)?.available === true) checkWindow(1, horizon);
      }
      for (let k = 1; k <= maxObservationDay; k += 1) {
        const decision = item.byDecisionDay.get(k);
        if (decision === undefined) continue;
        for (const horizon of futureHorizons) {
          if (decision.byHorizon.get(horizon)?.available === true) checkWindow(k + 1, horizon);
        }
      }
    }

    /**
     * 逐视界样本账（规格 §5）：每个视界**各自**统计 eligible / missing / invalid / valid。
     *
     * 🔴 关键纪律：长视界不可用**不会**把一个事件从短视界的统计里删掉 ——
     *    这里的 `eligibleCount` 恒为 `derived.length`（不随 horizon 变化），
     *    `missingCount` / `invalidCount` 只描述「该视界所需窗口内」的问题。
     *    （一个事件可能既有缺又有坏 ⇒ 两个计数可重叠，故三者之和未必等于 eligible。）
     */
    const horizonDataQuality = futureHorizons.map((horizon) => {
      let missingCount = 0;
      let invalidCount = 0;
      let validCount = 0;
      for (const item of derived) {
        if (item.byHorizon.get(horizon)?.available === true) {
          validCount += 1;
          continue;
        }
        if ([...item.sample.missingRelativeDays].some((day) => day <= horizon)) missingCount += 1;
        if ([...item.sample.invalidRelativeDays].some((day) => day <= horizon)) invalidCount += 1;
      }
      return {
        horizon,
        eligibleCount: derived.length,
        missingCount,
        invalidCount,
        validCount,
      };
    });
    log(
      `逐视界可用样本：${horizonDataQuality
        .map((item) => `T+${item.horizon} ${item.validCount}/${item.eligibleCount}`)
        .join("、")}`,
    );

    // ---- 8) 汇总（表 / 图 / CSV 同源）----
    const classificationDay = maxObservationDay;
    const dailyPath = summarizeDailyPath(derived, maxObservationDay);
    const nonBreakVsBreak = summarizeNonBreakVsBreak(derived, maxObservationDay);
    const drawdownBuckets = summarizeDrawdownBuckets(
      derived,
      buckets,
      classificationDay,
      futureHorizons,
    );
    const entryDay = summarizeEntryDay(derived, maxObservationDay, futureHorizons);
    const futureHorizonComparison = summarizeFutureHorizons(derived, futureHorizons, classificationDay);
    // 🔴 本轮新增的核心产出：决策时点 × 不破/破位 × 后续视界。
    const decisionConditionByDay = summarizeDecisionConditionByDay(
      derived,
      maxObservationDay,
      futureHorizons,
    );
    const tables: StudyTable[] = [
      dailyPath,
      nonBreakVsBreak,
      drawdownBuckets,
      entryDay,
      futureHorizonComparison,
      decisionConditionByDay,
    ];

    const availableMaxPostRelativeDay = dataset.facts.postRelativeDayRange?.max ?? null;
    /**
     * 🔴 **账目缺口**（`datasetEventCount − candidateCount`）。
     *
     * 事件扫描有平台安全阀：触顶后本轮只拿到前 `PLATFORM_EVENT_SCAN_LIMIT` 个事件，
     * 后面的**既不在候选、也不在剔除清单**里。平台的样本账守恒式是
     * `eligible + excluded = candidate`，对「压根没进候选」的事件恒真、毫无约束力 ⇒
     * 必须单独出这个数，否则「数据集 23978 个 / 本轮统计 19877 个」的差额静默消失
     * （EXP-001 真机 Run 实测踩过）。刻意**不夹取到 0**：若数据集少报事件导致差额为负，
     * 那是数据集不一致，应当如实暴露而不是被抹平。
     */
    const unscannedEventCount =
      dataset.facts.totalEvents === null ? null : dataset.facts.totalEvents - candidateCount;
    if (unscannedEventCount !== null && unscannedEventCount !== 0) {
      log(
        `账目缺口：数据集声明 ${dataset.facts.totalEvents} 个事件 − 候选 ${candidateCount} = ${unscannedEventCount}`,
      );
    }
    const candidatesInfo = {
      datasetEventCount: dataset.facts.totalEvents,
      scannedRowCount,
      candidateCount,
      usedEventCount: usedEvents.length,
      droppedByMaxEvents,
      /**
       * 🔴 触顶判据 = **账目缺口**（`unscannedEventCount > 0`），而不是「扫描行数 ≥ 某上限」。
       *
       * 为什么不用上限比较：实验**看不到**平台实际生效的上限（`deps.eventScanLimit` 可被
       * 注入覆盖），拿自己声明的上限去比会得出「没截断」的假结论（真被截断时缺口就在那儿）。
       * 缺口为 `null`（数据集未声明总数）时无法判定 ⇒ 如实给 `false`，
       * 并由 `sampleSummary.notes` 说明「无法核对」。
       */
      droppedByScanLimit: unscannedEventCount !== null && unscannedEventCount > 0,
      scanLimit: scanLimitApplied,
      eventScanPolicy: "FULL_DATASET",
      eventPageCount,
      unscannedEventCount,
    };

    const observations = buildObservations({
      dailyPath,
      futureHorizons: futureHorizonComparison,
      entryDay,
      drawdownBuckets,
      maxObservationDay,
      futureHorizonList: futureHorizons,
      classificationDay,
      sampleCount: eligibleCount,
      pullbackSampleCount: derived.filter((item) => item.byDay.some((d) => d.pullbackBelowClose)).length,
      nonBreakOpenSampleCount: derived.filter(
        (item) => item.byDay.find((d) => d.relativeDay === classificationDay)?.nonBreakOpen === true,
      ).length,
      breakOpenSampleCount: derived.filter(
        (item) => item.byDay.find((d) => d.relativeDay === classificationDay)?.nonBreakOpen === false,
      ).length,
      maxAvailableRelativeDay: longestHorizon,
      availableMaxPostRelativeDay,
      droppedByMaxEvents,
      droppedByScanLimit: candidatesInfo.droppedByScanLimit,
      scanLimit: scanLimitApplied,
      datasetDeclaredTotalEvents: dataset.facts.totalEvents,
      unscannedEventCount,
      minFutureHorizon: futureHorizons[0]!,
      decisionCondition: decisionConditionByDay,
      invalidOhlc: {
        barCount: invalidOhlcBarCount,
        byRelativeDay: invalidOhlcByRelativeDay,
        affectedEventCount: invalidOhlcEventIds.size,
        usedInFutureOutcomeCount: invalidOhlcUsedInFutureOutcomeCount,
      },
      horizonDataQuality,
      eventScanPolicy: "FULL_DATASET",
    });

    const hypotheses = buildPotentialHypotheses({
      futureHorizons: futureHorizonComparison,
      maxObservationDay,
      futureHorizonList: futureHorizons,
      nonBreakOpenSampleCount: derived.filter(
        (item) => item.byDay.find((d) => d.relativeDay === classificationDay)?.nonBreakOpen === true,
      ).length,
      breakOpenSampleCount: derived.filter(
        (item) => item.byDay.find((d) => d.relativeDay === classificationDay)?.nonBreakOpen === false,
      ).length,
      drawdownBuckets,
    });

    // ---- 9) 产物（6 张 CSV + 3 张 SVG；与信封里的表 / 图同源）----
    const maxObsRow = dailyPath.rows.find((row) => row["relativeDay"] === `T+${classificationDay}`) ?? null;
    const dailyPathSvg = renderLineChartSvg({
      title: `首板后 T+1…T+${maxObservationDay} 路径（平均 / 中位，锚 = 首板日收盘价）`,
      subtitle: "全部为小数比例，负数 = 下跌；样本 " + String(eligibleCount) + " 个首板事件",
      xLabels: Array.from({ length: maxObservationDay }, (_, i) => `T+${i + 1}`),
      series: [
        {
          label: "平均收盘收益",
          points: dailyPath.rows.map((row) => numeric(row["averageCloseReturn"])),
        },
        {
          label: "中位收盘收益",
          points: dailyPath.rows.map((row) => numeric(row["medianCloseReturn"])),
        },
        {
          label: "平均最低价收益",
          points: dailyPath.rows.map((row) => numeric(row["averageLowReturn"])),
        },
      ],
    });
    const bucketSvg = renderBarChartSvg({
      title: `回撤深度分布（截至 T+${classificationDay}，对首板日收盘价）`,
      subtitle:
        "桶边界（基点）：" + drawdownBucketEdgesBps.join(" / ") + "；负数 = 回撤；合计样本 " + String(eligibleCount),
      // 🔴 横轴标签取自**同一张表**的行（`bucketShort`），不在实验里另写一套边界格式化。
      labels: drawdownBuckets.rows.map((row) => String(row["bucketShort"] ?? row["bucket"] ?? "—")),
      values: drawdownBuckets.rows.map((row) => numeric(row["sampleCount"]) ?? 0),
    });

    // 决策时点条件矩阵图（本轮新增）：X = 决策时点，Y = 决策之后的平均收盘收益。
    const decisionChartHorizon = futureHorizons.includes(10) ? 10 : longestHorizon;
    const decisionSeriesValues = (group: string): Array<number | null> =>
      Array.from({ length: maxObservationDay }, (_, i) =>
        numeric(
          decisionConditionByDay.rows.find(
            (row) =>
              row["classificationDay"] === `T+${i + 1}` &&
              row["group"] === group &&
              row["futureHorizon"] === `T+${decisionChartHorizon}`,
          )?.["meanCloseReturn"],
        ),
      );
    const decisionConditionSvg = renderGroupedBarChartSvg({
      title: `决策时点条件矩阵（各决策时点之后的 T+${decisionChartHorizon} 平均收盘收益）`,
      subtitle:
        `锚 = 决策日 T+k 收盘价；窗口 rd ∈ [k+1, ${decisionChartHorizon}]（严格在决策时点之后）。` +
        `三条序列 = 不破 / 破位 / 全部；**不标注「最佳」**；样本 ${String(eligibleCount)} 个首板事件`,
      categories: Array.from({ length: maxObservationDay }, (_, i) => `T+${i + 1}`),
      series: [
        // 红涨绿跌（A 股口径）：不破组用红、破位组用绿、全部用灰。
        { label: GROUP_LABELS.NON_BREAK_OPEN, values: decisionSeriesValues("NON_BREAK_OPEN"), color: "#dc2626" },
        { label: GROUP_LABELS.BREAK_OPEN, values: decisionSeriesValues("BREAK_OPEN"), color: "#16a34a" },
        { label: GROUP_LABELS.ALL, values: decisionSeriesValues("ALL"), color: "#6b7280" },
      ],
    });

    // 🔴 `name` 不含角色段（角色段由 `role` 决定）：
    //    最终 Object Key = `…/runs/{runId}/charts/daily-path.svg`。
    const svgSpecs: ReadonlyArray<{ name: string; label: string; description: string; body: string }> = [
        {
          name: "daily-path.svg",
          label: "T+1…T+maxObservationDay 路径图（SVG）",
          description: "逐观察日的平均 / 中位收盘收益与平均最低价收益；自包含 SVG，无外部依赖。",
          body: dailyPathSvg,
        },
        {
          name: "drawdown-buckets.svg",
          label: "回撤深度分布图（SVG）",
          description: "各回撤观察桶的样本数；自包含 SVG，无外部依赖。",
          body: bucketSvg,
        },
        {
          name: "decision-condition-by-day.svg",
          label: "决策时点条件矩阵图（SVG）",
          description:
            "X = 决策时点 T+k；Y = 决策之后（rd ∈ [k+1, h]）的平均收盘收益；三条序列 = 不破 / 破位 / 全部。" +
            "自包含 SVG，无外部依赖；**不含任何择优标注**。",
          body: decisionConditionSvg,
        },
    ];
    for (const file of buildArtifacts(tables, svgSpecs)) {
      artifact({
        name: file.name,
        role: file.role,
        body: file.body,
        contentType: file.contentType,
        label: file.label,
        description: file.description,
      });
    }

    log(
      `分桶边界（比率）：[${edgesRatio.map((value) => value.toFixed(4)).join(", ")}]；` +
        `截至 T+${classificationDay} 不破位率 ${percentText(numeric(maxObsRow?.["nonBreakOpenRate"]))}`,
    );
    log(`产物：6 张表 CSV + 3 张 SVG（另由平台写入 result.json / logs/run.log / manifest.json）`);

    // ---- 10) 结果组装（结构定义与组装都在 result.ts）----
    return assembleFundamentalStudyResult({
      maxObservationDay,
      futureHorizons,
      classificationDay,
      drawdownBucketEdgesBps,
      derived,
      tables,
      observations,
      hypotheses,
      candidates: candidatesInfo,
      dataQuality: {
        eventDayBarRowsRead: eventDayBars.length,
        observationBarRowsRead,
        missingEventDayBarCount,
        missingObservationBarCount,
        invalidOhlcBarCount,
        invalidOhlcByRelativeDay,
        invalidOhlcAffectedEventCount: invalidOhlcEventIds.size,
        invalidOhlcUsedInFutureOutcomeCount,
        horizonDataQuality,
        insufficientForwardBarsEventCount,
        duplicateEventIdCount,
        eventDayCloseDiffersFromLimitUpPriceCount: closeDiffersCount,
        closeMismatchToleranceRatio: CLOSE_MISMATCH_TOLERANCE_RATIO,
      },
      excludedByReason,
      availableMaxPostRelativeDay,
      forwardDataPurpose: context.descriptor.datasetRequirement.forwardDataPurpose ?? "",
    });
  },
};

/** 行值 → 有限数值（`null` 原样）。 */
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 统计一行里非空字段个数（用于同一 (eventId, rd) 的重复行取「更完整」的那根）。 */
function countNonNull(values: Readonly<Record<string, unknown>>): number {
  let count = 0;
  for (const value of Object.values(values)) if (value !== null && value !== undefined) count += 1;
  return count;
}

/** 便于页面 / 文档引用（与 `EXCLUSION_REASON_LABELS` 同源）。 */
export { EXCLUSION_REASON_LABELS };

export default fundamentalStudyExperiment;
