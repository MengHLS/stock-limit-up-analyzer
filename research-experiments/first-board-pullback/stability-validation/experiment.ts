/**
 * EXP-002 · 首板后回踩条件稳定性验证（`first-board-pullback/stability-validation`）。
 *
 * ## 研究问题
 *
 * EXP-001 回答了「首板之后会发生什么」，但只回答了**一次** —— 在**一组**默认研究条件下。
 * 本实验回答第二个问题：**换一组同样合理的条件，结论会不会变？**
 *
 * ```text
 * Baseline → 改变合理条件 → 重新计算 → 比较 → 判断稳定性
 * ```
 *
 * ## 本文件**不实现** Robustness 方法（规格 §1.1 / §17）
 *
 * 上面那行方法学流程不是本实验发明的：它早就存在于 `server/research/robustness/**`
 * （C-18.1 的策略鲁棒性 + `ROBUSTNESS-CROSS-STAGE-001` 认定的跨阶段泛化层）。
 * 本文件做的是**把自己接上去**（唯一引桥 = `@experiments/robustnessBridge`）：
 *
 * | 复用（既有核心） | 本实验提供（注入） |
 * | --- | --- |
 * | baseline-first / 恰一条基准 / 索引 0 | 基准 = `BASELINE_SPEC`（显式声明，不隐含） |
 * | variant execution / failed 结构化 | 每个变体的**真重算**（读 Dataset → 重新筛选 / 聚合） |
 * | evaluator 注入（核心零 IO） | evaluator 闭包（唯一有 IO 的地方） |
 * | 容差判定（`evaluateTolerance`） | 比较声明（比哪个指标 / 容差多大 / 方向） |
 * | canonical 指纹 / 记录结构校验 | 输入（维度 / 变体 / 指标词表） |
 * | 样本账守恒闸门 | 逐变体的四桶账目 |
 *
 * ⇒ 本目录里**没有** `ResearchRobustnessEngine` 的复制品，也**没有**第二套持久化：
 *    结果仍然只走 `research_experiment_run` + 对象存储（`result.json` / `manifest.json` /
 *    CSV / SVG），TiDB 里**不新增任何表、不新增 migration**。
 *
 * ## 真重算（规格 §12）与「绝不这样做」（规格 §17）
 *
 * - ✅ 每个变体：读 Dataset 原始行情 → 按该变体的条件**重新筛选** → **重新聚合** → **重新算指标**
 *      → 交给核心与**同一个基准**比较；
 * - ❌ 不读 EXP-001 的 `result.json` 做差（本文件里根本没有这条路径）；
 * - ❌ 不只改标签（指标是从 `deriveSample` 的原始派生量现算出来的，不是从旧结果搬来的）。
 *
 * 口径定义（`deriveSample` / `buildDrawdownBuckets` / `isValidOhlc`）**复用 EXP-001 的实现**：
 * 同一份定义只有一处 —— 否则「稳定性」里混进了口径差异，结论无从解释。
 */

import type {
  ExperimentArtifactFileSpec,
  ExperimentBarRow,
  ExperimentDefinition,
  ExperimentEventRow,
  ExperimentResultPayload,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  DECLARED_DECISION_OFFSET_DAYS,
  DECLARED_POST_RELATIVE_DAYS,
  FULL_DATASET_EVENT_SCAN_LIMIT,
  MAX_DECLARED_POST_RELATIVE_DAY,
  buildDrawdownBuckets,
  deriveSample,
  isValidOhlc,
  toFiniteNumber,
  type DrawdownBucket,
  type SampleDerived,
  type StudyBar,
  type StudySample,
  type StudyTable,
} from "../fundamental-study/result";
import {
  MULTI_DIMENSION_RUN_ID_PREFIX,
  computeCanonicalFingerprint,
  runMultiDimensionRobustness,
  subjectFromExperiment,
  type MultiDimensionRobustnessRun,
  type RobustnessSampleAccounting,
} from "@experiments/robustnessBridge";
import {
  ACCOUNTING_FORMULA,
  BASELINE_VARIANT_SPEC,
  COMPARISON_SPECS,
  COMPUTATION_VERSION,
  DATASET_CODE,
  EVENT_SCAN_POLICY,
  EXPERIMENT_CODE,
  METRIC_NAMES,
  METRIC_UNAVAILABLE_REASONS,
  SAMPLE_CONDITIONS,
  SELF_CHECK_VARIANT_CODES,
  STABILITY_DIMENSIONS,
  VARIANT_ITEMS,
  assembleStabilityValidationResult,
  buildSampleAccountingTable,
  buildStabilityArtifacts,
  buildStabilityComparisonTable,
  buildStabilityMatrixTable,
  exclusionBucketOf,
  requiredMaxRelativeDayOf,
  specOf,
  stabilityValidationCustomPayloadSchema,
  type BaselineView,
  type ComparisonRow,
  type ExclusionReasonCode,
  type ObservationKind,
  type SampleConditionCode,
  type StabilityVariantSpec,
  type VariantResultRow,
} from "./result";

// ---------------------------------------------------------------------------
// 研究范围常量（口径集中在此，不散落）
// ---------------------------------------------------------------------------

/**
 * 决策时点的观察窗口上界（T+N）。
 *
 * = EXP-001 的 `DECLARED_DECISION_OFFSET_DAYS`（= 5）：本实验的样本条件分组
 * （不破开盘价 / 破开盘价 / 回撤深度分桶）都只看「截至 T+5」的路径 ——
 * 与 EXP-001 的缺省分组口径**逐字一致**，不另立一套。
 */
const MAX_OBSERVATION_DAY = DECLARED_DECISION_OFFSET_DAYS;

/** 本实验要统计的全部视界（= 维度 B 的取值集合；与 EXP-001 缺省视界一致）。 */
const FUTURE_HORIZONS: readonly number[] = Object.freeze([5, 10, 20]);

/**
 * 回撤分桶边界（基点）。
 *
 * 🔴 本实验**不重新定义**桶：边界取自 EXP-001 的缺省值，桶语义（半开区间 / 桶名 / 测试函数）
 *    全部由 EXP-001 的 `buildDrawdownBuckets` 现算，并在 `run()` 里**双向核对**
 *    「声明面 = 实现面」（见 `assertBucketVocabularyConsistent`）。
 */
const DRAWDOWN_BUCKET_EDGES_BPS: readonly number[] = Object.freeze([0, -200, -500, -800, -1000]);

/** 非桶类样本条件（其余条件码必须是 `buildDrawdownBuckets` 产出的桶名）。 */
const NON_BUCKET_CONDITIONS: readonly SampleConditionCode[] = Object.freeze([
  "ALL",
  "NON_BREAK_OPEN",
  "BREAK_OPEN",
]);

/** 交叉核对容差（仅信息性计数：首板日收盘价 vs `limitUpPrice`）。 */
const CLOSE_MISMATCH_TOLERANCE_RATIO = 0.005;

/** 参与容差判定的三个指标（进词表但**不声明容差**的两个样本量指标不在其中）。 */
const RATIO_METRIC_NAMES: readonly string[] = Object.freeze([
  "meanCloseReturn",
  "medianCloseReturn",
  "breakoutVsCloseRate",
]);

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

/** 一个候选事件在「全局数据资格」层面的结论（与具体变体无关）。 */
type GlobalDataStatus = "ok" | ExclusionReasonCode;

