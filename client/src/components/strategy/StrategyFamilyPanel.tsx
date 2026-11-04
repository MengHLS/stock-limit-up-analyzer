import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/common/SectionCard";
import { trpc } from "@/lib/trpc";
import { Loader2, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ParameterValue = number | boolean | string;

export function StrategyFamilyPanel({
  currentStrategyId,
  datasetVersionId,
  datasetLabel,
}: {
  currentStrategyId: string;
  datasetVersionId: number | null;
  datasetLabel: string;
}) {
  const families = trpc.strategyDomain.strategy.listFamilies.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const [familyId, setFamilyId] = useState("rolling-first-limit-pool");
  const [parameters, setParameters] = useState<Record<string, ParameterValue>>({});
  const [strategyId, setStrategyId] = useState("first-limit-pool-rolling-3f-top3");
  const [version, setVersion] = useState("1.0.0");
  const [name, setName] = useState("首板股票池 · 滚动 3F Top3");
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);

  const family = useMemo(
    () => families.data?.find(item => item.familyId === familyId) ?? null,
    [families.data, familyId],
  );

  useEffect(() => {
    if (family === null) return;
    setParameters(Object.fromEntries(
      family.parameters.map(parameter => [parameter.name, parameter.defaultValue]),
    ));
    setPreviewFingerprint(null);
  }, [family]);

  const materializeInput = useMemo(() => ({
    familyId,
    strategyId,
    version,
    name,
    datasetVersionId: datasetVersionId ?? 0,
    datasetLabel,
    parameters,
  }), [datasetLabel, datasetVersionId, familyId, name, parameters, strategyId, version]);

  const materialize = trpc.strategyDomain.strategy.materializeFamily.useMutation({
    onSuccess: document => {
      setPreviewFingerprint(String(document.fingerprint ?? ""));
      toast.success("模式族配置可物化", { description: "服务端已通过文档校验与指纹重算。" });
    },
    onError: error => toast.error("模式族配置无效", { description: error.message }),
  });
  const createNew = trpc.strategyDomain.strategy.createFromFamily.useMutation({
    onSuccess: result => toast.success("策略已创建", {
      description: String(result.strategyId ?? strategyId),
    }),
    onError: error => toast.error("创建策略失败", { description: error.message }),
  });
  const createVersion = trpc.strategyDomain.strategy.createVersionFromFamily.useMutation({
    onSuccess: result => toast.success("新版本已创建", {
      description: String(result.version ?? version),
    }),
    onError: error => toast.error("创建版本失败", { description: error.message }),
  });

  const disabled = datasetVersionId === null || family === null;

  return (
    <SectionCard
      title="模式族配置"
      icon={Settings2}
      description="从已注册模式族派生策略；继承的 v1.62.1 执行、退出和成本面只读，服务端负责物化与校验。"
    >
      {families.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在读取模式族…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium">模式族</span>
              <select
                className="h-9 w-full rounded-md border bg-background px-2"
                value={familyId}
                onChange={event => setFamilyId(event.target.value)}
              >
                {(families.data ?? []).map(item => (
                  <option key={item.familyId} value={item.familyId}>{item.label}</option>
                ))}
              </select>
            </label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <p>基线：{family?.baseStrategyId}@{family?.baseVersion}</p>
              <p className="mt-1 font-mono">{family?.baseArmId}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-xs">
              <span className="font-medium">策略 ID</span>
              <Input value={strategyId} onChange={event => setStrategyId(event.target.value)} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">版本</span>
              <Input value={version} onChange={event => setVersion(event.target.value)} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium">名称</span>
              <Input value={name} onChange={event => setName(event.target.value)} />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(family?.parameters ?? []).map(parameter => (
              <label key={parameter.name} className="space-y-1 text-xs" title={parameter.description}>
                <span className="font-medium">{parameter.label}</span>
                <Input
                  type={parameter.type === "number" ? "number" : "text"}
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  value={String(parameters[parameter.name] ?? parameter.defaultValue)}
                  onChange={event => setParameters(previous => ({
                    ...previous,
                    [parameter.name]: parameter.type === "number"
                      ? Number(event.target.value)
                      : event.target.value,
                  }))}
                />
                <span className="block font-mono text-[10px] text-muted-foreground">
                  {parameter.name}
                </span>
              </label>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground">
            数据集坐标：{datasetVersionId === null ? "未绑定" : `#${datasetVersionId} / ${datasetLabel}`}
            {previewFingerprint !== null && (
              <span className="ml-2 font-mono">预览指纹 {previewFingerprint.slice(0, 12)}…</span>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || materialize.isPending}
              onClick={() => materialize.mutate(materializeInput)}
            >
              {materialize.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              预览文档
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || createVersion.isPending}
              onClick={() => createVersion.mutate({
                ...materializeInput,
                strategyId: currentStrategyId,
              })}
            >
              保存为当前策略新版本
            </Button>
            <Button
              size="sm"
              disabled={disabled || createNew.isPending}
              onClick={() => createNew.mutate(materializeInput)}
            >
              创建独立策略
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
