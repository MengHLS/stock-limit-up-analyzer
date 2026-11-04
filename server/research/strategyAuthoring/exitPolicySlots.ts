/**
 * FE-PLAN-004 —— 「退出政策」拆成 **9 个规则槽**（服务端唯一定义）。
 *
 * ## 为什么会有这个模块
 *
 * 实测（`docs/product/FE-PLAN-004-exit-policy-restructure.md` §1）：
 * `STOP_POLICY_EXPERIMENTS` 的 **46 个实验里，40 个只改了 1 个维度**、4 个改了 2 个、
 * **2 个与基准逐字相同**；而且止盈 / 到期 / 续持 / 资金循环在 46 个里**完全不变**。
 * 也就是说 —— 那 46 个不是 46 套政策，而是 **6 个止损维度的单变量扫描**。
 *
 * 所以本模块把「一套退出政策」重新表达为 **9 个正交规则槽**：
 *
 *   止损位置 · 止损确认 · 止损收紧 · 止损时间表 · 分批止损 · 止盈 · 到期 · 续持 · 研究路径
 *
 * 每槽 = 一组「方案（option）+ 可调参数」，槽与 `ExitPolicyDefinition` 的字段**逐字段对应**：
 *
 * | 槽 | 落到 policy 的哪一块 |
 * |---|---|
 * | 止损位置 | `stop.anchor` |
 * | 止损确认 | `stop.confirmation`（+ `stop.disasterStopRatio`） |
 * | 止损收紧 | `stop.escalation` |
 * | 止损时间表 | `stop.schedule` |
 * | 分批止损 | `stop.reduction` |
 * | 止盈 | `takeProfit` |
 * | 到期 | `timeExit` |
 * | 续持 | `strongHold` |
 * | 研究路径 | `recoveryPath` / `runnerBridge` / `clc2ReversalPath` |
 *
 * ## 三条纪律
 *
 * 1. 🔴 **不新增语义**：每个 option 的 `patch` 都只由**既有已登记取值**拼成
 *    （union 类型 `StopAnchorDefinition` / `StopEscalationDefinition` /
 *    `ResearchTrailingPolicyDefinition` …），参数用 RFC 6901 JSON Pointer 写进 patch。
 * 2. 🔴 **只覆盖自己的键**：`applyExitPolicySlot` 做**浅合并**（stop 层再浅合并一层），
 *    槽没声明的键（例如 `strongHold.scaleOutRatio`、以及表单不编辑的扩展键）**原样保留**
 *    —— 否则"只改一下止损"就会把别的字段冲掉。
 * 3. 🔴 **不认识的策略不许猜**：`recognizeExitPolicySlot` 认不出就返回 `null`
 *    （UI 必须显示「本表单不识别」并**不改写**），绝不"就近匹配"一个看起来像的选项。
 */
import {
  RUNNER_HOLDING_BRIDGE_STATES,
  type ExitPolicyDefinition,
} from "../exitPolicyCommon";
import {
  STRONG_HOLD_AFTER_EXTENDED_EXIT_POLICIES,
  type ResearchTrailingPolicyDefinition,
} from "../trailingPolicy";
import { JsonPointerError, setByPointer } from "./jsonPointer";
import type { StrategyPresetParameter, StrategyPresetParameterValue } from "./presetRegistry";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/**
 * 槽位 id。**顺序 = UI 顺序**（常显 3 → 折叠 5 → 研究 1），
 * 与 `EXIT_POLICY_SLOTS` 的表顺序**逐位相同**（由测试钉住）——
 * 免得"元组顺序"与"渲染顺序"各说各话。
 */
export const EXIT_POLICY_SLOT_IDS = [
  "ANCHOR",
  "TAKE_PROFIT",
  "TIME_EXIT",
  "CONFIRMATION",
  "ESCALATION",
  "SCHEDULE",
  "REDUCTION",
  "STRONG_HOLD",
  "RESEARCH",
] as const;
export type ExitPolicySlotId = (typeof EXIT_POLICY_SLOT_IDS)[number];

/** 首屏可见性：`PRIMARY` 常显 / `MORE` 折叠进「再加规则」/ `RESEARCH` 折叠进「研究专用」。 */
export type ExitPolicySlotVisibility = "PRIMARY" | "MORE" | "RESEARCH";

export interface ExitPolicySlotOption {
  readonly optionId: string;
  /** 规则式中文名：名字本身要说清规则（不出现 optionId / 内部 kind）。 */
  readonly displayName: string;
  readonly summary: string;
  /**
   * 该 option 拥有的键（**是 `ExitPolicyDefinition` 的偏对象**）。
   * `stop` 下的槽写成 `{ stop: { <field>: … } }`，合并时 stop 层再浅合并一次。
   */
  readonly patch: Readonly<Record<string, unknown>>;
  readonly parameters: readonly StrategyPresetParameter[];
}

export interface ExitPolicySlotDefinition {
  readonly slotId: ExitPolicySlotId;
  readonly label: string;
  /** 这个槽回答的那句人话问题（唯一一处解释文字，UI 可直接当 title）。 */
  readonly question: string;
  readonly visibility: ExitPolicySlotVisibility;
  readonly options: readonly ExitPolicySlotOption[];
}

export interface MaterializeExitSlotOptionResult {
  readonly patch: Readonly<Record<string, unknown>> | null;
  readonly resolvedParameters: Readonly<Record<string, StrategyPresetParameterValue>>;
  readonly issues: readonly string[];
}

export interface RecognizeExitSlotResult {
  readonly optionId: string;
  readonly parameters: Readonly<Record<string, StrategyPresetParameterValue>>;
}

// ---------------------------------------------------------------------------
// 参数小工具（与 presetRegistry 的 num/bool 同形；本模块不 import 其私有实现）
// ---------------------------------------------------------------------------

