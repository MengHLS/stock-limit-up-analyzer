/**
 * STEP 7.4 — Tushare namechange Provider（Adapter 化）。
 *
 * namechange 返回某只证券的「名称历史」（含每个名称的有效区间 start_date/end_date）。
 * 实测字段（2026-09-06 探测）：ts_code,name,start_date,end_date,ann_date,change_reason。
 *
 * 语义说明：
 *   - 名称历史与标识符历史（6 位代码）严格独立；本表/本模块不含 name 落库。
 *   - 但 namechange 的有效区间揭示了该 ts_code 的「代码生命周期」：
 *     min(start_date) ≈ 上市日；最新一条 end_date 为空表示至今仍上市，非空表示已退市。
 *   - 名称区间之间的「缺口」（前一条 end_date 与后一条 start_date 不连续）是
 *     「退市后代码复用」的信号，供 buildSecurityMaster 做 code reuse 拆分。
 *
 * namechange 限频：约 1 次/分钟 + 1 次/小时，必须节制；开发/测试用 mock 数据。
 */

import { parseSecurityCode } from "./code";
import { toIsoDateOrNull } from "./provider";
import type { Exchange } from "./types";

/** Tushare namechange 原始响应形态（与 provider.ts 的 TusharePayload 一致）。 */
export interface TushareNameChangePayload {
  code?: number;
  msg?: string;
  data?: {
    fields?: string[];
    items?: unknown[][];
  };
}

/** namechange 归一化记录（名称历史 + 有效区间；名称不进入 identifier history）。 */
export interface NameChangeRecord {
  /** 交易所。 */
  exchange: Exchange;
  /** 6 位数字代码。 */
  code: string;
  /** 完整 ts_code，如 600001.SH。 */
  tsCode: string;
  /** 该区间使用的证券名称。 */
  name: string;
  /** 名称生效起始日（YYYY-MM-DD），未知为 null。 */
  effectiveFrom: string | null;
  /** 名称失效日（YYYY-MM-DD），null = 至今有效。 */
  effectiveTo: string | null;
  /** 公告日。 */
  annDate: string | null;
  /** 变更原因（实测多为 "其他"）。 */
  changeReason: string;
}

/**
 * 解析 Tushare namechange 响应为归一化 NameChangeRecord[]（纯函数）。
 * 期望字段：ts_code,name（必需）；start_date,end_date,ann_date,change_reason（可选）。
 * 交易所取自 ts_code 后缀；无法解析交易所或代码的记录跳过。
 */
export function parseTushareNameChange(payload: TushareNameChangePayload): NameChangeRecord[] {
  if (payload.code !== 0) {
    throw new Error(`Tushare namechange 请求失败：${payload.msg || `错误码 ${payload.code ?? "未知"}`}`);
  }
  const fields = payload.data?.fields ?? [];
  const items = payload.data?.items ?? [];
  const indexByField = new Map(fields.map((field, index) => [field, index]));
  for (const field of ["ts_code", "name"]) {
    if (!indexByField.has(field)) throw new Error(`Tushare namechange 返回缺少字段：${field}`);
  }

  const get = (item: unknown[], field: string): unknown => {
    const index = indexByField.get(field);
    return index === undefined ? undefined : item[index];
  };

  const records: NameChangeRecord[] = [];
  for (const item of items) {
    const tsCode = String(get(item, "ts_code") ?? "").trim();
    let parsed;
    try {
      parsed = parseSecurityCode(tsCode);
    } catch {
      continue; // 无法解析 ts_code（非股票 / 异常代码）→ 跳过
    }
    records.push({
      exchange: parsed.exchange,
      code: parsed.digits,
      tsCode,
      name: String(get(item, "name") ?? "").trim(),
      effectiveFrom: toIsoDateOrNull(get(item, "start_date")),
      effectiveTo: toIsoDateOrNull(get(item, "end_date")),
      annDate: toIsoDateOrNull(get(item, "ann_date")),
      changeReason: String(get(item, "change_reason") ?? "").trim(),
    });
  }
  return records;
}

/** Tushare namechange Provider（单只股票，可能限频，由上层控制节奏）。 */
export class TushareNameChangeProvider {
  readonly name = "tushare-namechange";
  private readonly url: string;
  private readonly token: string | undefined;

  constructor(options?: { url?: string; token?: string }) {
    this.url = options?.url ?? "https://api.tushare.pro";
    this.token = options?.token ?? process.env.TUSHARE_TOKEN;
  }

  /**
   * 拉取某只股票的完整名称历史。
   * @param tsCode 完整代码（如 600001.SH）
   * @param startDate 可选起始日（YYYYMMDD）
   * @param endDate 可选结束日（YYYYMMDD）
   */
  async fetch(tsCode: string, startDate?: string, endDate?: string): Promise<NameChangeRecord[]> {
    if (!this.token) throw new Error("未配置 TUSHARE_TOKEN，无法拉取 namechange");
    const params: Record<string, string> = { ts_code: tsCode };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;

    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_name: "namechange",
        token: this.token,
        params,
        fields: "ts_code,name,start_date,end_date,ann_date,change_reason",
      }),
    });
    if (!response.ok) throw new Error(`Tushare namechange 网络请求失败：HTTP ${response.status}`);
    return parseTushareNameChange((await response.json()) as TushareNameChangePayload);
  }
}
