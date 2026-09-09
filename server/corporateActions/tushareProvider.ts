/**
 * STEP 12 WORK D — Tushare Corporate Action / Adjustment Factor Provider 适配器。
 *
 * 目标：把 Tushare 的 `dividend` / `adj_factor` 原始返回归一化为 provider-neutral 的
 * `CorporateAction` / `AdjustmentFactor`。本模块分两层：
 *   - `parse*` 纯解析器（可单测，不发网络）；
 *   - `fetch*` 网络适配器（复用 Tushare HTTP POST 模式，token 从 `process.env.TUSHARE_TOKEN` 读）。
 *
 * 字段探测（2026-09-06 实测，以实测为准）：
 *   - dividend 字段：ts_code, end_date, ann_date, div_proc, stk_div, stk_bo_rate,
 *     stk_co_rate, cash_div, cash_div_tax, record_date, ex_date, pay_date,
 *     imp_ann_date, base_date, base_share。
 *     同一分红年度会返回多行（div_proc = 预案 / 股东大会通过 / 实施），仅 `实施` 行含
 *     ex_date / record_date；故本层仅取 div_proc="实施" 的行，其余阶段跳过。
 *   - adj_factor 字段：ts_code, trade_date, adj_factor（逐日、后复权口径、最早日≈1）。
 *
 * PIT 语义（硬约束）：announcementDate（公告日，ann_date）、recordDate（登记日，record_date）、
 * effectiveDate（除权除息日，ex_date）严格区分；ex_date 缺失时该行丢弃并计入 missingExDate，
 * 禁止假设 announcementDate === effectiveDate。
 *
 * 单位换算（硬约束）：cash_div / stk_div / stk_bo_rate / stk_co_rate 均为「每 10 股」口径，
 * 写入前除以 10 转为「每股」。
 *
 * 复权因子转换（adj_factor → AdjustmentFactor）：
 *   - Tushare `adj_factor` 是「后复权因子」（raw × adj_factor = 后复权价，最早日≈1），
 *     即项目 `backFactor`；
 *   - 前复权因子 `foreFactor(d) = adj_factor(d) / adj_factor(最新日)`；
 *   - adj_factor 逐日给出，本层只保留「因子变化点」（即除权除息日），与 BaoStock 累计因子
 *     的 dividOperateDate 语义对齐（首行基线不产出，因为 baseline 不是除权事件）。
 */

import type { AdjustmentFactor, CorporateAction } from "./types";

export type TusharePayload = {
  code?: number;
  msg?: string;
  data?: { fields?: string[]; items?: unknown[][] };
};

const TUSHARE_API_URL = "https://api.tushare.pro";

/** 判断是否为 Tushare 40203（积分/频次受限）。 */
export function isTusharePermissionLimited(error: unknown): boolean {
  return (
    error instanceof Error &&
    /40203|权限|积分|每分钟最多|每小时最多|最多访问|访问频率|频率超限/.test(error.message)
  );
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** 把 Tushare 日期（YYYYMMDD）或 ISO 日期（YYYY-MM-DD）统一为 ISO；非法/空返回 null。 */
function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  let iso: string;
  if (/^\d{8}$/.test(s)) {
    iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    iso = s;
  } else {
    return null;
  }
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) ? iso : null;
}

