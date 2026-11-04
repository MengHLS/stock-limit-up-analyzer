/**
 * 回测留档的模式族研究注解。
 *
 * 这些文本只解释“这个版本在整条研究链里代表什么”，不参与策略执行，也不替代
 * `closed_loop_backtest_run` 的指标。注解挂在统一版本目录上，让版本卡片与详情弹窗
 * 使用同一份结论，避免前端各处复制研究口径。
 */

import type {
  StrategyVersionStudyAnnotationDto,
  StrategyVersionStudySignalDto,
} from "../../shared/researchContracts";
import { compareStrategyVersions } from "./strategySchema/version";
import {
  FIRST_LIMIT_POOL_DAILY_SCORE_ARM_ID,
  FIRST_LIMIT_POOL_DAILY_SCORE_FAMILY_ID,
  FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID,
  FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION,
  describeFirstLimitPoolDailyScore,
} from "./patternLibrary/firstLimitPoolDailyScore";
import {
  describeThreeFactorTopNFamily,
  describeThreeFactorTopNFamilyArm,
  resolveThreeFactorTopNFamily,
} from "./patternLibrary/threeFactorTopNFamilies";

type StudyAnnotation = StrategyVersionStudyAnnotationDto;

interface VersionRangeRule {
  readonly minVersion: string;
  readonly maxVersion: string;
  readonly annotation: StudyAnnotation;
}

function minuteFields(): StudyAnnotation["minuteFields"] {
  return [
    {
      field: "limitUpTime",
      role: "信号日涨停封板时间（HH:MM:SS）。它只在 T 日横截面评分、候选准入、风险/质量分和 T+1 开盘预期中使用，不读取 T+1 分时。",
      stages: [
        {
          label: "信号日基础评分",
          effect:
            "≤10:00 加 10；≤11:30 加 8；≤13:30 加 5；≤14:30 加 2；更晚为 0。同分时优先封板更早的标的。",
        },
        {
          label: "候选准入",
          effect: "同题材涨停家数至少 3 家，且封板时间不晚于 13:30。",
        },
        {
          label: "下侧风险扣分",
          effect:
            "≥14:30 扣 16；13:30（含）至 14:30 扣 9；字段整体缺失时可能按不可用降级扣 5。",
        },
        {
          label: "质量混合评分",
          effect: "≤10:30 额外加 2。",
        },
        {
          label: "T+1 开盘预期",
          effect:
            "按早盘板、上午板、午后板、尾盘板分桶，与实际 T+1 开盘溢价比较，用于判断是否跳过买入。",
        },
      ],
      limitations: [
        "以上分钟信息只进入龙头候选、下侧风险和开盘预期链；当前 3F TopN 实际只使用最大振幅 LOW、平均振幅 LOW、T+1 量比 HIGH。",
        "INTRADAY 不是分钟线，而是用日线 OHLC 模拟盘中止损、止盈和盈利回撤。",
        "当前没有真实分钟线、开盘后 N 分钟、竞价和炸板次数数据，不能据此声称已经完成真实分钟级回测。",
        "limitUpTime 覆盖率约 82.4%；2025-11 缺失约 22.5%，2026-09 缺失约 1.2%，存在按时间分布的选择偏差。",
      ],
    },
  ];
}

function study(
  annotation: Omit<
    StudyAnnotation,
    "minuteFields" | "familyDirectory" | "firstLimitPool"
  >
): StudyAnnotation {
  return {
    ...annotation,
    minuteFields: minuteFields(),
    familyDirectory: familyDirectory(),
    firstLimitPool: null,
  };
}

type Signal = StrategyVersionStudySignalDto;

type Family = StudyAnnotation["familyDirectory"][number];

function tunable(
  label: string,
  value: string,
  stage: string,
  effect: string
): Signal {
  return { label, value, stage, effect, source: "TUNABLE" };
}

function fixed(
  label: string,
  value: string,
  stage: string,
  effect: string
): Signal {
  return { label, value, stage, effect, source: "FIXED" };
}

function assembly(
  label: string,
  value: string,
  stage: string,
  effect: string
): Signal {
  return { label, value, stage, effect, source: "ASSEMBLY" };
}

function familyDirectory(): Family[] {
  return FAMILY_PROSE.map(enrichFamilyProse);
}

/**
 * 把目录里的族级说明补上权威注册表里的可执行事实：可执行性、可覆写维度、
 * 具体取值与证据出处。未在注册表登记的族按 HISTORICAL_ONLY 呈现，避免出现
 * “说明文字宣称可执行、但注册表缺失”的裂缝。
 */
