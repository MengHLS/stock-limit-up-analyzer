/**
 * 定位：运行工作台「运行策略」跑完**为什么产出全是 0**（tradeCount=0 / 权益曲线恒平）。
 *
 * 背景：`loopRun` 只把 `summarizeTradeSimulationRun` 的 **12 个字段**投影回前端，
 * `TradeSimulationRun` 里真正能解释「0 笔成交」的 `executionStats.byReason` / `skipped` /
 * `trades` **不进返回体**（见 `server/research/closedLoop/adapters.ts`）⇒ 页面与排查者都无从得知。
 *
 * 本探针绕过投影层，直接拿 `createClosedLoopWiring` 的 **artifacts**（阶段间传重对象的通道），
 * 因此能看到真实引擎内部的拒单原因分布。
 *
 * 同时做 **A/B**：同一策略、同一窗口，`registry`（直读已落库 ds_*）vs `rebuild`（从零重建），
 * 对「订单执行日是否存在该证券的行情行」做逐单核对 —— 这是「能不能成交」的结构性前置条件。
 *
 * 只读：assembled 只读 DB；runClosedLoop 无副作用（不落库）。
 *
 * 用法：npx tsx docs/evidence/_probe_backtest_zero_trades.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { StrategyService } from "../../server/research/strategyPersistence/service";
import { DbStrategyRepository } from "../../server/research/strategyPersistence/db";
import { assembleRunWorkbenchInputs } from "../../server/runWorkbenchAssembly";
import { createClosedLoopWiring } from "../../server/research/closedLoopWiring";
import { runClosedLoop } from "../../server/research/closedLoop/orchestrator";
import { CLOSED_LOOP_STAGE_IDS } from "../../server/research/closedLoop/types";
import type { StrategyDocument } from "../../server/research/strategySchema/types";

const WINDOW = { startDate: "2025-01-02", endDate: "2025-03-31" };

/** 与 `researchRunRouter#primaryDatasetVersionIdOf` 同口径（PRIMARY 优先，退 doc 级镜像）。 */
function primaryDatasetVersionIdOf(document: StrategyDocument): number | undefined {
  const datasets = document.definition?.datasets;
  if (datasets !== undefined && datasets.length > 0) {
    const primary = datasets.find((d) => d.role === "PRIMARY") ?? datasets[0];
    if (primary !== undefined && primary.datasetVersionId !== undefined && primary.datasetVersionId !== null) {
      return primary.datasetVersionId;
    }
  }
  const mirrored = document.datasetVersionId;
  return mirrored !== undefined && mirrored !== null ? mirrored : undefined;
}

const service = new StrategyService(new DbStrategyRepository(), { codeVersion: "probe" });

interface CaseReport {
  readonly label: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly ok: boolean;
  readonly errorMessage?: string;
  readonly datasetSource?: string;
  readonly datasetSourceNote?: string | null;
  readonly datasetRowCount?: number;
  readonly datasetDateCount?: number;
  readonly recipeId?: string;
  readonly recipeSource?: string;
  readonly decisionDayCount?: number;
  readonly candidateSlotCount?: number;
  readonly tradeCount?: number;
  readonly equityPointCount?: number;
  readonly initialCapital?: number;
  readonly finalEquity?: number;
  readonly executionStats?: Record<string, unknown>;
  readonly skippedByCode?: Record<string, number>;
  /**
   * 🔴 结构性核对：候选意图的「执行日」（下一交易日）在该证券上是否存在数据集行。
   * 不存在 = 撮合引擎必然按 SUSPENDED 拒单（不可成交）。
   */
  readonly executionRowAudit?: {
    readonly intentCount: number;
    readonly intentsWithExecutionRow: number;
    readonly intentsWithoutExecutionRow: number;
    readonly sampleMissing: string[];
  };
  readonly stages?: Array<{ stageId: string; state: string; reasonCode?: string | null }>;
}

function nextTradingDateAfter(dates: readonly string[], date: string): string | null {
  for (const d of dates) if (d > date) return d;
  return null;
}