function requireFields(payload: TusharePayload, required: string[]): Map<string, number> {
  if (payload.code !== 0) {
    throw new Error(`Tushare 请求失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
  }
  const fields = payload.data?.fields ?? [];
  const indexByField = new Map(fields.map((field, index) => [field, index]));
  for (const field of required) {
    if (!indexByField.has(field)) throw new Error(`Tushare 返回缺少字段：${field}`);
  }
  return indexByField;
}

async function postTushare(
  apiName: string,
  params: Record<string, unknown>,
  fields: string
): Promise<TusharePayload> {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error("未配置 TUSHARE_TOKEN");
  const response = await fetch(TUSHARE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
  });
  if (!response.ok) throw new Error(`Tushare ${apiName} 网络请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as TusharePayload;
  if (payload.code !== 0) {
    throw new Error(`Tushare ${apiName} 失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
  }
  return payload;
}

export interface TushareDividendParseResult {
  actions: CorporateAction[];
  /** 原始返回行数（data.items.length），供回填统计 Received。 */
  received: number;
  /** 因缺 ex_date（除权除息日）被丢弃的「实施」行数（PIT：禁止伪造 effectiveDate）。 */
  missingExDate: number;
  /** 被跳过的行数（预案/股东大会通过等非实施阶段 + 无效行）。 */
  skipped: number;
}

/** 构建 provider 原始描述（保留每 10 股口径，便于追溯）。 */
function buildDescription(kind: "dividend" | "bonus_issue" | "transfer", per10: number): string {
  if (kind === "dividend") return `每10股派${per10}元(税前)`;
  if (kind === "bonus_issue") return `每10股送${per10}股`;
  return `每10股转增${per10}股`;
}

/**
 * 解析 Tushare `dividend` 返回，拆分为单一 actionType 的事件序列。
 *
 * 规则：
 *   - 仅取 div_proc="实施" 的行（预案/股东大会通过 不落库）；
 *   - ex_date 缺失/非法 → 计 missingExDate 并丢弃（禁止假设 effectiveDate）；
 *   - cash_div>0 → dividend（cashAmount=cash_div/10）；
 *   - stk_div>0 或 stk_bo_rate>0 → bonus_issue（送股，取 max 防重复，bonusRatio=/10）；
 *   - stk_co_rate>0 → transfer（transferRatio=/10）；
 *   - 同批内同一 (effectiveDate, actionType) 去重，保留公告日更早者（PIT 更保守）。
 */
export function parseTushareDividend(
  payload: TusharePayload,
  options: { retrievedAt?: string; source?: string } = {}
): TushareDividendParseResult {
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const source = options.source ?? "tushare";
  const indexByField = requireFields(payload, [
    "ts_code",
    "div_proc",
    "ann_date",
    "stk_div",
    "stk_bo_rate",
    "stk_co_rate",
    "cash_div",
    "record_date",
    "ex_date",
  ]);
  const items = payload.data?.items ?? [];
  const seen = new Map<string, CorporateAction>();
  let missingExDate = 0;
  let skipped = 0;

  const putAction = (action: CorporateAction) => {
    const key = `${action.effectiveDate}|${action.actionType}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, action);
      return;
    }
    const newAnn = action.announcementDate ?? "9999-99-99";
    const oldAnn = existing.announcementDate ?? "9999-99-99";
    if (newAnn < oldAnn) seen.set(key, action);
  };

  for (const item of items) {
    if (!item || item.length === 0) {
      skipped += 1;
      continue;
    }
    try {
      const tsCode = String(item[indexByField.get("ts_code")!] ?? "").trim();
      const divProc = String(item[indexByField.get("div_proc")!] ?? "").trim();
      if (divProc !== "实施") {
        skipped += 1;
        continue;
      }
      const effectiveDate = toIsoDate(item[indexByField.get("ex_date")!]);
      if (!effectiveDate) {
        missingExDate += 1;
        skipped += 1;
        continue;
      }
      const recordDate = toIsoDate(item[indexByField.get("record_date")!]);
      const announcementDate = toIsoDate(item[indexByField.get("ann_date")!]);

      // 每 10 股 → 每股
      const cashDiv = toNumber(item[indexByField.get("cash_div")!]);
      const stkDiv = toNumber(item[indexByField.get("stk_div")!]);
      const stkBoRate = toNumber(item[indexByField.get("stk_bo_rate")!]);
      const stkCoRate = toNumber(item[indexByField.get("stk_co_rate")!]);

      const cash = cashDiv !== null && cashDiv > 0 ? cashDiv / 10 : null;
      const bonusRaw =
        stkDiv !== null && stkDiv > 0 ? stkDiv : stkBoRate !== null && stkBoRate > 0 ? stkBoRate : null;
      const bonus = bonusRaw !== null ? bonusRaw / 10 : null;
      const transfer = stkCoRate !== null && stkCoRate > 0 ? stkCoRate / 10 : null;

      const base: Omit<CorporateAction, "actionType" | "cashAmount" | "bonusRatio" | "transferRatio" | "description"> = {
        securityId: null,
        securityCode: tsCode,
        effectiveDate,
        recordDate,
        announcementDate,
        rightsRatio: null,
        rightsPrice: null,
        splitRatio: null,
        source,
        retrievedAt,
      };

      let produced = 0;
      if (cash !== null) {
        putAction({
          ...base,
          actionType: "dividend",
          cashAmount: cash,
          bonusRatio: null,
          transferRatio: null,
          description: buildDescription("dividend", cashDiv!),
        });
        produced += 1;
      }
      if (bonus !== null) {
        putAction({
          ...base,
          actionType: "bonus_issue",
          cashAmount: null,
          bonusRatio: bonus,
          transferRatio: null,
          description: buildDescription("bonus_issue", bonusRaw!),
        });
        produced += 1;
      }
      if (transfer !== null) {
        putAction({
          ...base,
          actionType: "transfer",
          cashAmount: null,
          bonusRatio: null,
          transferRatio: transfer,
          description: buildDescription("transfer", stkCoRate!),
        });
        produced += 1;
      }
      if (produced === 0) {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { actions: Array.from(seen.values()), received: items.length, missingExDate, skipped };
}

export interface TushareAdjFactorParseResult {
  factors: AdjustmentFactor[];
  /** 原始返回行数（data.items.length），供回填统计 Received。 */
  received: number;
  /** 因缺日期/因子非正被丢弃的行数。 */
  skipped: number;
}

/**
 * 解析 Tushare `adj_factor` 逐日因子，转为「除权除息日」级别的累计 AdjustmentFactor。
 *
 * 语义：Tushare adj_factor 为后复权因子（backFactor），前复权因子 = adj_factor/adj_factor(最新)。
 * 只保留因子「变化点」（即除权除息日）；首行（无前值，通常为基线 adj_factor≈1）不产出。
 */
export function parseTushareAdjFactor(
  payload: TusharePayload,
  options: { retrievedAt?: string; source?: string } = {}
): TushareAdjFactorParseResult {
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const source = options.source ?? "tushare";
  const indexByField = requireFields(payload, ["ts_code", "trade_date", "adj_factor"]);
  const items = payload.data?.items ?? [];
  const factors: AdjustmentFactor[] = [];
  let skipped = 0;

  const rows: { securityCode: string; date: string; factor: number }[] = [];
  for (const item of items) {
    if (!item || item.length === 0) {
      skipped += 1;
      continue;
    }
    const securityCode = String(item[indexByField.get("ts_code")!] ?? "").trim();
    const date = toIsoDate(item[indexByField.get("trade_date")!]);
    const factor = toNumber(item[indexByField.get("adj_factor")!]);
    if (!date || !securityCode || factor === null || factor <= 0) {
      skipped += 1;
      continue;
    }
    rows.push({ securityCode, date, factor });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) return { factors, received: items.length, skipped };

  const latestFactor = rows[rows.length - 1]!.factor;
  const EPS = 1e-9;
  let prev: number | null = null;
  for (const row of rows) {
    if (prev !== null && Math.abs(row.factor - prev) > EPS * Math.max(1, Math.abs(prev))) {
      factors.push({
        securityId: null,
        securityCode: row.securityCode,
        effectiveDate: row.date,
        foreFactor: row.factor / latestFactor,
        backFactor: row.factor,
        source,
        retrievedAt,
      });
    }
    prev = row.factor;
  }
  return { factors, received: items.length, skipped };
}

/** 获取单只证券的公司行为（现金分红/送股/转增）。 */
export async function fetchTushareDividend(tsCode: string): Promise<TushareDividendParseResult> {
  const payload = await postTushare(
    "dividend",
    { ts_code: tsCode },
    "ts_code,end_date,ann_date,div_proc,stk_div,stk_bo_rate,stk_co_rate,cash_div,cash_div_tax,record_date,ex_date,pay_date,imp_ann_date,base_date"
  );
  return parseTushareDividend(payload);
}

/** 获取单只证券的累计复权因子（全历史，转为除权除息日级别）。 */
export async function fetchTushareAdjFactor(tsCode: string): Promise<TushareAdjFactorParseResult> {
  const payload = await postTushare("adj_factor", { ts_code: tsCode }, "ts_code,trade_date,adj_factor");
  return parseTushareAdjFactor(payload);
}