function enrichFamilyProse(
  prose: Omit<
    Family,
    | "executability"
    | "historicalOnlyReason"
    | "tunableParameters"
    | "arms"
    | "resolvedSignals"
    | "evidenceSources"
  >,
): Family {
  const definition = resolveThreeFactorTopNFamily(prose.familyId);
  if (definition === null) {
    return {
      ...prose,
      executability: "HISTORICAL_ONLY",
      historicalOnlyReason: "该族未登记到可执行注册表，暂不能按参数重跑。",
      tunableParameters: [],
      arms: [],
      resolvedSignals: [],
      evidenceSources: [],
    };
  }
  return {
    ...prose,
    executability: definition.executability,
    historicalOnlyReason: definition.historicalOnlyReason,
    tunableParameters: definition.tunableParameters.map(parameter => ({
      name: parameter.name,
      defaultValue: parameter.defaultValue,
      min: parameter.min,
      max: parameter.max,
      step: parameter.step,
      note: parameter.note,
    })),
    arms: definition.arms.map(arm => ({
      armId: arm.armId,
      strategyVersion: arm.strategyVersion,
      label: arm.label,
      description: arm.description,
      signals: describeThreeFactorTopNFamilyArm(prose.familyId, arm.armId).map(
        signal => ({
          source: signal.source,
          label: signal.label,
          value: signal.value,
          stage: signal.stage,
          effect: signal.effect,
        }),
      ),
    })),
    resolvedSignals: describeThreeFactorTopNFamily(prose.familyId).map(signal => ({
      source: signal.source,
      label: signal.label,
      value: signal.value,
      stage: signal.stage,
      effect: signal.effect,
    })),
    evidenceSources: [...definition.evidenceSources],
  };
}

type FamilyProse = Omit<
  Family,
  | "executability"
  | "historicalOnlyReason"
  | "tunableParameters"
  | "arms"
  | "resolvedSignals"
  | "evidenceSources"
>;

