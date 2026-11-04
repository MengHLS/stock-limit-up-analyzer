/**
 * 示例实验 · 首板回踩 · 入场日基础统计（`first-board-pullback/entry-day`）。
 *
 * ## 研究问题
 *
 * 首板（首个涨停）之后，**在第 T+k 个交易日开盘入场、持有到第 T+exit 个交易日收盘**，
 * 不同 k 的基础统计差多少？——「不同入场日」是超短线最常被问到、也最容易被「感觉」误导的问题，
 * 因此本实验只做**描述性统计**：不排序、不评级、不做显著性主张。
 *
 * ## 本文件演示的六件事（外部 AI 生成本类实验时照这个骨架写）
 *
 * 1. `descriptor` 是**唯一**元数据来源：参数定义、Dataset 需求、页面键都在里面；
 * 2. **不碰 DB**：只通过 `context.dataset` 按声明取数（列投影 + 相对日白名单）；
 * 3. **列名写错立刻被拒**（`requiredColumns` 里的列名必须真实存在）；
 * 4. **样本账必须平**：`candidate = eligible + excluded`，且 `Σ excludedByReason === excluded`
 *    —— 服务端 runner 会校验，账不平即 `EXPERIMENT_RESULT_INVALID`；
 * 5. **缺数据一律剔除并登记原因**，绝不用 0 兜底、绝不静默丢样本；
 * 6. 结果结构与组装在 `result.ts`（口径与呈现分离；`resultSchema` 与产物不可能漂移）。
 */

import type { ExperimentDefinition, ExperimentRunContext } from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  EXCLUSION_REASON_LABELS,
  assembleEntryDayResult,
  entryDayCustomPayloadSchema,
  summarizeByEntryDay,
  toFiniteNumber,
  type EntryDaySample,
} from "./result";

/**
 * 声明面：本实验要读的 post（事件日之后）相对日。
 *
 * 🔴 「声明面 ⊇ 使用面」在这里是**可执行的不变量**（不是注释）：
 *   参数 `exitRelativeDay` 的上界**派生自**这个声明；
 *   若有人改了声明却没同步参数界，`run()` 的守卫会**立刻失败并指出缺哪几天**，
 *   而不是静默少读数据。
 */
const DECLARED_POST_RELATIVE_DAYS = Array.from({ length: 20 }, (_, i) => i + 1);
/** `exitRelativeDay` 的上界 = 声明的最远 post 相对日。 */
const MAX_EXIT_RELATIVE_DAY = DECLARED_POST_RELATIVE_DAYS[DECLARED_POST_RELATIVE_DAYS.length - 1]!;
/** 平台事件扫描安全阀（与 `server/researchExperiments/datasetPort.ts` 保持一致）。 */
const PLATFORM_EVENT_SCAN_LIMIT = 20000;

