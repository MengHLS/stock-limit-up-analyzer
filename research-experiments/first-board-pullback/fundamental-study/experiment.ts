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
  ExperimentRunContext,
  ExperimentResultPayload,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  DECLARED_DECISION_OFFSET_DAYS,
  DECLARED_POST_RELATIVE_DAYS,
  EXCLUSION_REASON_LABELS,
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
  renderLineChartSvg,
  summarizeDailyPath,
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
          `本实验最多统计多少个首板事件（按事件日升序取前 N 个）。超出部分逐条登记原因，不静默丢弃。` +
          `硬上界 = 平台事件扫描安全阀 ${PLATFORM_EVENT_SCAN_LIMIT}。`,
        kind: "INT",
        required: false,
        defaultValue: PLATFORM_EVENT_SCAN_LIMIT,
        bounds: { min: 100, max: PLATFORM_EVENT_SCAN_LIMIT },
        unit: "个事件",
      },
    ],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
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
    const events = await dataset.events();
    log(`读取事件行 ${events.length} 条（数据集声明事件总数 ${String(dataset.facts.totalEvents)}）`);

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
        invalidOhlcBarCount += 1;
        continue;
      }
      if (close0 === null || !(close0 > 0)) {
        addExclusion("INVALID_EVENT_DAY_CLOSE", 1);
        invalidOhlcBarCount += 1;
        continue;
      }
      if (!isValidOhlc({ open: open0, high: high0, low: low0, close: close0 })) {
        addExclusion("INVALID_EVENT_DAY_OHLC", 1);
        invalidOhlcBarCount += 1;
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
      let windowFailure: "MISSING_OBSERVATION_BAR" | "INVALID_OBSERVATION_OHLC" | null = null;
      for (let day = 1; day <= requiredMaxRelativeDay; day += 1) {
        const row = observationByDay.get(day)?.get(event.eventId);
        if (row === undefined) {
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
          invalidOhlcBarCount += 1;
          continue;
        }
        if (!isValidOhlc(bar)) {
          invalidOhlcBarCount += 1;
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
    const tables: StudyTable[] = [
      dailyPath,
      nonBreakVsBreak,
      drawdownBuckets,
      entryDay,
      futureHorizonComparison,
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
      droppedByScanLimit: scannedRowCount >= PLATFORM_EVENT_SCAN_LIMIT,
      scanLimit: PLATFORM_EVENT_SCAN_LIMIT,
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
      scanLimit: PLATFORM_EVENT_SCAN_LIMIT,
      datasetDeclaredTotalEvents: dataset.facts.totalEvents,
      unscannedEventCount,
      minFutureHorizon: futureHorizons[0]!,
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

    // ---- 9) 产物（5 张 CSV + 2 张 SVG；与信封里的表 / 图同源）----
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
    log(`产物：5 张表 CSV + 2 张 SVG（另由平台写入 result.json / logs/run.log / manifest.json）`);

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