function buildFamilyProse(): FamilyProse[] {
  return [
    {
      familyId: "early-execution-baseline",
      familyLabel: "早期执行基线族",
      minVersion: "1.0.0",
      maxVersion: "1.6.0",
      studyStage: "事件与执行口径修复",
      uniqueDimension: "事件身份、除权动作、容量与固定仓位",
      minuteStage: "信号日基础评分 / 候选准入",
      minuteEffect:
        "依赖 limitUpTime 形成信号日基础分和同题材准入；该族尚未引入评分分档。",
    },
    {
      familyId: "cost-position-correction",
      familyLabel: "仓位与成本矫正族",
      minVersion: "1.7.0",
      maxVersion: "1.9.1",
      studyStage: "仓位、成本与权益口径统一",
      uniqueDimension: "候选退出政策、约 20.2 bps 往返成本、固定 6% 止损",
      minuteStage: "信号日基础评分 / 候选准入",
      minuteEffect:
        "分钟字段仍只参与信号日评分和准入；停用候选退出后不再通过盘中路径改写候选周转。",
    },
    {
      familyId: "strong-hold-extension",
      familyLabel: "强势续持延长族",
      minVersion: "1.10.0",
      maxVersion: "1.10.0",
      studyStage: "退出期限实验",
      uniqueDimension: "强势持仓从第 5 日延长到第 10 日",
      minuteStage: "信号日基础评分",
      minuteEffect:
        "分钟字段只影响 T 日入池评分；延长持有发生在持仓期，不读取新的分钟数据。",
    },
    {
      familyId: "event-board-filter",
      familyLabel: "事件形态过滤族",
      minVersion: "1.11.0",
      maxVersion: "1.11.0",
      studyStage: "一字板/T 字板过滤",
      uniqueDimension: "排除 T 日 open=high 的一字板与 T 字板",
      minuteStage: "候选准入",
      minuteEffect:
        "分钟字段不决定板型；板型由 T 日 OHLC 排除，limitUpTime 仍用于评分和准入。",
    },
    {
      familyId: "intraday-drawdown-exit",
      familyLabel: "盘中盈利回撤止盈族",
      minVersion: "1.12.0",
      maxVersion: "1.12.0",
      studyStage: "止盈触发时点实验",
      uniqueDimension: "盈利回撤止盈从收盘确认改为盘中检查",
      minuteStage: "盘中退出（OHLC 模拟）",
      minuteEffect:
        "INTRADAY 用当日 OHLC 判断是否触发，不是分钟线；limitUpTime 不参与该退出。",
    },
    {
      familyId: "no-pullback-gate",
      familyLabel: "回踩门槛移除族",
      minVersion: "1.13.0",
      maxVersion: "1.13.0",
      studyStage: "候选资格实验",
      uniqueDimension: "移除观察窗内必须出现收盘回踩的门槛",
      minuteStage: "候选准入",
      minuteEffect:
        "放宽资格发生在观察窗条件层；分钟字段对候选评分和风险扣分仍然生效。",
    },
    {
      familyId: "trailing-take-profit",
      familyLabel: "移动止盈族",
      minVersion: "1.14.0",
      maxVersion: "1.21.0",
      studyStage: "固定回撤替代实验",
      uniqueDimension: "MA、ATR、R 倍利润锁、结构低点与 PSAR 收盘确认",
      minuteStage: "收盘退出",
      minuteEffect:
        "移动止盈读取持仓期日线的最高价、均线与波动率，不读取分钟线。",
    },
    {
      familyId: "runner-scale-out",
      familyLabel: "趋势 Runner 与减仓族",
      minVersion: "1.22.0",
      maxVersion: "1.26.0",
      studyStage: "强势持仓再分配",
      uniqueDimension: "趋势 runner、到期减仓比例与 runner 退出截止",
      minuteStage: "持仓管理",
      minuteEffect:
        "该族只在到期/趋势阶段分配仓位；分钟字段不进入 runner 决策。",
    },
    {
      familyId: "stop-policy-sweep",
      familyLabel: "止损政策族",
      minVersion: "1.27.0",
      maxVersion: "1.56.0",
      studyStage: "单票止损网格搜索",
      uniqueDimension: "固定比例、ATR、结构低点、利润锁、时间递减与上下文止损",
      minuteStage: "盘中止损（OHLC 模拟）",
      minuteEffect:
        "止损锚在退出评估阶段生效；盘中触发只读日线路径，limitUpTime 仍停留在 T 日评分。",
    },
    {
      familyId: "entry-risk-filter-b",
      familyLabel: "入场风险过滤 B 族",
      minVersion: "1.58.0",
      maxVersion: "1.58.7",
      studyStage: "绝对风险硬过滤",
      uniqueDimension: "平均振幅、最大振幅与观察窗破位深度门槛",
      minuteStage: "入场风险过滤",
      minuteEffect:
        "风险过滤读取 T+1..T+5 派生 bar 特征，不直接读取 limitUpTime；分钟字段仍用于 T 日评分。",
    },
    {
      familyId: "tiered-position-sizing-c",
      familyLabel: "分层仓位 C 族",
      minVersion: "1.59.0",
      maxVersion: "1.59.6",
      studyStage: "按评分分档仓位",
      uniqueDimension: "按候选 score 或当日 rank 分档决定权益仓位",
      minuteStage: "建仓仓位",
      minuteEffect:
        "分钟字段通过 T 日综合评分间接影响档位；c4 的 rank 档使用当日候选排序。",
    },
    {
      familyId: "zero-low-score-allocation",
      familyLabel: "低分归零族",
      minVersion: "1.61.0",
      maxVersion: "1.61.2",
      studyStage: "低分档仓位归零",
      uniqueDimension: "低分档归零并重新分配高、中分档仓位",
      minuteStage: "建仓仓位",
      minuteEffect:
        "分钟字段通过评分决定是否落入归零档；归零本身改变后续现金和买入路径。",
    },
    {
      familyId: "c6-b4-14-best-combination",
      familyLabel: "c6+b4-14 当前最佳组合族",
      minVersion: "1.62.1",
      maxVersion: "1.62.1",
      studyStage: "分层仓位叠加最大振幅阈值",
      uniqueDimension: "c6 分层仓位叠加最大振幅 <14% 过滤",
      minuteStage: "入场风险过滤 + 建仓仓位",
      minuteEffect:
        "最大振幅过滤使用观察窗日线派生特征；评分分档再使用 T 日分钟派生分，二者先后生效。",
    },
    {
      familyId: "early-non-3f-comparison",
      familyLabel: "早期非 3F 对照族",
      minVersion: "1.0.0",
      maxVersion: "1.0.0",
      studyStage: "历史对照",
      uniqueDimension: "cand-* / first-board-pullback 早期结构",
      minuteStage: "不纳入 3F 分钟阶段链",
      minuteEffect:
        "这些版本的样本窗口和执行口径不同，不能套用 3F 的 limitUpTime 阶段结论。",
    },
  ];
}

const FAMILY_PROSE: readonly FamilyProse[] = buildFamilyProse();