interface CandidateEvent {
  readonly eventId: string;
  readonly globalStatus: GlobalDataStatus;
  /** 全局资格成立时的入池样本（含 rd ∈ [1, 20] 的**已校验**行情 + 缺 / 坏日集合）。 */
  readonly sample: StudySample | null;
}

/** 一个变体的完整评估产物（evaluator 的返回值来源）。 */
interface VariantEvaluationInternal {
  readonly accounting: RobustnessSampleAccounting;
  readonly metrics: { metrics: Record<string, number>; unavailable: Record<string, string> };
  readonly missingByReason: Record<string, number>;
  readonly invalidByReason: Record<string, number>;
  /** 独立反查：该变体实际用于统计的每一天是否都能在「已校验合法」的 bar 索引里找到。 */
  readonly invalidOhlcUsedInWindowCount: number;
}

interface StabilityObservation {
  readonly kind: ObservationKind;
  readonly text: string;
}

interface RunDataQuality {
  readonly invalidOhlcBarCount: number;
  readonly invalidOhlcAffectedEventCount: number;
  readonly missingWindowBarCount: number;
  readonly invalidOhlcUsedInWindowCount: number;
}

interface RunCandidatesInfo {
  readonly datasetEventCount: number | null;
  readonly scannedRowCount: number;
  readonly candidateCount: number;
  readonly duplicateEventIdCount: number;
  readonly unscannedEventCount: number | null;
  readonly droppedByScanLimit: boolean;
  readonly eventPageCount: number;
}

