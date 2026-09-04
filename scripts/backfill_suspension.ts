import "dotenv/config";
import { checkStockPriceSync, inferStockSuspensionWindows } from "../server/stockPriceSync";

const START = "2025-10-01";
const END = "2026-09-04";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const before = await checkStockPriceSync();
  const missingCodes = Array.from(new Set(before.items.filter((i) => i.missingCount > 0).map((i) => i.stockCode))).sort();
  console.log(`== 推断前：缺失对数=${before.summary.missingPairs}，停牌对数=${before.summary.suspendedPairs}，缺失股票数=${missingCodes.length} ==`);
  console.log("缺失股票:", missingCodes.join(", ") || "(无)");

  if (missingCodes.length === 0) {
    console.log("无需回填。");
    return;
  }

  console.log("\n开始逐只推断停牌窗口...");
  const invalid: string[] = [];
  const inferred: Array<{ code: string; windows: number }> = [];
  for (const code of missingCodes) {
    try {
      const results = await inferStockSuspensionWindows([code], START, END);
      const r = results[0];
      if (r.invalidCode) {
        invalid.push(code);
        console.log(`  ${code}: 无日线(疑似代码错误/退市)`);
      } else if (r.windows.length > 0) {
        inferred.push({ code, windows: r.windows.length });
        console.log(`  ${code}: 推断 ${r.windows.length} 段停牌`, r.windows.map((w) => `${w.startDate}~${w.endDate}`).join(" "));
      } else {
        console.log(`  ${code}: 无停牌（缺失应为真缺/未同步）`);
      }
      await sleep(350);
    } catch (e) {
      console.log(`  ${code}: 推断失败`, (e as Error).message);
    }
  }

  const after = await checkStockPriceSync();
  console.log(`\n== 推断后：缺失对数=${after.summary.missingPairs}（-${before.summary.missingPairs - after.summary.missingPairs}），停牌对数=${after.summary.suspendedPairs} ==`);
  console.log("疑似代码错误(无日线):", invalid.join(", ") || "(无)");

  // 展示 600984 的最终状态
  const c = after.items.filter((i) => i.stockCode === "600984.SH");
  for (const item of c) {
    console.log(`  600984 ${item.limitUpDate} ${item.stockName}: 缺失=${item.missingCount}${item.missingDates.length ? "(" + item.missingDates.join(",") + ")" : ""} 停牌=${item.suspendedDates.length}${item.suspendedDates.length ? "(" + item.suspendedDates[0] + "~" + item.suspendedDates.at(-1) + ")" : ""}`);
  }

  // 剩余真缺明细
  const stillMissing = after.items.filter((i) => i.missingCount > 0);
  console.log("\n== 仍缺失明细(真缺，可同步) ==");
  for (const item of stillMissing) {
    console.log(`  ${item.stockCode} ${item.stockName} ${item.limitUpDate}: ${item.missingDates.join(", ")}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