const BASE_SIGNALS: readonly Signal[] = [
  fixed(
    "观察窗",
    "T+1..T+5",
    "候选资格",
    "在信号后的 5 个交易日窗口内计算回踩、振幅和破位特征，所有入场条件只读这个窗口。"
  ),
  fixed(
    "默认仓位",
    "20% 权益/标的",
    "建仓",
    "没有分档覆盖时，每个入选标的按固定权益比例建仓；持仓上限与日买入上限另行约束。"
  ),
  fixed(
    "成本",
    "约 20.2 bps 往返",
    "权益核算",
    "每次买卖按统一成本扣减权益，保证不同模式族之间的收益口径可比。"
  ),
  tunable(
    "max_max_amplitude",
    "文档默认值",
    "入场风险过滤",
    "观察窗最大振幅上限；只有在版本文档显式声明该参数时才可由前端覆写，未声明的版本按装配值读取。"
  ),
];

const BASE_3F_CAUTION =
  "本清单描述版本留档时的装配值；TUNABLE 可在重跑时覆写，FIXED/ASSEMBLY 在正式版本中不接受前端改写。";

/**
 * 3F TopN 的版本族。区间按语义版本比较，避免把 1.9 与 1.10 当成字符串排序。
 */
const THREE_FACTOR_RANGE_RULES: readonly VersionRangeRule[] = [
  {
    minVersion: "1.0.0",
    maxVersion: "1.6.0",
    annotation: study({
      familyId: "early-execution-baseline",
      familyLabel: "早期执行基线族",
      studyStage: "事件与执行口径修复",
      keyDifference:
        "修复事件身份、除权动作、容量、固定仓位和 T+1 退出等基础执行问题。",
      observedResult:
        "整族深度亏损，只保留为执行口径修复与复现证据，不作为选优候选。",
      signals: [
        ...BASE_SIGNALS,
        fixed(
          "仓位",
          "固定仓位",
          "建仓",
          "尚未引入评分分档；执行差异主要来自事件身份、除权与容量修复。"
        ),
      ],
      caution:
        "早期留档的代码快照和当前工作区存在差距，横向比较前先确认 fresh rerun。",
    }),
  },
  {
    minVersion: "1.7.0",
    maxVersion: "1.9.1",
    annotation: study({
      familyId: "cost-position-correction",
      familyLabel: "仓位与成本矫正族",
      studyStage: "仓位、成本与权益口径统一",
      keyDifference:
        "停用候选退出，统一约 20.2 bps 的单次往返成本，按现金流重算权益，并显式采用固定 6% 止损。",
      observedResult:
        "仍未形成可转正收益；这一族的主要价值是让后续版本的收益、成本和权益口径可比较。",
      signals: [
        ...BASE_SIGNALS,
        fixed(
          "candidateExitPolicy",
          "停用",
          "候选管理",
          "不再用候选退出规则提前腾挪仓位，避免不同版本的候选周转不可比。"
        ),
        fixed(
          "stopLossRatio",
          "6%",
          "止损",
          "持仓跌破固定止损线后退出，是后续止损政策搜索的控制组。"
        ),
      ],
      caution:
        "1.9.0 的 #930001 与 #990001 属于重复归档，只取纠正后的留档进入结论。",
    }),
  },
  {
    minVersion: "1.10.0",
    maxVersion: "1.10.0",
    annotation: study({
      familyId: "strong-hold-extension",
      familyLabel: "强势续持延长族",
      studyStage: "退出期限实验",
      keyDifference: "把强势持仓从第 5 个持有日延长到第 10 个持有日。",
      observedResult: "累计收益约 -46.68%，延长持有没有修复整体亏损。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "strongHold",
          "第 5 日续持至第 10 日",
          "持仓延期",
          "满足续持条件的仓位在第 5 个持有日不按 TIME_EXIT 退出，而是延长到第 10 个持有日。"
        ),
      ],
      caution: null,
    }),
  },
  {
    minVersion: "1.11.0",
    maxVersion: "1.11.0",
    annotation: study({
      familyId: "event-board-filter",
      familyLabel: "事件形态过滤族",
      studyStage: "一字板/T 字板过滤",
      keyDifference:
        "排除 T 日一字板与 T 字板，并增加 open < high 的事件条件。",
      observedResult: "累计收益约 -42.96%，过滤后仍未转正。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "excludeEventDayOpenAtLimit",
          "启用",
          "事件过滤",
          "信号日开盘即涨停的一字板、T 字板被排除；该筛选在建仓前生效。"
        ),
      ],
      caution: null,
    }),
  },
  {
    minVersion: "1.12.0",
    maxVersion: "1.12.0",
    annotation: study({
      familyId: "intraday-drawdown-exit",
      familyLabel: "盘中盈利回撤止盈族",
      studyStage: "止盈触发时点实验",
      keyDifference: "把盈利回撤止盈从收盘确认改为盘中检查。",
      observedResult:
        "纠正留档累计收益约 -80.15%、PF 0.7602，盘中触发反而放大了亏损。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "trailingTakeProfitTrigger",
          "INTRADAY",
          "止盈触发",
          "盈利回撤止盈改为盘中最低价击穿触发线即卖出，不再等收盘确认。"
        ),
      ],
      caution:
        "只有除权动作修正后的 #1200001 有效；#1170001 为错误留档，不能用于结论。",
    }),
  },
  {
    minVersion: "1.13.0",
    maxVersion: "1.13.0",
    annotation: study({
      familyId: "no-pullback-gate",
      familyLabel: "回踩门槛移除族",
      studyStage: "候选资格实验",
      keyDifference: "移除观察窗内必须出现收盘回踩的门槛。",
      observedResult: "累计收益约 -71.32%，放宽资格没有改善结果。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "requirePullback",
          "false",
          "候选资格",
          "移除观察窗内必须出现收盘价低于首板日收盘价的门槛，扩大候选池。"
        ),
      ],
      caution: null,
    }),
  },
  {
    minVersion: "1.14.0",
    maxVersion: "1.21.0",
    annotation: study({
      familyId: "trailing-take-profit",
      familyLabel: "移动止盈族",
      studyStage: "固定回撤替代实验",
      keyDifference:
        "用 MA、ATR、R 倍利润锁、利润回吐、结构低点和 Parabolic SAR 等收盘确认规则替换固定回撤。",
      observedResult:
        "历史 1.14.0 为 +19.01%；当前代码 fresh 1.14.1 为 +4.75%。只有 MA5/MA10 方向明显改善，其余方案没有稳定超越。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "trailingPolicy",
          "MA / ATR / R 倍 / 结构低点 / PSAR",
          "移动止盈",
          "用收盘确认的移动止盈规则替换固定回撤；策略在退出评估阶段读取最高价、均线与波动率。"
        ),
      ],
      caution: "1.14.0 是历史快照，后续止损实验应以 fresh 1.14.1 为控制组。",
    }),
  },
  {
    minVersion: "1.22.0",
    maxVersion: "1.26.0",
    annotation: study({
      familyId: "runner-scale-out",
      familyLabel: "趋势 Runner 与减仓族",
      studyStage: "强势持仓再分配",
      keyDifference:
        "测试趋势 runner、第 10 日部分减仓、runner 配额和候选替换。",
      observedResult:
        "修正后的 1.23.1 为 +6.69%、1.24.1 为 +7.17%，均低于 1.14.x 控制组；runner 释放仓位但仍牺牲完整仓位收益。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "strongHold.afterExtendedHold",
          "TREND",
          "趋势续持",
          "第 10 日不再固定清仓，满足趋势条件时保留 runner 继续持有。"
        ),
        assembly(
          "scaleOutRatio",
          "50% (1.23.1) / 75% (1.24.1)",
          "第 10 日减仓",
          "到期先卖出部分仓位，剩余仓位作为趋势 runner 保留。"
        ),
        assembly(
          "runnerExitAtHoldingDays",
          "带截止日",
          "runner 退出",
          "runner 最迟在截止持有日产生退出信号，避免无期限占用仓位。"
        ),
      ],
      caution:
        "1.23.0/1.24.0 的 runner 没有退出截止日，结果无效；只采用带截止日的 1.23.1/1.24.1。",
    }),
  },
  {
    minVersion: "1.27.0",
    maxVersion: "1.56.0",
    annotation: study({
      familyId: "stop-policy-sweep",
      familyLabel: "止损政策族",
      studyStage: "单票止损网格搜索",
      keyDifference:
        "围绕固定百分比、ATR、结构低点、利润锁、时间递减和上下文止损做大规模止损政策搜索。",
      observedResult:
        "约 46 个版本中 1.44.1（峰值回撤 8%）为 +27.96%，1.42.0（Chandelier 2.5ATR10）为 +21.63%，领先其余静态止损。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "exitPolicy.stop",
          "固定比例 / ATR / 结构低点 / 利润锁 / 时间递减 / 上下文",
          "单票止损",
          "仓位在退出评估阶段按止损锚计算有效止损线；不同 arm 只改变锚、确认方式和上下文条件。"
        ),
        assembly(
          "SL-18.1",
          "止损政策搜索控制/最优链",
          "止损装配",
          "后续 1.58–1.62 的组合族沿用这条统一 stop/takeProfit/timeExit/strongHold/capitalRecycle 配置。"
        ),
      ],
      caution:
        "1.52.0 至 1.56.0 的市场/板块/龙头/组合上下文未真正注入引擎，五版结果相同且不作为有效实验结论。",
    }),
  },
  {
    minVersion: "1.58.0",
    maxVersion: "1.58.7",
    annotation: study({
      familyId: "entry-risk-filter-b",
      familyLabel: "入场风险过滤 B 族",
      studyStage: "绝对风险硬过滤",
      keyDifference:
        "在 v1.44.1 退出链上测试平均振幅、最大振幅和破位深度门槛。",
      observedResult:
        "只有最大振幅 <12% 的 1.58.3 优于控制组，达到 +30.21%；平均振幅和破位深度过滤多数显著恶化。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "entryRiskFilter.maxMeanAmplitude",
          "8% (b1) / 7% (b2) / 6% (b3)",
          "入场风险过滤",
          "观察窗平均振幅高于阈值的候选被拒绝；在评分之后、下单之前生效。"
        ),
        assembly(
          "entryRiskFilter.maxMaxAmplitude",
          "12% (b4) / 10% (b5)",
          "入场风险过滤",
          "观察窗历史最高振幅超过阈值的候选被拒绝；用于限制单一候选的波动暴露。"
        ),
        assembly(
          "entryRiskFilter.minDrawdownFromEventClose",
          "-10% (b6) / -8% (b7)",
          "入场风险过滤",
          "观察窗最低价相对首板收盘的破位超过阈值时拒绝入场。"
        ),
      ],
      caution: "最大振幅阈值不是单调有效，后续必须做 OOS 与参数扰动验证。",
    }),
  },
  {
    minVersion: "1.59.0",
    maxVersion: "1.59.6",
    annotation: study({
      familyId: "tiered-position-sizing-c",
      familyLabel: "分层仓位 C 族",
      studyStage: "按评分分档仓位",
      keyDifference:
        "用候选 score / rank 分档替代所有候选固定 20% 仓位，并进一步测试低分降仓与 c6+b4 组合。",
      observedResult:
        "1.59.5（c6）为 +42.24%，1.59.6（c6+b4，最大振幅 <12%）为 +46.74%，是当时最优组合；中分档是主要利润来源。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "positionTiers",
          "低 5% / 中 10–20% / 高 20–25%",
          "建仓仓位",
          "按候选 score 命中最高档决定权益比例；替换默认 20% 固定仓位。"
        ),
        assembly(
          "positionRankTiers",
          "rank1 20% / rank2 15% / 其余 10%",
          "建仓仓位",
          "c4 改用当日 rank 分档，rank 越靠前仓位越高。"
        ),
      ],
      caution:
        "1.59.0 至 1.59.3 通过削减中分档降低回撤，但收益机会成本较高，不能只看回撤改善。",
    }),
  },
  {
    minVersion: "1.61.0",
    maxVersion: "1.61.2",
    annotation: study({
      familyId: "zero-low-score-allocation",
      familyLabel: "低分归零族",
      studyStage: "低分档仓位归零",
      keyDifference: "把低分档仓位降为 0，并分别调整高、中分档仓位。",
      observedResult:
        "三个版本为 +17.85%、+25.63%、+11.04%，均低于 1.59.6 的 +46.74%；释放仓位改变了后续买入路径，整体为负优化。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "positionTiers[low]",
          "0%",
          "建仓仓位",
          "低分档仓位归零，资金释放后可能进入后续更高评分候选，改变整条买入路径。"
        ),
        assembly(
          "positionTiers[high]",
          "25% (c7/c9) / 30% (c8)",
          "建仓仓位",
          "在低分档归零的同时提高高分档仓位，测试资金集中度。"
        ),
      ],
      caution:
        "低分档自身亏损不大，但直接归零会释放现金并触发更差的替代候选，不能只按单档净盈亏判断。",
    }),
  },
  {
    minVersion: "1.62.1",
    maxVersion: "1.62.1",
    annotation: study({
      familyId: "c6-b4-14-best-combination",
      familyLabel: "c6+b4-14 当前最佳组合族",
      studyStage: "分层仓位叠加最大振幅阈值",
      keyDifference:
        "采用 c6 分层仓位（高 25% / 中 20% / 低 5%），并叠加最大振幅 <14% 过滤。",
      observedResult:
        "累计收益 +57.73%，最大回撤 47.96%，PF 1.1366，完成交易 1354 笔；是当前全窗口探索中的最优组合。",
      signals: [
        ...BASE_SIGNALS,
        assembly(
          "positionTiers",
          "低 5% / 中 20% / 高 25%",
          "建仓仓位",
          "c6 分档决定候选实际建仓比例，是当前最佳组合的收益来源之一。"
        ),
        assembly(
          "entryRiskFilter.maxMaxAmplitude",
          "14%",
          "入场风险过滤",
          "在 c6 分档基础上放宽最大振幅上限到 14%，保留更多中等波动候选。"
        ),
      ],
      caution:
        "仍是全窗口探索结果，转入正式候选前必须完成 OOS、walk-forward、成本扰动和阈值敏感性验证。",
    }),
  },
];

