/**
 * STEP 22 / C-22.1 — Market Regime：日级市场事实构建（纯函数、PIT 安全）。
 *
 * 职责：把「某交易日的横截面快照 + 指数收盘 + 可选情绪事实」聚合成 RegimeDayFacts
 * ——regime 七维计算的唯一输入单元。**只使用当日数据**，不含任何未来信息。
 *
 * 复用而非重写（真实复用，非声明）：
 *   - `server/data/boardRules`（STEP 5 涨停规则唯一权威来源）：resolveLimitRules /
 *     isPriceAtLimitUp / isPriceAtLimitDown。禁止自造「9.9% / 10% 近似」；
 *     ST/退市整理 5%、创业板/科创板 20%、北交所 30% 全部由该层给出。
 *   - `server/research/datasetAccess/invariants`：assertRowPitInvariant（行级
 *     asOf === tradeDate 断言，与 C-13.1 同一事实来源，避免两套 PIT 口径）。
 *   - `shared/quant-stats`：mean（换手率均值；过滤非有限值、空样本返回 null）。
 *
 * 缺失语义：字段缺失 = 不计入相应计数（不填零、不猜测）；成交额全缺 → totalAmount=null
 * （下游流动性维因此 unassessed，绝不退化成 0 成交额）。
 */

import { limitDownPrice, limitUpPrice, resolveLimitRules } from "../../data/boardRules";
import { assertRowPitInvariant } from "../datasetAccess/invariants";
import { mean } from "../../../shared/quant-stats";
import { RegimeAnalysisError } from "./errors";
import { assertRegimeIsoDate } from "./dates";
import type { ResearchDatasetRow } from "../../researchDataset/types";
import type {
  RegimeDayFacts,
  RegimeIndexBar,
  RegimeSecuritySnapshot,
  RegimeSentimentFacts,
} from "./types";

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 是否为可用于价格比较的正有限数。 */
function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 把 dataset 的 st 状态映射为 boardRules 可识别的「股票名称」。
 * 依据：server/data/boardRules.isStStock 通过名称判定风险警示（ST/*ST/退市），
 * 而 Research Dataset 行只给 st 枚举（NORMAL/ST/*ST/UNKNOWN），故做确定性映射；
 * UNKNOWN/NORMAL 传 null（按非 ST 处理，主板 10%）。
 */
function stPseudoName(st: RegimeSecuritySnapshot["st"]): string | null {
  if (st === "ST") return "ST";
  if (st === "*ST") return "*ST";
  return null;
}

