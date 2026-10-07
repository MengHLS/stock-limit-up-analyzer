/**
 * PATTERN-DISCOVERY-REGULATION-001 — CNINFO（巨潮资讯）公告只读客户端。
 *
 * 只抓取公开公告元数据，不写数据库，不修改公告源。
 * PIT 注意：CNINFO announcementTime 当前表现为日期级时间戳，不能证明公告是在盘前、盘中或盘后发布。
 */

import type { CninfoAnnouncement } from "./types";

const CNINFO_BASE = "http://www.cninfo.com.cn/new";
const STATIC_BASE = "http://static.cninfo.com.cn/";

interface CninfoRawAnnouncement {
  announcementId?: string | null;
  secCode?: string | null;
  secName?: string | null;
  announcementTitle?: string | null;
  announcementTime?: number | null;
  adjunctUrl?: string | null;
  announcementType?: string | null;
  columnId?: string | null;
  pageColumn?: string | null;
}

interface CninfoSearchRow {
  code?: string;
  orgId?: string;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

/** CNINFO 时间戳按 Asia/Shanghai 自然日解释，不能按 UTC 日期截断。 */
export function cninfoTimestampToDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

async function postJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(`${CNINFO_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "stock-limit-up-analyzer/pattern-discovery-regulation-001",
      Referer: "http://www.cninfo.com.cn/",
    },
    body: new URLSearchParams(params),
  });
  if (!response.ok) throw new Error(`CNINFO ${path} HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function resolveCninfoOrgId(stockCode: string): Promise<string | null> {
  const plain = stockCode.replace(/\.(SH|SZ|BJ)$/i, "");
  const rows = await postJson<CninfoSearchRow[]>("/information/topSearch/query", {
    keyWord: plain,
    maxNum: "10",
  });
  if (!Array.isArray(rows)) return null;
  return rows.find((row) => row.code === plain)?.orgId ?? null;
}

export interface FetchCninfoAnnouncementsInput {
  stockCode: string;
  startDate: string;
  endDate: string;
  sourceTimestamp?: string;
  pageSize?: number;
}

export async function fetchCninfoAnnouncements(
  input: FetchCninfoAnnouncementsInput,
): Promise<CninfoAnnouncement[]> {
  const plain = input.stockCode.replace(/\.(SH|SZ|BJ)$/i, "");
  const orgId = await resolveCninfoOrgId(input.stockCode);
  if (!orgId) return [];
  const sourceTimestamp = input.sourceTimestamp ?? new Date().toISOString();
  const json = await postJson<{ announcements?: CninfoRawAnnouncement[] }>("/hisAnnouncement/query", {
    pageNum: "1",
    pageSize: String(input.pageSize ?? 100),
    column: "szse",
    tabName: "fulltext",
    plate: "",
    stock: `${plain},${orgId}`,
    searchkey: "",
    secid: "",
    category: "",
    trade: "",
    seDate: `${input.startDate}~${input.endDate}`,
    isHLtitle: "true",
  });
  return (json.announcements ?? [])
    .filter((row) => row.secCode && row.announcementTitle && row.announcementTime)
    .map((row) => {
      const suffix = input.stockCode.endsWith(".SH") ? "SH" : input.stockCode.endsWith(".SZ") ? "SZ" : "BJ";
      return {
        announcementId: String(row.announcementId ?? ""),
        stockCode: `${String(row.secCode)}.${suffix}`,
        stockName: stripHtml(String(row.secName ?? "")),
        title: stripHtml(String(row.announcementTitle ?? "")),
        announcementDate: cninfoTimestampToDate(Number(row.announcementTime)),
        announcementTime: Number(row.announcementTime),
        announcementType: row.announcementType ?? null,
        columnId: row.columnId ?? null,
        pageColumn: row.pageColumn ?? null,
        pdfUrl: row.adjunctUrl ? `${STATIC_BASE}${row.adjunctUrl}` : null,
        source: "cninfo",
        sourceTimestamp,
      };
    });
}