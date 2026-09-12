/**
 * RESEARCH-007 — 变量目录只读探测（不写任何数据）。
 *
 * 目的：拿到 Dataset Version 390002（首板回踩 v2，READY）上**真实可用**的
 * feature / outcome / dimension / 分段视界，用它来构造后续分析批次
 * —— 绝不凭变量名猜测（本项目的铁律：变量只能从真实目录里选）。
 *
 * 用法：npx tsx _r007_catalog_probe.mts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { researchEngineRouter } from "../../server/researchEngineRouter";

const DATASET_VERSION_ID = 390002;

async function main(): Promise<void> {
  const caller = researchEngineRouter.createCaller({ req: {} as never, res: {} as never, user: null });

  const vars = await caller.listVariables({ datasetVersionId: DATASET_VERSION_ID });
  const lines: string[] = [];
  lines.push(`# Dataset Version ${DATASET_VERSION_ID} 变量目录（真实读接口）`);
  lines.push("");
  lines.push("## datasetVersion context");
  lines.push(JSON.stringify(vars.datasetVersion, null, 2));
  lines.push("");
  lines.push(`## features (${vars.features.length})`);
  lines.push(vars.features.join("\n"));
  lines.push("");
  lines.push(`## outcomes (${vars.outcomes.length})`);
  lines.push(vars.outcomes.join("\n"));
  lines.push("");
  lines.push("## dimensions");
  lines.push(JSON.stringify(vars.dimensions));
  lines.push("");
  lines.push("## unavailableDimensions");
  lines.push(JSON.stringify(vars.unavailableDimensions, null, 2));

  writeFileSync("_r007_catalog.md", lines.join("\n"));
  console.log("written _r007_catalog.md");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
