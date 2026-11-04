/**
 * StrategyResearchProvenancePanel — Strategy Version 上的 **Research 溯源只读区**
 * （RESEARCH-006.4.1-B §20 ~ §23）。
 *
 * 定位（三条硬纪律）：
 *  1. **只读**：没有任何编辑 / 删除 / 覆盖 / 重新绑定入口（§22）。溯源是历史事实快照，
 *     可改即伪造历史 —— 后端仓储甚至连 `update` 都不提供。
 *  2. **不阻断**：本面板**只是附加信息**。上游（候选 / 结论 / 实验 / Run / Dataset）被删除时，
 *     面板如实显示「来源已不存在」，但**绝不**让策略打不开（§14 / §23 / §24）。
 *  3. **不重算**：字段值原样搬运；缺就是缺（显示 `—`），不猜 label、不补默认值。
 *
 * 数据来源是**唯一**的只读端点 `research.strategyCandidate.getVersionProvenance`，
 * 它按 **Strategy 侧坐标**（strategyId + semver）查询，**不要求** Research 任何行存在。
 */

import { Loader2, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SectionCard } from "@/components/common";
import {
  PROVENANCE_DISCLAIMER,
  promotionProvenanceToVm,
} from "@/adapters/strategyCandidateAdapter";

export function StrategyResearchProvenancePanel({
  strategyId,
  version,
}: {
  strategyId: string;
  version: string;
}) {
  const query = trpc.strategyDomain.strategyCandidate.getVersionProvenance.useQuery(
    { strategyId, version },
    { enabled: strategyId.length > 0 && version.length > 0, refetchOnWindowFocus: false, retry: false },
  );

  const vm = query.data === undefined ? null : promotionProvenanceToVm(query.data);

  /** 来源 Dataset 与执行 Dataset 的对照（判据 = 两边都有值且不同；缺任一边就不标注）。 */
  const sourceDatasetValue =
    vm?.rows.find((r) => r.label === "Source Dataset Version ID")?.value ?? null;
  const datasetDiverged =
    vm !== null
    && vm.executionDatasetVersionId !== null
    && sourceDatasetValue !== null
    && sourceDatasetValue !== String(vm.executionDatasetVersionId);

  return (
    <SectionCard
      title="Research 溯源（只读）"
      icon={ShieldCheck}
      description={`${strategyId}@${version} · 只读`}
    >
      {query.isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 读取溯源…
        </p>
      )}

      {query.error && (
        // 读取失败**不等于**策略不可用：如实说明，并明确「不影响策略读取与执行」。
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          溯源读取失败：{query.error.message}（不影响策略的读取与执行）
        </p>
      )}

      {vm !== null && (
        <div className="space-y-3">
          {!vm.hasProvenance ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              {vm.strategyVersionId === null
                ? "没有溯源记录（版本行也没读到 —— 请确认策略 ID 与版本号）。"
                : "没有溯源记录（不是由研究候选转正产生的，或溯源行已清理）。"}
            </p>
          ) : (
            <>
              {vm.missingNote !== null && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {vm.missingNote}
                </p>
              )}

              <dl className="grid gap-x-4 gap-y-1 text-xs md:grid-cols-2">
                {vm.rows.map((row) => (
                  <div key={row.label} className="flex items-baseline gap-2">
                    <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                    <dd className="break-all font-mono">
                      {row.value ?? "—"}
                      {row.missing && (
                        <span className="ml-1.5 font-sans text-[10px] text-amber-700">
                          （来源已不存在）
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {/*
            Research Evidence（STRATEGY-RESEARCH-BRIDGE-001 §16）——
            「这个 Strategy 是基于哪些研究运行产生的？」的正面回答。
            每条指向一次**真实持久化 Run**；只读、保持后端行序（排序会被误读成推荐）。
          */}
          {vm.researchEvidences.length > 0 && (
            <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-sky-900">
                  研究证据（{vm.researchEvidences.length} 条 · 只读）
                </span>
                <span
                  className="font-mono text-[10px] text-muted-foreground"
                  title="证据列表的独立内容指纹（与执行语义指纹同名不同义）"
                >
                  证据指纹 {vm.researchEvidenceFingerprint ?? "—"}
                </span>
              </div>
              <ul className="space-y-1.5">
                {vm.researchEvidences.map((e, index) => (
                  <li
                    key={`${e.runId}·${e.reference}·${index}`}
                    className="rounded border border-sky-200 bg-background/70 px-2 py-1.5 text-[11px]"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded border border-sky-300 bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-900">
                        {e.evidenceKindLabel}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {e.runStatus}
                      </span>
                    </div>
                    <dl className="grid gap-x-3 gap-y-0.5 md:grid-cols-2">
                      <div className="flex items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">实验编号</dt>
                        <dd className="break-all font-mono">{e.experimentCode}</dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">实验版本</dt>
                        <dd className="font-mono">{e.experimentVersion}</dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">运行</dt>
                        <dd className="break-all font-mono">{e.runId}</dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">数据集版本</dt>
                        <dd className="break-all font-mono">
                          {`#${e.datasetVersionId}`}
                          {e.datasetVersionLabel === null ? "" : `（${e.datasetVersionLabel}）`}
                        </dd>
                      </div>
                      <div className="flex items-baseline gap-1.5 md:col-span-2">
                        <dt className="shrink-0 text-muted-foreground">引用</dt>
                        <dd className="break-all font-mono">{e.reference}</dd>
                      </div>
                    </dl>
                    {e.description !== null && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{e.description}</p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                这些运行只作为来源事实（样本量 / 统计量 / 稳定性判定等）被引用，
                不构成本策略的买入 / 卖出规则 —— 交易规则属于 Strategy 侧定义。
              </p>
            </div>
          )}

          {/* 执行绑定（Strategy 侧事实）与来源的对照 —— 两个坐标可以不同，且必须能看出差别。 */}
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-muted-foreground">Research Source Dataset</span>
              <span className="font-mono">
                {vm.rows.find((r) => r.label === "Source Dataset Version ID")?.value ?? "—"}
              </span>
              <span className="text-muted-foreground">Execution Dataset</span>
              <span className="font-mono">
                {vm.executionDatasetVersionId === null ? "—" : `#${vm.executionDatasetVersionId}`}
                {vm.executionDatasetLabel === null ? "" : `（${vm.executionDatasetLabel}）`}
              </span>
              {datasetDiverged && (
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                  两者不同
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              数据集分歧原因：
              {vm.sourceDatasetDivergenceReason ?? "—（执行数据集与研究来源一致，或无记录）"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              执行绑定是 Strategy 侧事实，来源 Dataset 是 promote 时刻快照 —— 两者可以不同（研究用一份、执行覆盖另一份）。
            </p>
          </div>

          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900">
            {PROVENANCE_DISCLAIMER}
          </p>
        </div>
      )}
    </SectionCard>
  );
}
