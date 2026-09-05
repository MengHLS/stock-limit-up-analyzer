/**
 * STEP 7.4 — Security Master Provider 抽象（Adapter 化）。
 *
 * 约束：
 *   - Provider 必须 Adapter 化：不允许把 provider-specific schema 写进 research layer。
 *   - 本层输出统一的 ProviderSecurityRecord，与底层来源（Tushare / BaoStock / Sina / 现有库）解耦。
 *   - Tushare stock_basic 受 40203 限制，未完成全量实证：不得假设可一次完成；
 *     因此 fetch 为「可能限频」的尽力而为实现，解析逻辑（parseTushareStockBasic）为纯函数、可独立测试。
 */

import { parseSecurityCode } from "./code";
import type { Exchange, Security, SecurityIdentifier, SecurityStatus, SecurityType } from "./types";

/** provider 归一化后的证券记录（尚未分配 security_id）。 */
export interface ProviderSecurityRecord {
  exchange: Exchange;
  /** 6 位数字代码（不含交易所后缀）。 */
  code: string;
  /** 证券名称（仅用于人工核对；不进 identifier history）。 */
  name: string;
  securityType: SecurityType;
  listedDate: string | null;
  delistedDate: string | null;
  status: SecurityStatus;
  /** 来源 provider 标识。 */
  source: string;
}

/** Security Master Provider 抽象接口。 */
export interface SecurityMasterProvider {
  readonly name: string;
  /** 拉取证券主数据（归一化）。 */
  fetchSecurityMaster(): Promise<ProviderSecurityRecord[]>;
}

/** Tushare stock_basic 原始响应形态（与 server/tushare.ts 一致）。 */
export interface TusharePayload {
  code?: number;
  msg?: string;
  data?: {
    fields?: string[];
    items?: unknown[][];
  };
}

/** 将 Tushare 的交易所代码映射为项目统一交易所。 */
export function mapTushareExchange(value: string | undefined): Exchange | null {
  switch (value) {
    case "SSE":
    case "SH":
      return "SH";
    case "SZSE":
    case "SZ":
      return "SZ";
    case "BSE":
    case "BJ":
      return "BJ";
    default:
      return null;
  }
}

/** 将 Tushare list_status 映射为生命周期状态快照。 */
export function mapTushareListStatus(value: string | undefined): SecurityStatus {
  switch (value) {
    case "L":
      return "listed";
    case "P":
      return "suspended";
    case "D":
      return "delisted";
    default:
      return "unknown";
  }
}

/** 将 Tushare 的 "YYYYMMDD" 日期转为 ISO "YYYY-MM-DD"；空/非法返回 null。 */
export function toIsoDateOrNull(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * 解析 Tushare stock_basic 响应为归一化的 ProviderSecurityRecord[]。
 * 期望字段：ts_code, symbol, name, list_status, list_date, delist_date, exchange, curr_type。
 * 交易所优先取 ts_code 后缀；缺失时回退 exchange 字段映射。
 */
export function parseTushareStockBasic(payload: TusharePayload): ProviderSecurityRecord[] {
  if (payload.code !== 0) {
    throw new Error(`Tushare stock_basic 请求失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
  }
  const fields = payload.data?.fields ?? [];
  const items = payload.data?.items ?? [];
  const indexByField = new Map(fields.map((field, index) => [field, index]));
  const required = ["ts_code", "name"];
  for (const field of required) {
    if (!indexByField.has(field)) throw new Error(`Tushare stock_basic 返回缺少字段：${field}`);
  }

  const get = (item: unknown[], field: string): unknown => {
    const index = indexByField.get(field);
    return index === undefined ? undefined : item[index];
  };

  const records: ProviderSecurityRecord[] = [];
  for (const item of items) {
    const tsCode = String(get(item, "ts_code") ?? "").trim();
    const parsed = parseSecurityCode(tsCode); // 尾缀 SH/SZ/BJ 即交易所
    const exchangeFromField = mapTushareExchange(String(get(item, "exchange") ?? ""));
    const exchange = exchangeFromField ?? parsed.exchange;

    records.push({
      exchange,
      code: parsed.digits,
      name: String(get(item, "name") ?? "").trim(),
      securityType: "stock",
      listedDate: toIsoDateOrNull(get(item, "list_date")),
      delistedDate: toIsoDateOrNull(get(item, "delist_date")),
      status: mapTushareListStatus(String(get(item, "list_status") ?? "")),
      source: "tushare_stock_basic",
    });
  }
  return records;
}

/** 由归一化记录构造 Security 主数据（分配给定 security_id）。 */
export function buildSecurityFromRecord(record: ProviderSecurityRecord, securityId: string): Security {
  return {
    securityId,
    securityType: record.securityType,
    exchange: record.exchange,
    currency: "CNY",
    country: "CN",
    status: record.status,
    listedDate: record.listedDate,
    delistedDate: record.delistedDate,
  };
}

/** 由归一化记录构造 primary 标识符（effectiveFrom = 上市日或记录起点，open 至今）。 */
export function buildPrimaryIdentifierFromRecord(
  record: ProviderSecurityRecord,
  securityId: string,
  effectiveFrom?: string,
): SecurityIdentifier {
  const from = effectiveFrom ?? record.listedDate;
  if (!from) {
    throw new Error(`无法构造标识符：${record.exchange} ${record.code} 缺少上市日期`);
  }
  return {
    securityId,
    exchange: record.exchange,
    code: record.code,
    identifierType: "primary",
    effectiveFrom: from,
    effectiveTo: null,
    source: record.source,
  };
}

/**
 * Tushare stock_basic Provider（尽力而为，可能限频）。
 * 未配置 TUSHARE_TOKEN 或限频时抛错，由上层决定重试策略。
 */
export class TushareStockBasicProvider implements SecurityMasterProvider {
  readonly name = "tushare-stock-basic";
  private readonly url: string;
  private readonly token: string | undefined;

  constructor(options?: { url?: string; token?: string }) {
    this.url = options?.url ?? "https://api.tushare.pro";
    this.token = options?.token ?? process.env.TUSHARE_TOKEN;
  }

  async fetchSecurityMaster(): Promise<ProviderSecurityRecord[]> {
    if (!this.token) throw new Error("未配置 TUSHARE_TOKEN，无法拉取 stock_basic");
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_name: "stock_basic",
        token: this.token,
        params: { list_status: "L" },
        fields: "ts_code,symbol,name,list_status,list_date,delist_date,exchange,curr_type",
      }),
    });
    if (!response.ok) throw new Error(`Tushare stock_basic 网络请求失败：HTTP ${response.status}`);
    return parseTushareStockBasic((await response.json()) as TusharePayload);
  }
}
