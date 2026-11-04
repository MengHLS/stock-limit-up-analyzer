/**
 * STEP 7.6 — AkShare SW Provider Adapter（Python bridge）。
 *
 * 申万一级行业 + 成分（当前快照）。
 * 铁律：AkShare SW 仅提供「当前」行业与成分快照，不提供历史成分有效期 → 历史行业归属
 * 无法由本 provider 直接获得，必须标记 CONDITIONAL GAP（不得用当前行业回填历史）。
 */

import type { SecurityId } from "../types";
import type { HistoricalIndustryCoverage, IndustryListItem, IndustryMemberRow, IndustryProvider } from "./types";
import { normalizeStockCode } from "../../stockIdentity";
import { runPythonScript } from "./pythonBridge";

export interface AkShareSwIndustryRow {
  industry_code: string;
  industry_name: string;
}

export interface AkShareSwMemberRow {
  code: string;
  name: string;
}

/** 解析申万一级行业列表。 */
export function parseAkShareSwIndustries(rows: readonly AkShareSwIndustryRow[]): IndustryListItem[] {
  return rows
    .filter((row) => row.industry_code && row.industry_name)
    .map((row) => ({ industryCode: row.industry_code, industryName: row.industry_name }));
}

/** 解析行业成分（6 位代码 → 规范化 "002361.SZ"）。非法代码跳过（不抛错，避免单条脏数据阻断整批）。 */
export function parseAkShareSwMembers(rows: readonly AkShareSwMemberRow[]): IndustryMemberRow[] {
  const result: IndustryMemberRow[] = [];
  for (const row of rows) {
    try {
      result.push({ securityId: normalizeStockCode(row.code), securityName: row.name });
    } catch {
      // 跳过无法规范化的代码
    }
  }
  return result;
}

/** 获取申万一级行业列表（当前）。 */
export async function fetchAkShareSwIndustries(): Promise<IndustryListItem[]> {
  const stdout = await runPythonScript("akshare_sw_probe.py", ["industries"], "MARKETDATA_PYTHON");
  return parseAkShareSwIndustries(JSON.parse(stdout) as AkShareSwIndustryRow[]);
}

/** 获取某行业当前成分（非历史）。 */
export async function fetchAkShareSwMembers(industryCode: string): Promise<IndustryMemberRow[]> {
  const stdout = await runPythonScript("akshare_sw_probe.py", ["members", industryCode], "MARKETDATA_PYTHON");
  return parseAkShareSwMembers(JSON.parse(stdout) as AkShareSwMemberRow[]);
}

const AKSHARE_SW_HISTORICAL_COVERAGE: HistoricalIndustryCoverage = {
  historicalMembersAvailable: false,
  note: "AkShare SW 仅提供当前行业成分快照，无历史成分有效期；历史行业归属需另寻来源或标记 CONDITIONAL GAP",
};

/** AkShare SW 行业 adapter。 */
export const akShareSwIndustryProvider: IndustryProvider = {
  name: "akshare-sw",
  fetchIndustries: fetchAkShareSwIndustries,
  fetchMembers: fetchAkShareSwMembers,
  historicalCoverage: () => AKSHARE_SW_HISTORICAL_COVERAGE,
};

export type { SecurityId };
