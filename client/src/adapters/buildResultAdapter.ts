/**
 * buildResultAdapter — Research Dataset 构建结果的 Frontend Adapter（任务 §17）。
 *
 * 后端 `researchDataset.build` 返回摘要，其中 `dataSnapshot` / `universeDefinition` /
 * `policySet` 在 shared 契约是 `unknown`（RPC 透传，无第二份口径）。本 adapter 把它们
 * **防御性解析**为前端 `BuildResultViewModel`，供 Build Summary / Source Validation /
 * Build Pipeline / Diagnostics 消费。
 *
 * 纪律：
 * - 只做「wire → 展示形态」边界转换，**不重算** gate / datasetVersion / PIT 判定；
 * - 所有派生字段（reason / pitStatus / dataReadyStatus / domain status / pipeline）
 *   严格来自后端返回事实（coverageGaps / gateNotes / domains / rowCount），
 *   **不臆造**「Filtered rows」等后端未提供的数据。
 */

import type { ResearchDatasetSummary } from "@shared/researchContracts";

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export type NodeStatus = "SUCCESS" | "WARNING" | "FAILED" | "SKIPPED";

export interface SourceDomainViewModel {
  domain: string;
  /** 人类可读标签（去域前缀，如 "OHLCV"）。 */
  label: string;
  status: NodeStatus;
  rowsLoaded: number | null;
  securitiesCovered: number | null;
  datesCovered: number | null;
  datesExpected: number | null;
  note: string;
}

export interface UniverseDayViewModel {
  tradeDate: string;
  isTradingDay: boolean;
  memberCount: number;
  excludedByReason: Record<string, number>;
}

export interface PolicyViewModel {
  policyId: string;
  name: string;
  description: string;
  value: unknown;
  evidence: string[];
}

export interface PipelineNodeViewModel {
  id: string;
  label: string;
  status: NodeStatus;
  detail: string;
  inputRows: number | null;
  outputRows: number | null;
}

export interface BuildResultViewModel {
  datasetVersion: string;
  gate: "FAIL" | "PASS" | "INCONCLUSIVE";
  gateNotes: string[];
  rowCount: number;

  // config echo
  startDate: string | null;
  endDate: string | null;
  asOfPerTradeDate: boolean | null;
  asOf: string | null;

  // calendar
  calendarName: string | null;
  tradingDays: number | null;
  capturedAt: string | null;

  // source
  domains: SourceDomainViewModel[];
  sourceRows: number;
  universeSize: number;
  coverageGaps: string[];

  // universe
  universeRule: string | null;
  universeAsOfDescription: string | null;
  universeDays: UniverseDayViewModel[];
  universeTotalMembers: number;

  // policy
  policies: PolicyViewModel[];

  // derived（honest，来自真实事实）
  reason: string | null;
  pitStatus: "PASS" | "FULL_KNOWLEDGE" | "UNKNOWN";
  dataReadyStatus: "PASS" | "FAIL" | "UNKNOWN";
  hasNoRows: boolean;
  pipeline: PipelineNodeViewModel[];
}

// ---------------------------------------------------------------------------
// 防御性取值
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

// ---------------------------------------------------------------------------
// 域状态派生（honest）
// ---------------------------------------------------------------------------

const PARTIAL_HINTS = [
  "部分覆盖",
  "PENDING",
  "未加载",
  "回填中",
  "未全量",
  "受限",
  "未完成",
];
const FULL_HINTS = ["FULL", "完整", "全量"];

function noteHas(note: string, hints: string[]): boolean {
  return hints.some(h => note.includes(h));
}

function domainStatus(d: SourceDomainViewModel): NodeStatus {
  if (d.rowsLoaded === null) return "SKIPPED";
  if (d.rowsLoaded === 0) return "FAILED";
  if (noteHas(d.note, PARTIAL_HINTS)) return "WARNING";
  if (noteHas(d.note, FULL_HINTS)) return "SUCCESS";
  // 日期覆盖缺口（loaded 但覆盖不足）
  if (
    d.datesCovered !== null &&
    d.datesExpected !== null &&
    d.datesCovered < d.datesExpected
  ) {
    return "WARNING";
  }
  return "SUCCESS";
}

const DOMAIN_LABELS: Record<string, string> = {
  "A OHLCV": "OHLCV",
  "B Master": "Master",
  "C Status": "Status",
  "D CA": "Corporate Actions",
  "E Liquidity": "Liquidity",
  "F Index": "Index",
  "G Industry": "Industry",
};

// ---------------------------------------------------------------------------
// 主解析
// ---------------------------------------------------------------------------