export const entryDayExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/entry-day",
    name: "首板后入场日基础统计",
    version: COMPUTATION_VERSION,
    description:
      "首板之后，在第 T+k 个交易日开盘入场、持有到第 T+exit 个交易日收盘：按入场日 k 分组给出样本数、" +
      "平均 / 中位收益、胜率、入场位置与期间最大不利偏移。**纯描述性统计**：不排序、不评级、不判定最优入场日。",
    source: "stock-limit-up-analyzer",
    tags: ["first-board", "pullback", "entry-timing"],
    parameters: [
      {
        code: "entryDays",
        label: "入场日集合（T+n）",
        description: "要比较的入场日，交易日个数（1 = 首板次日开盘）。",
        kind: "INT_LIST",
        required: false,
        defaultValue: [1, 2, 3, 4, 5],
        bounds: { min: 1, max: MAX_EXIT_RELATIVE_DAY },
        unit: "个交易日",
      },
      {
        code: "exitRelativeDay",
        label: "退出日（T+exit 收盘）",
        description: "持有的终点：第 exit 个交易日收盘。必须大于所有入场日。",
        kind: "INT",
        required: false,
        defaultValue: 5,
        bounds: { min: 1, max: MAX_EXIT_RELATIVE_DAY },
        unit: "个交易日",
      },
      {
        code: "maxEvents",
        label: "最大事件数",
        description:
          "本实验最多统计多少个首板事件（按事件日升序取前 N 个）。超出部分会逐条登记原因，不静默丢弃。",
        kind: "INT",
        required: false,
        defaultValue: 2000,
        bounds: { min: 10, max: PLATFORM_EVENT_SCAN_LIMIT },
        unit: "个事件",
      },
    ],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: ["isFirstLimit", "boardType", "previousClose"],
        feature: ["close"],
        observation: ["open", "high", "low", "close"],
      },
      // rd=0 = 首板日本身：唯一的基准价来源（PIT 安全）。
      prefixRelativeDays: [0],
      // 入场日 + 退出日 + 中间日都要读（实际读取的子集由参数决定）。
      postRelativeDays: DECLARED_POST_RELATIVE_DAYS,
      // 样本资格不使用事件日之后的价格条件（入池只依赖「数据是否齐备」）⇒ null。
      decisionOffsetDays: null,
      usesForwardData: true,
      forwardDataPurpose:
        "研究事件日之后的入场位置与持有到窗口末的收益分布（描述性前瞻统计，不是可交易决策；" +
        "本实验不产出任何信号、参数或策略结论）。",
    },
    pageKey: "first-board-pullback/entry-day",
    pageTitle: "入场日基础统计",
  },

  /** 本实验自有结果结构（信封由平台校验）。 */
  resultSchema: entryDayCustomPayloadSchema,

  async run(context: ExperimentRunContext) {
    const { dataset, parameters, log } = context;

    // ---- 1) 参数（默认值已由 Runner 归并、越界已被拒；这里只做**跨参数**守恒检查）----
    const entryDays = [...(parameters.entryDays as number[])].sort((a, b) => a - b);
    const exitRelativeDay = parameters.exitRelativeDay as number;
    const maxEvents = parameters.maxEvents as number;

    const beyondExit = entryDays.filter((day) => day > exitRelativeDay);
    if (beyondExit.length > 0) {
      // 入场日晚于退出日 ⇒ 连「当日开盘到当日收盘」都没有。
      // 注意 `entryDay === exitRelativeDay` 是**合法**的（当日开盘买入、当日收盘卖出）。
      throw new Error(
        `入场日不得晚于退出日：exitRelativeDay=${exitRelativeDay}，但 entryDays 含 ${beyondExit.join(", ")}` +
          `（= 早于退出日或等于退出日均可）`,
      );
    }

    // ---- 2) 声明面 ⊇ 使用面（改声明而忘记改参数界时立刻失败，不静默少读）----
    const declaredPostDays = context.descriptor.datasetRequirement.postRelativeDays ?? [];
    const requiredPostDays = Array.from({ length: exitRelativeDay }, (_, i) => i + 1);
    const unmet = requiredPostDays.filter((day) => !declaredPostDays.includes(day));
    if (unmet.length > 0) {
      throw new Error(
        `descriptor 只声明了 post 相对日 [${declaredPostDays.join(", ")}]，` +
          `但 exitRelativeDay=${exitRelativeDay} 需要 [${requiredPostDays.join(", ")}]` +
          `（缺失：${unmet.join(", ")}）—— 请同步扩声明，不要静默少读数据`,
      );
    }

    // ---- 3) 取数（全部经声明面；未声明的列 / 相对日读不到）----
    const events = await dataset.events();
    log(`读取事件 ${events.length} 条（数据集声明总数 ${String(dataset.facts.totalEvents)}）`);
    context.freezeSelection(events.map((event) => event.eventId));

    const eventDayBars = await dataset.feature(0);
    log(`读取首板日（rd=0）行情 ${eventDayBars.length} 行`);
    const eventDayCloseByEvent = new Map<string, number | null>();
    for (const bar of eventDayBars) {
      eventDayCloseByEvent.set(bar.eventId, toFiniteNumber(bar.values.close));
    }

    const postByDay = new Map<string, Map<string, Readonly<Record<string, number | boolean | string | null>>>>();
    for (const day of requiredPostDays) {
      const rows = await dataset.observation(day);
      const byEvent = new Map<string, Readonly<Record<string, number | boolean | string | null>>>();
      for (const row of rows) byEvent.set(row.eventId, row.values);
      postByDay.set(String(day), byEvent);
      log(`读取 rd=${day} 行情 ${rows.length} 行`);
    }

    const postValueOf = (
      day: number,
      eventId: string,
      column: string,
    ): number | null => {
      const values = postByDay.get(String(day))?.get(eventId);
      if (!values) return null;
      return toFiniteNumber(values[column]);
    };

    // ---- 4) 候选裁剪（只按事件日升序取前 N 个；被裁掉的一律登记原因）----
    const scannedEventCount = events.length;
    const usedEvents = events.slice(0, maxEvents);
    const droppedByMaxEvents = scannedEventCount - usedEvents.length;
    log(`候选 ${scannedEventCount} → 使用 ${usedEvents.length}（maxEvents=${maxEvents}）`);

    const excludedByReason: Record<string, number> = {};
    const addExclusion = (reason: keyof typeof EXCLUSION_REASON_LABELS, count: number): void => {
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + count;
    };

    // 「样本」= （事件 × 入场日）一次可评估的入场机会，因此账目单位是**槽位**。
    const slotsPerEvent = entryDays.length;
    const candidateCount = scannedEventCount * slotsPerEvent;
    if (droppedByMaxEvents > 0) addExclusion("MAX_EVENTS_LIMIT", droppedByMaxEvents * slotsPerEvent);

    const samples: EntryDaySample[] = [];

    for (const event of usedEvents) {
      const baseClose = eventDayCloseByEvent.get(event.eventId);
      if (baseClose === null || baseClose === undefined) {
        addExclusion("MISSING_EVENT_DAY_BAR", slotsPerEvent);
        continue;
      }
      if (!(baseClose > 0)) {
        addExclusion("INVALID_EVENT_DAY_CLOSE", slotsPerEvent);
        continue;
      }

      const exitClose = postValueOf(exitRelativeDay, event.eventId, "close");

      for (const entryDay of entryDays) {
        const entryOpen = postValueOf(entryDay, event.eventId, "open");
        if (entryOpen === null) {
          // 区分「整行缺失」与「行在但字段缺」——两者的排查方向完全不同。
          addExclusion(
            postByDay.get(String(entryDay))?.has(event.eventId) ? "INVALID_ENTRY_OPEN" : "MISSING_ENTRY_BAR",
            1,
          );
          continue;
        }
        if (!(entryOpen > 0)) {
          addExclusion("INVALID_ENTRY_OPEN", 1);
          continue;
        }
        if (!postByDay.get(String(exitRelativeDay))?.has(event.eventId)) {
          addExclusion("MISSING_EXIT_BAR", 1);
          continue;
        }
        if (exitClose === null || !(exitClose > 0)) {
          addExclusion("INVALID_EXIT_CLOSE", 1);
          continue;
        }

        // 最大不利偏移：入场日（**含当日**）到退出日之间所有 low 的最低点。
        // 含入场日当日是必要的 —— 否则 `entryDay === exitRelativeDay` 时区间为空、
        // 该指标恒为「无数据」，看起来像数据问题而其实是口径问题。
        let minLow: number | null = null;
        let hasGap = false;
        for (let day = entryDay; day <= exitRelativeDay; day += 1) {
          const low = postValueOf(day, event.eventId, "low");
          if (low === null) {
            hasGap = true;
            break;
          }
          minLow = minLow === null ? low : Math.min(minLow, low);
        }
        if (hasGap || minLow === null) {
          addExclusion("MISSING_INTERMEDIATE_BAR", 1);
          continue;
        }

        samples.push({
          entryDay,
          entryGapPercent: (entryOpen / baseClose - 1) * 100,
          forwardReturnPercent: (exitClose / entryOpen - 1) * 100,
          maxAdversePercent: (minLow / entryOpen - 1) * 100,
        });
      }
    }

    const eligibleCount = samples.length;
    log(`入池样本 ${eligibleCount} / 候选槽位 ${candidateCount}`);

    // ---- 5) 结果组装（结构定义与组装都在 result.ts）----
    return assembleEntryDayResult({
      slots: summarizeByEntryDay(entryDays, samples),
      samples,
      exitRelativeDay,
      datasetEventCount: dataset.facts.totalEvents,
      scannedEventCount,
      usedEventCount: usedEvents.length,
      droppedByMaxEvents,
      excludedByReason,
      candidateCount,
      eligibleCount,
      slotsPerEvent,
    });
  },
};

export default entryDayExperiment;
