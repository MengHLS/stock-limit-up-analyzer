/**
 * FE-1 — 数据域健康看板 服务端数据源（STEP 12 · A~G 域 + gate 认证证据）。
 *
 * 纪律（§0.2 证据优先级 / §27 Frontend Audit / §31 禁止项）：
 * - **只读真实证据**：一切判定来自 `docs/researchReadyGate/research_ready_gate.json`
 *   （由 `scripts/step12_certify_gate.mjs` 只读 TiDB 生成）。本模块**不重新计算 gate 判定**，
 *   只做「读取 → schema 校验 → 派生展示字段（域聚合/覆盖率/陈旧度）」；
 * - **不粉饰**：FAIL / PENDING 原样透传；文件缺失或 schema 不匹配 → 返回 `parseError`，
 *   **绝不构造一份「看起来正常」的假 gate**；
 * - **认证态 vs 实况态分离**：`readCertifiedGate()` 为认证快照（可复现，带 capturedAt）；
 *   `queryLiveCounts()` 为未认证实况（查库观察回填进度），二者不得互相冒充。
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getDb } from "./db";
import { sql } from "drizzle-orm";
import {
  type Coverage,
  type DataDomain,
  type DataHealthOverview,
  type DomainHealth,
  type EvidenceArtifact,
  type GateCheck,
  type GateStatus,
  type LiveTableCount,
  type ResearchReadyGateFile,
  researchReadyGateFileSchema,
} from "../shared/dataHealthContracts";

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

const EVIDENCE_REL_DIR = "docs/researchReadyGate";
const AUDIT_REL_DIR = "docs/audit";

/**
 * 定位仓库根：优先用模块所在目录上溯（开发/测试稳定），
 * 再退化为 cwd（打包后 `import.meta.dirname` 可能不可用）。
 */
function resolveProjectRoot(): string {
  const candidates: string[] = [];
  const modDir = (import.meta as { dirname?: string }).dirname;
  if (modDir) candidates.push(resolve(modDir, ".."));
  candidates.push(process.cwd());
  for (const c of candidates) {
    if (existsSync(join(c, EVIDENCE_REL_DIR))) return c;
  }
  return candidates[0] ?? process.cwd();
}

const PROJECT_ROOT = resolveProjectRoot();

/** 认证 gate 证据文件（唯一权威判定来源）。 */
export const GATE_EVIDENCE_PATH = join(EVIDENCE_REL_DIR, "research_ready_gate.json");

// ---------------------------------------------------------------------------
// 域 → gate 项 映射（单一来源，前端不得另有口径）
// ---------------------------------------------------------------------------

type CoverageSource = {
  checkId: number;
  currentKey: string;
  targetKey: string;
  unit: string;
  /** 可选：脚本已算好的百分比字段（如 OHLCV 的 coveragePct）。 */
  pctKey?: string;
};

type DomainSpec = {
  label: string;
  tables: string[];
  checkIds: number[];
  /** 覆盖率取所有来源中**最差**的一个（保守口径，不取平均、不取最好）。 */
  coverageSources: CoverageSource[];
};

