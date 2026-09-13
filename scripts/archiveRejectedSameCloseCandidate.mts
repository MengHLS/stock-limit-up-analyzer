/**
 * 清理：把失败的 `SAME_CLOSE` 变体候选 #360003 归档（`ACCEPTED → ARCHIVED`，由真实 Service 执行）。
 *
 * 背景：该变体因架构约束被校验器拒（`SIGNAL_EXECUTION_TIMING_CONFLICT`：T+1 模型下
 * 同一 bar 收盘不能既出信号又成交）⇒ 它**不产出任何** Strategy / Version / provenance
 * （实测 3 张表均 0 行，这正是 promote 的「定义校验失败 ⇒ 零 Strategy 数据」保证）。
 * 留一个永远转不了正的 ACCEPTED 候选是脏数据 ⇒ 按状态机既有终态 ARCHIVED 归档。
 *
 * 用法：npx tsx scripts/archiveRejectedSameCloseCandidate.mts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createDbResearchRepositories } from "../server/researchCore/repository/db";
import { RegistryDatasetVersionReadPort } from "../server/research/strategyCandidate/datasetVersionPort";
import { createStrategyPromotionPort } from "../server/research/strategyCandidate/strategyPromotionPort";
import { DbStrategyResearchProvenanceRepository } from "../server/research/strategyCandidate/provenance";
import { createStrategyCandidateService } from "../server/research/strategyCandidate/service";
import { composeCodeVersion } from "../server/research/experimentLineage/codeVersion";

function resolveCodeVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return composeCodeVersion({
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      git: { commitShortHash: null, dirty: null },
    });
  } catch {
    return "unknown";
  }
}

const TARGET = 360003;

const service = createStrategyCandidateService({
  repos: createDbResearchRepositories(),
  datasetVersions: new RegistryDatasetVersionReadPort(),
  strategies: createStrategyPromotionPort({ codeVersion: resolveCodeVersion() }),
  provenance: new DbStrategyResearchProvenanceRepository(),
});

const before = await service.get(TARGET);
console.log(`候选 #${TARGET} 当前状态=${before.candidate.status} name=${before.candidate.name}`);

const after = await service.transition({ candidateId: TARGET, to: "ARCHIVED" });
console.log(`✅ 归档完成：状态=${after.status}`);

process.exit(0);