export const stabilityValidationExperiment: ExperimentDefinition = {
  descriptor: {
    id: EXPERIMENT_CODE,
    name: "首板后回踩条件稳定性验证",
    version: COMPUTATION_VERSION,
    description:
      "把 EXP-001 的研究条件铺成三个维度（决策时点 T+1…T+5 / 未来评价窗口 T+5·T+10·T+20 / " +
      "样本条件 全部·不破开盘价·破开盘价·回撤深度 6 桶），对**同一个基准**逐变体**真重算**，" +
      "再按声明容差判定 稳定 / 敏感 / 指标不足。**复用既有 Robustness 核心方法**，" +
      "不新建引擎、不新建表；只产出稳定性结论与证据，不产出策略、不选最优条件。",
    source: "stock-limit-up-analyzer",
    tags: ["first-board", "pullback", "stability", "robustness", "sensitivity"],
    parameters: [
      {
        code: "maxEvents",
        label: "最大事件数",
        description:
          "本轮最多评估多少个首板事件（按事件日升序取前 N 个）。超出部分逐条登记为 " +
          "MAX_EVENTS_LIMIT（进「缺数据」桶，不静默丢弃）。缺省 = 平台事件扫描**硬阀** " +
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
      datasetCode: DATASET_CODE,
      /**
       * 与 EXP-001 一致地声明全量扫描：`candidateCount` 必须等于数据集声明的事件数，
       * 账目缺口 `unscannedEventCount` 由结果如实暴露，不夹取。
       */
      eventScanPolicy: EVENT_SCAN_POLICY,
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "limitUpPrice", "previousClose"],
        // rd = 0 = 首板日本身：基准价（开盘 / 收盘）的唯一来源，PIT 安全。
        feature: ["open", "high", "low", "close"],
        // rd ≥ 1：决策时点路径（1..k）与未来评价窗口（k+1..h）的唯一来源。
        observation: ["open", "high", "low", "close"],
      },
      prefixRelativeDays: [0],
      postRelativeDays: [...DECLARED_POST_RELATIVE_DAYS],
      decisionOffsetDays: MAX_OBSERVATION_DAY,
      usesForwardData: true,
      forwardDataPurpose:
        "在首板事件之后的路径上比较「同一研究问题在不同合理条件下的答案」——" +
        "决策时点与未来评价窗口**按定义就在事件日之后**，属**事后描述性研究**，" +
        "不是可交易决策；本实验不产出信号、参数、候选或策略结论。",
    },
    pageKey: EXPERIMENT_CODE,
    pageTitle: "首板后回踩条件稳定性验证",
  },

  resultSchema: stabilityValidationCustomPayloadSchema,

  async run(context: ExperimentRunContext): Promise<ExperimentResultPayload> {
    const { dataset, parameters, log, artifact } = context;
    const maxEvents = parameters.maxEvents as number;

    // ---- 1) 分桶口径的双向核对（声明面 = 实现面；不一致就当场失败）----
    const { buckets } = buildDrawdownBuckets(DRAWDOWN_BUCKET_EDGES_BPS);
    assertBucketVocabularyConsistent(buckets);
    const bucketByCode = new Map(buckets.map((bucket) => [bucket.code, bucket]));
    log(`回撤桶（由 EXP-001 的 buildDrawdownBuckets 现算）：${buckets.map((b) => b.code).join(" / ")}`);

    // ---- 2) 声明的相对日必须覆盖所有变体所需上界 ----
    const declaredPost = new Set(context.descriptor.datasetRequirement.postRelativeDays ?? []);
    const matrixRequiredMax = VARIANT_ITEMS.reduce(
      (acc, item) => Math.max(acc, requiredMaxRelativeDayOf(specOf(item.code))),
      0
    );
    for (let day = 1; day <= matrixRequiredMax; day += 1) {
      if (!declaredPost.has(day)) {
        throw new Error(
          `descriptor 只声明了 post 相对日 [${[...declaredPost].sort((a, b) => a - b).join(", ")}]，` +
            `但变体矩阵需要 [1…${matrixRequiredMax}] —— 请同步扩声明，不要静默少读数据`
        );
      }
    }
    log(
      `变体矩阵所需最大相对日 = ${matrixRequiredMax}；声明边界 = ${MAX_DECLARED_POST_RELATIVE_DAY}`
    );

    // ---- 3) 取数（全部经声明面；未声明的列 / 相对日读不到）----
    //
    // 🔴 逐页消费 `dataset.eventPages()`（keyset 游标续读），而不是一次性 `events()`：
    //    差别在于「分页真的发生了」这件事**可见且可断言**（页数进日志与结果）。
    const events: ExperimentEventRow[] = [];
    let eventPageCount = 0;
    for await (const page of dataset.eventPages()) {
      eventPageCount += 1;
      for (const row of page) events.push(row);
    }
    const scannedRowCount = events.length;
    log(
      `读取事件行 ${scannedRowCount} 条（${eventPageCount} 轮分页；数据集声明事件总数 ` +
        `${String(dataset.facts.totalEvents)}；扫描策略 ${EVENT_SCAN_POLICY}）`
    );

    const eventDayBars = await dataset.feature(0);
    log(`读取首板日（rd=0）行情 ${eventDayBars.length} 行`);

    // 逐相对日批量读取（Dataset 侧一次查一天，**不是** N×M 逐事件查询）。
    //
    // 🔴 存的是**整行**而不是 `row.values`：`tradeDate` 是**行身份字段**
    //    （`ExperimentBarRow.tradeDate`），**不在** `values` 里 ——
    //    `values` 只含 `requiredColumns` 里声明过的列。踩过的坑：读 `values.tradeDate`
    //    恒得 `undefined` ⇒ 每天都判成「行身份缺失」⇒ 全部样本被误剔，而结果只像「样本量为 0」。
    const observationByDay = new Map<number, Map<string, ExperimentBarRow>>();
    let observationBarRowsRead = 0;
    for (let day = 1; day <= MAX_DECLARED_POST_RELATIVE_DAY; day += 1) {
      const rows = await dataset.observation(day);
      observationBarRowsRead += rows.length;
      const byEvent = new Map<string, ExperimentBarRow>();
      for (const row of rows) {
        // 同一 (eventId, rd) 在物理表上有唯一索引；若真出现重复，保留**更完整**的一根。
        const existing = byEvent.get(row.eventId);
        if (existing === undefined || countNonNull(row.values) > countNonNull(existing.values)) {
          byEvent.set(row.eventId, row);
        }
      }
      observationByDay.set(day, byEvent);
    }
    log(`读取观察日行情合计 ${observationBarRowsRead} 行（rd=1…${MAX_DECLARED_POST_RELATIVE_DAY}）`);

    // ---- 4) 候选裁剪（按事件日升序 + eventId 保证确定性）----
    const deduped = new Map<string, ExperimentEventRow>();
    let duplicateEventIdCount = 0;
    for (const event of events) {
      if (deduped.has(event.eventId)) {
        duplicateEventIdCount += 1;
        continue;
      }
      deduped.set(event.eventId, event);
    }
    const uniqueEvents = [...deduped.values()].sort((a, b) =>
      a.tradeDate === b.tradeDate ? a.eventId.localeCompare(b.eventId) : a.tradeDate.localeCompare(b.tradeDate)
    );
    const candidateCount = uniqueEvents.length;
    const usedEvents = uniqueEvents.slice(0, maxEvents);
    const droppedByMaxEvents = candidateCount - usedEvents.length;
    log(
      `候选 ${scannedRowCount} 行 → 去重 ${candidateCount} 个事件（重复 ${duplicateEventIdCount}）→ ` +
        `评估 ${usedEvents.length}（maxEvents=${maxEvents}，裁剪 ${droppedByMaxEvents}）`
    );

    // ---- 5) 逐候选事件的「全局数据资格」（与变体无关的那一层）----
    const eventDayBarByEvent = new Map<string, Readonly<Record<string, number | boolean | string | null>>>();
    for (const bar of eventDayBars) eventDayBarByEvent.set(bar.eventId, bar.values);

    const candidates: CandidateEvent[] = [];
    let closeDiffersCount = 0;
    let missingEventDayBarCount = 0;
    let missingLimitUpPriceCount = 0;
    let missingWindowBarCount = 0;
    let invalidOhlcBarCount = 0;
    const invalidOhlcEventIds = new Set<string>();

    for (const event of usedEvents) {
      const base = eventDayBarByEvent.get(event.eventId);
      // 相对日的「缺失 / 非法」集合**先记全**（供逐变体按各自窗口上界消费）。
      const invalidRelativeDays = new Set<number>();
      const missingRelativeDays = new Set<number>();
      const bars: StudyBar[] = [];
      let invalidEventDay = false;
      for (let day = 1; day <= MAX_DECLARED_POST_RELATIVE_DAY; day += 1) {
        const row = observationByDay.get(day)?.get(event.eventId);
        if (row === undefined) {
          missingRelativeDays.add(day);
          missingWindowBarCount += 1;
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
        if (bar.tradeDate === "" || !isValidOhlc(bar)) {
          invalidRelativeDays.add(day);
          invalidOhlcBarCount += 1;
          invalidOhlcEventIds.add(event.eventId);
          continue;
        }
        bars.push(bar as StudyBar);
      }

      const limitUpPrice = toFiniteNumber(event.values.limitUpPrice);
      const open0 = base === undefined ? null : toFiniteNumber(base.open);
      const close0 = base === undefined ? null : toFiniteNumber(base.close);
      const high0 = base === undefined ? null : toFiniteNumber(base.high);
      const low0 = base === undefined ? null : toFiniteNumber(base.low);
      if (base !== undefined && !isValidOhlc({ open: open0, high: high0, low: low0, close: close0 })) {
        invalidEventDay = true;
        invalidOhlcBarCount += 1;
        invalidOhlcEventIds.add(event.eventId);
      }
      if (
        close0 !== null &&
        limitUpPrice !== null &&
        Math.abs(close0 - limitUpPrice) >
          Math.max(0.011, CLOSE_MISMATCH_TOLERANCE_RATIO * limitUpPrice)
      ) {
        closeDiffersCount += 1;
      }

      /**
       * 全局数据资格判定 —— **优先级 missing > invalid**（与核心的归入优先级逐字一致）。
       *
       * 🔴 三个「刻意不在这里做」的事：
       *    1. **不**按 `[1, maxObservationDay]` 把事件整条删掉 —— 每个变体需要的窗口长度不同
       *       （见 `requiredMaxRelativeDayOf`）；删早了会把「该变体根本不需要的天数」算成缺陷，
       *       也会让「逐变体样本集合变化」这件事从账上消失；
       *    2. **不**把 `h ≤ k`（窗口为空）当数据缺陷 —— 那是**指标不可用**，不是样本被丢；
       *    3. **不**在 rd=0 非法时去算派生量 —— 派生量的基准价就是它，算了也是垃圾。
       */
      let globalStatus: GlobalDataStatus = "ok";
      if (base === undefined) {
        globalStatus = "MISSING_EVENT_DAY_BAR";
        missingEventDayBarCount += 1;
      } else if (limitUpPrice === null || !(limitUpPrice > 0)) {
        globalStatus = "MISSING_LIMIT_UP_PRICE";
        missingLimitUpPriceCount += 1;
      } else if (hasDayAtMost(missingRelativeDays, MAX_OBSERVATION_DAY)) {
        globalStatus = "MISSING_WINDOW_BAR";
      } else if (invalidEventDay) {
        globalStatus = "INVALID_EVENT_DAY_OHLC";
      } else if (hasDayAtMost(invalidRelativeDays, MAX_OBSERVATION_DAY)) {
        globalStatus = "INVALID_WINDOW_OHLC";
      }

      candidates.push({
        eventId: event.eventId,
        globalStatus,
        sample:
          globalStatus === "ok"
            ? {
                eventId: event.eventId,
                symbol: event.symbol,
                eventDate: event.tradeDate,
                firstLimitUpOpen: open0 as number,
                firstLimitUpClose: close0 as number,
                firstLimitUpPrice: limitUpPrice as number,
                bars,
                maxAvailableRelativeDay: bars.length === 0 ? 0 : bars[bars.length - 1]!.relativeDay,
                invalidRelativeDays,
                missingRelativeDays,
              }
            : null,
      });
    }

    const globallyEligible = candidates.filter((item) => item.sample !== null).length;
    log(
      `全局资格成立（rd ∈ [1, ${MAX_OBSERVATION_DAY}] 齐备且合法）${globallyEligible} / 已评估 ${candidateCount}` +
        `（含裁剪 ${droppedByMaxEvents}；缺首板日 ${missingEventDayBarCount}；缺涨停价 ${missingLimitUpPriceCount}）`
    );

    // ---- 6) 派生量（只对全局资格成立的样本算；逐变体共享这一份**原始派生事实**）----
    //
    // 🔴 这叫「共享事实、不共享结论」：`deriveSample` 产出的逐日路径与逐决策时点视界都是
    //    **原始派生量**。逐变体的**筛选 + 聚合 + 指标**在后面各自独立做 ——
    //    所以「换条件后结论变没变」是真的重新算出来的，不是从别处搬来的。
    const derivedByEvent = new Map<string, SampleDerived>();
    for (const candidate of candidates) {
      if (candidate.sample === null) continue;
      derivedByEvent.set(
        candidate.eventId,
        deriveSample(candidate.sample, {
          maxObservationDay: MAX_OBSERVATION_DAY,
          futureHorizons: FUTURE_HORIZONS,
        })
      );
    }
    log(`派生量就绪：${derivedByEvent.size} 个样本 × ${VARIANT_ITEMS.length} 行矩阵（含基准）`);

    // ---- 7) 逐变体重算（**本文件唯一做研究计算的地方**）----
    const evaluations = new Map<string, VariantEvaluationInternal>();
    for (const item of VARIANT_ITEMS) {
      evaluations.set(
        item.code,
        evaluateVariant({
          variant: specOf(item.code),
          candidates,
          derivedByEvent,
          bucketByCode,
          totalCandidateCount: candidateCount,
          droppedByMaxEvents,
        })
      );
    }
    for (const item of VARIANT_ITEMS) {
      const evaluation = evaluations.get(item.code)!;
      const accounting = evaluation.accounting;
      log(
        `[${item.code}] candidate=${accounting.candidateCount} eligible=${accounting.eligibleCount} ` +
          `valid=${accounting.validCount} missing=${accounting.missingCount} ` +
          `invalid=${accounting.invalidCount} excluded=${accounting.excludedCount}` +
          ` | mean=${formatRatio(evaluation.metrics.metrics.meanCloseReturn)} ` +
          `median=${formatRatio(evaluation.metrics.metrics.medianCloseReturn)} ` +
          `breakout=${formatRatio(evaluation.metrics.metrics.breakoutVsCloseRate)}`
      );
    }

    // ---- 8) 交给跨阶段 Robustness 核心：一个 Run、一个基准、N 个维度共享它 ----
    const subject = subjectFromExperiment({
      experimentCode: EXPERIMENT_CODE,
      experimentVersion: COMPUTATION_VERSION,
      /**
       * 🔴 平台 Run id 在 `run()` 执行期**尚未生成**（Runner 先执行、后持久化）⇒
       *    如实传 `null`，而不是编一个看起来合法的 id。
       */
      runId: null,
    });
    /**
     * 多维运行 id：**确定性派生**（同一实验 + 同一数据集版本 + 同一变体矩阵 ⇒ 同一 id）。
     *
     * 🔴 为什么不注入 wall-clock / 随机数：运行 id 会进记录内容指纹 —— 若它带时间戳，
     *    「同输入 ⇒ 同产物」这条可复现性主张当场失效。需要时间的调用方可以显式注入
     *    （核心的 `createdAt` 是**可选**字段，理由见 `multiDimension.ts` 文件头）。
     */
    const robustnessRunId =
      `${MULTI_DIMENSION_RUN_ID_PREFIX}-` +
      computeCanonicalFingerprint({
        experimentCode: EXPERIMENT_CODE,
        experimentVersion: COMPUTATION_VERSION,
        datasetVersionId: dataset.facts.datasetVersionId,
        baseline: BASELINE_VARIANT_SPEC,
        variants: VARIANT_ITEMS,
      })
        .slice(0, 16)
        .toUpperCase();

    const robustnessRun: MultiDimensionRobustnessRun = runMultiDimensionRobustness({
      subject,
      runId: robustnessRunId,
      dimensions: STABILITY_DIMENSIONS,
      metricNames: METRIC_NAMES,
      comparisons: COMPARISON_SPECS,
      variants: VARIANT_ITEMS,
      // 🔴 evaluator 是**同步**的：核心不执行 IO。重算已经在上面做完并冻结在 `evaluations`。
      evaluator: (item) => {
        const evaluation = evaluations.get(item.code);
        if (evaluation === undefined) {
          return { status: "failed", error: `变体 "${item.code}" 没有评估产物（矩阵与声明不一致）` };
        }
        return {
          status: "succeeded",
          metrics: evaluation.metrics,
          sampleAccounting: evaluation.accounting,
        };
      },
    });
    log(
      `跨阶段 Robustness 核心：runId=${robustnessRun.runId}・` +
        `fingerprint=${robustnessRun.fingerprint.slice(0, 16)}…・overallVerdict=${robustnessRun.overallVerdict}・` +
        `敏感 ${robustnessRun.counts.sensitiveCount} / 稳定 ${robustnessRun.counts.stableCount} / ` +
        `不足 ${robustnessRun.counts.insufficientCount} / 失败 ${robustnessRun.counts.failedCount}`
    );

    // ---- 9) 自检行（配置与基准逐字段相同 ⇒ delta 必须恰为 0）----
    assertSelfCheckRows(robustnessRun, log);

    // ---- 10) 投影成展示行（展示只做投影，不再做任何二次判定）----
    const rows: VariantResultRow[] = [robustnessRun.baseline, ...robustnessRun.variants].map((variant) => {
      const variantSpec = specOf(variant.item.code);
      const evaluation = evaluations.get(variant.item.code)!;
      const accounting = evaluation.accounting;
      const comparisons = variant.comparisons;
      const dimension =
        variantSpec.dimensionId === null
          ? undefined
          : STABILITY_DIMENSIONS.find((item) => item.id === variantSpec.dimensionId);
      const succeeded = variant.status === "succeeded";
      return {
        dimensionId: variantSpec.dimensionId ?? "",
        dimensionLabel:
          variantSpec.dimensionId === null
            ? "（基准 · 不属于任何维度）"
            : (dimension?.label ?? variantSpec.dimensionId),
        code: variant.item.code,
        label: variant.item.label,
        decisionDay: variantSpec.decisionDay,
        horizon: variantSpec.horizon,
        sampleCondition: variantSpec.sampleCondition,
        status: variant.status,
        verdict: variant.verdict,
        candidateCount: accounting.candidateCount,
        eligibleCount: accounting.eligibleCount,
        validCount: accounting.validCount,
        excludedCount: accounting.excludedCount,
        missingCount: accounting.missingCount,
        invalidCount: accounting.invalidCount,
        excludedByReason: { ...accounting.excludedByReason },
        missingByReason: { ...evaluation.missingByReason },
        invalidByReason: { ...evaluation.invalidByReason },
        validSampleCount: accounting.validCount,
        metricValues: succeeded ? { ...evaluation.metrics.metrics } : {},
        unavailableReasons: succeeded ? { ...evaluation.metrics.unavailable } : {},
        configFingerprint: variant.configFingerprint,
        stableMetricCount: comparisons.filter((item) => item.verdict === "stable").length,
        sensitiveMetricCount: comparisons.filter((item) => item.verdict === "sensitive").length,
        insufficientMetricCount: comparisons.filter((item) => item.verdict === "insufficient").length,
        sensitiveMetrics: comparisons
          .filter((item) => item.verdict === "sensitive")
          .map((item) => item.metric),
        sampleSetChanged: comparisons.length === 0 ? null : comparisons.some((item) => item.sampleSetChanged === true),
        note: variant.error ?? "",
      };
    });

    const comparisonRows: ComparisonRow[] = robustnessRun.variants.flatMap((variant) =>
      variant.comparisons.map((comparison) => ({
        variantCode: variant.item.code,
        metric: comparison.metric,
        baselineValue: comparison.baselineValue,
        variantValue: comparison.variantValue,
        delta: comparison.delta,
        tolerance: comparison.tolerance,
        verdict: comparison.verdict,
        reason: comparison.reason,
        sampleSetChanged: comparison.sampleSetChanged,
      }))
    );

    const baselineRow = rows.find((row) => row.verdict === "baseline");
    if (baselineRow === undefined) {
      throw new Error("内部不一致：投影后没有基准行（核心的 baseline 必须 verdict=baseline）");
    }
    const baselineView: BaselineView = {
      code: baselineRow.code,
      label: baselineRow.label,
      decisionDay: baselineRow.decisionDay,
      horizon: baselineRow.horizon,
      sampleCondition: baselineRow.sampleCondition,
      metrics: { ...baselineRow.metricValues },
      unavailable: { ...baselineRow.unavailableReasons },
      configFingerprint: baselineRow.configFingerprint,
    };

    // ---- 11) 表 / 图 / 产物（全部 `context.artifact()`；**不把明细塞进 TiDB**）----
    const tables: StudyTable[] = [
      buildStabilityMatrixTable({ variants: rows, comparisons: comparisonRows }),
      buildStabilityComparisonTable(rows),
      buildSampleAccountingTable(rows),
    ];
    const artifacts = buildStabilityArtifacts({
      tables,
      variants: rows,
      comparisons: comparisonRows,
      baseline: baselineView,
      counts: robustnessRun.counts,
    });
    /**
     * 产物 spec 列表（**先构造、再发出、同一份作为声明索引下发**）。
     *
     * 🔴 三段名字分工（EXP-001 真机上踩过）：
     *    Object Key = `…/runs/{runId}/{role}/{name}` —— 角色段由 `role` 决定，
     *    因此 `name` 必须是**不含角色段的相对名**（写 `tables/x.csv` + `role:"table"`
     *    会落成 `tables/tables/x.csv`）。
     */
    const artifactSpecs: ExperimentArtifactFileSpec[] = [
      ...artifacts.map((file) => ({
        name: file.name,
        role: file.role,
        body: file.body,
        contentType: file.contentType,
        label: file.label,
        description: file.description,
      })),
      /**
       * 核心产出的多维运行记录**原样**落一份（含逐变体指标快照 / 样本账 / 比较 / 维度结论 / 指纹）。
       *
       * 为什么值得单独存：它是「这份矩阵是哪一次算的」的**可离线复核**证据 ——
       * 任何人拿它可以重算指纹、核对样本账守恒式，而不必相信本实验的展示层。
       */
      {
        name: "robustness-run.json",
        role: "artifact",
        body: JSON.stringify(robustnessRun, null, 2),
        contentType: "application/json; charset=utf-8",
        label: "跨阶段 Robustness 多维运行记录（JSON）",
        description:
          "由 server/research/robustness/multiDimension.ts 产出的**核心记录原样**：" +
          "recordKind / recordVersion / 维度 / 指标词表 / 比较声明 / baseline / variants / " +
          "dimensionConclusions / counts / fingerprint。可离线用同一份代码复核指纹与守恒式。",
      },
    ];
    for (const spec of artifactSpecs) artifact(spec);

    const dataQuality: RunDataQuality = {
      invalidOhlcBarCount,
      invalidOhlcAffectedEventCount: invalidOhlcEventIds.size,
      missingWindowBarCount,
      invalidOhlcUsedInWindowCount: [...evaluations.values()].reduce(
        (acc, evaluation) => acc + evaluation.invalidOhlcUsedInWindowCount,
        0
      ),
    };

    const unscannedEventCount =
      dataset.facts.totalEvents === null ? null : dataset.facts.totalEvents - candidateCount;
    const candidatesInfo: RunCandidatesInfo = {
      datasetEventCount: dataset.facts.totalEvents,
      scannedRowCount,
      candidateCount,
      duplicateEventIdCount,
      unscannedEventCount,
      /**
       * 🔴 触顶判据 = **账目缺口**（`unscannedEventCount > 0`），而不是「扫描行数 ≥ 某上限」。
       *    实验**看不到**平台实际生效的上限（`deps.eventScanLimit` 可被注入覆盖），
       *    拿自己声明的上限去比会得出「没截断」的假结论（真被截断时缺口就在那儿）。
       */
      droppedByScanLimit: unscannedEventCount !== null && unscannedEventCount > 0,
      eventPageCount,
    };

    const observations = buildStabilityObservations({
      rows,
      counts: robustnessRun.counts,
      dimensionConclusions: robustnessRun.dimensionConclusions,
      overallVerdict: robustnessRun.overallVerdict,
      baseline: baselineRow,
      dataQuality,
      unscannedEventCount,
      droppedByMaxEvents,
    });

    const notes = [
      `Baseline（**显式声明、不隐含**）：T+${baselineRow.decisionDay} 决策 · T+${baselineRow.horizon} 视界 · ` +
        `样本条件 ${baselineRow.sampleCondition}。口径依据见 customPayload.baselineRationale。`,
      `维度 × 变体：${STABILITY_DIMENSIONS.map(
        (dimension) => `${dimension.id}(${rows.filter((row) => row.dimensionId === dimension.id).length})`
      ).join(" / ")}；外加 1 个基准 ⇒ 矩阵共 ${rows.length} 行（**一个 Run 一个基准**，不是 N 个 Run 拼接）。`,
      "容差是**研究口径**（多大幅度算「结论变了」），不是统计显著性：本实验不做假设检验、不给 p 值。",
      "样本账有两套守恒式（平台信封 vs 核心四桶），换算关系见 result.sampleSummary.notes —— 两者**不同义**。",
      `首板日收盘价与 limitUpPrice 不一致的事件 ${closeDiffersCount} 个（容差 ${CLOSE_MISMATCH_TOLERANCE_RATIO}，` +
        "仅信息性计数，**不触发剔除**）。",
      `缺数据总览（已评估的 ${candidateCount} 个候选内）：缺首板日行情 ${missingEventDayBarCount} / ` +
        `缺涨停价 ${missingLimitUpPriceCount} / 缺窗口行情行 ${missingWindowBarCount} 个 (eventId, 相对日) 对。`,
      `maxEvents 主动裁剪 ${droppedByMaxEvents} 个候选（登记为 MAX_EVENTS_LIMIT，进「缺数据」桶）。`,
      "本实验不产出：最优条件、排序、参数候选、策略对象。`sensitive` 是**发现**，不是缺陷。",
    ];

    log("产物：3 张表 CSV + 1 张 SVG + robustness-run.json（另由平台写入 result.json / logs/run.log / manifest.json）");

    // ---- 12) 结果组装（结构与组装都在 result.ts）----
    return assembleStabilityValidationResult({
      experimentVersion: COMPUTATION_VERSION,
      robustnessRunId: robustnessRun.runId,
      robustnessFingerprint: robustnessRun.fingerprint,
      baseline: baselineView,
      variants: rows,
      comparisons: comparisonRows,
      dimensionConclusions: robustnessRun.dimensionConclusions,
      counts: robustnessRun.counts,
      overallVerdict: robustnessRun.overallVerdict,
      candidates: candidatesInfo,
      dataQuality,
      observations,
      notes,
      artifacts: artifactSpecs.map((spec) => ({
        name: spec.name,
        role: spec.role,
        ...(spec.label !== undefined ? { label: spec.label } : {}),
        ...(spec.description !== undefined ? { description: spec.description } : {}),
        ...(spec.contentType !== undefined ? { contentType: spec.contentType } : {}),
      })),
    });
  },
};

