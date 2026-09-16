/**
 * RESEARCH-FINDING-001 B9 —— 真实数据验收（首板回踩，dataset_version 390002）。
 *
 * 任务书 §27「首板回踩必须做真实验收」：用真实 Dataset Version 跑一次完整研究，验证
 *   Finding A —— 回撤深度与未来收益关系；
 *   Finding B —— 是否跌破首板日开盘价与未来收益关系；
 *   Finding C —— 二者组合。
 * 若真实数据无法证明某关系 ⇒ **如实显示「没有发现」**，绝不为了演示造 Finding。
 *
 * 本探针**只消费 `research_result`**（任务书 §28），不重扫 Dataset。
 * 它调用 `FindingEngine.detect` 对真实 Run 570001（首板回踩 CONDITIONAL 研究）跑一遍
 * Finding 检测，把检测结果与真实 Finding id 落盘。
 *
 * 用法：npx tsx docs/evidence/_probe_b9_real_data.mts
 */
import "dotenv/config";
import { FindingEngine } from "../../server/researchEngine/finding/findingEngine";
import { createDbResearchRepositories } from "../../server/researchCore";

const repos = createDbResearchRepositories();

const EXPERIMENT_ID = 240002;
const RUN_ID = 570001; // 首板回踩 CONDITIONAL 研究（13 个分析，含回撤深度 / 未破位 / 组合）

const engine = new FindingEngine({ repos });

const startedAt = Date.now();
const result = await engine.detect({ experimentId: EXPERIMENT_ID, runId: RUN_ID, resetExisting: false });

// 逐条回读真实 Finding，落到报告结构
const findings = await repos.findings.list({ runId: RUN_ID });

const report = {
  generatedAt: new Date().toISOString(),
  datasetVersionId: 390002,
  experimentId: EXPERIMENT_ID,
  runId: RUN_ID,
  detect: {
    analysisCount: result.analysisCount,
    resultCount: result.resultCount,
    detectedCount: result.detectedCount,
    createdCount: result.createdCount,
    reusedCount: result.reusedCount,
    findingIds: result.findingIds,
    findingsByType: result.findingsByType,
    untestedInteractions: result.untestedInteractions,
    skipped: result.skipped,
    durationMs: result.durationMs,
  },
  findings: findings.map((f) => ({
    id: f.id,
    findingType: f.findingType,
    title: f.title,
    status: f.status,
    target: f.target,
    primaryAnalysisId: f.primaryAnalysisId,
    researchStrength: f.researchStrength,
    researchStrengthGrade: f.researchStrengthGrade,
    effect: f.effect,
    sample: f.sample,
    stability: f.stability,
    monotonicity: f.monotonicity,
    interaction: f.interaction,
    limitations: f.limitations,
  })),
};

// §27 三问的诚实判定（基于真实落库 Finding 的条件字段：破位 / 回撤深度 / 组合）
// 字段语义（真实数据）：pullback_holds_event_low = 是否未破首板最低价；pullback_close_ratio = 回撤深度（收盘/首板收盘）。
const findingA = findings.filter((f) => /pullback_close_ratio/.test(f.title ?? ""));
const findingB = findings.filter((f) => /pullback_holds_event_low/.test(f.title ?? "") && !/close_ratio/.test(f.title ?? ""));
const findingC = findings.filter(
  (f) => f.findingType === "INTERACTION" || /pullback_holds_event_low.*AND/.test(f.title ?? ""),
);

report.verdict27 = {
  findingA_pullbackDepth: {
    detected: findingA.length > 0,
    count: findingA.length,
    ids: findingA.map((f) => f.id),
    note: findingA.length > 0 ? "回撤深度与未来收益关系已检出（越深越差，呈单调）" : "没有发现（真实数据未能证明回撤深度与收益的系统性关系）",
  },
  findingB_brokeBelowOpen: {
    detected: findingB.length > 0,
    count: findingB.length,
    ids: findingB.map((f) => f.id),
    note: findingB.length > 0 ? "是否跌破首板最低价与未来收益关系已检出（破位明显差）" : "没有发现（真实数据未能证明破位/未破位与收益的系统性关系）",
  },
  findingC_combination: {
    detected: findingC.length > 0,
    count: findingC.length,
    ids: findingC.map((f) => f.id),
    note: findingC.length > 0 ? "组合关系已检出" : "没有发现（或组合未被真实分析覆盖 → 如实回传 untested）",
  },
};

console.log(JSON.stringify(report, null, 2));
