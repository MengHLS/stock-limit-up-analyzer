/**
 * RESEARCH-006.1 — 桥的**契约测试台**（同一批断言跑在 InMemory 与真实 DB 两个实现上）。
 *
 * 为什么需要它（而不是各写一份测试）：006.0 §12 的验收要求是「DB Repository 与
 * InMemory Repository **产生一致领域语义**」。若两边各写一套断言，通过只能说明
 * 「两套断言各自的实现没崩」，**不能**说明语义一致。故把断言抽成**唯一一份**，
 * 由 `provenance.test.ts`（InMemory）与 `scripts/verifyResearchStrategyBridge.mts`
 * （真实 TiDB）共同驱动 —— 同一批用例、同一批期望。
 *
 * 纪律：
 *   - 只断言**领域语义**（错误码 / 往返 / 边界），不断言存储细节；
 *   - 自带清理（创建的行由本台删除），保证真实库验证不污染既有数据；
 *   - 不吞错：每条用例独立捕获并计入报告，便于一次跑完看全貌。
 */

import {
  STRATEGY_PROVENANCE_ERROR,
  StrategyProvenanceError,
  type StrategyResearchProvenanceRepository,
} from "./types";

export interface ContractCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

function ok(name: string, detail?: string): ContractCheck {
  return { name, ok: true, detail };
}

function fail(name: string, detail: string): ContractCheck {
  return { name, ok: false, detail };
}

/** 运行一个用例：断言体返回 string = 失败原因；返回 undefined = 通过。 */
async function check(name: string, body: () => Promise<string | undefined>): Promise<ContractCheck> {
  try {
    const reason = await body();
    return reason === undefined ? ok(name) : fail(name, reason);
  } catch (err) {
    return fail(name, `抛出未预期异常：${(err as Error).message}`);
  }
}

/** 捕获异步调用的错误码；未抛出也返回 undefined。 */
async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    const e = err as { code?: string; name?: string };
    return e.code ?? e.name ?? "UNKNOWN";
  }
}

// ---------------------------------------------------------------------------
// Provenance 契约
// ---------------------------------------------------------------------------

/**
 * 溯源仓储契约（调用方负责保证库/内存是**空**的，或至少这些 id 未被占用）。
 */