export function buildResultToViewModel(
  summary: ResearchDatasetSummary
): BuildResultViewModel {
  const snap = isRecord(summary.dataSnapshot) ? summary.dataSnapshot : {};
  const request = isRecord(snap.request) ? snap.request : {};
  const coverageGaps = Array.isArray(snap.coverageGaps)
    ? (snap.coverageGaps as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : [];

  const domains: SourceDomainViewModel[] = (
    Array.isArray(snap.domains) ? snap.domains : []
  ).map(d => {
    const r = isRecord(d) ? d : {};
    const domain = asStr(r.domain) ?? "?";
    return {
      domain,
      label: DOMAIN_LABELS[domain] ?? domain,
      status: "SUCCESS" as NodeStatus, // 占位，下一步统一计算
      rowsLoaded: asNum(r.rowsLoaded),
      securitiesCovered: asNum(r.securitiesCovered),
      datesCovered: asNum(r.datesCovered),
      datesExpected: asNum(r.datesExpected),
      note: asStr(r.note) ?? "",
    };
  });
  for (const d of domains) d.status = domainStatus(d);

  const sourceRows = domains.reduce((sum, d) => sum + (d.rowsLoaded ?? 0), 0);

  // universe
  const uni = isRecord(summary.universeDefinition)
    ? summary.universeDefinition
    : {};
  const universeDays: UniverseDayViewModel[] = (
    Array.isArray(uni.days) ? uni.days : []
  ).map(d => {
    const r = isRecord(d) ? d : {};
    const excl = isRecord(r.excludedByReason) ? r.excludedByReason : {};
    const excludedByReason: Record<string, number> = {};
    for (const [k, v] of Object.entries(excl)) {
      if (typeof v === "number") excludedByReason[k] = v;
    }
    const members = Array.isArray(r.members) ? r.members : [];
    return {
      tradeDate: asStr(r.tradeDate) ?? "?",
      isTradingDay: r.isTradingDay === true,
      memberCount: members.length,
      excludedByReason,
    };
  });
  const universeTotalMembers = universeDays.reduce(
    (sum, d) => sum + d.memberCount,
    0
  );

  // universe size（§9/§10 的 "Universe Size" = Master 证券数）
  const master = domains.find(d => d.domain === "B Master");
  const universeSize =
    master?.securitiesCovered ?? master?.rowsLoaded ?? universeTotalMembers;

  // policy
  const policies: PolicyViewModel[] = (
    Array.isArray(summary.policySet) ? summary.policySet : []
  ).map(p => {
    const r = isRecord(p) ? p : {};
    return {
      policyId: asStr(r.policyId) ?? "?",
      name: asStr(r.name) ?? "?",
      description: asStr(r.description) ?? "",
      value: r.value,
      evidence: (Array.isArray(r.evidence) ? r.evidence : []).filter(
        (x): x is string => typeof x === "string"
      ),
    };
  });

  // config echo
  const asOfPerTradeDate = asBool(request.asOfPerTradeDate);
  const startDate = asStr(request.startDate);
  const endDate = asStr(request.endDate);
  const asOf = asStr(request.asOf);

  // derived
  const gateNotes = [...summary.gateNotes];
  const notesText = gateNotes.join(" ");
  const hasNoRows = summary.rowCount === 0;

  let reason: string | null = null;
  if (coverageGaps.includes("NO_ROWS_BUILT")) reason = "NO_ROWS_BUILT";
  else if (coverageGaps.includes("DB_UNAVAILABLE_OR_EMPTY_CALENDAR"))
    reason = "DB_UNAVAILABLE";
  else if (notesText.includes("dataReady=false")) reason = "DATA_NOT_READY";
  else if (coverageGaps.length > 0) reason = "COVERAGE_GAPS";

  const pitStatus: BuildResultViewModel["pitStatus"] =
    asOfPerTradeDate === true
      ? "PASS"
      : asOfPerTradeDate === false
        ? "FULL_KNOWLEDGE"
        : "UNKNOWN";

  let dataReadyStatus: BuildResultViewModel["dataReadyStatus"] = "UNKNOWN";
  if (summary.gate === "PASS") dataReadyStatus = "PASS";
  else if (notesText.includes("dataReady=false")) dataReadyStatus = "FAIL";

  const pipeline = derivePipeline({
    domains,
    sourceRows,
    tradingDays: asNum(snap.tradingDays),
    asOfPerTradeDate,
    asOf,
    rowCount: summary.rowCount,
    hasNoRows,
    coverageGaps,
  });

  return {
    datasetVersion: summary.datasetVersion,
    gate: summary.gate,
    gateNotes,
    rowCount: summary.rowCount,
    startDate,
    endDate,
    asOfPerTradeDate,
    asOf,
    calendarName: asStr(snap.calendarName),
    tradingDays: asNum(snap.tradingDays),
    capturedAt: asStr(snap.capturedAt),
    domains,
    sourceRows,
    universeSize,
    coverageGaps,
    universeRule: asStr(uni.rule),
    universeAsOfDescription: asStr(uni.asOfDescription),
    universeDays,
    universeTotalMembers,
    policies,
    reason,
    pitStatus,
    dataReadyStatus,
    hasNoRows,
    pipeline,
  };
}

// ---------------------------------------------------------------------------
// Build Pipeline 派生（honest：只用后端真实字段，不臆造 Filtered rows）
// ---------------------------------------------------------------------------

function derivePipeline(input: {
  domains: SourceDomainViewModel[];
  sourceRows: number;
  tradingDays: number | null;
  asOfPerTradeDate: boolean | null;
  asOf: string | null;
  rowCount: number;
  hasNoRows: boolean;
  coverageGaps: string[];
}): PipelineNodeViewModel[] {
  const {
    domains,
    sourceRows,
    tradingDays,
    asOfPerTradeDate,
    asOf,
    rowCount,
    hasNoRows,
    coverageGaps,
  } = input;
  const domain = (key: string) => domains.find(d => d.domain === key);

  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());
  const nodes: PipelineNodeViewModel[] = [];

  // 1. Source（各域加载总量）
  nodes.push({
    id: "source",
    label: "Source",
    status: sourceRows > 0 ? "SUCCESS" : "FAILED",
    detail: `合计加载 ${fmt(sourceRows)} rows`,
    inputRows: null,
    outputRows: sourceRows > 0 ? sourceRows : null,
  });

  // 2. Universe
  const master = domain("B Master");
  nodes.push({
    id: "universe",
    label: "Universe",
    status: (master?.rowsLoaded ?? 0) > 0 ? "SUCCESS" : "FAILED",
    detail: `Master ${fmt(master?.rowsLoaded ?? 0)} 证券`,
    inputRows: null,
    outputRows: master?.rowsLoaded ?? null,
  });

  // 3. Trading Calendar
  const calStatus: NodeStatus =
    tradingDays === null ? "SKIPPED" : tradingDays > 0 ? "SUCCESS" : "FAILED";
  nodes.push({
    id: "calendar",
    label: "Trading Calendar",
    status: calStatus,
    detail: `${fmt(tradingDays)} 交易日`,
    inputRows: null,
    outputRows: tradingDays,
  });

  // 4. PIT（模式节点，无 rows）
  const pitLabel =
    asOfPerTradeDate === false
      ? `固定 asOf = ${asOf ?? "—"}`
      : "逐日 PIT（asOf = tradeDate）";
  nodes.push({
    id: "pit",
    label: "PIT",
    status:
      asOfPerTradeDate === true
        ? "SUCCESS"
        : asOfPerTradeDate === false
          ? "WARNING"
          : "SKIPPED",
    detail: pitLabel,
    inputRows: null,
    outputRows: null,
  });

  // 5~9. 各数据域（真实加载事实）
  const pipelineDomains: Array<[string, string]> = [
    ["A OHLCV", "OHLCV"],
    ["D CA", "Corporate Actions"],
    ["E Liquidity", "Liquidity"],
    ["F Index", "Index"],
    ["G Industry", "Industry"],
  ];
  for (const [key, label] of pipelineDomains) {
    const d = domain(key);
    if (!d) {
      nodes.push({
        id: key,
        label,
        status: "SKIPPED",
        detail: "未加载",
        inputRows: null,
        outputRows: null,
      });
      continue;
    }
    const cover =
      d.datesCovered !== null && d.datesExpected !== null
        ? ` · ${fmt(d.datesCovered)}/${fmt(d.datesExpected)} 日`
        : "";
    nodes.push({
      id: key,
      label,
      status: d.status,
      detail: `加载 ${fmt(d.rowsLoaded)} rows${cover}`,
      inputRows: d.rowsLoaded,
      outputRows: d.rowsLoaded,
    });
  }

  // 10. Final Dataset
  let finalStatus: NodeStatus;
  let finalDetail: string;
  if (hasNoRows && (tradingDays ?? 0) > 0) {
    finalStatus = coverageGaps.includes("NO_ROWS_BUILT") ? "WARNING" : "FAILED";
    finalDetail = "Output: 0 rows（NO_ROWS_BUILT）";
  } else if (rowCount > 0) {
    finalStatus = "SUCCESS";
    finalDetail = `Output: ${fmt(rowCount)} rows`;
  } else {
    finalStatus = "SKIPPED";
    finalDetail = "Output: 0 rows";
  }
  nodes.push({
    id: "final",
    label: "Final Dataset",
    status: finalStatus,
    detail: finalDetail,
    inputRows: sourceRows > 0 ? sourceRows : null,
    outputRows: rowCount,
  });

  return nodes;
}