/** 关键版本的更精确留档说明；未列出的版本沿用所属模式族结论。 */
const EXACT_OVERRIDES: Readonly<Record<string, Partial<StudyAnnotation>>> = {
  "1.9.0": {
    caution:
      "本版本 #930001 与 #990001 属于重复归档；只使用纠正后的留档，避免把重复运行当成两套实验。",
  },
  "1.12.0": {
    observedResult:
      "纠正留档累计收益 -80.15%、PF 0.7602；错误留档 #1170001 不可用。",
  },
  "1.14.1": {
    observedResult:
      "当前代码快照 fresh 控制组：+4.75%，PF 1.0118，成交 1078 笔。",
  },
  "1.23.1": {
    observedResult:
      "第 10 日减仓 50% + 趋势 runner（带退出截止日）：+6.69%，最大回撤 47.36%，PF 1.0538。",
  },
  "1.24.1": {
    observedResult:
      "第 10 日减仓 75% + 趋势 runner（带退出截止日）：+7.17%，最大回撤 47.48%，PF 1.0517。",
  },
  "1.42.0": {
    observedResult:
      "Chandelier（最高收盘 - 2.5ATR10）：+21.63%，最大回撤 50.71%，PF 1.0474。",
  },
  "1.44.1": {
    observedResult:
      "峰值回撤 8%：+27.96%，最大回撤 51.68%，PF 1.0909，成交 1362 笔；是止损族历史最优。",
    caution:
      "本版本 #2130001 与 fresh 门禁留档 #2370001 实质重复；fresh 重跑用于确认逐笔一致性。优势集中在 2025/2026，不能直接转正。",
  },
  "1.58.3": {
    observedResult:
      "最大振幅 <12%：+30.21%，最大回撤 52.59%，PF 1.0954；是 B 族唯一优于 v1.44.1 的候选。",
  },
  "1.59.5": {
    observedResult:
      "c6：高 25% / 中 20% / 低 5%：+42.24%，最大回撤 48.23%，PF 1.1139。",
  },
  "1.59.6": {
    observedResult:
      "c6+b4：分层仓位叠加最大振幅 <12%：+46.74%，最大回撤 49.72%，PF 1.1229。",
  },
};