async function runCase(
  label: string,
  strategyId: string,
  opts: { readonly strategyVersion?: string; readonly sourcePolicy?: "prefer-registry" | "rebuild" } = {},
): Promise<CaseReport> {
  const strategyVersion = opts.strategyVersion ?? "1.0.0";
  try {
    const record = await service.loadVersion(strategyId, strategyVersion);
    const document = record.strategy;
    const boundId = primaryDatasetVersionIdOf(document);

    const assembled = await assembleRunWorkbenchInputs({
      strategyId,
      strategyVersion,
      startDate: WINDOW.startDate,
      endDate: WINDOW.endDate,
      createdAt: "2026-09-13T00:00:00.000Z",
      codeVersion: "probe",
      strategyDocument: document,
      ...(boundId !== undefined ? { datasetVersionId: boundId } : {}),
      ...(opts.sourcePolicy !== undefined ? { datasetSourcePolicy: opts.sourcePolicy } : {}),
      dataReady: true,
    });

    const dataset = assembled.dataset;
    const { inputs, artifacts, stageRunners } = createClosedLoopWiring(assembled.inputs, {
      requested: CLOSED_LOOP_STAGE_IDS,
    });

    const run = runClosedLoop({
      runId: "clrun-probe-zero-trades",
      createdAt: "2026-09-13T00:00:00.000Z",
      metadata: {
        experimentId: "EXP-20260913-PROBE0001",
        strategyId,
        strategyVersion,
        dateRange: { ...WINDOW },
        datasetVersion: dataset.datasetVersion,
        universeVersion: null,
        codeVersion: "probe",
        costModel: null,
        executionModel: "NEXT_OPEN",
        parameterSet: {},
      },
      stageIds: CLOSED_LOOP_STAGE_IDS,
      stageRunners,
    } as never);

    const sim = artifacts.tradeSimulationRun;
    const candidateRun = artifacts.candidateRun;

    // ---- 结构性核对：执行日是否有行（与引擎第 6 步预检同一数据面，但不提前抛错）----
    let executionRowAudit: CaseReport["executionRowAudit"];
    if (sim !== undefined && candidateRun !== undefined) {
      const rowKeys = new Set<string>();
      for (const row of dataset.rows) rowKeys.add(`${row.tradeDate}\u0000${row.securityId}`);
      const tradingDates = dataset.universeDefinition.days
        .filter((d) => d.isTradingDay)
        .map((d) => d.tradeDate)
        .filter((d) => d >= WINDOW.startDate && d <= WINDOW.endDate)
        .sort();
      const sampleMissing: string[] = [];
      let intentCount = 0;
      let withRow = 0;
      for (const day of candidateRun.days) {
        for (const intent of day.positionIntents) {
          if (intent.direction !== "long") continue;
          intentCount += 1;
          const execDate = nextTradingDateAfter(tradingDates, day.date);
          if (execDate !== null && rowKeys.has(`${execDate}\u0000${intent.securityId}`)) {
            withRow += 1;
          } else if (sampleMissing.length < 8) {
            sampleMissing.push(`${day.date}→${String(execDate)} ${intent.securityId}`);
          }
        }
      }
      executionRowAudit = {
        intentCount,
        intentsWithExecutionRow: withRow,
        intentsWithoutExecutionRow: intentCount - withRow,
        sampleMissing,
      };
    }

    const skippedByCode: Record<string, number> = {};
    if (sim !== undefined) {
      for (const entry of sim.skipped) {
        skippedByCode[entry.code] = (skippedByCode[entry.code] ?? 0) + 1;
      }
    }

    return {
      label,
      strategyId,
      strategyVersion,
      ok: true,
      datasetSource: assembled.assembly.datasetSource,
      datasetSourceNote: assembled.assembly.datasetSourceNote,
      datasetRowCount: assembled.assembly.datasetRowCount,
      datasetDateCount: dataset.universeDefinition.days.length,
      recipeId: assembled.assembly.recipeId,
      recipeSource: assembled.assembly.recipeSource,
      decisionDayCount: sim?.decisionDayCount,
      candidateSlotCount: candidateRun?.evaluation.totalSelectedSlots,
      tradeCount: sim?.trades.length,
      equityPointCount: sim?.equityCurve.length,
      initialCapital: sim?.initialCapital,
      finalEquity: sim?.finalEquity,
      executionStats: sim === undefined ? undefined : (sim.executionStats as unknown as Record<string, unknown>),
      skippedByCode,
      ...(executionRowAudit !== undefined ? { executionRowAudit } : {}),
      stages: run.stages.map((s) => ({
        stageId: s.stageId,
        state: s.state,
        reasonCode: s.blocked?.reasonCode ?? null,
      })),
    };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return {
      label,
      strategyId,
      strategyVersion,
      ok: false,
      errorMessage: `${err.code ?? ""} ${String(err.message)}`.trim().slice(0, 600),
    };
  }
}

const reports: CaseReport[] = [];
reports.push(await runCase("A. 文档配方（首板回踩·守线+缩量≤30%）· registry 直读", "cand-360001"));
reports.push(await runCase("B. 同上 · **强制 rebuild 重建**", "cand-360001", { sourcePolicy: "rebuild" }));
reports.push(await runCase("C. 存量无 recipe 文档（兜底配方）· registry 直读", "cand-270001"));

for (const r of reports) {
  console.log(`\n=== ${r.label} (${r.strategyId}@${r.strategyVersion}) ${r.ok ? "✅" : "🔴"} ===`);
  if (!r.ok) {
    console.log(`   ${r.errorMessage ?? "(无消息)"}`);
    continue;
  }
  console.log(
    `   datasetSource=${String(r.datasetSource)} rows=${String(r.datasetRowCount)} dates=${String(r.datasetDateCount)} recipe=${String(r.recipeId)}(${String(r.recipeSource)})`,
  );
  if (r.datasetSourceNote) console.log(`   sourceNote=${r.datasetSourceNote}`);
  console.log(
    `   决策日=${String(r.decisionDayCount)} 候选名额=${String(r.candidateSlotCount)} 成交笔数=${String(r.tradeCount)} 权益点=${String(r.equityPointCount)} 初始/期末=${String(r.initialCapital)}/${String(r.finalEquity)}`,
  );
  console.log(`   executionStats=${JSON.stringify(r.executionStats)}`);
  console.log(`   skippedByCode=${JSON.stringify(r.skippedByCode)}`);
  if (r.executionRowAudit) {
    const a = r.executionRowAudit;
    console.log(
      `   执行日有行核对：意图 ${a.intentCount} 条 → 有行 ${a.intentsWithExecutionRow} / **无行 ${a.intentsWithoutExecutionRow}**`,
    );
    if (a.sampleMissing.length > 0) console.log(`   样例(无行)：${a.sampleMissing.join(" | ")}`);
  }
  console.log(`   stages=${(r.stages ?? []).map((s) => `${s.stageId}:${s.state}${s.reasonCode ? `<${s.reasonCode}>` : ""}`).join(" ")}`);
}

writeFileSync(
  "docs/evidence/_probe_backtest_zero_trades.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), window: WINDOW, reports }, null, 2),
);
process.exit(0);