export const DOMAIN_SPEC: Record<DataDomain, DomainSpec> = {
  A: {
    label: "OHLCV 日线",
    tables: ["stock_daily_prices", "backfill_checkpoints"],
    checkIds: [3],
    coverageSources: [
      {
        checkId: 3,
        currentKey: "distinctTradeDates",
        targetKey: "distinctTradeDates",
        unit: "交易日",
        pctKey: "coveragePct",
      },
    ],
  },
  B: {
    label: "证券主数据 + 标识历史",
    tables: ["research_securities", "research_security_identifier_history"],
    checkIds: [4, 5],
    coverageSources: [{ checkId: 4, currentKey: "rows", targetKey: "rows", unit: "证券" }],
  },
  C: {
    label: "历史状态（ST / 停牌）",
    tables: ["research_security_status_history"],
    checkIds: [6],
    coverageSources: [
      {
        checkId: 6,
        currentKey: "distinctSecurityIds",
        targetKey: "distinctSecurityIds",
        unit: "证券",
      },
    ],
  },
  D: {
    label: "公司行为 + 复权因子",
    tables: ["corporate_actions", "adjustment_factors"],
    checkIds: [10, 11],
    coverageSources: [
      {
        checkId: 10,
        currentKey: "distinctSecurities",
        targetKey: "distinctSecurities",
        unit: "证券（CA）",
      },
      {
        checkId: 11,
        currentKey: "distinctSecurities",
        targetKey: "distinctSecurities",
        unit: "证券（复权）",
      },
    ],
  },
  E: {
    label: "流动性",
    tables: ["liquidity_daily"],
    checkIds: [9],
    coverageSources: [
      {
        checkId: 9,
        currentKey: "distinctSecurities",
        targetKey: "distinctSecurities",
        unit: "证券",
      },
    ],
  },
  F: {
    label: "指数（日历 + 日线）",
    tables: ["index_master", "index_daily"],
    checkIds: [8],
    coverageSources: [
      {
        checkId: 8,
        currentKey: "minDaysPerIndex",
        targetKey: "minDaysPerIndex",
        unit: "交易日/指数",
      },
    ],
  },
  G: {
    label: "行业归属",
    tables: ["industry_assignments"],
    checkIds: [7],
    coverageSources: [
      {
        checkId: 7,
        currentKey: "distinctSecurities",
        targetKey: "distinctSecurities",
        unit: "证券",
      },
    ],
  },
};

/** 跨域 gate 项（不属于任何单一数据域）：迁移台账/日历/历史 universe/PIT/存活者偏差/数据质量/阻塞/可复现。 */
export const CROSS_CUTTING_CHECK_IDS = [1, 2, 12, 13, 14, 15, 16, 17];

/** 域状态派生：含 FAIL→FAIL；含 PENDING→PENDING；无对应项→PENDING（口径漂移，保守）。 */
function deriveStatus(statuses: GateStatus[]): GateStatus {
  if (statuses.length === 0) return "PENDING";
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("PENDING")) return "PENDING";
  return "PASS";
}

function toNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 从某项 check 的 current/threshold 取覆盖率（缺失 → 全 null，不臆造）。 */
function coverageFrom(
  check: GateCheck | undefined,
  src: CoverageSource,
): Coverage & { pct: number | null } {
  if (!check) return { current: null, target: null, unit: src.unit, pct: null };
  const current = toNumber(check.current?.[src.currentKey]) ;
  const target = toNumber(check.threshold?.[src.targetKey]);
  const declaredPct = src.pctKey ? toNumber(check.current?.[src.pctKey]) : null;
  let pct: number | null = declaredPct;
  if (pct === null && current !== null && target !== null && target > 0) {
    pct = Math.min(100, (current / target) * 100);
  }
  return { current, target, unit: src.unit, pct };
}

/** 派生 A~G 域健康度。 */
export function deriveDomains(gate: ResearchReadyGateFile): DomainHealth[] {
  const byId = new Map(gate.checks.map((c) => [c.id, c]));
  return (Object.keys(DOMAIN_SPEC) as DataDomain[]).map((domain) => {
    const spec = DOMAIN_SPEC[domain];
    const checks = spec.checkIds
      .map((id) => byId.get(id))
      .filter((c): c is GateCheck => Boolean(c));
    const status = deriveStatus(checks.map((c) => c.status));

    // 覆盖率取最差来源（保守）：不因某一子项达标而粉饰另一子项缺口。
    let worst: Coverage = { current: null, target: null, unit: spec.tables[0] ?? "", pct: null };
    let worstRatio = Number.POSITIVE_INFINITY;
    for (const src of spec.coverageSources) {
      const cov = coverageFrom(byId.get(src.checkId), src);
      const ratio =
        cov.pct !== null ? cov.pct : Number.POSITIVE_INFINITY;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worst = cov;
      }
    }

    const detail =
      checks.length > 0
        ? checks.map((c) => `#${c.id} ${c.name}：${c.detail}`).join(" ｜ ")
        : `gate 文件中未找到本域对应的 check（ids=${spec.checkIds.join(",")}）`;

    return {
      domain,
      label: spec.label,
      tables: spec.tables,
      status,
      checkIds: spec.checkIds,
      coverage: worst,
      detail,
    };
  });
}