const NON_THREE_FACTOR_STUDY = study({
  familyId: "early-non-3f-comparison",
  familyLabel: "早期非 3F 对照族",
  studyStage: "历史对照",
  keyDifference:
    "cand-* 与 first-board-pullback 等早期策略或候选版本，用于补全历史脉络。",
  observedResult:
    "这些版本的样本窗口、执行口径和策略结构不同，不纳入 3F TopN 的族内排名。",
  signals: [
    fixed(
      "策略结构",
      "非 3F TopN",
      "历史对照",
      "这些版本使用早期候选或首板回踩结构，不能与 3F TopN 的族内信号逐项对比。"
    ),
  ],
  caution:
    "不要把非 3F 版本与 first-limit-pullback-3f-top3/top5 的版本收益直接混算。",
});

function buildFirstLimitPoolStudy(): StudyAnnotation {
  const detail = describeFirstLimitPoolDailyScore();
  return study({
    familyId: detail.familyId,
    familyLabel: "首板股票池 · 滚动 3F Top3",
    studyStage: "池化执行语义 / 逐 N 校准滚动评分",
    keyDifference:
      "首板事件发生后按 eventId 入池，池成员在有效期内每个交易日都可产生买入意图；"
      + "T+1 起使用逐 N 校准的滚动 3F，T+5 后固定窗口；低于最低分立即移池。",
    observedResult:
      "该族是新执行语义版本，不复用旧 3F TopN 的 T+5 单点决策留档。"
      + "旧的 first-limit-pullback-3f-top3/top5 事件窗版本继续保持原行为与历史结果。",
    signals: [
      fixed(
        "入池事件",
        "FIRST_LIMIT_UP",
        "入池",
        "检测到首板事件即按 eventId 入池；同一证券的多个首板事件由 poolMemberId 隔离。",
      ),
      fixed(
        "滚动评分",
        "ROLLING_3F · T+1..T+5",
        "每日评分",
        "maxAmplitude / meanAmplitude 取 LOW，t1VolumeRatio 取 HIGH；逐 N 分桶校准、等权合成。",
      ),
      fixed(
        "窗口冻结",
        "T+5 后固定 T+1..T+5",
        "每日评分",
        "同一事件 T+5 后评分值固定，但会与池内其他新老成员每日重新排名。",
      ),
      fixed(
        "每日执行",
        "决策日收盘 → 次一交易日开盘",
        "买入执行",
        "每个有效池交易日产生候选，受 topN、maxPositions、maxDailyBuys 约束；"
          + "已持有不再加仓。",
      ),
      fixed(
        "失效规则",
        "低于 0.55 / 连续 3 日不可评分 / 资格线破坏 / 池龄 60 日",
        "池生命周期",
        "失效当天不再产生新建仓意图；多事件成员的失效按各自 poolMemberId 独立判断。",
      ),
      fixed(
        "candidateExitPolicy",
        "DISABLED",
        "退出边界",
        "评分只影响买入；跌出候选不卖出，退出仍由止损、回撤止盈、时间退出与强持政策独立决定。",
      ),
      fixed(
        "面板预算",
        "成员数 / 总行数 / 池龄",
        "数据装配",
        "超预算抛 POOL_MEMBER_BUDGET_EXCEEDED、POOL_PANEL_ROW_BUDGET_EXCEEDED、"
          + "POOL_AGE_CAP_EXCEEDED；不静默截断、不回落事件窗。",
      ),
    ],
    caution:
      "该族移除原回踩资格门槛，并使用逐 N 重估桶边界；与 v1.62.1 的收益比较必须配合固定桶、"
      + "事件窗无回踩和逐 N 校准事件窗三类归因对照，不能只比较主策略。",
  });
}