// ---------------------------------------------------------------------------
// 逐变体重算（**本文件唯一做研究计算的地方**）
// ---------------------------------------------------------------------------

/**
 * 一个变体的完整重算：筛选 → 聚合 → 指标 → 样本账。
 *
 * 这是「换一组条件重新算一遍」的字面实现 —— 没有任何一步从 EXP-001 的结果里取值。
 */
function evaluateVariant(input: {
  variant: StabilityVariantSpec;
  candidates: readonly CandidateEvent[];
  derivedByEvent: ReadonlyMap<string, SampleDerived>;
  bucketByCode: ReadonlyMap<string, DrawdownBucket>;
  totalCandidateCount: number;
  droppedByMaxEvents: number;
}): VariantEvaluationInternal {
  const { variant, candidates, derivedByEvent, bucketByCode } = input;
  const requiredMaxDay = requiredMaxRelativeDayOf(variant);
  const missingByReason: Record<string, number> = {};
  const invalidByReason: Record<string, number> = {};
  const excludedByReason: Record<string, number> = {};
  if (input.droppedByMaxEvents > 0) {
    // 被 `maxEvents` 裁掉的事件**从未进入评估** ⇒ 进「缺数据」桶（这是变体级常量，逐变体相同）。
    missingByReason.MAX_EVENTS_LIMIT = input.droppedByMaxEvents;
  }
  let eligibleCount = 0;
  let validCount = 0;
  let invalidOhlcUsedInWindowCount = 0;

  const closeReturns: number[] = [];
  let breakoutCount = 0;
  /** 该变体的未来窗口是否**按定义为空**（`h ≤ k`）—— 与「样本不足」是两件事。 */
  const emptyFutureWindow = variant.horizon <= variant.decisionDay;

  for (const candidate of candidates) {
    const reason = resolveReason(candidate, requiredMaxDay);
    if (reason !== null) {
      const bucket = exclusionBucketOf(reason);
      if (bucket === "missing") bump(missingByReason, reason);
      else bump(invalidByReason, reason);
      continue;
    }
    eligibleCount += 1;
    if (!conditionMet(candidate, variant, derivedByEvent, bucketByCode)) {
      bump(excludedByReason, "SAMPLE_CONDITION_NOT_MET");
      continue;
    }
    validCount += 1;
    if (emptyFutureWindow) continue;

    const derived = derivedByEvent.get(candidate.eventId);
    if (derived === undefined) {
      throw new Error(`内部不一致：事件 ${candidate.eventId} 通过了资格判定却没有派生量`);
    }
    const decision = derived.byDecisionDay.get(variant.decisionDay);
    if (decision === undefined) {
      throw new Error(
        `内部不一致：事件 ${candidate.eventId} 的决策时点 T+${variant.decisionDay} 无派生量` +
          `（资格判定已保证 rd ∈ [1, ${requiredMaxDay}] 齐备）`
      );
    }
    const horizon = decision.byHorizon.get(variant.horizon);
    if (horizon === undefined) {
      throw new Error(`内部不一致：变体声明的视界 T+${variant.horizon} 不在 deriveSample 的视界集合里`);
    }
    if (!horizon.available || horizon.closeReturn === null) {
      throw new Error(
        `内部不一致：事件 ${candidate.eventId} 在 T+${variant.decisionDay} 决策 / T+${variant.horizon} 视界的` +
          "评价窗口不可用（资格判定已保证该窗口连续）"
      );
    }

    /**
     * 🔴 **独立于构造路径**的反查：把该样本**实际用于统计**的每一天，回到
     *    「已校验合法」的 bar 索引（`derived.sample.bars`）里按 rd 找。
     *
     * 只写「因为 `bars` 只 push 合法 bar 所以恒为 0」是同义反复、证明不了任何事；
     * 反过来查才能让「实现绕过连续窗口拿坏 bar 凑数」这类回归立刻把它顶成非 0。
     */
    const validDays = new Set(derived.sample.bars.map((bar) => bar.relativeDay));
    for (let day = 1; day <= variant.decisionDay; day += 1) {
      if (!validDays.has(day)) invalidOhlcUsedInWindowCount += 1;
    }
    for (let day = variant.decisionDay + 1; day <= variant.horizon; day += 1) {
      if (!validDays.has(day)) invalidOhlcUsedInWindowCount += 1;
    }

    closeReturns.push(horizon.closeReturn);
    if (horizon.breakoutVsClose) breakoutCount += 1;
  }

  const accounting: RobustnessSampleAccounting = {
    candidateCount: input.totalCandidateCount,
    eligibleCount,
    validCount,
    excludedCount: sumOf(excludedByReason),
    missingCount: sumOf(missingByReason),
    invalidCount: sumOf(invalidByReason),
    excludedByReason,
    accountingFormula: ACCOUNTING_FORMULA,
  };

  const metrics: Record<string, number> = {
    sampleCount: accounting.candidateCount,
    validSampleCount: accounting.validCount,
  };
  const unavailable: Record<string, string> = {};
  /**
   * 指标可用性（规格 §10：不适用 ⇒ `null + reason`，**不得伪造 0**）。
   *
   * 判定顺序刻意固定：**先看变体本身是否按定义不可评估**（`h ≤ k` ⇒ 窗口为空），
   * 再看数据是否够（有效样本 = 0）。前者是关于**声明**的事实，后者是关于**数据**的事实 ——
   * 把两者混成一个原因，会让「窗口按定义不存在」被读成「样本太少」。
   */
  if (emptyFutureWindow) {
    for (const name of RATIO_METRIC_NAMES) {
      unavailable[name] = METRIC_UNAVAILABLE_REASONS.EMPTY_FUTURE_WINDOW;
    }
  } else if (validCount === 0) {
    for (const name of RATIO_METRIC_NAMES) {
      unavailable[name] = METRIC_UNAVAILABLE_REASONS.NO_VALID_SAMPLE;
    }
  } else {
    metrics.meanCloseReturn = mean(closeReturns);
    metrics.medianCloseReturn = median(closeReturns);
    metrics.breakoutVsCloseRate = breakoutCount / validCount;
  }

  return {
    accounting,
    metrics: { metrics, unavailable },
    missingByReason,
    invalidByReason,
    invalidOhlcUsedInWindowCount,
  };
}

