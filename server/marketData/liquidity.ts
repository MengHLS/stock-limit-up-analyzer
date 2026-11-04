/**
 * STEP 7.6 — Liquidity：统一流动性日线的 provider 归一化与单位换算。
 *
 * 铁律：某 provider 无法提供的字段 → 显式 UNAVAILABLE（bar 字段为 null），
 * 禁止用其他字段推导、禁止用 0 或近似值伪造。
 *
 * 单位归一（canonical）：
 *   - turnoverRate          %（provider 原始字段即 %）
 *   - circulation/total     元（Tushare daily_basic 原始为 万元 → ×10000）
 *   - amount                千元（BaoStock 原始为 元 → ×0.001；Tushare daily 原始即 千元）
 *   - volume                手（BaoStock 原始为 股 → ×0.01；Tushare daily 原始即 手）
 */

import {
  LIQUIDITY_UNITS,
  TURNOVER_RATE_MAX,
  type DataAvailability,
  type LiquidityDaily,
  type LiquidityField,
  type LiquidityProviderCapability,
  type SecurityId,
} from "./types";

/** 流动性 provider 名称（与 providers/types.ts 的 LiquidityProvider 接口区分）。 */
export type LiquidityProviderName = "tushare-daily" | "tushare-daily-basic" | "baostock-daily";

/** 单位换算系数（到 canonical 单位）。 */
export interface LiquidityUnitScale {
  turnoverRate: number;
  marketCapToYuan: number;
  amountToQianYuan: number;
  volumeToHand: number;
}

/** 各 provider 的单位换算系数（唯一权威来源，禁止业务层自行乘除）。 */
export const LIQUIDITY_PROVIDER_SCALES: Record<LiquidityProviderName, LiquidityUnitScale> = {
  // Tushare daily：amount 千元 / volume 手（原样），无换手/市值。
  "tushare-daily": { turnoverRate: 1, marketCapToYuan: 1, amountToQianYuan: 1, volumeToHand: 1 },
  // Tushare daily_basic：circ_mv/total_mv 万元 → 元；无 amount/volume。
  "tushare-daily-basic": { turnoverRate: 1, marketCapToYuan: 10_000, amountToQianYuan: 1, volumeToHand: 1 },
  // BaoStock daily：volume 股 → 手、amount 元 → 千元；无市值。
  "baostock-daily": { turnoverRate: 1, marketCapToYuan: 1, amountToQianYuan: 0.001, volumeToHand: 0.01 },
};

/** 各 provider 的字段可提供性（显式 UNAVAILABLE，避免静默 null）。 */
export const LIQUIDITY_PROVIDER_CAPABILITIES: Record<LiquidityProviderName, LiquidityProviderCapability> = {
  "tushare-daily": {
    turnoverRate: "UNAVAILABLE",
    circulationMarketCap: "UNAVAILABLE",
    totalMarketCap: "UNAVAILABLE",
    amount: "AVAILABLE",
    volume: "AVAILABLE",
  },
  "tushare-daily-basic": {
    turnoverRate: "AVAILABLE",
    circulationMarketCap: "AVAILABLE",
    totalMarketCap: "AVAILABLE",
    amount: "UNAVAILABLE",
    volume: "UNAVAILABLE",
  },
  "baostock-daily": {
    turnoverRate: "AVAILABLE",
    circulationMarketCap: "UNAVAILABLE",
    totalMarketCap: "UNAVAILABLE",
    amount: "AVAILABLE",
    volume: "AVAILABLE",
  },
};

/** provider 原始流动性行（数值字段为 provider 原始单位）。 */
export interface RawLiquidityRow {
  securityId: SecurityId;
  tradeDate: string;
  turnoverRate?: number | null;
  circulationMarketCap?: number | null;
  totalMarketCap?: number | null;
  amount?: number | null;
  volume?: number | null;
}

/** 归一化结果：canonical bar + 该 provider 的字段可提供性。 */
export interface NormalizedLiquidity {
  bar: LiquidityDaily;
  capability: LiquidityProviderCapability;
}

/** 安全换算：非有限 → null（不静默填 0）。 */
function convert(value: number | null | undefined, scale: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value * scale;
}

/**
 * 把某 provider 的原始行归一化为 canonical LiquidityDaily。
 * 不可提供字段 → null；可提供字段按 scale 换算到 canonical 单位。
 */