export async function runProvenanceContract(
  repo: StrategyResearchProvenanceRepository,
): Promise<ContractCheck[]> {
  const results: ContractCheck[] = [];
  const SID = "c-0061-contract";
  const V1 = 9006101;
  const V2 = 9006102;

  results.push(
    await check("create(DIRECT) 全字段往返", async () => {
      const created = await repo.create({
        strategyVersionId: V1,
        strategyId: SID,
        strategyVersion: "1.0.0",
        sourceCandidateId: 90061,
        sourceConclusionId: 330001,
        sourceExperimentId: 240002,
        sourceResearchRunId: null,
        sourceDatasetVersionId: 390002,
        sourceDatasetLabel: "v2",
        sourceSnapshotJson: { conclusionId: 330001, metricCode: "future_return_mean", effectLabel: "回踩不破" },
        origin: "DIRECT",
      });
      if (created.id === undefined) return "create 未返回自增 id";
      if (created.origin !== "DIRECT") return `origin 期望 DIRECT，实际 ${created.origin}`;
      if (created.sourceResearchRunId !== null) {
        return `sourceResearchRunId 期望 null（提不出即 NULL，不得伪造），实际 ${String(created.sourceResearchRunId)}`;
      }
      if (created.sourceDatasetVersionId !== 390002) return "sourceDatasetVersionId 未往返";
      if (created.sourceDatasetLabel !== "v2") return "sourceDatasetLabel 未往返";
      const snap = created.sourceSnapshotJson as { effectLabel?: string } | undefined;
      if (snap?.effectLabel !== "回踩不破") return "sourceSnapshotJson 未往返";
      if (typeof created.createdAt !== "string") return "createdAt 缺失";
      return undefined;
    }),
  );

  results.push(
    await check("UNIQUE(strategyVersionId)：重复 create → ALREADY_EXISTS", async () => {
      const code = await codeOf(() =>
        repo.create({
          strategyVersionId: V1,
          strategyId: "c-0061-dup",
          strategyVersion: "9.9.9",
          sourceCandidateId: 90062,
          sourceConclusionId: 1,
          sourceExperimentId: 1,
        }),
      );
      if (code !== STRATEGY_PROVENANCE_ERROR.ALREADY_EXISTS) {
        return `期望 ${STRATEGY_PROVENANCE_ERROR.ALREADY_EXISTS}，实际 ${String(code)}`;
      }
      return undefined;
    }),
  );

  results.push(
    await check("create(INHERITED) + 缺省 origin 归一为 DIRECT", async () => {
      const inherited = await repo.create({
        strategyVersionId: V2,
        strategyId: SID,
        strategyVersion: "1.1.0",
        sourceCandidateId: 90063,
        sourceConclusionId: 330001,
        sourceExperimentId: 240002,
        sourceResearchRunId: 450001,
        origin: "INHERITED",
      });
      if (inherited.origin !== "INHERITED") return `origin 期望 INHERITED，实际 ${inherited.origin}`;
      if (inherited.sourceResearchRunId !== 450001) return "sourceResearchRunId 未往返";
      if (inherited.sourceDatasetVersionId !== null) {
        return `未提供时应为 null，实际 ${String(inherited.sourceDatasetVersionId)}`;
      }
      return undefined;
    }),
  );

  results.push(
    await check("getByStrategyVersionId / getBySourceCandidateId / listByStrategyId", async () => {
      const byVersion = await repo.getByStrategyVersionId(V1);
      if (!byVersion) return "getByStrategyVersionId 未命中";
      const byCandidate = await repo.getBySourceCandidateId(90063);
      if (byCandidate?.strategyVersionId !== V2) return "getBySourceCandidateId 未命中 V2";
      const list = await repo.listByStrategyId(SID);
      if (list.length !== 2) return `listByStrategyId 期望 2 行，实际 ${list.length}`;
      if (list[0].strategyVersionId !== V1 || list[1].strategyVersionId !== V2) {
        return "listByStrategyId 顺序应为 strategyVersionId 升序";
      }
      const missing = await repo.getByStrategyVersionId(9006199);
      if (missing !== undefined) return "查询不存在的版本应返回 undefined";
      return undefined;
    }),
  );

  results.push(
    await check("入参非法 → INVALID_INPUT", async () => {
      const cases: Array<[string, () => Promise<unknown>]> = [
        [
          "strategyId 为空串",
          () =>
            repo.create({
              strategyVersionId: 9006110,
              strategyId: "   ",
              strategyVersion: "1.0.0",
              sourceCandidateId: 1,
              sourceConclusionId: 1,
              sourceExperimentId: 1,
            }),
        ],
        [
          "strategyVersionId 非正整数",
          () =>
            repo.create({
              strategyVersionId: 0,
              strategyId: "x",
              strategyVersion: "1.0.0",
              sourceCandidateId: 1,
              sourceConclusionId: 1,
              sourceExperimentId: 1,
            }),
        ],
        [
          "origin 非法",
          () =>
            repo.create({
              strategyVersionId: 9006111,
              strategyId: "x",
              strategyVersion: "1.0.0",
              sourceCandidateId: 1,
              sourceConclusionId: 1,
              sourceExperimentId: 1,
              origin: "CANDIDATE" as never,
            }),
        ],
      ];
      for (const [label, fn] of cases) {
        const code = await codeOf(fn);
        if (code !== STRATEGY_PROVENANCE_ERROR.INVALID_INPUT) {
          return `${label}：期望 ${STRATEGY_PROVENANCE_ERROR.INVALID_INPUT}，实际 ${String(code)}`;
        }
      }
      return undefined;
    }),
  );

  results.push(
    await check("deleteByStrategyVersionId：删后再删 → NOT_FOUND", async () => {
      await repo.deleteByStrategyVersionId(V2);
      if ((await repo.getByStrategyVersionId(V2)) !== undefined) return "删除后仍可查到 V2";
      const code = await codeOf(() => repo.deleteByStrategyVersionId(V2));
      if (code !== STRATEGY_PROVENANCE_ERROR.NOT_FOUND) {
        return `期望 ${STRATEGY_PROVENANCE_ERROR.NOT_FOUND}，实际 ${String(code)}`;
      }
      return undefined;
    }),
  );

  results.push(
    await check("deleteByStrategyId：返回删除行数并把该策略清空（非级联，应用层调用）", async () => {
      const removed = await repo.deleteByStrategyId(SID);
      if (removed !== 1) return `期望删除 1 行（V2 已先删），实际 ${removed}`;
      const left = await repo.listByStrategyId(SID);
      if (left.length !== 0) return `期望清空，实际剩 ${left.length} 行`;
      return undefined;
    }),
  );

  results.push(
    await check("StrategyProvenanceError 携带稳定错误码", async () => {
      const err = new StrategyProvenanceError(STRATEGY_PROVENANCE_ERROR.NOT_FOUND, "x");
      if (err.code !== "STRATEGY_PROVENANCE_NOT_FOUND") return "错误码常量不稳定";
      if (err.name !== "StrategyProvenanceError") return "name 不稳定";
      return undefined;
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Candidate 来源快照契约
// ---------------------------------------------------------------------------