/**
 * 该候选事件对某变体的「数据层结论」；`null` = 数据资格成立（可以进入条件判定）。
 *
 * 🔴 优先级：`missing` > `invalid`（与核心的归入优先级逐字一致）。
 *
 * 窗口需求上界 = `max(k, h)` —— 理由：要「在 T+k 收盘后决策」，必须知道 T+k 收盘价
 * 与**截至 T+k 的路径**（EXP-001 的分组口径就是「截至 T+N 是否跌破首板日开盘价」），
 * 再加上 T+k+1…T+h 的评价窗口。这是**保守**取舍：宁可多要求一天，
 * 也不把不完整的路径算进稳定性结论。
 */
function resolveReason(candidate: CandidateEvent, requiredMaxDay: number): ExclusionReasonCode | null {
  if (candidate.sample === null) {
    if (candidate.globalStatus === "ok") {
      throw new Error(`内部不一致：事件 ${candidate.eventId} 的全局状态为 ok 却没有样本`);
    }
    return candidate.globalStatus;
  }
  // 超出全局判定窗口（> 5）的部分：按该变体真正需要的上界再判一次。
  if (hasDayInRange(candidate.sample.missingRelativeDays, MAX_OBSERVATION_DAY + 1, requiredMaxDay)) {
    return "MISSING_WINDOW_BAR";
  }
  if (hasDayInRange(candidate.sample.invalidRelativeDays, MAX_OBSERVATION_DAY + 1, requiredMaxDay)) {
    return "INVALID_WINDOW_OHLC";
  }
  return null;
}

