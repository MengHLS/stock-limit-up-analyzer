/**
 * STEP 12.6 — Research Dataset 策略一致性校验（C-12.6.2）：纯函数、确定性、无 IO。
 *
 * validateResearchDatasetPolicyConsistency(ctx) 对一个「built dataset」的
 *   request / universeDefinition / dataSnapshot / rows / policySet 做四层核对：
 *   1. 9 类齐备性：缺失 / 重复 / 未知 / class 不符 / 顺序错；
 *   2. value shape：键白名单 + 值域（机器可读结构合法性）；
 *   3. 声明值 vs 期望值：每类以 canonical JSON 相等性与「由 request/dataSnapshot 派生的
 *      权威口径」核对（防声明被篡改 / 与数据集语义脱钩）；
 *   4. 交叉语义：request 级 asOf 完备性、PIT 声明 vs universeDefinition.asOfDescription、
 *      行级 asOf 与 mode 的一致性、knowledge 行级模式、universe 行覆盖、日历窗口、快照请求。
 *
 * 诚实边界（与 policy.ts 头注释一致）：survivorship/industry/liquidity/corporate-action/
 *   universe-membership 的 value 是「上游层口径声明」，无法仅从 rows/universe/snapshot 重新观测，
 *   故以 canonical 期望值相等性约束其必须等于本数据集 schema 的权威口径（防止被改写成矛盾声明）。
 *
 * 确定性：同输入必同 issue 列表（code 升序、message 确定）；空壳（days=[] 且 rows=[]）不误报。
 */

import { canonicalStringify } from "./version";
import { deriveExpectedPolicyValue, RESEARCH_DATASET_POLICY_ORDER } from "./policy";
import type {
  ResearchDatasetPolicy,
  ResearchDatasetPolicyId,
  ResearchDatasetPolicySet,
} from "./policy";
import { indexPolicyById } from "./policy";
import type {
  DataSnapshot,
  NormalizedResearchDatasetRequest,
  ResearchDatasetRow,
  UniverseDefinition,
} from "./types";

/** 一致性校验入参（built dataset 的四要素 + 声明的 policySet）。 */
export interface PolicyConsistencyContext {
  request: NormalizedResearchDatasetRequest;
  universeDefinition: UniverseDefinition;
  dataSnapshot: DataSnapshot;
  rows: readonly ResearchDatasetRow[];
  policySet: ResearchDatasetPolicySet;
}

/** 一致性校验问题（code 稳定，message 确定性可审计）。 */
export interface PolicyConsistencyIssue {
  code: string;
  message: string;
}

