/**
 * 高位连板风险控制（PIT 安全：只使用信号日收盘即可知的「连板高度」）。
 *
 * ── 业务背景 ────────────────────────────────────────────────────────────────
 * 连板高度越高，愿意在次日开盘接力的资金越少，一旦断板，实际回撤幅度与「一字跌停」
 * 概率都显著上升，风险收益比快速恶化。旧口径把「4 板及以上」统一记为同一档风险贡献
 * （20 分），于是 5 板 / 6 板 / 7 板与普通 4 板完全等价：
 *   · 硬过滤与质量门控只按风险总分裁决，高位连板照样通过；
 *   · 风险扣分策略同样扣不动，排序上仍压过低位标的。
 * 结果是「风险收益比明显不合理」的标的仍然产出买入信号。
 *
 * ── 本模块给出的三件事（全部纯函数、确定性、可序列化）──────────────────────
 *   1. boardHeightRiskContribution —— 连板高度的风险扣分梯度（5/6 板显著加重）；
 *   2. isBoardParticipationRestricted —— 超过「允许参与的最高连板高度」→ 限制参与；
 *   3. boardHeightPositionScale —— 未越上限但已属高位的标的 → 降低仓位（缩放系数）。
 *
 * 所有阈值与梯度都是本文件中的显式常量，禁止在各调用点另写一套
 * 「boards >= 4 即高位」的隐式口径（历史缺陷正是口径散落导致）。
 */

/** 连板高度风险扣分梯度；按 minBoards 降序匹配第一个满足项。 */
const BOARD_HEIGHT_RISK_LADDER: ReadonlyArray<{ minBoards: number; contribution: number }> = [
  { minBoards: 7, contribution: 60 },
  { minBoards: 6, contribution: 46 },
  { minBoards: 5, contribution: 34 },
  { minBoards: 4, contribution: 22 },
  { minBoards: 3, contribution: 12 },
  { minBoards: 2, contribution: 5 },
];

/**
 * 暴露扣分梯度（升序副本），供前端参数表直接渲染。
 * 目的：避免 UI 再抄一份阈值表 —— 口径的唯一权威是本文件的 BOARD_HEIGHT_RISK_LADDER。
 */
export function boardHeightRiskLadder(): Array<{ minBoards: number; contribution: number }> {
  return [...BOARD_HEIGHT_RISK_LADDER].sort((left, right) => left.minBoards - right.minBoards);
}

/** 扣分梯度中的最高档起始板数（≥ 该板数统一按最高档处理）。 */
export const BOARD_HEIGHT_RISK_MAX_TIER_FROM = 7;

/** 默认「允许参与」的最高连板高度；超过即视为高位连板，限制参与。 */
export const DEFAULT_MAX_PARTICIPATING_BOARDS = 6;

/** 进入「高位连板」关注区间的下界（用于风险提示与仓位缩放）。 */
export const HIGH_BOARD_TIER_FROM = 4;

/** 5 板仓位缩放系数（相对等权基准）。 */
export const HIGH_BOARD_POSITION_SCALE_FIVE = 0.6;

/** 6 板及以上仓位缩放系数（相对等权基准）。 */
export const HIGH_BOARD_POSITION_SCALE_SIX_PLUS = 0.3;

/** 连板高度归一化：非法值按 1 板处理，避免 NaN / 负数污染风险分。 */
export function normalizeBoards(boards: number | null | undefined): number {
  if (boards === null || boards === undefined || !Number.isFinite(boards)) return 1;
  return Math.max(1, Math.floor(boards));
}

/**
 * 连板高度对应的风险扣分（0~100 风险分的组成项之一）。
 * 2 板及以下不扣分；3 板起阶梯上升，5 板 / 6 板明显加重，7 板及以上按最高档处理。
 */
export function boardHeightRiskContribution(boards: number | null | undefined): number {
  const normalized = normalizeBoards(boards);
  for (const step of BOARD_HEIGHT_RISK_LADDER) {
    if (normalized >= step.minBoards) return step.contribution;
  }
  return 0;
}

/** 是否属于「高位连板」关注区间（默认 4 板及以上）。 */
export function isHighBoard(boards: number | null | undefined, highBoardFrom: number = HIGH_BOARD_TIER_FROM): boolean {
  return normalizeBoards(boards) >= normalizeBoards(highBoardFrom);
}

/**
 * 是否应「限制参与」：连板高度超过允许上限。
 * 语义为硬约束（不再进入买入意图），而不是扣分。
 */
export function isBoardParticipationRestricted(
  boards: number | null | undefined,
  maxParticipatingBoards: number = DEFAULT_MAX_PARTICIPATING_BOARDS,
): boolean {
  return normalizeBoards(boards) > normalizeBoards(maxParticipatingBoards);
}

/**
 * 高位连板的仓位缩放系数（用于「不剔除但降低仓位」）。
 *   · 超过允许上限 → 0（已被限制参与，系数无用但仍返回 0 以便复算）；
 *   · 6 板及以上 → 0.3；
 *   · 5 板 → 0.6；
 *   · 其余 → 1（不缩放）。
 */
export function boardHeightPositionScale(
  boards: number | null | undefined,
  maxParticipatingBoards: number = DEFAULT_MAX_PARTICIPATING_BOARDS,
): number {
  const normalized = normalizeBoards(boards);
  if (isBoardParticipationRestricted(normalized, maxParticipatingBoards)) return 0;
  if (normalized >= 6) return HIGH_BOARD_POSITION_SCALE_SIX_PLUS;
  if (normalized === 5) return HIGH_BOARD_POSITION_SCALE_FIVE;
  return 1;
}

/** 可读的高位连板说明（用于剔除原因 / 风险标签 / 前端展示）。 */
export function describeBoardHeightRisk(
  boards: number | null | undefined,
  maxParticipatingBoards: number = DEFAULT_MAX_PARTICIPATING_BOARDS,
): string {
  const normalized = normalizeBoards(boards);
  if (isBoardParticipationRestricted(normalized, maxParticipatingBoards)) {
    return `${normalized}板高位连板（超过允许参与上限 ${normalizeBoards(maxParticipatingBoards)} 板），限制参与`;
  }
  const scale = boardHeightPositionScale(normalized, maxParticipatingBoards);
  if (scale < 1) return `${normalized}板高位连板，风险扣分加重并按 ${scale} 倍降低仓位`;
  return `${normalized}板，连板高度在允许区间内`;
}