/** 变体的样本条件是否成立（只读 `deriveSample` 的派生量，不另算一套路径）。 */
function conditionMet(
  candidate: CandidateEvent,
  variant: StabilityVariantSpec,
  derivedByEvent: ReadonlyMap<string, SampleDerived>,
  bucketByCode: ReadonlyMap<string, DrawdownBucket>
): boolean {
  if (variant.sampleCondition === "ALL") return true;
  const derived = derivedByEvent.get(candidate.eventId);
  if (derived === undefined) {
    throw new Error(`内部不一致：事件 ${candidate.eventId} 无派生量却进入条件判定`);
  }
  const day = derived.byDay.find((item) => item.relativeDay === variant.decisionDay);
  if (day === undefined) {
    throw new Error(
      `内部不一致：事件 ${candidate.eventId} 缺 T+${variant.decisionDay} 的逐日派生量（资格判定已保证）`
    );
  }
  if (variant.sampleCondition === "NON_BREAK_OPEN") return day.nonBreakOpen;
  if (variant.sampleCondition === "BREAK_OPEN") return !day.nonBreakOpen;
  const bucket = bucketByCode.get(variant.sampleCondition);
  if (bucket === undefined) {
    throw new Error(
      `内部不一致：样本条件 "${variant.sampleCondition}" 不是 buildDrawdownBuckets 产出的桶名`
    );
  }
  return bucket.test(day.drawdownFromClose);
}