/** 数值字段校验（有限即可；成交额允许为 0？A 股停牌日成交额为 0，属真实值，允许）。 */
function assertOptionalFinite(value: number | null | undefined, label: string): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) {
    throw new RegimeAnalysisError(
      "REGIME_INVALID_PARAMETER",
      `marketRegime: ${label} 必须是有限数字或 null，实际 ${String(value)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 日级事实构建
// ---------------------------------------------------------------------------

/** 构建日级事实的入参。 */
export interface BuildRegimeDayFactsInput {
  /** 交易日（YYYY-MM-DD）。 */
  readonly tradeDate: string;
  /**
   * 事实可获得时点；缺省 = tradeDate。
   * 必须 === tradeDate（逐日 PIT 快照语义）；任何偏离一律响亮抛错。
   */
  readonly asOf?: string;
  /** 当日核心指数收盘（缺失指数的 indexCode 不出现，close 为 null 视为缺失）。 */
  readonly indexBars?: readonly RegimeIndexBar[];
  /** 当日全市场（或 universe 内）证券快照。 */
  readonly snapshots: readonly RegimeSecuritySnapshot[];
  /** 情绪事实；null / 缺省 = 数据源缺失（情绪维 unassessed）。 */
  readonly sentiment?: RegimeSentimentFacts | null;
}

/**
 * 构建单个交易日的 RegimeDayFacts（纯函数、确定性）。
 *
 * 统计口径（全部只基于当日快照）：
 *   - sampleSize      = close 与 preClose 均为正有限数的证券数；
 *   - advancing / declining / unchanged = close > / < / === preClose 的家数；
 *   - limitUp / limitDown = 收盘价触及涨/跌停价的家数（规则来自 boardRules）；
 *   - limitClassifiableCount = 板块规则可判定且价格齐备的家数（涨停占比的分母）；
 *   - totalAmount     = Σ amount（有限且 >= 0）；全缺为 null；
 *   - meanTurnoverRate= 有效换手率的算术平均（quant-stats mean）；全缺为 null。
 */
export function buildRegimeDayFacts(input: BuildRegimeDayFactsInput): RegimeDayFacts {
  const tradeDate = input.tradeDate;
  assertRegimeIsoDate(tradeDate, "buildRegimeDayFacts.tradeDate");
  const asOf = input.asOf ?? tradeDate;
  assertRegimeIsoDate(asOf, "buildRegimeDayFacts.asOf");
  if (asOf !== tradeDate) {
    throw new RegimeAnalysisError(
      "REGIME_ASOF_INVARIANT_VIOLATION",
      `marketRegime: 日级事实 asOf=${asOf} != tradeDate=${tradeDate}；` +
        `逐日 PIT 快照要求 asOf === tradeDate（asOf 落后=信息缺失，asOf 超前=未来信息）`,
    );
  }

  // -- 指数收盘（键升序，确定性；close 为 null 视为缺失不入表）--
  const indexCloses: Record<string, number> = {};
  for (const bar of input.indexBars ?? []) {
    if (typeof bar.indexCode !== "string" || bar.indexCode.length === 0) {
      throw new RegimeAnalysisError(
        "REGIME_INVALID_PARAMETER",
        "marketRegime: indexBars[].indexCode 必须是非空字符串",
      );
    }
    if (bar.close === null || bar.close === undefined) continue;
    if (!Number.isFinite(bar.close) || bar.close <= 0) {
      throw new RegimeAnalysisError(
        "REGIME_INVALID_PARAMETER",
        `marketRegime: indexBars[${bar.indexCode}].close 必须是 > 0 的有限数，实际 ${String(bar.close)}`,
      );
    }
    indexCloses[bar.indexCode] = bar.close;
  }

  let sampleSize = 0;
  let advancingCount = 0;
  let decliningCount = 0;
  let unchangedCount = 0;
  let limitUpCount = 0;
  let limitDownCount = 0;
  let limitClassifiableCount = 0;
  let amountSum: number | null = null;
  const turnoverRates: number[] = [];

  for (const snapshot of input.snapshots) {
    assertOptionalFinite(snapshot.close, "snapshot.close");
    assertOptionalFinite(snapshot.preClose, "snapshot.preClose");
    assertOptionalFinite(snapshot.amount, "snapshot.amount");
    assertOptionalFinite(snapshot.turnoverRate, "snapshot.turnoverRate");

    const priceComparable = isPositiveFinite(snapshot.close) && isPositiveFinite(snapshot.preClose);
    if (priceComparable) {
      sampleSize += 1;
      if (snapshot.close! > snapshot.preClose!) advancingCount += 1;
      else if (snapshot.close! < snapshot.preClose!) decliningCount += 1;
      else unchangedCount += 1;
    }

    // 涨跌停判定：板块比例与涨跌停价来自 boardRules（唯一权威），此处不重算比例
    if (snapshot.code !== null && priceComparable) {
      const rules = resolveLimitRules(snapshot.code, stPseudoName(snapshot.st));
      // supported=false（未知代码前缀/板块）→ 不可判定，不计入分母
      if (rules.supported && rules.limitUpRatio !== null && rules.limitDownRatio !== null) {
        limitClassifiableCount += 1;
        const close = snapshot.close!;
        const preClose = snapshot.preClose!;
        // 容差说明（诚实披露与既有实现的差异）：
        // 直接 `close >= preClose × (1+ratio)` 会因二进制浮点把真实涨停误判为未涨停
        // ——如 preClose=100、ratio=0.1 时 100×1.1 = 110.00000000000001 > 110。
        // A 股价格最小变动单位为 0.01 元，故用「相对 1e-9」容差吸收纯浮点噪声：
        // 它比浮点噪声（~1e-16）大若干个量级、比 0.01 元 tick 小 5 个量级，
        // 不会把「差一档」的价格误判成涨停。
        const tolerance = preClose * 1e-9;
        if (close >= limitUpPrice(preClose, rules.limitUpRatio) - tolerance) limitUpCount += 1;
        if (close <= limitDownPrice(preClose, rules.limitDownRatio) + tolerance) limitDownCount += 1;
      }
    }

    if (typeof snapshot.amount === "number" && Number.isFinite(snapshot.amount) && snapshot.amount >= 0) {
      amountSum = (amountSum ?? 0) + snapshot.amount;
    }
    if (typeof snapshot.turnoverRate === "number" && Number.isFinite(snapshot.turnoverRate)) {
      turnoverRates.push(snapshot.turnoverRate);
    }
  }

  return {
    tradeDate,
    asOf,
    indexCloses: Object.freeze(indexCloses),
    sampleSize,
    advancingCount,
    decliningCount,
    unchangedCount,
    limitUpCount,
    limitDownCount,
    limitClassifiableCount,
    totalAmount: amountSum,
    meanTurnoverRate: mean(turnoverRates),
    sentiment: input.sentiment ?? null,
  };
}

// ---------------------------------------------------------------------------
// Research Dataset 适配（C-13.1 行 → regime 日级事实；import 只读，不修改既有文件）
// ---------------------------------------------------------------------------

/**
 * Research Dataset 行 → regime 证券快照（字段直取，缺失保持 null）。
 *
 * 逐行调用 C-13.1 的 assertRowPitInvariant：行 asOf !== tradeDate 立即抛错
 * （冻结快照面板不得喂给 regime 计算，否则等于用今天的知识给历史贴标签）。
 */
export function regimeSecuritySnapshotFromDatasetRow(
  row: ResearchDatasetRow,
): RegimeSecuritySnapshot {
  assertRowPitInvariant(row);
  return {
    securityId: row.securityId,
    code: row.code,
    close: row.close,
    preClose: row.preClose,
    amount: row.amount,
    turnoverRate: row.turnoverRate,
    st: row.st,
  };
}

/** 从 Research Dataset 行构建日级事实的入参。 */
export interface BuildRegimeDayFactsFromRowsInput {
  readonly tradeDate: string;
  /** 该交易日的全部 dataset 行（必须都是该交易日，且 asOf === tradeDate）。 */
  readonly rows: readonly ResearchDatasetRow[];
  /** 指数收盘；未提供时取首行的 indexClose（dataset 行已按 indexCode 升序内嵌）。 */
  readonly indexBars?: readonly RegimeIndexBar[];
  readonly sentiment?: RegimeSentimentFacts | null;
}

/**
 * 从 Research Dataset 行构建日级事实（适配 C-13.1 / C-12.6 行形态）。
 *
 * 注意：调用方必须**只传入该交易日**的行（(tradeDate, securityId) 宽行面板按日切片）；
 * 混入其它日期的行会被 assertRowPitInvariant 直接拒绝（FAIL FAST）。
 */
export function buildRegimeDayFactsFromDatasetRows(
  input: BuildRegimeDayFactsFromRowsInput,
): RegimeDayFacts {
  assertRegimeIsoDate(input.tradeDate, "buildRegimeDayFactsFromDatasetRows.tradeDate");
  const snapshots = input.rows.map((row) => regimeSecuritySnapshotFromDatasetRow(row));
  let indexBars = input.indexBars;
  if (indexBars === undefined) {
    const firstRowWithIndex = input.rows.find((row) => Object.keys(row.indexClose).length > 0);
    indexBars = firstRowWithIndex
      ? Object.keys(firstRowWithIndex.indexClose)
          .sort()
          .map((indexCode) => ({
            indexCode,
            close: firstRowWithIndex.indexClose[indexCode] ?? null,
          }))
      : [];
  }
  return buildRegimeDayFacts({
    tradeDate: input.tradeDate,
    indexBars,
    snapshots,
    sentiment: input.sentiment ?? null,
  });
}

// ---------------------------------------------------------------------------
// 情绪代理（默认关闭，见 config.REGIME_SENTIMENT_DEFAULT_ALLOW_LIMIT_UP_PROXY）
// ---------------------------------------------------------------------------

/**
 * 由「涨跌停家数」派生情绪事实（**代理口径，非真实情绪数据**）。
 *
 * 仅在 sentiment.allowSentimentLimitUpProxy=true 时被 dimensions.ts 使用；
 * 派出的事实 maxConsecutiveBoard / brokenBoardCount 恒为 null（涨停家数无法给出
 * 连板高度与炸板率）——如实留空，不编造。
 */
export function deriveRegimeSentimentFromLimitUp(
  facts: Pick<RegimeDayFacts, "limitUpCount" | "limitDownCount">,
): RegimeSentimentFacts {
  return {
    limitUpCount: facts.limitUpCount,
    limitDownCount: facts.limitDownCount,
    maxConsecutiveBoard: null,
    brokenBoardCount: null,
  };
}
