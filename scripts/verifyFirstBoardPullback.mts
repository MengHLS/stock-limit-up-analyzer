/**
 * 首板回踩真实 DB 验证脚本（临时，非 mock）。
 * 走通用 researchDataset 构建管线：universeFilter.tDayCondition=firstBoard + pullback 回踩条件。
 * 运行：npx tsx scripts/verifyFirstBoardPullback.mts
 */
import "dotenv/config";
import { buildResearchDataset } from "../server/researchDataset";

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

async function main() {
  const t0 = Date.now();
  log("开始构建（静态加载 + 逐日 facts + 回踩筛选，DB 数据量大，请耐心等待）...");
  const dataset = await buildResearchDataset(
    {
      name: "first-board-pullback-verify",
      startDate: "2026-08-10",
      endDate: "2026-08-21",
      asOfPerTradeDate: true,
      universeFilter: {
        boards: ["main", "chinext", "star"],
        excludeSt: true,
        tDayCondition: "firstBoard",
        pullback: {
          targetTypes: ["limitPrice", "ma5"],
          tolerancePercent: 2,
          observationWindowDays: 5,
        },
      },
    },
    { maxTradingDays: 15, maxSecuritiesPerDay: 1000 },
  );
  const elapsed = Date.now() - t0;
  log(`=== 耗时 ${elapsed}ms ===`);
  log("datasetVersion: " + dataset.datasetVersion);
  log("gate: " + dataset.gate + " | gateNotes: " + dataset.gateNotes.join("；"));
  log("rowCount（首板回踩命中候选数）: " + dataset.rows.length);
  log("universe rule: " + dataset.universeDefinition.rule);

  log("== 回踩排除统计（PULLBACK_*）==");
  let any = false;
  for (const day of dataset.universeDefinition.days) {
    const pb = Object.entries(day.excludedByReason).filter(([k]) => k.startsWith("PULLBACK_"));
    if (pb.length > 0) {
      any = true;
      log(`  ${day.tradeDate}: ${JSON.stringify(Object.fromEntries(pb))}`);
    }
  }
  if (!any) log("  （无 PULLBACK_ 排除，或因窗口内无首板事件）");

  log(`=== 候选 ${dataset.rows.length} 条，展示前 12 条 ===`);
  for (const row of dataset.rows.slice(0, 12)) {
    log(
      `${row.code}  ${row.tradeDate}  close=${row.close?.toFixed(2) ?? "—"}  ` +
        `preClose=${row.preClose?.toFixed(2) ?? "—"}  low=${row.low?.toFixed(2) ?? "—"}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stdout.write("ERR " + String(e).slice(0, 500) + "\n");
    process.exit(1);
  });