// ---------------------------------------------------------------------------
// 断言 / 小工具
// ---------------------------------------------------------------------------

/** 声明面（`SAMPLE_CONDITIONS`）与实现面（`buildDrawdownBuckets`）必须**双向**一致。 */
function assertBucketVocabularyConsistent(buckets: readonly DrawdownBucket[]): void {
  const implemented = new Set(buckets.map((bucket) => bucket.code));
  const declared = new Set(
    SAMPLE_CONDITIONS.filter((code) => !NON_BUCKET_CONDITIONS.includes(code)) as readonly string[]
  );
  const onlyDeclared = [...declared].filter((code) => !implemented.has(code));
  const onlyImplemented = [...implemented].filter((code) => !declared.has(code));
  if (onlyDeclared.length > 0 || onlyImplemented.length > 0) {
    throw new Error(
      "样本条件与回撤桶口径不一致：" +
        (onlyDeclared.length > 0 ? `声明了但 buildDrawdownBuckets 不产出 [${onlyDeclared.join(", ")}]；` : "") +
        (onlyImplemented.length > 0
          ? `buildDrawdownBuckets 产出但未声明 [${onlyImplemented.join(", ")}]；`
          : "") +
        "请让两边同源（边界改动必须同时改声明）"
    );
  }
}

/**
 * 自检行断言：与基准同配置 ⇒ 逐指标 `delta` 必须**恰为 0**、verdict 必须 `stable`。
 *
 * 这是本实验对「重算干净」最硬的一条证据：它不依赖任何「我相信」——
 * 一旦重算路径里掺进了不该有的状态（缓存串味、遍历顺序依赖、上一轮残留的累加器），
 * 这两行会立刻不再为 0。
 */
function assertSelfCheckRows(run: MultiDimensionRobustnessRun, log: (message: string) => void): void {
  for (const code of SELF_CHECK_VARIANT_CODES) {
    const variant = run.variants.find((item) => item.item.code === code);
    if (variant === undefined) {
      throw new Error(`自检行 "${code}" 不在变体清单里（声明与矩阵不一致）`);
    }
    if (variant.status !== "succeeded") {
      throw new Error(`自检行 "${code}" 评估失败（${variant.error ?? "无错误信息"}）`);
    }
    for (const comparison of variant.comparisons) {
      /**
       * 🔴 `delta === null` 的**唯一**合法情形：**两侧都不可用**（`h ≤ k` 的窗口按定义为空，
       *    或整个数据集没有有效样本）。这不是「重算掺了状态」，而是「这个指标按定义无从比较」。
       *
       *    反之，若基准有值而变体没值（或反过来），delta 同样是 null ——
       *    那正是要抓的重算缺陷 ⇒ 一律判失败。空数据集真机实测踩过这条：
       *    早期写法把 null 也算失败 ⇒ 零样本数据集的 Run 直接崩，而不是如实报 insufficient。
       */
      if (comparison.delta === null) {
        if (comparison.baselineValue !== null || comparison.variantValue !== null) {
          throw new Error(
            `自检失败：变体 "${code}" 与基准同配置，但指标 ${comparison.metric} 只有一侧不可用` +
              `（基准=${String(comparison.baselineValue)}，变体=${String(comparison.variantValue)}）` +
              " —— 同配置必须同可用性",
          );
        }
        if (comparison.verdict !== "insufficient") {
          throw new Error(
            `自检失败：变体 "${code}" 与基准同配置、指标 ${comparison.metric} 两侧都不可用，` +
              `但判定 = ${comparison.verdict}（必须为 insufficient）`,
          );
        }
        log(`自检行 ${code}：指标 ${comparison.metric} 两侧都不可用 ⇒ 判定 insufficient（按定义无从比较）`);
        continue;
      }
      if (comparison.delta !== 0) {
        throw new Error(
          `自检失败：变体 "${code}" 与基准同配置，但指标 ${comparison.metric} 的 delta = ` +
            `${String(comparison.delta)}（必须恰为 0 —— 重算路径里掺进了不该有的状态）`
        );
      }
      if (comparison.verdict !== "stable") {
        throw new Error(
          `自检失败：变体 "${code}" 与基准同配置，但指标 ${comparison.metric} 的判定 = ${comparison.verdict}`
        );
      }
    }
    log(`自检行 ${code}：与基准同配置 ⇒ ${variant.comparisons.length} 个指标的 delta 全为 0 ✓`);
  }
}

function bump(map: Record<string, number>, code: ExclusionReasonCode): void {
  map[code] = (map[code] ?? 0) + 1;
}

function sumOf(map: Readonly<Record<string, number>>): number {
  return Object.values(map).reduce((acc, value) => acc + value, 0);
}

/** 集合里是否存在 `≤ limit` 的相对日。 */
function hasDayAtMost(days: ReadonlySet<number>, limit: number): boolean {
  for (const day of days) if (day <= limit) return true;
  return false;
}

/** 集合里是否存在落在 `[from, to]` 内的相对日。 */
function hasDayInRange(days: ReadonlySet<number>, from: number, to: number): boolean {
  for (const day of days) if (day >= from && day <= to) return true;
  return false;
}