// ---------------------------------------------------------------------------
// 认证证据读取
// ---------------------------------------------------------------------------

export type GateReadResult = {
  gate: ResearchReadyGateFile | null;
  exists: boolean;
  parseError: string | null;
};

/** 读取 + schema 校验认证 gate 文件。缺失/不匹配 → gate=null 且带 parseError（不伪造）。 */
export async function readCertifiedGate(): Promise<GateReadResult> {
  const abs = join(PROJECT_ROOT, GATE_EVIDENCE_PATH);
  if (!existsSync(abs)) {
    return { gate: null, exists: false, parseError: `证据文件不存在：${GATE_EVIDENCE_PATH}` };
  }
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch (e) {
    return { gate: null, exists: true, parseError: `读取失败：${(e as Error).message}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { gate: null, exists: true, parseError: `JSON 解析失败：${(e as Error).message}` };
  }
  const parsed = researchReadyGateFileSchema.safeParse(json);
  if (!parsed.success) {
    return {
      gate: null,
      exists: true,
      parseError: `schema 校验失败：${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    };
  }
  return { gate: parsed.data, exists: true, parseError: null };
}

/** 证据文件 → 类型标签（用于看板「证据产物」区）。 */
const EVIDENCE_KIND_BY_NAME: Record<string, EvidenceArtifact["kind"]> = {
  "research_ready_gate.json": "gate",
  "certify_final.json": "certify",
  "pit_audit_smoke.json": "pit",
  "research_dataset_smoke.json": "dataset",
  "0023_deploy_evidence.json": "deploy",
  "MASTER_AUDIT_STATE.json": "audit",
};

async function collectEvidence(dirRel: string): Promise<EvidenceArtifact[]> {
  const absDir = join(PROJECT_ROOT, dirRel);
  if (!existsSync(absDir)) return [];
  const entries = await readdir(absDir);
  const out: EvidenceArtifact[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const abs = join(absDir, name);
    const s = await stat(abs);
    let capturedAt: string | null = null;
    try {
      const j = JSON.parse(await readFile(abs, "utf8")) as Record<string, unknown>;
      const c = j["capturedAt"] ?? j["audit_timestamp"];
      if (typeof c === "string") capturedAt = c;
    } catch {
      // 证据文件损坏 → 只记录元信息，capturedAt 留 null（不猜测时间戳）
    }
    out.push({
      name,
      path: `${dirRel}/${name}`,
      kind: EVIDENCE_KIND_BY_NAME[name] ?? "certify",
      bytes: s.size,
      capturedAt,
      modifiedAt: s.mtime.toISOString(),
    });
  }
  return out;
}

/** 列出 docs 下全部真实 JSON 证据产物（gate / certify / pit / dataset / audit）。 */
export async function listEvidenceArtifacts(): Promise<EvidenceArtifact[]> {
  const [step12, audit] = await Promise.all([
    collectEvidence(EVIDENCE_REL_DIR),
    collectEvidence(AUDIT_REL_DIR),
  ]);
  return [...step12, ...audit].sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// 健康看板总览
// ---------------------------------------------------------------------------

/** 组装看板总览：认证快照 + 派生域健康 + 证据清单。 */
export async function buildDataHealthOverview(): Promise<DataHealthOverview> {
  const { gate, exists, parseError } = await readCertifiedGate();
  const evidence = await listEvidenceArtifacts();

  if (!gate) {
    return {
      source: {
        path: GATE_EVIDENCE_PATH,
        exists,
        capturedAt: null,
        staleMinutes: null,
        parseError,
      },
      researchReady: false,
      summary: null,
      domains: [],
      checks: [],
      crossCuttingChecks: [],
      thresholds: {},
      snapshot: null,
      evidence,
    };
  }

  const capturedMs = Date.parse(gate.capturedAt);
  const staleMinutes =
    Number.isFinite(capturedMs) ? Math.max(0, (Date.now() - capturedMs) / 60000) : null;

  const crossIds = new Set(CROSS_CUTTING_CHECK_IDS);
  return {
    source: {
      path: GATE_EVIDENCE_PATH,
      exists: true,
      capturedAt: gate.capturedAt,
      staleMinutes,
      parseError: null,
    },
    researchReady: gate.researchReady,
    summary: gate.summary,
    domains: deriveDomains(gate),
    checks: gate.checks,
    crossCuttingChecks: gate.checks.filter((c) => crossIds.has(c.id)),
    thresholds: gate.thresholds,
    snapshot: gate.snapshot ?? null,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// 未认证实况（查库，仅用于观察回填进度）
// ---------------------------------------------------------------------------

/** 单条覆盖查询超时（毫秒）：超限即放弃该表，返回 null + 原因，不拖垮整体响应。 */
const COVERAGE_QUERY_TIMEOUT_MS = 25_000;

/**
 * 实况统计定义：表 + 覆盖口径（覆盖列用于观察「多少只证券已回填」，精确 COUNT DISTINCT）。
 *
 * 性能取舍：行数改用 `information_schema` 统计估算（O(1)，避免 8.9M 行大表全表 COUNT）；
 * 覆盖率只对**中小表**做精确 COUNT(DISTINCT)，超大表（stock_daily_prices）不查覆盖
 * （其覆盖已由认证 gate #3 给出 1863/1863 PASS，无需在此重复消耗）。
 */
const LIVE_TABLE_SPECS: Array<{
  table: string;
  coverageExpr: string | null;
  coverageLabel: string | null;
}> = [
  { table: "stock_daily_prices", coverageExpr: null, coverageLabel: null },
  { table: "research_securities", coverageExpr: "COUNT(DISTINCT `securityId`)", coverageLabel: "证券数" },
  {
    table: "research_security_identifier_history",
    coverageExpr: "COUNT(DISTINCT `securityId`)",
    coverageLabel: "证券数",
  },
  {
    table: "research_security_status_history",
    coverageExpr: "COUNT(DISTINCT `securityId`)",
    coverageLabel: "证券数",
  },
  {
    table: "industry_assignments",
    // 与 certify 脚本口径一致：industry_assignments.securityId 当前全 NULL，覆盖按 securityCode 统计
    coverageExpr: "COUNT(DISTINCT `securityCode`)",
    coverageLabel: "证券数",
  },
  { table: "index_master", coverageExpr: null, coverageLabel: null },
  { table: "index_daily", coverageExpr: "COUNT(DISTINCT `indexCode`)", coverageLabel: "指数数" },
  {
    table: "liquidity_daily",
    coverageExpr: "COUNT(DISTINCT `securityCode`)",
    coverageLabel: "证券数",
  },
  {
    table: "corporate_actions",
    coverageExpr: "COUNT(DISTINCT `securityCode`)",
    coverageLabel: "证券数",
  },
  {
    table: "adjustment_factors",
    coverageExpr: "COUNT(DISTINCT `securityCode`)",
    coverageLabel: "证券数",
  },
  { table: "backfill_checkpoints", coverageExpr: null, coverageLabel: null },
];

export const LIVE_NOTE =
  "行数取自 information_schema 统计（近似值，用于观察量级）；覆盖率为精确 COUNT(DISTINCT)。" +
  "本结果未经 gate 认证，不得用于 RESEARCH_READY 判定。";

function rowsFromExecute(res: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(res)) return [];
  return (Array.isArray(res[0]) ? res[0] : res) as Array<Record<string, unknown>>;
}

/** 带超时地执行单条 DB 查询；超时返回 null（不取消 DB 侧执行，但不再阻塞响应）。 */
async function withQueryTimeout<T>(
  exec: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  return Promise.race([
    exec,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/** 带超时地执行单条覆盖查询；超时返回 null + 原因。 */
async function queryCoverageWithTimeout(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  table: string,
  expr: string,
  timeoutMs: number,
): Promise<{ coverage: number | null; error: string | null }> {
  const started = Date.now();
  try {
    const result = await withQueryTimeout(
      db.execute(sql.raw(`SELECT ${expr} AS \`c\` FROM \`${table}\``)),
      timeoutMs,
    );
    if (result === null) {
      return {
        coverage: null,
        error: `覆盖查询超时（>${Math.round(timeoutMs / 1000)}s）`,
      };
    }
    const rows = rowsFromExecute(result);
    const v = rows[0]?.["c"];
    return {
      coverage: v === null || v === undefined ? 0 : Number(v),
      error: null,
    };
  } catch (e) {
    return {
      coverage: null,
      error: `覆盖查询失败：${(e as Error).message}（${Date.now() - started}ms）`,
    };
  }
}

/**
 * 查库取实况行数与覆盖率（**未认证**，不得用于 gate 判定）。
 *
 * 两段式：
 * 1) 行数：单次 `information_schema` 查询（O(1)，全部表一次拿完，标记为估算值）；
 * 2) 覆盖率：逐表精确 COUNT(DISTINCT) + 单表超时保护。
 *
 * 全局硬截止 `LIVE_OVERALL_TIMEOUT_MS`：回填任务会占满 TiDB RU，导致任意 DB 查询长时间挂起，
 * 故整体必须兜底超时，命中后返回**已收集的部分结果** + error 说明（不返回空数组冒充「正常」）。
 */
const LIVE_OVERALL_TIMEOUT_MS = 30_000;

export async function queryLiveCounts(): Promise<{
  capturedAt: string;
  tables: LiveTableCount[];
  error: string | null;
}> {
  const capturedAt = new Date().toISOString();
  const db = await getDb();
  if (!db) {
    return { capturedAt, tables: [], error: "DATABASE_URL 未配置或数据库连接不可用" };
  }

  const deadline = Date.now() + LIVE_OVERALL_TIMEOUT_MS;
  const tables: LiveTableCount[] = [];

  const names = LIVE_TABLE_SPECS.map((s) => `'${s.table}'`).join(",");
  let estimated = new Map<string, number>();
  const remain = () => deadline - Date.now();

  // 1) 行数估算（带兜底超时）
  const infoRes = await withQueryTimeout(
    db.execute(
      sql.raw(
        `SELECT TABLE_NAME AS \`table\`, TABLE_ROWS AS \`rows\` FROM information_schema.tables ` +
          `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${names})`,
      ),
    ),
    Math.max(1000, remain()),
  );
  if (infoRes === null) {
    return {
      capturedAt,
      tables: [],
      error: `实况查询超时（>${LIVE_OVERALL_TIMEOUT_MS / 1000}s）——TiDB 可能正被回填任务占满，请稍后再试`,
    };
  }
  for (const r of rowsFromExecute(infoRes)) {
    estimated.set(String(r["table"]), Number(r["rows"] ?? 0));
  }

  // 2) 覆盖率（逐表，受全局截止约束）
  for (const spec of LIVE_TABLE_SPECS) {
    if (remain() <= 0) {
      return {
        capturedAt,
        tables,
        error: `实况查询超时（>${LIVE_OVERALL_TIMEOUT_MS / 1000}s，返回部分结果）——TiDB 可能正被回填任务占满`,
      };
    }
    let coverage: number | null = null;
    let coverageError: string | null = null;
    if (spec.coverageExpr) {
      const r = await queryCoverageWithTimeout(
        db,
        spec.table,
        spec.coverageExpr,
        Math.min(COVERAGE_QUERY_TIMEOUT_MS, remain()),
      );
      coverage = r.coverage;
      coverageError = r.error;
    }
    tables.push({
      table: spec.table,
      rows: estimated.get(spec.table) ?? 0,
      rowsEstimated: estimated.has(spec.table),
      coverage,
      coverageLabel: spec.coverageLabel,
      coverageError,
    });
  }

  return { capturedAt, tables, error: null };
}
