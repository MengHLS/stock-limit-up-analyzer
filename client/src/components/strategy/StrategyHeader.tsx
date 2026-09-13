/**
 * StrategyHeader — 策略**详情页**的上下文条。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 与上一版的差别（2026-09-13）
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. 🔴 **删掉了「策略选择器」** —— 详情页已经在某个策略里，换策略是「回列表再点一张卡」
 *    的事。把两者塞进同一个下拉框，正是上一版被吐槽「乱七八糟」的来源：用户既在浏览
 *    全库，又在编辑某一条，分不清当前在看什么。
 * 2. **加了返回入口**（← 策略列表），让「我在哪 / 怎么出去」一眼可见。
 * 3. **行数从 3 行压到 2 行**：身份信息合并成一行等宽文本（ID · 版本 · 数据集 · 校验），
 *    不再每条一行地竖着排。
 * 4. **真实状态徽标保留**：取后端 `listVersions[].status`，不是本地默认值。
 *
 * 纪律：本组件**不重算**任何判定，也不改写 vm —— 只发起动作、展示后端事实。
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common";
import { ArrowLeft, Loader2, Save, Tag } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StrategyViewModel } from "@/adapters/strategyAdapter";

/** 版本选择器只需要的最小字段集（结构性兼容后端 `listVersions` 行）。 */
export interface VersionOption {
  version: string;
  status: string;
}

/** 已落库并加载进编辑器的坐标（`version` 必有值 —— 能加载出来就一定解析出了版本号）。 */
export interface LoadedTarget {
  strategyId: string;
  version: string;
}

export function StrategyHeader({
  vm,
  loadedTarget,
  versionStatus,
  versions,
  versionsLoading,
  onSelectVersion,
  onBack,
  loadingTarget,
  validating,
  onValidate,
  saving,
  onSave,
  creatingVersion,
  onCreateVersion,
  validateStatus,
  dirty,
}: {
  vm: StrategyViewModel;
  /** 已落库并加载进编辑器的坐标；`null` = 当前是未落库的草稿。 */
  loadedTarget: LoadedTarget | null;
  /** 当前版本的真实状态（`listVersions`）；`null` = 未知 / 未落库。 */
  versionStatus: string | null;
  versions: VersionOption[] | null;
  versionsLoading: boolean;
  onSelectVersion: (version: string) => void;
  onBack: () => void;
  loadingTarget: boolean;
  validating: boolean;
  onValidate: () => void;
  saving: boolean;
  onSave: () => void;
  creatingVersion: boolean;
  onCreateVersion: () => void;
  /** 最近一次校验结论；`null` = 本次会话还没校验过。 */
  validateStatus: boolean | null;
  /** 草稿是否有未保存的改动。 */
  dirty: boolean;
}) {
  const busy = validating || saving || creatingVersion;

  return (
    <div className="space-y-2.5 rounded-lg border bg-card px-4 py-3">
      {/* ---- 第 1 行：返回 + 动作 ---- */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 策略列表
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {dirty && (
            <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
              未保存
            </span>
          )}
          <Button size="sm" variant="outline" onClick={onValidate} disabled={busy}>
            {validating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Tag className="mr-1.5 h-3.5 w-3.5" />
            )}
            校验
          </Button>
          <Button size="sm" variant="outline" onClick={onSave} disabled={busy}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            保存
          </Button>
          <Button size="sm" variant="outline" onClick={onCreateVersion} disabled={busy}>
            {creatingVersion && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            另存为新版本
          </Button>
        </div>
      </div>

      {/* ---- 第 2 行：身份 + 版本选择 ---- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold">
              {vm.name || "未命名策略"}
            </h1>
            {versionStatus !== null && <StatusBadge status={versionStatus} />}
            {loadedTarget === null && (
              <Badge
                variant="outline"
                className="border-slate-300 bg-slate-100 font-mono text-[10px] text-slate-600"
              >
                未落库草稿
              </Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {vm.strategyId || "—"} · v{vm.version || "—"} · 数据集{" "}
            {vm.datasetVersion || "未绑定"}
            {validateStatus !== null && (
              <span className={validateStatus ? "text-emerald-700" : "text-red-700"}>
                {` · 校验${validateStatus ? "通过" : "未通过"}`}
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {loadingTarget && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <Select
            value={loadedTarget?.version ?? undefined}
            onValueChange={onSelectVersion}
            disabled={
              loadedTarget === null ||
              versionsLoading ||
              versions === null ||
              versions.length === 0
            }
          >
            <SelectTrigger className="h-8 w-40 text-xs" aria-label="选择版本">
              <SelectValue
                placeholder={versionsLoading ? "加载版本…" : "选择版本"}
              />
            </SelectTrigger>
            <SelectContent>
              {versions?.map(v => (
                <SelectItem key={v.version} value={v.version}>
                  {v.version} · {v.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