function countNonNull(values: Readonly<Record<string, unknown>>): number {
  let count = 0;
  for (const value of Object.values(values)) if (value !== null && value !== undefined) count += 1;
  return count;
}

/** 均值（空数组 ⇒ 抛错；调用方必须先保证非空）。 */
function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("内部不一致：空数组求均值");
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

/** 中位数（偶数个取中间两个的算术平均；**不做任何插值或裁剪**）。 */
function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("内部不一致：空数组求中位数");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function formatRatio(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// 观察项（只放**能由本轮实测数字支撑**的陈述）
// ---------------------------------------------------------------------------

function buildStabilityObservations(args: {
  rows: readonly VariantResultRow[];
  counts: MultiDimensionRobustnessRun["counts"];
  dimensionConclusions: MultiDimensionRobustnessRun["dimensionConclusions"];
  overallVerdict: string;
  baseline: VariantResultRow;
  dataQuality: RunDataQuality;
  unscannedEventCount: number | null;
  droppedByMaxEvents: number;
}): StabilityObservation[] {
  const out: StabilityObservation[] = [];
  const base = args.baseline;

  out.push({
    kind: "DESCRIPTIVE",
    text:
      `基准（T+${base.decisionDay} 决策 · T+${base.horizon} 视界 · ${base.sampleCondition}）：` +
      `有效样本 ${base.validCount}；平均收盘收益 ${formatRatio(base.metricValues.meanCloseReturn)}、` +
      `中位 ${formatRatio(base.metricValues.medianCloseReturn)}、` +
      `突破决策日收盘价率 ${formatRatio(base.metricValues.breakoutVsCloseRate)}。`,
  });

  for (const conclusion of args.dimensionConclusions) {
    out.push({
      kind: conclusion.sensitiveCount > 0 ? "COMPARATIVE" : "DESCRIPTIVE",
      text:
        `维度「${conclusion.label}」：${conclusion.variantCount} 个变体 ⇒ 判定 ${conclusion.verdict}` +
        `（敏感 ${conclusion.sensitiveCount} / 稳定 ${conclusion.stableCount} / ` +
        `指标不足 ${conclusion.insufficientCount} / 失败 ${conclusion.failedCount}）` +
        (conclusion.sensitiveEntries.length > 0
          ? `；敏感变体：${conclusion.sensitiveEntries.map((entry) => entry.code).join("、")}`
          : ""),
    });
  }

  const sensitiveRows = args.rows.filter((row) => row.verdict === "sensitive");
  out.push({
    kind: sensitiveRows.length > 0 ? "POTENTIAL_SIGNAL" : "DESCRIPTIVE",
    text:
      sensitiveRows.length > 0
        ? `共 ${sensitiveRows.length} / ${args.counts.variantCount} 个变体触发至少一个指标超容差 ⇒ ` +
          `对应维度上的结论是**条件结论**：换一个同样合理的条件，答案会变。` +
          `总体判定 = ${args.overallVerdict}。`
        : `没有任何变体触发超容差（总体判定 = ${args.overallVerdict}）⇒ 在本次声明的维度与容差下，` +
          `结论对这三类条件不敏感。这**不等于**「结论稳健」—— 未声明的条件仍未检验。`,
  });

  const insufficientRows = args.rows.filter((row) => row.verdict === "insufficient");
  if (insufficientRows.length > 0) {
    out.push({
      kind: "DESCRIPTIVE",
      text:
        `指标不足的变体 ${insufficientRows.length} 个：` +
        `${insufficientRows
          .map((row) => `${row.code}(${row.unavailableReasons["meanCloseReturn"] ?? "—"})`)
          .join("、")}。` +
        "指标不足是**口径结果**（窗口按定义为空 / 无有效样本），不是执行失败，也**不允许以 0 顶替**。",
    });
  }

  const sampleSetChangedRows = args.rows.filter((row) => row.sampleSetChanged === true);
  out.push({
    kind: "DESCRIPTIVE",
    text:
      `样本集合发生变化（相对基准的有效样本数不同）的变体 ${sampleSetChangedRows.length} 个` +
      (sampleSetChangedRows.length > 0
        ? `：${sampleSetChangedRows.map((row) => `${row.code}(valid=${row.validCount})`).join("、")}；` +
          "这些比较是**在不同样本总体之间**做的，逐行 sampleSetChanged 已显式暴露。"
        : "（全部非基准变体与基准的有效样本数一致）"),
  });

  out.push({
    kind: "LIMITATION",
    text:
      "容差是**研究口径**（0.02 / 0.02 / 0.05，比例量纲）而非统计显著性：本实验不做假设检验、不给 p 值，" +
      "因此 `stable` 只能读作「在声明容差内未观测到变化」，不能读作「差异不显著」。",
  });
  out.push({
    kind: "LIMITATION",
    text:
      "评价口径 = 决策日 T+k 收盘价锚定、窗口 rd ∈ [k+1, h]（严格在决策时点之后）。" +
      "这与 EXP-001 的「事件日锚定」口径（锚 = 首板日收盘价、窗口 rd ∈ [1, h]）**不同义**、" +
      "数值不可直接对比；本实验只比较「同一口径下不同条件」。",
  });
  out.push({
    kind: "LIMITATION",
    text:
      "基线不是唯一合理的基线：k=5 取自 EXP-001 参数缺省、h=10 取自缺省视界中严格大于 k 的最小值。" +
      "换一个基线，敏感 / 稳定的划分会变 —— 稳定性结论**相对基线而成立**。",
  });
  out.push({
    kind: "LIMITATION",
    text:
      "资格口径是保守的：一个变体要求 `rd ∈ [1, max(k, h)]` 全部齐备且合法（含决策日之前的路径）—— " +
      "宁可多要求一天，也不把不完整的路径算进稳定性结论。因此本实验的有效样本数**低于**" +
      "「只要求未来窗口」的口径，这是口径选择，不是数据缺陷。",
  });
  out.push({
    kind: "LIMITATION",
    text:
      `坏 bar 混入可用窗口次数 = ${args.dataQuality.invalidOhlcUsedInWindowCount}（必须为 0）；` +
      `坏 OHLC bar 总数 ${args.dataQuality.invalidOhlcBarCount}，涉及事件 ${args.dataQuality.invalidOhlcAffectedEventCount} 个。` +
      "第一个数由**独立于构造路径**的反查得到：逐变体逐样本，把实际用于统计的每一天回到" +
      "「已校验合法」的 bar 索引里找。",
  });
  if (args.unscannedEventCount !== null && args.unscannedEventCount > 0) {
    out.push({
      kind: "LIMITATION",
      text:
        `⚠️ 账目缺口：数据集声明事件数与本轮候选数相差 ${args.unscannedEventCount} 个 —— ` +
        "这些事件既不在候选、也不在剔除清单（平台的候选守恒式对它们恒真、毫无约束力）。",
    });
  }
  if (args.droppedByMaxEvents > 0) {
    out.push({
      kind: "LIMITATION",
      text: `本轮 maxEvents 主动裁剪了 ${args.droppedByMaxEvents} 个候选事件（登记为 MAX_EVENTS_LIMIT，进「缺数据」桶）。`,
    });
  }

  return out;
}

export default stabilityValidationExperiment;
