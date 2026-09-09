/**
 * DatasetConfigPanel — 数据集构建配置（任务 §6.1）。
 *
 * 常用参数（名称 / 时间范围 / PIT 模式）直显；不常用护栏（最大交易日数 /
 * 单日最大证券数 / dataReady）收进「高级设置」折叠区。
 *
 * 只做展示/传输形态，语义合法性由后端 `researchDataset.build` 权威校验。
 */

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionCard } from "@/components/common";
import { AlertTriangle, ChevronDown, Hammer, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BOARD_LABELS,
  DATASET_CONFIG_LIMITS,
  PULLBACK_TARGET_LABELS,
  SELECTABLE_BOARDS,
  SELECTABLE_PULLBACK_TARGETS,
  TDAY_CONDITION_LABELS,
  validateDatasetConfig,
  type DatasetConfigViewModel,
} from "@/adapters/datasetAdapter";
import type {
  PullbackTargetTypeValue,
  TDayConditionValue,
} from "@shared/researchContracts";

/** T 日条件选项（展示顺序）。 */
const TDAY_OPTIONS: TDayConditionValue[] = [
  "none",
  "limitUp",
  "firstBoard",
  "consecutiveBoard",
];

export function DatasetConfigPanel({
  config,
  onChange,
  onSubmit,
  isBuilding,
}: {
  config: DatasetConfigViewModel;
  onChange: (next: DatasetConfigViewModel) => void;
  onSubmit: () => void;
  isBuilding: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { valid, errors } = validateDatasetConfig(config);

  const set = (patch: Partial<DatasetConfigViewModel>) =>
    onChange({ ...config, ...patch });

  return (
    <SectionCard
      title="Dataset Configuration"
      icon={Hammer}
      description="配置窗口 / PIT 口径 / 构建护栏 → 触发后端构建"
      contentClassName="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="ds-name">数据集名称</Label>
        <Input
          id="ds-name"
          value={config.name}
          onChange={e => set({ name: e.target.value })}
          placeholder="如 universe-tradable-daily"
        />
        <p className="text-[11px] text-muted-foreground">
          仅描述，不进 datasetVersion 指纹。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ds-start">起始日期</Label>
          <Input
            id="ds-start"
            type="date"
            value={config.startDate}
            onChange={e => set({ startDate: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ds-end">结束日期</Label>
          <Input
            id="ds-end"
            type="date"
            value={config.endDate}
            onChange={e => set({ endDate: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="ds-pit"
            checked={config.asOfPerTradeDate}
            onCheckedChange={v => set({ asOfPerTradeDate: v === true })}
          />
          <Label htmlFor="ds-pit" className="text-xs font-medium">
            逐日 PIT（asOf = tradeDate）
          </Label>
        </div>
        {!config.asOfPerTradeDate && (
          <div className="space-y-1.5 pl-6">
            <Label htmlFor="ds-asof">固定 asOf</Label>
            <Input
              id="ds-asof"
              type="date"
              value={config.asOf}
              onChange={e => set({ asOf: e.target.value })}
            />
            <p className="text-[11px] text-amber-700">
              固定快照仅用于调试/审计；研究必须逐日 PIT（§4）。
            </p>
          </div>
        )}
      </div>

      {/* 高级设置（不常用护栏） */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40">
            <span>高级设置</span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                advancedOpen && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ds-maxday">最大交易日数</Label>
              <Input
                id="ds-maxday"
                type="number"
                min={DATASET_CONFIG_LIMITS.maxTradingDaysMin}
                max={DATASET_CONFIG_LIMITS.maxTradingDaysMax}
                value={config.maxTradingDays}
                onChange={e =>
                  set({ maxTradingDays: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ds-maxsec">单日最大证券数</Label>
              <Input
                id="ds-maxsec"
                type="number"
                min={DATASET_CONFIG_LIMITS.maxSecuritiesMin}
                max={DATASET_CONFIG_LIMITS.maxSecuritiesMax}
                value={config.maxSecuritiesPerDay}
                onChange={e =>
                  set({ maxSecuritiesPerDay: Number(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Checkbox
              id="ds-ready"
              checked={config.dataReady}
              onCheckedChange={v => set({ dataReady: v === true })}
            />
            <Label htmlFor="ds-ready" className="text-xs font-medium">
              数据链已就绪（A~H 全 DATA_READY）
            </Label>
          </div>

          {/* Universe 过滤（板块 / ST / T 日条件） */}
          <div className="mt-4 space-y-3 rounded-md border p-3">
            <p className="text-xs font-semibold">
              Universe 过滤（板块 / ST / T 日条件）
            </p>

            <div className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground">
                市场板块（全选 = 不过滤）
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {SELECTABLE_BOARDS.map(board => (
                  <div key={board} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`ds-board-${board}`}
                      checked={config.boards.includes(board)}
                      onCheckedChange={v =>
                        set({
                          boards:
                            v === true
                              ? [...config.boards, board]
                              : config.boards.filter(b => b !== board),
                        })
                      }
                    />
                    <Label htmlFor={`ds-board-${board}`} className="text-xs">
                      {BOARD_LABELS[board]}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="ds-exclude-st"
                checked={config.excludeSt}
                onCheckedChange={v => set({ excludeSt: v === true })}
              />
              <Label htmlFor="ds-exclude-st" className="text-xs font-medium">
                排除 ST / *ST
              </Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ds-tday" className="text-xs font-medium">
                T 日条件
              </Label>
              <Select
                value={config.tDayCondition}
                onValueChange={v =>
                  set({ tDayCondition: v as TDayConditionValue })
                }
              >
                <SelectTrigger id="ds-tday" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TDAY_OPTIONS.map(o => (
                    <SelectItem key={o} value={o}>
                      {TDAY_CONDITION_LABELS[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                首板 = T 日涨停且 T-1 未涨停；涨停按板块+ST 取
                10%/5%/20%/30%。仅完整构建时生效（预览只计入板块/ST）。
              </p>
            </div>

            {/* 首板回踩筛选（通用条件） */}
            <div className="space-y-2 border-t pt-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ds-pullback"
                  checked={config.pullback !== null}
                  onCheckedChange={v => {
                    if (v === true) {
                      set({
                        tDayCondition: "firstBoard",
                        pullback: {
                          targetTypes: ["limitPrice"],
                          tolerancePercent: 2,
                          observationWindowDays: 5,
                        },
                      });
                    } else {
                      set({ pullback: null });
                    }
                  }}
                />
                <Label htmlFor="ds-pullback" className="text-xs font-medium">
                  首板回踩筛选（触及且不破）
                </Label>
              </div>

              {config.pullback && (
                <div className="space-y-2 pl-6">
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      回踩目标位（可多选，任一命中即回踩）
                    </span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {SELECTABLE_PULLBACK_TARGETS.map(target => (
                        <div key={target} className="flex items-center gap-1.5">
                          <Checkbox
                            id={`ds-pb-${target}`}
                            checked={config.pullback!.targetTypes.includes(target)}
                            onCheckedChange={v => {
                              const targetTypes =
                                v === true
                                  ? [...config.pullback!.targetTypes, target]
                                  : config.pullback!.targetTypes.filter(
                                      t => t !== target
                                    );
                              set({ pullback: { ...config.pullback!, targetTypes } });
                            }}
                          />
                          <Label htmlFor={`ds-pb-${target}`} className="text-xs">
                            {PULLBACK_TARGET_LABELS[target as PullbackTargetTypeValue]}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ds-pb-tol" className="text-[11px]">
                        容差（%）
                      </Label>
                      <Input
                        id="ds-pb-tol"
                        type="number"
                        min={0}
                        max={50}
                        value={config.pullback.tolerancePercent}
                        onChange={e =>
                          set({
                            pullback: {
                              ...config.pullback!,
                              tolerancePercent: Number(e.target.value) || 0,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ds-pb-win" className="text-[11px]">
                        观察窗口（日）
                      </Label>
                      <Input
                        id="ds-pb-win"
                        type="number"
                        min={1}
                        max={10}
                        value={config.pullback.observationWindowDays}
                        onChange={e =>
                          set({
                            pullback: {
                              ...config.pullback!,
                              observationWindowDays: Number(e.target.value) || 1,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    回踩 = 首板后 T+1~T+N
                    最低价落在[目标位, 目标位×(1+容差)]且全程未跌破。
                  </p>
                </div>
              )}
            </div>
          </div>

          <Alert className="mt-3 py-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-[11px]">
              默认护栏：≤{DATASET_CONFIG_LIMITS.maxTradingDaysMax} 交易日 / ≤
              {DATASET_CONFIG_LIMITS.maxSecuritiesMax} 股 /
              dataReady=false。未勾选「数据链已就绪」时构建 gate 至多
              INCONCLUSIVE。
            </AlertDescription>
          </Alert>
        </CollapsibleContent>
      </Collapsible>

      {!valid && (
        <ul className="space-y-0.5 text-[11px] text-red-600">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={!valid || isBuilding}
        onClick={onSubmit}
      >
        {isBuilding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isBuilding ? "构建中…（同步长任务，DB 繁忙时等待较久）" : "触发构建"}
      </Button>
    </SectionCard>
  );
}