export function normalizeLiquidity(provider: LiquidityProviderName, raw: RawLiquidityRow): NormalizedLiquidity {
  const scale = LIQUIDITY_PROVIDER_SCALES[provider];
  const capability = LIQUIDITY_PROVIDER_CAPABILITIES[provider];
  const available = (field: LiquidityField) => capability[field] === "AVAILABLE";
  return {
    bar: {
      securityId: raw.securityId,
      tradeDate: raw.tradeDate,
      turnoverRate: available("turnoverRate") ? convert(raw.turnoverRate, scale.turnoverRate) : null,
      circulationMarketCap: available("circulationMarketCap") ? convert(raw.circulationMarketCap, scale.marketCapToYuan) : null,
      totalMarketCap: available("totalMarketCap") ? convert(raw.totalMarketCap, scale.marketCapToYuan) : null,
      amount: available("amount") ? convert(raw.amount, scale.amountToQianYuan) : null,
      volume: available("volume") ? convert(raw.volume, scale.volumeToHand) : null,
      source: provider,
    },
    capability,
  };
}

/**
 * 合并多个 provider 的流动性（按传入顺序，后者只补前者缺失的字段）。
 * 显式、可追溯：合并后 source 记录为各 provider 拼接，per-field 来源单独返回。
 * 禁止隐式覆盖已有值——只有前序字段为 null（UNAVAILABLE）时才用后序补。
 */
export interface MergedLiquidity {
  bar: LiquidityDaily;
  /** 每个字段最终取自哪个 provider（null 表示仍不可获取）。 */
  sourceByField: Record<LiquidityField, LiquidityProviderName | null>;
}

export function mergeLiquidity(normalized: readonly NormalizedLiquidity[]): MergedLiquidity | null {
  if (normalized.length === 0) return null;
  const first = normalized[0]!;
  const securityId = first.bar.securityId;
  const tradeDate = first.bar.tradeDate;

  const fields: LiquidityField[] = ["turnoverRate", "circulationMarketCap", "totalMarketCap", "amount", "volume"];
  const bar: LiquidityDaily = {
    securityId,
    tradeDate,
    turnoverRate: null,
    circulationMarketCap: null,
    totalMarketCap: null,
    amount: null,
    volume: null,
    source: normalized.map((n) => n.bar.source).join("+"),
  };
  const sourceByField = {} as Record<LiquidityField, LiquidityProviderName | null>;

  for (const field of fields) {
    sourceByField[field] = null;
    for (const n of normalized) {
      const value = n.bar[field];
      if (value !== null) {
        bar[field] = value;
        sourceByField[field] = n.bar.source as LiquidityProviderName;
        break;
      }
    }
  }

  return { bar, sourceByField };
}

/** 流动性字段的可提供性枚举（供报告/覆盖分析使用）。 */
export function liquidityFieldAvailability(normalized: readonly NormalizedLiquidity[]): Record<LiquidityField, DataAvailability> {
  const result: Record<LiquidityField, DataAvailability> = {
    turnoverRate: "UNAVAILABLE",
    circulationMarketCap: "UNAVAILABLE",
    totalMarketCap: "UNAVAILABLE",
    amount: "UNAVAILABLE",
    volume: "UNAVAILABLE",
  };
  for (const n of normalized) {
    for (const field of Object.keys(result) as LiquidityField[]) {
      if (n.capability[field] === "AVAILABLE" && result[field] !== "AVAILABLE") {
        result[field] = "AVAILABLE";
      }
    }
  }
  return result;
}

/** 校验 canonical 流动性行：换手率范围、非负市值/额/量。 */
export interface LiquidityValidation {
  status: "VALID" | "WARNING" | "INVALID";
  issues: Array<{ code: string; message: string }>;
}

export function validateLiquidity(bar: LiquidityDaily): LiquidityValidation {
  const issues: Array<{ code: string; message: string }> = [];

  const nonNegative = (name: string, value: number | null) => {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      issues.push({ code: "NEGATIVE_VALUE", message: `${name} 必须 >= 0，实际 ${value}` });
    }
  };
  nonNegative("circulationMarketCap", bar.circulationMarketCap);
  nonNegative("totalMarketCap", bar.totalMarketCap);
  nonNegative("amount", bar.amount);
  nonNegative("volume", bar.volume);

  if (bar.turnoverRate !== null && (!Number.isFinite(bar.turnoverRate) || bar.turnoverRate < 0 || bar.turnoverRate > TURNOVER_RATE_MAX)) {
    issues.push({ code: "TURNOVER_RATE_OUT_OF_RANGE", message: `turnoverRate 超出合理范围，实际 ${bar.turnoverRate}` });
  }
  if (bar.circulationMarketCap !== null && bar.totalMarketCap !== null && bar.circulationMarketCap > bar.totalMarketCap) {
    issues.push({ code: "CIRC_MV_GT_TOTAL_MV", message: `流通市值 > 总市值` });
  }

  const hasInvalid = issues.some((issue) => issue.code === "NEGATIVE_VALUE" || issue.code === "TURNOVER_RATE_OUT_OF_RANGE");
  if (hasInvalid) return { status: "INVALID", issues };
  return { status: issues.length > 0 ? "WARNING" : "VALID", issues };
}

export { LIQUIDITY_UNITS };
