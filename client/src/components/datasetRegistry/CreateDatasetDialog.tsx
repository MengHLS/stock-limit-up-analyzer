/**
 * CreateDatasetDialog — 「新建数据集」入口（STEP DATASET-003A）。
 *
 * 多数据集支持：在 Dataset Registry 中登记一个新的逻辑 Dataset（datasetCode 唯一）。
 *   - 若该 datasetCode **已有构建插件** → 后端同时建立其物理表（ds_{code}_{role}）；
 *   - 若尚无插件 → 仍可登记（定义为 ACTIVE），但界面与后端都会明确标注
 *     「暂无构建实现」，构建入口会被拒绝（BUILDER_NOT_REGISTERED），
 *     需先实现并注册该数据集的插件（表结构 + 构建器）。
 *
 * 纪律：
 *   - datasetCode 校验复用 `@shared/datasetRegistryContracts.datasetCodeSchema`（与后端同源，防漂移）；
 *   - 可构建性由后端 `listDatasetPlugins` 权威给出，前端不猜测；
 *   - 本组件不建表、不猜表名（后端领域层负责）。
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DATASET_DEFINITION_TYPE_VALUES,
  datasetCodeSchema,
  type DatasetDefinitionType,
} from "@shared/datasetRegistryContracts";

const TYPE_LABELS: Record<DatasetDefinitionType, string> = {
  EVENT: "事件型（EVENT）",
  FACTOR: "因子型（FACTOR）",
  ML: "机器学习（ML）",
  RESEARCH: "研究型（RESEARCH）",
};

/**
 * 前端 datasetCode 预校验（纯函数，便于单测）。
 *
 * 与后端同源：复用 `@shared/datasetRegistryContracts.datasetCodeSchema`，因此
 * 形态（lowercase snake_case）与禁止模式（版本号 / 纯数字后缀等）判定完全一致，无漂移。
 * 返回 null = 合法；返回 string = 首个错误信息。空串不报错（由提交按钮 disabled 兜底）。
 */
export function validateDatasetCodeInput(code: string): string | null {
  if (!code) return null;
  const parsed = datasetCodeSchema.safeParse(code);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "datasetCode 非法");
}

export function CreateDatasetDialog({
  onCreated,
  trigger,
}: {
  onCreated?: (definitionId: number) => void;
  trigger?: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [datasetCode, setDatasetCode] = useState("");
  const [name, setName] = useState("");
  const [datasetType, setDatasetType] = useState<DatasetDefinitionType>("EVENT");
  const [description, setDescription] = useState("");

  const plugins = trpc.datasetRegistry.listDatasetPlugins.useQuery(undefined, { enabled: open });
  const create = trpc.datasetRegistry.createDatasetDefinition.useMutation();

  const codeError = useMemo(() => validateDatasetCodeInput(datasetCode), [datasetCode]);

  const matchedPlugin = useMemo(
    () => plugins.data?.plugins.find((p) => p.datasetCode === datasetCode) ?? null,
    [plugins.data, datasetCode],
  );

  const canSubmit = !!datasetCode && !codeError && !!name.trim() && !create.isPending;

  function reset() {
    setDatasetCode("");
    setName("");
    setDatasetType("EVENT");
    setDescription("");
  }

  async function onSubmit() {
    if (!canSubmit) return;
    try {
      const created = await create.mutateAsync({
        datasetCode: datasetCode.trim(),
        name: name.trim(),
        datasetType,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      await utils.datasetRegistry.listDefinitions.invalidate();
      toast.success(
        created.buildable
          ? `数据集 ${created.datasetCode} 已创建，并已建立物理表`
          : `数据集 ${created.datasetCode} 已登记（暂无构建实现，构建前需先实现插件）`,
      );
      setOpen(false);
      reset();
      onCreated?.(created.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> 新建数据集
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> 新建数据集
          </DialogTitle>
          <DialogDescription>
            在 Dataset Registry 登记一个新的逻辑数据集。<span className="font-mono">datasetCode</span>{" "}
            是它的稳定命名空间（决定物理表名 <span className="font-mono">ds_&#123;code&#125;_&#123;role&#125;</span>
            ），一经创建不可修改。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cd-code" className="text-xs">
              datasetCode（lowercase snake_case）
            </Label>
            <Input
              id="cd-code"
              value={datasetCode}
              onChange={(e) => setDatasetCode(e.target.value)}
              placeholder="first_limit_pullback"
              className="font-mono"
            />
            {codeError && <p className="text-[11px] text-destructive">{codeError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cd-name" className="text-xs">
              名称
            </Label>
            <Input
              id="cd-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="首板回踩"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cd-type" className="text-xs">
              类型
            </Label>
            <Select value={datasetType} onValueChange={(v) => setDatasetType(v as DatasetDefinitionType)}>
              <SelectTrigger id="cd-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATASET_DEFINITION_TYPE_VALUES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cd-desc" className="text-xs">
              描述（可选）
            </Label>
            <Textarea
              id="cd-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="该数据集的语义与用途"
            />
          </div>

          {/* 构建能力提示（由后端 listDatasetPlugins 权威给出） */}
          {datasetCode && !codeError && (
            <div className="rounded-md border px-3 py-2 text-[11px]">
              {matchedPlugin ? (
                <div className="space-y-1">
                  <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-500">
                    <CheckCircle2 className="h-3.5 w-3.5" /> 已实现构建：{matchedPlugin.displayName}
                  </p>
                  <p className="text-muted-foreground">
                    将建立物理表：
                    {matchedPlugin.physicalTables.map((t) => t.tableName).join("、" )}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5" /> 暂无构建实现
                  </p>
                  <p className="text-muted-foreground">
                    可以登记该数据集并管理其版本，但在实现并注册对应构建插件（表结构 + 构建器）之前，
                    「构建」会被明确拒绝。当前已实现：
                    {(plugins.data?.plugins ?? []).map((p) => p.datasetCode).join("、") || "（无）"}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={create.isPending}>
            取消
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={!canSubmit}>
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建数据集
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
