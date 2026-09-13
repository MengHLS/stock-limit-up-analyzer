/**
 * 探针：检查真实策略文档能否满足 `assembleRunWorkbenchInputs` 的三个硬前置
 * （costModel / executionModel / recipe）。
 *
 * 目的：在真跑之前先看清「库里已有的策略文档到底缺什么」，避免把装配失败误判为代码缺陷。
 *
 * 重跑：项目根目录 `npx tsx docs/evidence/_probe_strategy_doc_shape.mts`
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StrategyService } from "../../server/research/strategyPersistence/service";
import { DbStrategyRepository } from "../../server/research/strategyPersistence/db";
import { registeredStrategyRecipeIds } from "../../server/research/recipeRegistry";

const OUT = "docs/evidence/_probe_strategy_doc_shape.json";
const findings: unknown[] = [];
const log = (m: string) => console.log(m);

log(`已注册配方 = ${registeredStrategyRecipeIds().join("、") || "(无)"}`);

const svc = new StrategyService(new DbStrategyRepository(), { codeVersion: "unknown" });
const list = await svc.list();

for (const s of list) {
  const versions = await svc.listVersions(s.strategyId);
  for (const v of versions) {
    const doc = await svc.loadVersion(s.strategyId, v.version);
    const d = doc.strategy;
    const row = {
      strategyId: s.strategyId,
      version: v.version,
      status: v.status ?? null,
      name: d.name,
      hasCostModel: d.executionAssumptions?.costModel !== undefined,
      costModel: d.executionAssumptions?.costModel ?? null,
      executionModel: d.executionAssumptions?.executionModel ?? null,
      backtestConfig: d.executionAssumptions?.backtestConfig ?? null,
      hasRecipe: d.recipe !== undefined,
      recipe: d.recipe
        ? {
            kind: d.recipe.kind,
            recipeId: d.recipe.recipeId,
            point: d.recipe.point,
            signalFrequency: d.recipe.signalFrequency,
            featureVersions: d.recipe.featureVersions,
            rankingConfig: d.recipe.rankingConfig,
            selectionConfig: d.recipe.selectionConfig,
            requiredData: d.recipe.requiredData,
          }
        : null,
      parameters: d.parameters,
      hasDefinition: d.definition !== undefined,
      datasetVersion: d.datasetVersion,
    };
    findings.push(row);
    log(
      `  ${s.strategyId}@${v.version}: costModel=${row.hasCostModel} exec=${row.executionModel} ` +
        `recipe=${row.hasRecipe ? row.recipe?.recipeId : "(缺)"} params=${d.parameters.parameters.length}`,
    );
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ registeredRecipes: registeredStrategyRecipeIds(), findings }, null, 2), "utf8");
log(`报告 → ${OUT}`);
process.exit(0);
