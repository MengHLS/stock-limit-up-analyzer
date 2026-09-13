/**
 * 探针：验证 runWorkbenchAssembly 真实装配链路（`useRealData=true`）。
 *
 * 阶段一（本文件先跑）：列出真实策略库里的策略与版本，确认有可装配的 document。
 * 阶段二（_probe_realdata_assembly.mts 的后续版本）：真实构建 + 装配 + runClosedLoop。
 *
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_realdata_assembly.mts`
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StrategyService } from "../../server/research/strategyPersistence/service";
import { DbStrategyRepository } from "../../server/research/strategyPersistence/db";

const OUT = "docs/evidence/_probe_realdata_assembly.json";
const lines: string[] = [];
const log = (m: string) => {
  lines.push(m);
  console.log(m);
};

const svc = new StrategyService(new DbStrategyRepository(), { codeVersion: "unknown" });

const list = await svc.list();
log(`策略数 = ${list.length}`);
for (const s of list.slice(0, 20)) {
  const versions = await svc.listVersions(s.strategyId);
  const vs = versions.map(v => `${v.version}(${v.status ?? "?"})`).join(", ") || "(无版本)";
  log(`  ${s.strategyId} → ${vs}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ lines }, null, 2), "utf8");
process.exit(0);