function num(
  code: string,
  label: string,
  description: string,
  path: string,
  value: number,
  extra: Partial<StrategyPresetParameter> = {},
): StrategyPresetParameter {
  return { code, label, description, path, valueType: "number", required: true, defaultValue: value, ...extra };
}

function bool(code: string, label: string, description: string, path: string, value: boolean): StrategyPresetParameter {
  return { code, label, description, path, valueType: "boolean", required: true, defaultValue: value };
}

function str(
  code: string,
  label: string,
  description: string,
  path: string,
  value: string,
  allowedValues: readonly string[],
  optionLabels?: Readonly<Record<string, string>>,
): StrategyPresetParameter {
  return {
    code, label, description, path, valueType: "string", required: true, defaultValue: value,
    allowedValues, ...(optionLabels === undefined ? {} : { optionLabels }),
  };
}

/** 止损锚的公共上下限（46 个实验里一律是 4%~10%）。 */
const STOP_BOUNDS = { minStopRatio: 0.04, maxStopRatio: 0.1 };

/** 数值参数面板里「夹在 4%~10%」的两个公共参数（每个带上下限的锚家族都要）。 */
function stopBoundParameters(prefix: string): readonly StrategyPresetParameter[] {
  return [
    num("minStopRatio", "止损上限下的最小值", "止损比例的下限（太紧会被它托住）", prefix + "/minStopRatio", STOP_BOUNDS.minStopRatio, { unit: "ratio", min: 0.005, max: 0.5, step: 0.005 }),
    num("maxStopRatio", "止损最大值", "止损比例的上限（太宽会被它压住）", prefix + "/maxStopRatio", STOP_BOUNDS.maxStopRatio, { unit: "ratio", min: 0.005, max: 0.5, step: 0.005 }),
  ];
}

/**
 * 「不启用」选项。
 *
 * 🔴 它的 patch **必须显式把该字段置 `null`**，不能是空 patch：
 *   ① 空 patch 会与**任何**策略都匹配 ⇒ 识别层会把"有规则"的版本误判成"不启用"；
 *   ② 用户点「不启用」时要真的把字段清掉，而不是什么都不做。
 */
function offOption(displayName: string, patch: Readonly<Record<string, unknown>>): ExitPolicySlotOption {
  return {
    optionId: "off",
    displayName,
    summary: "这一层不设规则 —— 退出只看其它槽。",
    patch,
    parameters: [],
  };
}

// ---------------------------------------------------------------------------
// ① 止损位置
// ---------------------------------------------------------------------------

