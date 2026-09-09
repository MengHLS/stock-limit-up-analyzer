/**
 * FE-3 — Research Dataset 构建器（STEP 12.6 · 数据集构建）。
 *
 * 产品化改造（任务 §6~§11）：
 *   Dataset Configuration → Source Validation → Build Pipeline → Build Summary → Diagnostics。
 *
 * 纪律（不变）：
 * - **不重算任何量化判定**：gate / datasetVersion / policySet 均来自后端 `researchDataset.build`；
 * - **rows 永不回传**：只展示 rowCount 摘要；source rows 与 final rows 严格区分；
 * - **INCONCLUSIVE 产品化**：状态 + 原因 + 解释 + 建议 + 技术详情，不裸抛错误码。
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  EmptyState,
  ErrorState,
  TechnicalDetails,
  type DiagnosticError,
} from "@/components/common";
import {
  DatasetConfigPanel,
  SourceValidationTable,
  BuildPipeline,
  BuildSummary,
  BuildDiagnostics,
} from "@/components/dataset";
import {
  SnapshotView,
  PolicySetView,
  UniverseView,
} from "@/components/dataset/DatasetDetailViews";
import {
  buildResultToViewModel,
  type BuildResultViewModel,
} from "@/adapters/buildResultAdapter";
import {
  configToBuildInput,
  defaultDatasetConfig,
  type DatasetConfigViewModel,
} from "@/adapters/datasetAdapter";
import {
  Boxes,
  CalendarRange,
  Database,
  FileJson,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

function rpcErrorToDiagnostic(message: string): DiagnosticError {
  return {
    code: "RPC_ERROR",
    title: "构建请求失败",
    explanation: "后端构建过程抛出异常，未能返回数据集摘要。",
    suggestions: [
      "确认后端服务可用",
      "确认数据库连接正常",
      "查看下方技术详情中的原始错误信息",
    ],
    technical: message,
  };
}

function DetailTabs({
  vm,
  summary,
}: {
  vm: BuildResultViewModel;
  summary: NonNullable<
    ReturnType<typeof trpc.researchDataset.build.useMutation>["data"]
  >;
}) {
  return (
    <TechnicalDetails
      title="详细数据 / 原始契约（三级信息）"
      defaultOpen={false}
    >
      <Tabs defaultValue="snapshot">
        <TabsList>
          <TabsTrigger value="snapshot" className="flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" /> 数据快照
          </TabsTrigger>
          <TabsTrigger value="policy" className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> 9 类口径
          </TabsTrigger>
          <TabsTrigger value="universe" className="flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5" /> 成员决议
          </TabsTrigger>
          <TabsTrigger value="raw" className="flex items-center gap-1.5">
            <FileJson className="h-3.5 w-3.5" /> 原始契约
          </TabsTrigger>
        </TabsList>
        <TabsContent value="snapshot" className="pt-3">
          <SnapshotView snap={summary.dataSnapshot} />
        </TabsContent>
        <TabsContent value="policy" className="pt-3">
          <PolicySetView set={summary.policySet} />
        </TabsContent>
        <TabsContent value="universe" className="pt-3">
          <UniverseView uni={summary.universeDefinition} />
        </TabsContent>
        <TabsContent value="raw" className="pt-3">
          <div className="space-y-2">
            <p className="font-mono text-xs">
              datasetVersion: {vm.datasetVersion}
            </p>
            <p className="font-mono text-xs">
              gate: {vm.gate} · rowCount: {vm.rowCount}
            </p>
            <pre className="max-h-80 overflow-auto rounded bg-muted p-3 font-mono text-[11px] leading-5">
              {JSON.stringify(summary, null, 2)}
            </pre>
          </div>
        </TabsContent>
      </Tabs>
    </TechnicalDetails>
  );
}

export default function DatasetBuilder() {
  const build = trpc.researchDataset.build.useMutation();
  const [config, setConfig] = useState<DatasetConfigViewModel>(
    defaultDatasetConfig()
  );
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const startedAt = useRef<number | null>(null);

  const vm = useMemo(
    () => (build.data ? buildResultToViewModel(build.data) : null),
    [build.data]
  );

  function handleBuild() {
    startedAt.current = performance.now();
    build.mutate(configToBuildInput(config), {
      onSettled: () => {
        if (startedAt.current !== null) {
          setDurationMs(Math.round(performance.now() - startedAt.current));
          startedAt.current = null;
        }
      },
    });
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4" /> Research Dataset 构建器
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
              FE-3 · STEP 12.6
            </span>
          </CardTitle>
          <CardDescription>
            配置窗口 / PIT 口径 / 限流护栏 → 触发后端{" "}
            <code className="font-mono text-[11px]">researchDataset.build</code>
            。 返回摘要不含 rows；gate / datasetVersion / policySet
            均来自后端判定，页面只读展示、不重算、不粉饰。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 配置 */}
        <div className="lg:col-span-2">
          <DatasetConfigPanel
            config={config}
            onChange={setConfig}
            onSubmit={handleBuild}
            isBuilding={build.isPending}
          />
        </div>

        {/* 结果区 */}
        <div className="space-y-4 lg:col-span-3">
          {build.isPending && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-40 w-full" />
              </CardContent>
            </Card>
          )}

          {build.error && !build.isPending && (
            <ErrorState error={rpcErrorToDiagnostic(build.error.message)} />
          )}

          {vm && !build.isPending && (
            <>
              <BuildSummary vm={vm} durationMs={durationMs} />
              <BuildPipeline nodes={vm.pipeline} />
              <SourceValidationTable domains={vm.domains} />
              <BuildDiagnostics vm={vm} />
              <DetailTabs vm={vm} summary={build.data!} />
            </>
          )}

          {!build.data && !build.isPending && !build.error && (
            <Card>
              <CardContent className="p-4">
                <EmptyState
                  icon={Database}
                  title="尚未构建数据集"
                  description="在左侧配置窗口与护栏后触发构建。真实构建依赖 DB 可用（数据链回填期间可能等待较久）。"
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
