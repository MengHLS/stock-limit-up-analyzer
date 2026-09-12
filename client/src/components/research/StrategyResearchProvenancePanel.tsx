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
  const query = trpc.research.strategyCandidate.getVersionProvenance.useQuery(
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
      description={`${strategyId}@${version} —— 这条策略是从哪一次研究推导出来的`}
    >
      {query.isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 读取溯源…
        </p>
      )}

      {query.error && (
        // 读取失败**不等于**策略不可用：如实说明，并明确「不影响策略读取与执行」。
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          溯源读取失败：{query.error.message}
          <br />
          这不影响该策略的读取与执行 —— 溯源只是附加信息。
        </p>
      )}

      {vm !== null && (
        <div className="space-y-3">
          {!vm.hasProvenance ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              该版本没有 Research 溯源记录。
              {vm.strategyVersionId === null
                ? "（版本行也没读到 —— 请确认策略 ID 与版本号。）"
                : "（这条策略不是由研究候选转正产生的，或溯源行已被清理。）"}
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
              执行绑定是「Strategy 侧」事实（落 <code className="font-mono">strategy_version_datasets</code>）；
              来源 Dataset 是 promote 时刻的快照 —— 两者可以不同，这正是「研究用一份数据、执行覆盖另一份」的合法路径。
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