function issue(code: string, message: string): PolicyConsistencyIssue {
  return { code, message };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const EXPECTED_IDS: readonly ResearchDatasetPolicyId[] = [...RESEARCH_DATASET_POLICY_ORDER];
const EXPECTED_ID_SET: ReadonlySet<string> = new Set(EXPECTED_IDS);

/** 声明 policy 是否为某 id（运行时收窄宽联合 value 用）。 */
function valueOf(policy: ResearchDatasetPolicy | undefined): unknown {
  return policy?.value;
}

// ---------------------------------------------------------------------------
// 1. 9 类齐备性
// ---------------------------------------------------------------------------

function collectCompletenessIssues(policySet: ResearchDatasetPolicySet): PolicyConsistencyIssue[] {
  const out: PolicyConsistencyIssue[] = [];
  const seen = new Map<ResearchDatasetPolicyId, number>();
  for (const policy of policySet) {
    const id = policy.policyId;
    if (!EXPECTED_ID_SET.has(id)) {
      out.push(issue("POLICY_UNKNOWN_ID", `policySet 含未知 policyId：${id}`));
      continue;
    }
    if (policy.class !== id) {
      out.push(issue("POLICY_CLASS_MISMATCH", `policy ${id} 的 class(${policy.class}) 与 policyId 不一致`));
    }
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, count] of Array.from(seen.entries())) {
    if (count > 1) out.push(issue("POLICY_DUPLICATE", `policy ${id} 重复出现 ${count} 次（每类只允许单实例）`));
  }
  for (const id of EXPECTED_IDS) {
    if (!seen.has(id)) out.push(issue("POLICY_MISSING", `policySet 缺少 §12 要求策略：${id}`));
  }
  const declaredOrder = policySet.filter((p) => EXPECTED_ID_SET.has(p.policyId)).map((p) => p.policyId);
  if (declaredOrder.length === EXPECTED_IDS.length) {
    for (let i = 0; i < EXPECTED_IDS.length; i += 1) {
      if (declaredOrder[i] !== EXPECTED_IDS[i]) {
        out.push(
          issue(
            "POLICY_ORDER_INVALID",
            `policySet 顺序非法：期望 ${EXPECTED_IDS.join(",")}，实际 ${declaredOrder.join(",")}`,
          ),
        );
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. value shape（键白名单 + 值域）
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length) {
    return `键集合不合法（期望 {${expected.join(",")}}，实际 {${actual.join(",")}}）`;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) {
      return `键集合不合法（期望 {${expected.join(",")}}，实际 {${actual.join(",")}}）`;
    }
  }
  return null;
}

function typeError(label: string, ok: boolean): string | null {
  return ok ? null : `${label} 类型非法`;
}

/** 单条 policy 的 value shape 校验；非法返回描述字符串，合法返回 null。 */
function valueShapeError(policy: ResearchDatasetPolicy): string | null {
  const { policyId, value } = policy;
  if (!isRecord(value)) return `policy ${policyId} 的 value 必须是对象`;

  switch (policyId) {
    case "pit": {
      const keys = exactKeys(value, ["asOf", "mode"]);
      if (keys !== null) return keys;
      const mode = value.mode;
      if (mode !== "asOfPerTradeDate" && mode !== "fixed") return `mode 非法：${String(mode)}`;
      if (value.asOf !== null && typeError("asOf", typeof value.asOf === "string") !== null) {
        return `asOf 非法：${String(value.asOf)}`;
      }
      if (mode === "fixed" && value.asOf === null) return null; // 语义缺 asOf 由 MISSING_AS_OF 报
      if (mode === "asOfPerTradeDate" && value.asOf !== null) return null; // 语义冲突由 PIT_MODE_REQUEST_CONFLICT 报
      return null;
    }
    case "survivorship": {
      const keys = exactKeys(value, [
        "delistedNotRenderedAsEligibleRows",
        "masterIncludesDelistedSecurities",
        "membershipIsPointInTime",
      ]);
      if (keys !== null) return keys;
      for (const key of Object.keys(value)) {
        if (typeof value[key] !== "boolean") return `${key} 类型非法`;
      }
      return null;
    }
    case "corporate-action": {
      const keys = exactKeys(value, [
        "effectiveLayerRule",
        "knownLayerRule",
        "missingAnnouncementDateRule",
        "mode",
      ]);
      if (keys !== null) return keys;
      if (typeof value.effectiveLayerRule !== "string") return "effectiveLayerRule 类型非法";
      if (typeof value.knownLayerRule !== "string") return "knownLayerRule 类型非法";
      if (typeof value.missingAnnouncementDateRule !== "string") return "missingAnnouncementDateRule 类型非法";
      if (value.mode !== "PIT" && value.mode !== "FULL_KNOWLEDGE") return `mode 非法：${String(value.mode)}`;
      return null;
    }
    case "adjustment": {
      const keys = exactKeys(value, ["corporateActionAdjustmentIntoPrice", "priceBasis", "priceFields"]);
      if (keys !== null) return keys;
      if (value.priceBasis !== "raw" && value.priceBasis !== "adjusted") {
        return `priceBasis 非法：${String(value.priceBasis)}`;
      }
      if (!Array.isArray(value.priceFields) || value.priceFields.some((f) => typeof f !== "string")) {
        return "priceFields 类型非法（需 string[]）";
      }
      if (typeof value.corporateActionAdjustmentIntoPrice !== "boolean") {
        return "corporateActionAdjustmentIntoPrice 类型非法";
      }
      return null;
    }
    case "industry": {
      const keys = exactKeys(value, ["codeOwnership", "missing", "pointInTimeFilter"]);
      if (keys !== null) return keys;
      for (const key of Object.keys(value)) {
        if (typeof value[key] !== "string") return `${key} 类型非法`;
      }
      return null;
    }
    case "liquidity": {
      const keys = exactKeys(value, ["closingKnown", "granularity", "missing"]);
      if (keys !== null) return keys;
      if (typeof value.granularity !== "string") return "granularity 类型非法";
      if (typeof value.missing !== "string") return "missing 类型非法";
      if (typeof value.closingKnown !== "boolean") return "closingKnown 类型非法";
      return null;
    }
    case "universe-membership": {
      const keys = exactKeys(value, [
        "defaultOnUnknown",
        "includeExcluded",
        "membershipPerTradingDay",
        "resolver",
        "sortOrder",
      ]);
      if (keys !== null) return keys;
      if (typeof value.resolver !== "string") return "resolver 类型非法";
      if (typeof value.sortOrder !== "string") return "sortOrder 类型非法";
      if (typeof value.defaultOnUnknown !== "string") return "defaultOnUnknown 类型非法";
      if (typeof value.includeExcluded !== "boolean") return "includeExcluded 类型非法";
      if (typeof value.membershipPerTradingDay !== "boolean") return "membershipPerTradingDay 类型非法";
      return null;
    }
    case "calendar-trading-days": {
      const keys = exactKeys(value, ["calendarName", "tPlusOneAvailabilitySemantics", "tradingDayCount", "windowRule"]);
      if (keys !== null) return keys;
      if (typeof value.calendarName !== "string") return "calendarName 类型非法";
      if (typeof value.windowRule !== "string") return "windowRule 类型非法";
      if (typeof value.tradingDayCount !== "number") return "tradingDayCount 类型非法";
      if (typeof value.tPlusOneAvailabilitySemantics !== "boolean") return "tPlusOneAvailabilitySemantics 类型非法";
      return null;
    }
    case "knowledge": {
      const keys = exactKeys(value, ["asOfRequired", "dimensions", "mode"]);
      if (keys !== null) return keys;
      if (value.mode !== "PIT" && value.mode !== "FULL_KNOWLEDGE") return `mode 非法：${String(value.mode)}`;
      if (typeof value.asOfRequired !== "boolean") return "asOfRequired 类型非法";
      if (!Array.isArray(value.dimensions) || value.dimensions.some((d) => typeof d !== "string")) {
        return "dimensions 类型非法（需 string[]）";
      }
      return null;
    }
  }
}

function collectShapeIssues(policySet: ResearchDatasetPolicySet): PolicyConsistencyIssue[] {
  const out: PolicyConsistencyIssue[] = [];
  for (const policy of policySet) {
    const error = valueShapeError(policy);
    if (error !== null) {
      out.push(issue("POLICY_VALUE_SHAPE", `policy ${policy.policyId} value 非法：${error}`));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 声明值 vs 期望值（canonical 相等性）
// ---------------------------------------------------------------------------

const VALUE_CONFLICT_CODE_BY_ID: Readonly<Record<ResearchDatasetPolicyId, string>> = {
  pit: "PIT_VALUE_CONFLICT",
  survivorship: "POLICY_VALUE_CONFLICT",
  "corporate-action": "POLICY_VALUE_CONFLICT",
  adjustment: "ADJUSTMENT_BASIS_MISMATCH",
  industry: "POLICY_VALUE_CONFLICT",
  liquidity: "POLICY_VALUE_CONFLICT",
  "universe-membership": "POLICY_VALUE_CONFLICT",
  "calendar-trading-days": "CALENDAR_VALUE_CONFLICT",
  knowledge: "KNOWLEDGE_VALUE_CONFLICT",
};

function collectValueConflictIssues(
  request: NormalizedResearchDatasetRequest,
  dataSnapshot: DataSnapshot,
  policySet: ResearchDatasetPolicySet,
): PolicyConsistencyIssue[] {
  const byId = indexPolicyById(policySet);
  const out: PolicyConsistencyIssue[] = [];
  for (const id of EXPECTED_IDS) {
    const declared = byId.get(id);
    if (declared === undefined) continue; // 缺失已由 POLICY_MISSING 报
    const expected = deriveExpectedPolicyValue(id, request, dataSnapshot);
    const declaredCanonical = canonicalStringify(declared.value);
    const expectedCanonical = canonicalStringify(expected);
    if (declaredCanonical !== expectedCanonical) {
      out.push(
        issue(
          VALUE_CONFLICT_CODE_BY_ID[id],
          `policy ${id} 声明值与数据集实际口径冲突（声明=${declaredCanonical}，期望=${expectedCanonical}）`,
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. 交叉语义
// ---------------------------------------------------------------------------

function collectRequestAsOfIssues(
  request: NormalizedResearchDatasetRequest,
  policySet: ResearchDatasetPolicySet,
): PolicyConsistencyIssue[] {
  const out: PolicyConsistencyIssue[] = [];
  if (!request.asOfPerTradeDate && request.asOf === null) {
    out.push(
      issue(
        "MISSING_AS_OF",
        "asOfPerTradeDate=false 但未提供 asOf 固定快照日期（逐行无法确定 PIT 截止点，dataset 语义不完备）",
      ),
    );
  }
  const pit = indexPolicyById(policySet).get("pit");
  if (pit !== undefined) {
    const value = valueOf(pit);
    const mode = isRecord(value) ? value.mode : undefined;
    const asOf = isRecord(value) ? value.asOf : undefined;
    if (mode === "fixed" && asOf === null) {
      out.push(issue("MISSING_AS_OF", "pit policy 声明 mode=fixed 但 asOf=null（固定快照必须给出冻结日期）"));
    }
    if (mode === "fixed" && request.asOfPerTradeDate) {
      out.push(
        issue(
          "PIT_MODE_REQUEST_CONFLICT",
          "pit policy 声明 mode=fixed，但请求 asOfPerTradeDate=true（逐日 PIT 由 tradeDate 决定，不允许固定 asOf）",
        ),
      );
    }
    if (mode === "asOfPerTradeDate" && !request.asOfPerTradeDate) {
      out.push(
        issue(
          "PIT_MODE_REQUEST_CONFLICT",
          "pit policy 声明 mode=asOfPerTradeDate，但请求 asOfPerTradeDate=false（应声明 mode=fixed）",
        ),
      );
    }
    if (mode === "fixed" && typeof asOf === "string" && asOf !== request.asOf) {
      out.push(
        issue(
          "PIT_ASOF_REQUEST_CONFLICT",
          `pit policy 声明 asOf=${asOf} 与请求 asOf(${request.asOf ?? "null"}) 不一致`,
        ),
      );
    }
  }
  return out;
}

function collectPitUniverseIssues(
  universeDefinition: UniverseDefinition,
  policySet: ResearchDatasetPolicySet,
): PolicyConsistencyIssue[] {
  const out: PolicyConsistencyIssue[] = [];
  if (universeDefinition.days.length === 0) return out; // 空壳跳过
  const pit = indexPolicyById(policySet).get("pit");
  if (pit === undefined) return out;
  const value = valueOf(pit);
  if (!isRecord(value)) return out;
  const mode = value.mode;
  if (mode !== "asOfPerTradeDate" && mode !== "fixed") return out;
  const expectedPrefix = mode === "asOfPerTradeDate" ? "逐日 PIT" : `固定快照 asOf = ${value.asOf ?? "null"}`;
  if (!universeDefinition.asOfDescription.startsWith(expectedPrefix)) {
    out.push(
      issue(
        "PIT_MODE_UNIVERSE_MISMATCH",
        `PIT 声明(mode=${mode}) 与 universeDefinition.asOfDescription 不符：声明前缀应为「${expectedPrefix}」，` +
          `实际为「${universeDefinition.asOfDescription}」`,
      ),
    );
  }
  return out;
}

function collectRowPitIssues(
  request: NormalizedResearchDatasetRequest,
  rows: readonly ResearchDatasetRow[],
  policySet: ResearchDatasetPolicySet,
): PolicyConsistencyIssue[] {
  const out: PolicyConsistencyIssue[] = [];
  if (rows.length === 0) return out;
  const pit = indexPolicyById(policySet).get("pit");
  if (pit === undefined) return out;
  const value = valueOf(pit);
  if (!isRecord(value)) return out;
  const mode = value.mode;
  if (mode === "asOfPerTradeDate") {
    const first = rows.find((row) => row.asOf !== row.tradeDate);
    if (first !== undefined) {
      out.push(
        issue(
          "PIT_ROW_ASOF_MISMATCH",
          `逐日 PIT 声明下存在 asOf≠tradeDate 的行（${first.securityId} @ ${first.tradeDate} asOf=${first.asOf}）`,
        ),
      );
    }
  } else if (mode === "fixed") {
    const expectedAsOf = request.asOf;
    const first = rows.find((row) => row.asOf !== expectedAsOf);
    if (first !== undefined) {
      out.push(
        issue(
          "PIT_ROW_ASOF_MISMATCH",
          `固定快照声明下存在 asOf≠请求 asOf(${expectedAsOf ?? "null"}) 的行（${first.securityId} @ ${first.tradeDate} asOf=${first.asOf}）`,
        ),
      );
    }
  }
  const fullKnowledgeRow = rows.find((row) => row.knowledge.policy === "FULL_KNOWLEDGE");
  if (fullKnowledgeRow !== undefined) {
    out.push(
      issue(
        "KNOWLEDGE_ROW_FULL_KNOWLEDGE",
        `存在 knowledge.policy=FULL_KNOWLEDGE 的行（${fullKnowledgeRow.securityId} @ ${fullKnowledgeRow.tradeDate}）——` +
          `research dataset 行必须以 PIT 口径构建（全知视角仅供调试，见 reconstruct.ts）`,
      ),
    );
  }
  return out;
}

function collectUniverseCoverageIssues(
  request: NormalizedResearchDatasetRequest,
  universeDefinition: UniverseDefinition,
  dataSnapshot: DataSnapshot,
  rows: readonly ResearchDatasetRow[],
): PolicyConsistencyIssue[] {
  const out: PolicyConsistencyIssue[] = [];

  if (dataSnapshot.tradingDays !== universeDefinition.days.length) {
    out.push(
      issue(
        "CALENDAR_DAY_COUNT_MISMATCH",
        `dataSnapshot.tradingDays(${dataSnapshot.tradingDays}) ≠ universeDefinition.days(${universeDefinition.days.length})`,
      ),
    );
  }

  const dayDates = new Set(universeDefinition.days.map((day) => day.tradeDate));
  for (const day of universeDefinition.days) {
    if (day.tradeDate < request.startDate || day.tradeDate > request.endDate) {
      out.push(
        issue("UNIVERSE_DAYS_OUTSIDE_WINDOW", `universe 交易日 ${day.tradeDate} 超出请求窗口 [${request.startDate}, ${request.endDate}]`),
      );
    }
  }
  for (let i = 1; i < universeDefinition.days.length; i += 1) {
    const prev = universeDefinition.days[i - 1]!.tradeDate;
    const curr = universeDefinition.days[i]!.tradeDate;
    if (curr <= prev) {
      out.push(issue("UNIVERSE_DAYS_ORDER_INVALID", `universe 交易日未严格升序/去重：${prev} → ${curr}`));
    }
  }

  const rowsByDate = new Map<string, ResearchDatasetRow[]>();
  for (const row of rows) {
    const list = rowsByDate.get(row.tradeDate) ?? [];
    list.push(row);
    rowsByDate.set(row.tradeDate, list);
  }
  for (const [tradeDate, dayRows] of Array.from(rowsByDate.entries())) {
    if (!dayDates.has(tradeDate)) {
      out.push(issue("ROW_TRADE_DATE_ORPHAN", `存在 tradeDate=${tradeDate} 的行不在 universeDefinition.days 中`));
      continue;
    }
    const day = universeDefinition.days.find((d) => d.tradeDate === tradeDate);
    if (day === undefined) continue;
    const memberSet = new Set(day.members);
    const bad = dayRows.find((row) => !memberSet.has(row.securityId) || !row.eligible || row.exclusionReason !== null);
    if (bad !== undefined) {
      out.push(
        issue(
          "UNIVERSE_ROW_COVERAGE_MISMATCH",
          `行 ${bad.securityId} @ ${tradeDate} 与 universe 决议不符（非成员/eligible=false/带 exclusionReason 的行不应出现）`,
        ),
      );
    }
  }
  return out;
}

function collectSnapshotRequestIssues(
  request: NormalizedResearchDatasetRequest,
  dataSnapshot: DataSnapshot,
): PolicyConsistencyIssue[] {
  if (canonicalStringify(dataSnapshot.request) !== canonicalStringify(request)) {
    return [
      issue("SNAPSHOT_REQUEST_MISMATCH", "dataSnapshot.request 与构建请求（规范化）不一致"),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 校验 built dataset 的 policySet 与 request/universeDefinition/dataSnapshot/rows 的一致性。
 * 纯函数、确定性；返回 [] 表示 9 类齐备且与数据集语义无冲突。
 */
export function validateResearchDatasetPolicyConsistency(
  ctx: PolicyConsistencyContext,
): PolicyConsistencyIssue[] {
  const issues: PolicyConsistencyIssue[] = [
    ...collectCompletenessIssues(ctx.policySet),
    ...collectShapeIssues(ctx.policySet),
    ...collectValueConflictIssues(ctx.request, ctx.dataSnapshot, ctx.policySet),
    ...collectRequestAsOfIssues(ctx.request, ctx.policySet),
    ...collectPitUniverseIssues(ctx.universeDefinition, ctx.policySet),
    ...collectRowPitIssues(ctx.request, ctx.rows, ctx.policySet),
    ...collectUniverseCoverageIssues(ctx.request, ctx.universeDefinition, ctx.dataSnapshot, ctx.rows),
    ...collectSnapshotRequestIssues(ctx.request, ctx.dataSnapshot),
  ];
  return issues
    .slice()
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : 1));
}