const FIRST_LIMIT_POOL_STUDY = buildFirstLimitPoolStudy();

function isThreeFactorTopN(strategyId: string): boolean {
  return /^first-limit-pullback-3f-top\d+$/.test(strategyId);
}

function isFirstLimitPoolDailyScore(strategyId: string): boolean {
  return strategyId === FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_ID;
}

function isEarlyNonThreeFactor(strategyId: string): boolean {
  return (
    strategyId.startsWith("cand-") || strategyId === "first-board-pullback"
  );
}

function findThreeFactorRange(
  version: string
): VersionRangeRule["annotation"] | null {
  for (const rule of THREE_FACTOR_RANGE_RULES) {
    if (
      compareStrategyVersions(version, rule.minVersion) >= 0 &&
      compareStrategyVersions(version, rule.maxVersion) <= 0
    ) {
      return rule.annotation;
    }
  }
  return null;
}

/**
 * 按 `(strategyId, version)` 返回研究注解；没有可靠归属时返回 null。
 */
export function getStrategyVersionStudyAnnotation(
  strategyId: string,
  version: string
): StrategyVersionStudyAnnotationDto | null {
  if (isFirstLimitPoolDailyScore(strategyId)) {
    return version === FIRST_LIMIT_POOL_DAILY_SCORE_STRATEGY_VERSION
      ? {
          ...FIRST_LIMIT_POOL_STUDY,
          firstLimitPool: {
            ...describeFirstLimitPoolDailyScore(),
            errorCodes: [...describeFirstLimitPoolDailyScore().errorCodes],
          },
        }
      : null;
  }

  if (isThreeFactorTopN(strategyId)) {
    let parsed: boolean;
    try {
      // 该调用同时校验非法版本号；非法版本不应冒领一个模式族结论。
      compareStrategyVersions(version, version);
      parsed = true;
    } catch {
      parsed = false;
    }
    if (!parsed) return null;

    const base = findThreeFactorRange(version);
    if (base === null) return null;
    const override = EXACT_OVERRIDES[version];
    return override === undefined
      ? base
      : {
          ...base,
          ...override,
          signals: override.signals ?? base.signals,
          minuteFields: base.minuteFields,
        };
  }

  if (isEarlyNonThreeFactor(strategyId)) {
    return NON_THREE_FACTOR_STUDY;
  }

  return null;
}