const ANCHOR_OPTIONS: readonly ExitPolicySlotOption[] = [
  {
    optionId: "fixed-percent",
    displayName: "固定百分比",
    summary: "从建仓价往下固定一个百分比就止损（最直白，也最不挑数据）。",
    patch: { stop: { anchor: { kind: "FIXED_PERCENT", stopRatio: 0.06 } } },
    parameters: [
      num("stopRatio", "止损比例", "0.06 = 跌 6% 走", "/stop/anchor/stopRatio", 0.06, { unit: "ratio", min: 0.005, max: 0.5, step: 0.005 }),
    ],
  },
  {
    optionId: "atr",
    displayName: "ATR 倍数",
    summary: "按波动幅度定止损：ATR × 倍数，再夹在上下限之间。",
    patch: { stop: { anchor: { kind: "ATR", atrWindow: 10, atrMultiplier: 1.5, ...STOP_BOUNDS } } },
    parameters: [
      num("atrWindow", "ATR 窗口", "用多少日的 ATR", "/stop/anchor/atrWindow", 10, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("atrMultiplier", "ATR 倍数", "1.5 = 止损放在 1.5 个 ATR 之外", "/stop/anchor/atrMultiplier", 1.5, { unit: "MULTIPLE", min: 0.1, max: 10, step: 0.05 }),
      ...stopBoundParameters("/stop/anchor"),
    ],
  },
  {
    optionId: "structure-observation-window",
    displayName: "观察窗最低点",
    summary: "跌破观察窗口里那根最低价就走（可再往下留一点 ATR 缓冲）。",
    patch: { stop: { anchor: { kind: "STRUCTURE_LOW", source: "OBSERVATION_WINDOW", bufferAtrMultiplier: 0, ...STOP_BOUNDS } } },
    parameters: [
      num("bufferAtrMultiplier", "ATR 缓冲", "再往下留几个 ATR（0 = 不留）", "/stop/anchor/bufferAtrMultiplier", 0, { unit: "MULTIPLE", min: 0, max: 3, step: 0.05 }),
      ...stopBoundParameters("/stop/anchor"),
    ],
  },
  {
    optionId: "structure-event-day-close",
    displayName: "事件日收盘价",
    summary: "跌破事件当天收盘价就走。",
    patch: { stop: { anchor: { kind: "STRUCTURE_LOW", source: "EVENT_DAY_CLOSE", bufferAtrMultiplier: 0, ...STOP_BOUNDS } } },
    parameters: [
      num("bufferAtrMultiplier", "ATR 缓冲", "再往下留几个 ATR（0 = 不留）", "/stop/anchor/bufferAtrMultiplier", 0, { unit: "MULTIPLE", min: 0, max: 3, step: 0.05 }),
      ...stopBoundParameters("/stop/anchor"),
    ],
  },
  {
    optionId: "structure-event-day-low",
    displayName: "事件日最低价",
    summary: "跌破事件当天最低价就走（比收盘价更宽）。",
    patch: { stop: { anchor: { kind: "STRUCTURE_LOW", source: "EVENT_DAY_LOW", bufferAtrMultiplier: 0, ...STOP_BOUNDS } } },
    parameters: [
      num("bufferAtrMultiplier", "ATR 缓冲", "再往下留几个 ATR（0 = 不留）", "/stop/anchor/bufferAtrMultiplier", 0, { unit: "MULTIPLE", min: 0, max: 3, step: 0.05 }),
      ...stopBoundParameters("/stop/anchor"),
    ],
  },
  {
    optionId: "structure-rolling-low",
    displayName: "近 N 日最低价",
    summary: "跌破最近 N 个交易日的最低价就走。",
    patch: { stop: { anchor: { kind: "STRUCTURE_LOW", source: "ROLLING_LOW", lookbackDays: 5, bufferAtrMultiplier: 0, ...STOP_BOUNDS } } },
    parameters: [
      num("lookbackDays", "回看天数", "取最近多少个交易日的最低价", "/stop/anchor/lookbackDays", 5, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("bufferAtrMultiplier", "ATR 缓冲", "再往下留几个 ATR（0 = 不留）", "/stop/anchor/bufferAtrMultiplier", 0, { unit: "MULTIPLE", min: 0, max: 3, step: 0.05 }),
      ...stopBoundParameters("/stop/anchor"),
    ],
  },
  {
    optionId: "range-fraction",
    displayName: "事件日区间的比例",
    summary: "在事件日最高—最低这段区间里取一个比例位置当止损（1 = 区间底）。",
    patch: { stop: { anchor: { kind: "RANGE_FRACTION", fraction: 1, ...STOP_BOUNDS } } },
    parameters: [
      num("fraction", "区间位置", "1 = 区间最低价；0.5 = 区间中点", "/stop/anchor/fraction", 1, { unit: "ratio", min: 0.1, max: 1, step: 0.05 }),
      ...stopBoundParameters("/stop/anchor"),
    ],
  },
  {
    optionId: "atr-percentile",
    displayName: "ATR 分位数",
    summary: "取最近 ATR 的高分位当止损宽度 —— 波动放大时才放宽。",
    patch: { stop: { anchor: { kind: "ATR_PERCENTILE", atrWindow: 10, percentile: 0.9, ...STOP_BOUNDS } } },
    parameters: [
      num("atrWindow", "ATR 窗口", "用多少日的 ATR", "/stop/anchor/atrWindow", 10, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("percentile", "分位数", "0.9 = 取 90 分位", "/stop/anchor/percentile", 0.9, { unit: "ratio", min: 0.05, max: 0.99, step: 0.05 }),
      ...stopBoundParameters("/stop/anchor"),
    ],
  },
];

// ---------------------------------------------------------------------------
// ② 止损确认
// ---------------------------------------------------------------------------

const CONFIRMATION_OPTIONS: readonly ExitPolicySlotOption[] = [
  {
    optionId: "intraday",
    displayName: "盘中触价即走",
    summary: "盘中一碰到止损价就卖 —— 反应最快，也最容易被插针打掉。",
    patch: { stop: { confirmation: "INTRADAY", disasterStopRatio: null } },
    parameters: [],
  },
  {
    optionId: "on-close",
    displayName: "收盘确认才走",
    summary: "只在收盘价跌破时才算破位（次日开盘卖）—— 不容易被盘中插针打掉。",
    patch: { stop: { confirmation: "ON_CLOSE", disasterStopRatio: null } },
    parameters: [],
  },
  {
    optionId: "two-closes",
    displayName: "连续两根收盘确认",
    summary: "连续两个交易日收盘都在止损位之下才走 —— 更钝，但更少假信号。",
    patch: { stop: { confirmation: "TWO_CLOSES", disasterStopRatio: null } },
    parameters: [],
  },
  {
    optionId: "disaster-plus-close",
    displayName: "灾难价先走，其余收盘确认",
    summary: "跌到灾难价（很深的亏损）当场卖；没到灾难价就等收盘确认。",
    patch: { stop: { confirmation: "DISASTER_PLUS_CLOSE", disasterStopRatio: 0.09 } },
    parameters: [
      num("disasterStopRatio", "灾难止损比例", "0.09 = 亏 9% 当场走", "/stop/disasterStopRatio", 0.09, { unit: "ratio", min: 0.02, max: 0.5, step: 0.005 }),
    ],
  },
  {
    optionId: "limit-down-reconfirm",
    displayName: "跌停要再确认一次",
    summary: "跌停当天不急着卖，等下一个交易日再确认 —— 避免在跌停板上被动砸出。",
    patch: { stop: { confirmation: "LIMIT_DOWN_RECONFIRM", disasterStopRatio: null } },
    parameters: [],
  },
];

// ---------------------------------------------------------------------------
// ③ 止损收紧
// ---------------------------------------------------------------------------

const ESCALATION_OPTIONS: readonly ExitPolicySlotOption[] = [
  offOption("不收紧（只按初始止损）", { stop: { escalation: null } }),
  {
    optionId: "break-even",
    displayName: "浮盈 3% 后移到保本",
    summary: "赚到 3% 就把止损抬到建仓价 —— 之后最差是白干一场。",
    patch: { stop: { escalation: { kind: "BREAK_EVEN", activationRatio: 0.03, stopRatio: 0 } } },
    parameters: [
      num("activationRatio", "激活浮盈", "赚到多少才启动", "/stop/escalation/activationRatio", 0.03, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
      num("stopRatio", "移到什么位置", "0 = 建仓价（保本）", "/stop/escalation/stopRatio", 0, { unit: "ratio", min: 0, max: 0.5, step: 0.005 }),
    ],
  },
  {
    optionId: "ladder",
    displayName: "阶梯锁盈（3%→保本，6%→锁2%，10%→锁5%）",
    summary: "浮盈一档一档往上抬止损，把利润按档锁住。",
    patch: {
      stop: {
        escalation: {
          kind: "LADDER",
          steps: [
            { activationRatio: 0.03, stopRatio: 0 },
            { activationRatio: 0.06, stopRatio: 0.02 },
            { activationRatio: 0.1, stopRatio: 0.05 },
          ],
        },
      },
    },
    parameters: [],
  },
  {
    optionId: "r-multiple",
    displayName: "按 R 倍数锁盈（2R 锁 1R，3R 锁 2R）",
    summary: "以初始风险 R 为单位：赚到 2R 就把止损抬到 1R。",
    patch: { stop: { escalation: { kind: "R_MULTIPLE", rRatio: 0.06, steps: [{ triggerR: 2, lockR: 1 }, { triggerR: 3, lockR: 2 }] } } },
    parameters: [
      num("rRatio", "1R 等于多少", "初始风险的比例（0.06 = 6%）", "/stop/escalation/rRatio", 0.06, { unit: "ratio", min: 0.005, max: 0.5, step: 0.005 }),
    ],
  },
  {
    optionId: "chandelier",
    displayName: "吊灯止损（2.5 个 ATR）",
    summary: "从持仓期最高价往下挂 2.5 个 ATR，跟着新高往上走。",
    patch: { stop: { escalation: { kind: "CHANDELIER", atrWindow: 10, atrMultiplier: 2.5 } } },
    parameters: [
      num("atrWindow", "ATR 窗口", "用多少日的 ATR", "/stop/escalation/atrWindow", 10, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("atrMultiplier", "ATR 倍数", "往下挂几个 ATR", "/stop/escalation/atrMultiplier", 2.5, { unit: "MULTIPLE", min: 0.1, max: 10, step: 0.1 }),
    ],
  },
  {
    optionId: "ma-band",
    displayName: "均线带止损（MA10 − 0.5 ATR）",
    summary: "止损挂在 10 日均线下方半个 ATR —— 既是趋势线也是止损位。",
    patch: { stop: { escalation: { kind: "MA_BAND", maWindow: 10, atrWindow: 10, atrMultiplier: 0.5 } } },
    parameters: [
      num("maWindow", "均线窗口", "用多少日均线", "/stop/escalation/maWindow", 10, { unit: "TRADING_DAY", min: 2, max: 250, step: 1 }),
      num("atrWindow", "ATR 窗口", "用多少日的 ATR", "/stop/escalation/atrWindow", 10, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("atrMultiplier", "ATR 倍数", "均线下方留几个 ATR", "/stop/escalation/atrMultiplier", 0.5, { unit: "MULTIPLE", min: 0, max: 5, step: 0.1 }),
    ],
  },
  {
    optionId: "peak-drawdown",
    displayName: "峰值回撤保护",
    summary: "浮盈到激活线之后，从最高价回撤到阈值就走 —— 让利润跑，回撤才止盈。",
    patch: { stop: { escalation: { kind: "PEAK_DRAWDOWN", activationRatio: 0.03, drawdownRatio: 0.08 } } },
    parameters: [
      num("activationRatio", "激活浮盈", "赚到多少才开始保护", "/stop/escalation/activationRatio", 0.03, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
      num("drawdownRatio", "回撤幅度", "从最高价回撤多少就走", "/stop/escalation/drawdownRatio", 0.08, { unit: "ratio", min: 0.005, max: 0.5, step: 0.005 }),
    ],
  },
];

// ---------------------------------------------------------------------------
// ④ 止损时间表
// ---------------------------------------------------------------------------

const SCHEDULE_OPTIONS: readonly ExitPolicySlotOption[] = [
  offOption("不按时间变", { stop: { schedule: null } }),
  {
    optionId: "wide-first-two-days",
    displayName: "前两天放宽到 8%，第 3 天起 6%",
    summary: "刚进场最容易晃，前两天给宽一点；第三天收紧。",
    patch: { stop: { schedule: { phases: [{ fromHoldingDay: 1, toHoldingDay: 2, stopRatio: 0.08 }, { fromHoldingDay: 3, toHoldingDay: 999, stopRatio: 0.06 }] } } },
    parameters: [],
  },
  {
    optionId: "time-decay-three-phases",
    displayName: "8%→6%→5% 三档收紧",
    summary: "第 1–2 日 8%、第 3–5 日 6%、第 6 日起 5% —— 拿得越久要求越严。",
    patch: {
      stop: {
        schedule: {
          phases: [
            { fromHoldingDay: 1, toHoldingDay: 2, stopRatio: 0.08 },
            { fromHoldingDay: 3, toHoldingDay: 5, stopRatio: 0.06 },
            { fromHoldingDay: 6, toHoldingDay: 999, stopRatio: 0.05 },
          ],
        },
      },
    },
    parameters: [],
  },
  {
    optionId: "wide-first-day",
    displayName: "首日放宽到 10%，第 2 天起 6%",
    summary: "只给进场首日宽一点，第二天立刻回到 6%。",
    patch: { stop: { schedule: { phases: [{ fromHoldingDay: 1, toHoldingDay: 1, stopRatio: 0.1 }, { fromHoldingDay: 2, toHoldingDay: 999, stopRatio: 0.06 }] } } },
    parameters: [],
  },
];

// ---------------------------------------------------------------------------
// ⑤ 分批止损
// ---------------------------------------------------------------------------

const REDUCTION_OPTIONS: readonly ExitPolicySlotOption[] = [
  offOption("不分批（一次走完）", { stop: { reduction: null } }),
  {
    optionId: "partial-3-6",
    displayName: "亏 3% 走一半，亏 6% 走完",
    summary: "先减半仓减小回撤，剩下的一半给它机会。",
    patch: { stop: { reduction: { steps: [{ triggerRatio: -0.03, sellRatio: 0.5 }, { triggerRatio: -0.06, sellRatio: 1 }] } } },
    parameters: [],
  },
  {
    optionId: "partial-4-10",
    displayName: "亏 4% 走一半，亏 10% 走完",
    summary: "更宽的两档：4% 减半，10% 清仓。",
    patch: { stop: { reduction: { steps: [{ triggerRatio: -0.04, sellRatio: 0.5 }, { triggerRatio: -0.1, sellRatio: 1 }] } } },
    parameters: [],
  },
];

// ---------------------------------------------------------------------------
// ⑥ 止盈
// ---------------------------------------------------------------------------

const TAKE_PROFIT_OPTIONS: readonly ExitPolicySlotOption[] = [
  offOption("不主动止盈", { takeProfit: null }),
  {
    optionId: "ma-cross",
    displayName: "跌破 MA5/MA10 就走",
    summary: "收盘跌破 5 日或 10 日均线即离场 —— 趋势走坏就下车。",
    patch: { takeProfit: { kind: "MA_CROSS", fastWindow: 5, slowWindow: 10, activationRatio: 0 } },
    parameters: [
      num("fastWindow", "快线窗口", "快线用多少日", "/takeProfit/fastWindow", 5, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("slowWindow", "慢线窗口", "慢线用多少日", "/takeProfit/slowWindow", 10, { unit: "TRADING_DAY", min: 2, max: 250, step: 1 }),
      num("activationRatio", "激活浮盈", "先赚到多少才启用（0 = 一直启用）", "/takeProfit/activationRatio", 0, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
    ],
  },
  {
    optionId: "atr-chandelier-take-profit",
    displayName: "吊灯止盈（2 个 ATR）",
    summary: "从最高价往下 2 个 ATR 止盈 —— 比均线跟得更近。",
    patch: { takeProfit: { kind: "ATR_CHANDELIER", atrWindow: 10, atrMultiplier: 2, activationRatio: 0 } },
    parameters: [
      num("atrWindow", "ATR 窗口", "用多少日的 ATR", "/takeProfit/atrWindow", 10, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("atrMultiplier", "ATR 倍数", "往下挂几个 ATR", "/takeProfit/atrMultiplier", 2, { unit: "MULTIPLE", min: 0.1, max: 10, step: 0.1 }),
      num("activationRatio", "激活浮盈", "先赚到多少才启用", "/takeProfit/activationRatio", 0, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
    ],
  },
  {
    optionId: "profit-giveback",
    displayName: "盈利回吐止盈",
    summary: "赚到的钱回吐掉一定比例就走 —— 不猜顶，只守已得。",
    patch: { takeProfit: { kind: "PROFIT_GIVEBACK", activationRatio: 0.03, givebackFraction: 0.5 } },
    parameters: [
      num("activationRatio", "激活浮盈", "先赚到多少才开始守", "/takeProfit/activationRatio", 0.03, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
      num("givebackFraction", "回吐比例", "允许回吐掉浮盈的多少", "/takeProfit/givebackFraction", 0.5, { unit: "ratio", min: 0.05, max: 1, step: 0.05 }),
    ],
  },
  {
    optionId: "r-multiple-take-profit",
    displayName: "按 R 倍数止盈（2R 锁 1R，3R 锁 2R）",
    summary: "以初始风险 R 为单位，赚到 2R 就把止盈抬到 1R —— 阶梯固定，不接受参数。",
    patch: { takeProfit: { kind: "R_MULTIPLE", lockLadder: [{ triggerR: 2, lockR: 1 }, { triggerR: 3, lockR: 2 }] } },
    parameters: [],
  },
  {
    optionId: "parabolic-sar",
    displayName: "抛物线 SAR 止盈",
    summary: "用抛物线 SAR 翻转作为止盈信号 —— 趋势转弱就跟得比较紧。",
    patch: { takeProfit: { kind: "PARABOLIC_SAR", step: 0.02, maxStep: 0.2, activationRatio: 0 } },
    parameters: [
      num("step", "步长", "SAR 的加速因子步长", "/takeProfit/step", 0.02, { unit: "ratio", min: 0.001, max: 0.2, step: 0.001 }),
      num("maxStep", "最大步长", "加速因子的上限", "/takeProfit/maxStep", 0.2, { unit: "ratio", min: 0.01, max: 1, step: 0.01 }),
      num("activationRatio", "激活浮盈", "先赚到多少才启用", "/takeProfit/activationRatio", 0, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
    ],
  },
  {
    optionId: "hybrid",
    displayName: "混合止盈（均线 + ATR 地板）",
    summary: "同时看快均线与 ATR，取更靠上的那条当止盈线。",
    patch: { takeProfit: { kind: "HYBRID", fastWindow: 5, atrWindow: 10, atrMultiplier: 2, floorRatio: 0.03, activationRatio: 0 } },
    parameters: [
      num("fastWindow", "快线窗口", "快线用多少日", "/takeProfit/fastWindow", 5, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("atrWindow", "ATR 窗口", "用多少日的 ATR", "/takeProfit/atrWindow", 10, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("atrMultiplier", "ATR 倍数", "用几个 ATR 当第二条线", "/takeProfit/atrMultiplier", 2, { unit: "MULTIPLE", min: 0.1, max: 10, step: 0.1 }),
      num("floorRatio", "保底浮盈", "至少锁住多少浮盈才开始用", "/takeProfit/floorRatio", 0.03, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
      num("activationRatio", "激活浮盈", "先赚到多少才启用", "/takeProfit/activationRatio", 0, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
    ],
  },
  {
    optionId: "swing-low",
    displayName: "跌破近 N 日低点止盈",
    summary: "跌破最近 5 日的最低价就走 —— 摆动低点破位即离场。",
    patch: { takeProfit: { kind: "SWING_LOW", lookbackDays: 5, activationRatio: 0 } },
    parameters: [
      num("lookbackDays", "回看天数", "取最近多少个交易日的低点", "/takeProfit/lookbackDays", 5, { unit: "TRADING_DAY", min: 1, max: 60, step: 1 }),
      num("activationRatio", "激活浮盈", "先赚到多少才启用", "/takeProfit/activationRatio", 0, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
    ],
  },
];

// ---------------------------------------------------------------------------
// ⑦ 到期
// ---------------------------------------------------------------------------

const TIME_EXIT_OPTIONS: readonly ExitPolicySlotOption[] = [
  offOption("不到期（不限持有天数）", { timeExit: null }),
  {
    optionId: "fixed-holding-days",
    displayName: "最多拿 N 个交易日",
    summary: "持有满 N 个交易日的收盘就到点（次日开盘卖）。",
    patch: { timeExit: { kind: "FIXED_HOLDING_DAYS", holdingDays: 5 } },
    parameters: [
      num("holdingDays", "持有上限", "最多拿多少个交易日", "/timeExit/holdingDays", 5, { unit: "TRADING_DAY", min: 1, max: 250, step: 1 }),
    ],
  },
];

// ---------------------------------------------------------------------------
// ⑧ 续持
// ---------------------------------------------------------------------------

const STRONG_HOLD_OPTIONS: readonly ExitPolicySlotOption[] = [
  offOption("不给续持（到点就走）", { strongHold: null }),
  {
    optionId: "extend-when-strong",
    displayName: "够强就多拿",
    summary: "到判定日仍强势（浮盈够 + 站上均线）就延长持有，否则按期退出。",
    patch: {
      strongHold: {
        atHoldingDays: 5,
        minReturnRatio: 0.03,
        requireAboveMa5: true,
        requireAboveMa10: true,
        extendToHoldingDays: 10,
        afterExtendedHold: "TIME_EXIT",
      },
    },
    parameters: [
      num("atHoldingDays", "判定持有日", "在第几个交易日收盘判定", "/strongHold/atHoldingDays", 5, { unit: "TRADING_DAY", min: 1, max: 120, step: 1 }),
      num("minReturnRatio", "最低浮盈", "浮盈达到多少才算强", "/strongHold/minReturnRatio", 0.03, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
      num("extendToHoldingDays", "延长到第几日", "续持后最多再拿到第几个交易日", "/strongHold/extendToHoldingDays", 10, { unit: "TRADING_DAY", min: 2, max: 250, step: 1 }),
      bool("requireAboveMa5", "需站上 MA5", "判定日收盘要高于 5 日均线", "/strongHold/requireAboveMa5", true),
      bool("requireAboveMa10", "需站上 MA10", "判定日收盘要高于 10 日均线", "/strongHold/requireAboveMa10", true),
      str("afterExtendedHold", "延长后再到期怎么走", "延长段结束时按什么规则退出", "/strongHold/afterExtendedHold", "TIME_EXIT",
        [...STRONG_HOLD_AFTER_EXTENDED_EXIT_POLICIES],
        { TIME_EXIT: "到点就按到期退出", TREND: "顺势再判一次趋势" }),
    ],
  },
];

// ---------------------------------------------------------------------------
// ⑨ 研究路径
// ---------------------------------------------------------------------------

const RESEARCH_OPTIONS: readonly ExitPolicySlotOption[] = [
  {
    optionId: "off",
    displayName: "不启用研究路径",
    summary: "不使用研究专用的三条单变量路径。",
    patch: { recoveryPath: null, runnerBridge: null, clc2ReversalPath: null },
    parameters: [],
  },
  {
    optionId: "recovery-path",
    displayName: "转弱后确认恢复才走",
    summary: "首次转弱后等 N 个收盘日，期间恢复强势就继续持有（研究专用）。",
    patch: {
      recoveryPath: { kind: "HIGHER_HIGH_STREAK_RECOVERY", activationRatio: 0.03, confirmationDays: 1 },
      runnerBridge: null,
      clc2ReversalPath: null,
    },
    parameters: [
      num("activationRatio", "激活浮盈", "先赚到多少才开始跟踪强弱", "/recoveryPath/activationRatio", 0.03, { unit: "ratio", min: 0, max: 1, step: 0.005 }),
      num("confirmationDays", "等待几个收盘日", "转弱后等几天确认", "/recoveryPath/confirmationDays", 1, { unit: "TRADING_DAY", min: 0, max: 3, step: 1 }),
    ],
  },
  {
    optionId: "runner-bridge",
    displayName: "创 N 日新高就延长持有",
    summary: "到判定日若创了 N 日新高，就延到指定的持有上限（研究专用）。",
    patch: {
      runnerBridge: { kind: "PIT_RUNNER_HOLDING_BRIDGE", state: "NEW_HIGH_3", decisionHoldingDays: 5, extendToHoldingDays: 20 },
      recoveryPath: null,
      clc2ReversalPath: null,
    },
    parameters: [
      str("state", "判定状态", "用哪个状态判断是否延长", "/runnerBridge/state", "NEW_HIGH_3",
        [...RUNNER_HOLDING_BRIDGE_STATES]),
      num("decisionHoldingDays", "判定持有日", "在第几个交易日收盘判定", "/runnerBridge/decisionHoldingDays", 5, { unit: "TRADING_DAY", min: 1, max: 120, step: 1 }),
      num("extendToHoldingDays", "延长到第几日", "状态成立时延长到第几个交易日", "/runnerBridge/extendToHoldingDays", 20, { unit: "TRADING_DAY", min: 2, max: 250, step: 1 }),
    ],
  },
  {
    optionId: "clc2-reversal",
    displayName: "连跌后反转确认退出",
    summary: "连续收低达到门槛后，等反转确认再退出（研究专用）。",
    patch: {
      clc2ReversalPath: { kind: "SUSTAINED_CLOSE_DECLINE_REVERSAL", sustainMinRun: 5 },
      recoveryPath: null,
      runnerBridge: null,
    },
    parameters: [
      num("sustainMinRun", "连续收低天数", "连续几个交易日收低才算触发", "/clc2ReversalPath/sustainMinRun", 5, { unit: "TRADING_DAY", min: 1, max: 30, step: 1 }),
    ],
  },
];

// ---------------------------------------------------------------------------
// 槽表
// ---------------------------------------------------------------------------

export const EXIT_POLICY_SLOTS: readonly ExitPolicySlotDefinition[] = [
  { slotId: "ANCHOR", label: "止损位置", question: "跌到哪里算破位？", visibility: "PRIMARY", options: ANCHOR_OPTIONS },
  { slotId: "TAKE_PROFIT", label: "止盈", question: "什么时候主动止盈？", visibility: "PRIMARY", options: TAKE_PROFIT_OPTIONS },
  { slotId: "TIME_EXIT", label: "到期", question: "最多拿多久？", visibility: "PRIMARY", options: TIME_EXIT_OPTIONS },
  { slotId: "CONFIRMATION", label: "止损确认", question: "破位了，当天走还是等收盘确认？", visibility: "MORE", options: CONFIRMATION_OPTIONS },
  { slotId: "ESCALATION", label: "止损收紧", question: "有浮盈之后，止损怎么往上移？", visibility: "MORE", options: ESCALATION_OPTIONS },
  { slotId: "SCHEDULE", label: "止损时间表", question: "止损位要不要随持有天数变？", visibility: "MORE", options: SCHEDULE_OPTIONS },
  { slotId: "REDUCTION", label: "分批止损", question: "触发止损时一次走完，还是分两次？", visibility: "MORE", options: REDUCTION_OPTIONS },
  { slotId: "STRONG_HOLD", label: "续持", question: "到期了，什么情况可以多拿？", visibility: "MORE", options: STRONG_HOLD_OPTIONS },
  { slotId: "RESEARCH", label: "研究路径", question: "研究专用的单变量退出路径（默认不用）", visibility: "RESEARCH", options: RESEARCH_OPTIONS },
];

export function findExitPolicySlot(slotId: ExitPolicySlotId): ExitPolicySlotDefinition {
  const found = EXIT_POLICY_SLOTS.find(slot => slot.slotId === slotId);
  if (found === undefined) throw new Error("未知的退出政策槽：" + slotId);
  return found;
}

export function findExitPolicySlotOption(slotId: ExitPolicySlotId, optionId: string): ExitPolicySlotOption | null {
  return findExitPolicySlot(slotId).options.find(option => option.optionId === optionId) ?? null;
}

// ---------------------------------------------------------------------------
// 合并 / 物化 / 识别
// ---------------------------------------------------------------------------

/**
 * 把槽的 patch 合并进 policy。
 *
 * 🔴 浅合并（`stop` 层再浅合并一层）：**槽没声明的键原样保留** ——
 * 只改止损位置不会把 `strongHold.scaleOutRatio` 或表单不编辑的扩展键冲掉。
 */
export function mergeExitPolicyPatch(
  policy: ExitPolicyDefinition,
  patch: Readonly<Record<string, unknown>>,
): ExitPolicyDefinition {
  const policyRecord = policy as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...policyRecord };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "stop" || key === "strongHold") continue;
    /**
     * 🔴 `null` 与**键缺失**在类型上等价（都是 `| null` / 可选），但**字节上不同**：
     *    多写一个 `"takeProfit": null` 就会让 `strategyDocumentJson` 变样 ⇒
     *    「打开既有版本 → 什么都不改 → 保存」会派生出一个新版本。
     *    所以：patch 要置 `null` 而原对象**本来就没有这个键**时 ⇒ 跳过，不制造新键。
     */
    if (value === null && policyRecord[key] === undefined) continue;
    merged[key] = value;
  }
  /**
   * `stop` 与 `strongHold` 做**一层浅合并**：这两个容器里除了本槽拥有的字段，
   * 还住着本表单不编辑的键（`stop.contexts`、`strongHold.scaleOutRatio` /
   * `runnerExitAtHoldingDays` …）—— 整体替换会把它们冲掉。
   *
   * 其余键（`takeProfit` / `timeExit` / `recoveryPath` …）**整体替换**：
   * 它们带 `kind` 判别式，合并会把上一个 kind 的残留字段留下来 ⇒ 拼出不合法对象。
   */
  for (const container of ["stop", "strongHold"] as const) {
    const patchPart = patch[container];
    const currentPart = policyRecord[container];
    if (typeof patchPart !== "object" || patchPart === null || Array.isArray(patchPart)) continue;
    const base = typeof currentPart === "object" && currentPart !== null && !Array.isArray(currentPart)
      ? (currentPart as Record<string, unknown>)
      : {};
    const next: Record<string, unknown> = { ...base };
    for (const [field, value] of Object.entries(patchPart as Record<string, unknown>)) {
      if (value === null && base[field] === undefined) continue;
      next[field] = value;
    }
    merged[container] = next;
  }
  return merged as unknown as ExitPolicyDefinition;
}
/** 参数校验 + 按 JSON Pointer 写进 option 的 patch。 */
export function materializeExitPolicySlotOption(
  slotId: ExitPolicySlotId,
  optionId: string,
  parameters: Readonly<Record<string, StrategyPresetParameterValue>> = {},
): MaterializeExitSlotOptionResult {
  const option = findExitPolicySlotOption(slotId, optionId);
  if (option === null) {
    return { patch: null, resolvedParameters: {}, issues: [`未找到选项：slot=${slotId} optionId=${optionId}`] };
  }
  const issues: string[] = [];
  const resolved: Record<string, StrategyPresetParameterValue> = {};
  for (const code of Object.keys(parameters)) {
    if (!option.parameters.some(parameter => parameter.code === code)) {
      issues.push(`选项 ${optionId} 未声明参数 ${code}`);
    }
  }
  for (const parameter of option.parameters) {
    const raw = Object.prototype.hasOwnProperty.call(parameters, parameter.code)
      ? parameters[parameter.code]
      : parameter.defaultValue;
    if (parameter.valueType === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        issues.push(`参数 ${parameter.code} 必须是有限数字`);
        continue;
      }
      if (parameter.min !== undefined && raw < parameter.min) issues.push(`参数 ${parameter.code} 不得小于 ${parameter.min}`);
      if (parameter.max !== undefined && raw > parameter.max) issues.push(`参数 ${parameter.code} 不得大于 ${parameter.max}`);
    } else if (parameter.valueType === "boolean") {
      if (typeof raw !== "boolean") { issues.push(`参数 ${parameter.code} 必须是布尔值`); continue; }
    } else {
      if (typeof raw !== "string") { issues.push(`参数 ${parameter.code} 必须是字符串`); continue; }
      if (parameter.allowedValues !== undefined && !parameter.allowedValues.includes(raw)) {
        issues.push(`参数 ${parameter.code} 必须是 ${parameter.allowedValues.join(" | ")} 之一`);
        continue;
      }
    }
    resolved[parameter.code] = raw as StrategyPresetParameterValue;
  }
  if (issues.length > 0) return { patch: null, resolvedParameters: resolved, issues };

  let patch: unknown = JSON.parse(JSON.stringify(option.patch));
  for (const parameter of option.parameters) {
    try {
      patch = setByPointer(patch, parameter.path, resolved[parameter.code]);
    } catch (error) {
      if (error instanceof JsonPointerError) {
        issues.push(`参数 ${parameter.code} 的指针无效：${error.message}`);
      } else {
        throw error;
      }
    }
  }
  if (issues.length > 0) return { patch: null, resolvedParameters: resolved, issues };
  return { patch: patch as Readonly<Record<string, unknown>>, resolvedParameters: resolved, issues: [] };
}

/** 只读一个 JSON Pointer 指向的值（用于"从当前 policy 反读参数"）。 */
function readPointer(source: unknown, pointer: string): unknown {
  if (pointer === "") return source;
  let current: unknown = source;
  for (const rawSegment of pointer.split("/").slice(1)) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function pointerSegments(pointer: string): string[] {
  return pointer.split("/").slice(1).map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * `expected` **去掉被参数覆盖的叶子**之后，必须与 `actual` 逐叶相同；
 * `actual` 里多出来的键**不算差异**（那是本槽不拥有的、要原样保留的键）。
 *
 * 🔴 这条"只比 patch 声明的键"是**识别正确性**的关键：
 *    - 用 kind/枚举做判据的选项 ⇒ 只约束那一个字段（其余是自由参数）；
 *    - 用**数组/固定阶梯**做内容的选项（阶梯、分批表、时间表）⇒ 数组没被参数覆盖
 *      ⇒ 必须逐元素相同才算这个选项。否则「自定义阶梯」会被误认成「默认阶梯」，
 *      用户一改别的槽就被静默改写成默认阶梯。
 */
function subsetMatches(
  expected: unknown,
  actual: unknown,
  ignored: readonly string[][],
  prefix: readonly string[] = [],
): boolean {
  if (ignored.some(path => path.length === prefix.length && path.every((segment, index) => segment === prefix[index]))) {
    return true;
  }
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, index) => subsetMatches(item, actual[index], ignored, [...prefix, String(index)]));
  }
  if (typeof expected === "object") {
    if (typeof actual !== "object" || actual === null) return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
      subsetMatches(value, (actual as Record<string, unknown>)[key], ignored, [...prefix, key]));
  }
  return expected === actual;
}

/** 这个 option 是不是当前 policy 的形态（判据见 `subsetMatches`）。 */
function optionMatchesPolicy(option: ExitPolicySlotOption, policy: ExitPolicyDefinition): boolean {
  const ignored = option.parameters.map(parameter => pointerSegments(parameter.path));
  return subsetMatches(option.patch, policy as unknown as Record<string, unknown>, ignored);
}

/**
 * 从当前 policy 认出这个槽**现在是哪个选项**，并把当前值反读成参数。
 *
 * 认不出 ⇒ `null`（**绝不就近匹配**）：UI 必须显示「本表单不识别」且不改写，
 * 这样既有版本里那些本表单不表达的形状不会被"看起来像"的选项悄悄改写。
 */
export function recognizeExitPolicySlot(
  policy: ExitPolicyDefinition,
  slotId: ExitPolicySlotId,
): RecognizeExitSlotResult | null {
  const slot = findExitPolicySlot(slotId);
  const matched = slot.options.filter(option => optionMatchesPolicy(option, policy));
  if (matched.length === 0) return null;
  // 多个命中时取参数最"具体"的那个（参数多 ⇒ 约束更强）；仍并列则按声明顺序。
  const chosen = [...matched].sort((a, b) => b.parameters.length - a.parameters.length)[0];
  const parameters: Record<string, StrategyPresetParameterValue> = {};
  for (const parameter of chosen.parameters) {
    const value = readPointer(policy, parameter.path);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      parameters[parameter.code] = value;
    } else if (value === undefined || value === null) {
      parameters[parameter.code] = parameter.defaultValue;
    }
  }
  return { optionId: chosen.optionId, parameters };
}

/** 认出的槽是否与选项默认值**逐参数**相同（用来判"是不是变体"）。 */
export function exitSlotIsAtDefaults(
  recognized: RecognizeExitSlotResult,
  slotId: ExitPolicySlotId,
): boolean {
  const option = findExitPolicySlotOption(slotId, recognized.optionId);
  if (option === null) return false;
  return option.parameters.every(parameter => {
    const current = recognized.parameters[parameter.code];
    return current === undefined || current === parameter.defaultValue;
  });
}

/** 应用一个槽选择：认不出的槽会被 patch 覆盖（用户显式改了这一槽）。 */
export function applyExitPolicySlot(
  policy: ExitPolicyDefinition,
  slotId: ExitPolicySlotId,
  optionId: string,
  parameters: Readonly<Record<string, StrategyPresetParameterValue>> = {},
): { readonly policy: ExitPolicyDefinition; readonly issues: readonly string[] } {
  const materialized = materializeExitPolicySlotOption(slotId, optionId, parameters);
  if (materialized.patch === null) return { policy, issues: materialized.issues };
  return { policy: mergeExitPolicyPatch(policy, materialized.patch), issues: [] };
}
