/**
 * 策略类型标签的前端展示词汇表。
 *
 * 权威值域在后端 `server/research/strategySchema/types.ts#STRATEGY_TYPES`
 * （落库到 `strategies.strategyType`）。这里**只做中文标签映射**，不新增取值：
 * 遇到词汇表之外的字符串（历史脏数据 / 未来新增但前端未同步）原样展示，
 * 绝不猜测归类，也绝不把未知值悄悄吞成「其他」。
 *
 * 两侧一致性由 `tests/client/src/components/strategy/strategyTypeVocabulary.test.ts` 守护。
 */

/** 与后端 `STRATEGY_TYPES` 一一对应的值域（顺序一致，供下拉/筛选使用）。 */
export const STRATEGY_TYPE_VALUES = [
  "BASELINE",
  "MANUAL",
  "THREE_FACTOR_TOPN",
  "FIRST_LIMIT_POOL_DAILY_SCORE",
  "FIRST_LIMIT_POOL_ROLLING_3F",
  "RESEARCH_CANDIDATE",
  "TEST",
  "OTHER",
] as const;

export type StrategyTypeValue = (typeof STRATEGY_TYPE_VALUES)[number];

/** 值 → 中文标签。 */
const STRATEGY_TYPE_LABELS: Record<StrategyTypeValue, string> = {
  BASELINE: "基线策略",
  MANUAL: "人工策略",
  THREE_FACTOR_TOPN: "三因子 Top-N",
  FIRST_LIMIT_POOL_DAILY_SCORE: "首板股票池每日评分",
  FIRST_LIMIT_POOL_ROLLING_3F: "首板股票池滚动 3F",
  RESEARCH_CANDIDATE: "研究候选",
  TEST: "测试",
  OTHER: "其他",
};

/** 值 → 一句话说明（供卡片 tooltip / 总览页）。 */
const STRATEGY_TYPE_DESCRIPTIONS: Record<StrategyTypeValue, string> = {
  BASELINE: "系统基线参考策略，用作其它版本的对照。",
  MANUAL: "人工设计与维护的主力策略。",
  THREE_FACTOR_TOPN: "基于三因子评分排序取 Top-N 的策略族。",
  FIRST_LIMIT_POOL_DAILY_SCORE:
    "首板事件入池后逐日评分、动态买入；评分只影响买入，不触发卖出。",
  FIRST_LIMIT_POOL_ROLLING_3F:
    "首板事件入池后按逐 N 校准的滚动 3F 分每日排序，低分移池。",
  RESEARCH_CANDIDATE: "研究流程自动生成的候选策略。",
  TEST: "测试 / 验证用途，不代表生产口径。",
  OTHER: "尚未归入既定类别的策略。",
};

function isStrategyTypeValue(value: string): value is StrategyTypeValue {
  return (STRATEGY_TYPE_VALUES as readonly string[]).includes(value);
}

/** 中文标签（未知值原样返回；空值显示「未分类」）。 */
export function strategyTypeLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "未分类";
  return isStrategyTypeValue(value) ? STRATEGY_TYPE_LABELS[value] : value;
}

/** 类型说明（未知值返回空串，不编造）。 */
export function strategyTypeDescription(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return isStrategyTypeValue(value) ? STRATEGY_TYPE_DESCRIPTIONS[value] : "";
}

/**
 * 值 → Tailwind 徽标配色类（border / 文字 / 背景）。
 * 未分类与未知值走中性灰，避免用颜色暗示并不存在的语义。
 */
export function strategyTypeBadgeClass(value: string | null | undefined): string {
  switch (value) {
    case "BASELINE":
      return "border-slate-300 bg-slate-50 text-slate-700";
    case "MANUAL":
      return "border-sky-300 bg-sky-50 text-sky-700";
    case "THREE_FACTOR_TOPN":
      return "border-teal-300 bg-teal-50 text-teal-700";
    case "FIRST_LIMIT_POOL_DAILY_SCORE":
    case "FIRST_LIMIT_POOL_ROLLING_3F":
      return "border-cyan-300 bg-cyan-50 text-cyan-700";
    case "RESEARCH_CANDIDATE":
      return "border-amber-300 bg-amber-50 text-amber-700";
    case "TEST":
      return "border-violet-300 bg-violet-50 text-violet-700";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}
