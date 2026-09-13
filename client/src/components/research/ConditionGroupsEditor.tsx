/**
 * ConditionGroupsEditor — 条件组编辑器（RESEARCH-002 前端工作台共享组件）。
 *
 * 为什么共享：「新建分析」与「编辑既有分析的条件」必须产出**逐字段一致**的载荷。
 * 如果两处各写一套 UI，迟早出现「新建能过、编辑过不了」或更糟的「两条路径写入
 * 的口径不一样」。这里只负责**草稿态 UI**；载荷构造统一走
 * `createAnalysisForm.conditionGroupsToPayload`。
 *
 * 交互纪律（与后端运算符语义一一对应，避免「填了却不生效」）：
 *   - 组内连接符：并且 / 或者 / 并且不（组内首条忽略）；
 *   - 组间连接符：并且 / 或者（首组忽略）；
 *   - 输入框按运算符**元数**显示：`BETWEEN` 两个、`IS_NULL` 零个、`IN` 逗号列表。
 */

import { useState } from "react";
import { Plus, PlusCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { variableLabelOf } from "@/adapters/researchEngineAdapter";
import {
  CONDITION_OPERATOR_OPTIONS,
  createEmptyCondition,
  createEmptyConditionGroup,
  operatorArityOf,
  type ConditionDraft,
  type ConditionGroupDraft,
} from "./createAnalysisForm";

/**
 * 观察日字段的分组元数据（由 `listVariables` 下发，见 `researchEngineRouter.listVariables`）。
 *
 * 为什么要前端做「先选天数、再选字段」两级：
 *   观察日变量是**笛卡尔积**（逐日 8 字段 + 累积 6 口径，每个 offset 各一套），
 *   offset 上限 20 时共 280 个名字。一次性平铺进下拉会让列表无法使用，
 *   而用户思考的次序本来就是「第几天 → 看哪个量」，两级与心智一致。
 */
export interface ObservationFieldOption {
  readonly field?: string;
  readonly stat?: string;
  readonly label: string;
  readonly unit: string;
}

export interface ObservationCatalog {
  readonly variables: readonly string[];
  readonly maxOffset: number;
  readonly dayFields: readonly ObservationFieldOption[];
  readonly pullbackStats: readonly ObservationFieldOption[];
}

export interface ConditionFieldCatalog {
  readonly features: readonly string[];
  readonly outcomes: readonly string[];
  readonly dimensions: readonly string[];
  /** 观察日变量目录；缺省表示该 Dataset 没有 post 数据（下拉里不出现该分组）。 */
  readonly observations?: ObservationCatalog;
}

/** 从观察日变量名里取出 offset（`obs_3d.close` / `pullback_min_low_3d` → 3）。 */
export function observationOffsetOfName(name: string): number | null {
  const day = /^obs_(\d+)d\./.exec(name);
  if (day) return Number(day[1]);
  const pb = /^pullback_[a-z_]+_(\d+)d$/.exec(name);
  if (pb) return Number(pb[1]);
  return null;
}

/** 观察日变量名 → 人读标签（不依赖 adapter 的通用字典，避免 280 项写死）。 */
function observationLabelOf(name: string, catalog?: ConditionFieldCatalog): string {
  const k = observationOffsetOfName(name);
  if (k === null) return name;
  const day = /^obs_(\d+)d\.([a-z_]+)$/.exec(name);
  if (day) {
    const opt = catalog?.observations?.dayFields.find((f) => f.field === day[2]);
    return `T+${k} ${opt?.label ?? day[2]}`;
  }
  const pb = /^pullback_([a-z_]+)_(\d+)d$/.exec(name);
  if (pb) {
    const opt = catalog?.observations?.pullbackStats.find((s) => s.stat === pb[1]);
    return `T+1..T+${k} ${opt?.label ?? pb[1]}`;
  }
  return name;
}

function ConditionRow({
  draft,
  index,
  isFirst,
  catalog,
  onChange,
  onRemove,
}: {
  draft: ConditionDraft;
  index: number;
  isFirst: boolean;
  catalog: ConditionFieldCatalog;
  onChange: (next: ConditionDraft) => void;
  onRemove: () => void;
}) {
  const arity = operatorArityOf(draft.operator);
  const obs = catalog.observations;
  const obsEnabled = obs !== undefined && obs.maxOffset > 0;
  const isObservationField = obsEnabled && obs.variables.includes(draft.fieldName);
  const obsOffset = isObservationField ? observationOffsetOfName(draft.fieldName) : null;
  const [obsMode, setObsMode] = useState<"day" | "pullback">(
    draft.fieldName.startsWith("pullback_") ? "pullback" : "day",
  );

  const fieldOptions = [
    ...catalog.features.map((f) => ({ value: f, group: "特征（T 日可观测）" })),
    ...catalog.dimensions.map((d) => ({ value: d, group: "维度" })),
    ...catalog.outcomes.map((o) => ({ value: o, group: "结果（T+1 之后）" })),
  ];
  return (
    <div className="space-y-1.5 rounded-md border p-2">
      <div className="flex items-center gap-2">
        {!isFirst && (
          <Select
            value={draft.logicalOperator}
            onValueChange={(v) =>
              onChange({ ...draft, logicalOperator: v as ConditionDraft["logicalOperator"] })
            }
          >
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">并且</SelectItem>
              <SelectItem value="OR">或者</SelectItem>
              <SelectItem value="NOT">并且不</SelectItem>
            </SelectContent>
          </Select>
        )}
        {isFirst && <span className="w-24 shrink-0 text-xs text-muted-foreground">条件 {index + 1}</span>}

        <Select value={draft.fieldName} onValueChange={(v) => onChange({ ...draft, fieldName: v })}>
          <SelectTrigger className="h-8 flex-1">
            <SelectValue placeholder="选择字段" />
          </SelectTrigger>
          <SelectContent>
            {["特征（T 日可观测）", "维度", "结果（T+1 之后）"].map((group) => {
              const items = fieldOptions.filter((o) => o.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <p className="px-2 py-1 text-xs text-muted-foreground">{group}</p>
                  {items.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {variableLabelOf(o.value)}
                      <span className="ml-1 font-mono text-xs text-muted-foreground">{o.value}</span>
                    </SelectItem>
                  ))}
                </div>
              );
            })}
            {obsEnabled && (
              <div>
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  观察日（T+k 当时可见，可当条件）
                </p>
                {obs.variables.map((v) => (
                  <SelectItem key={v} value={v}>
                    {observationLabelOf(v, catalog)}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">{v}</span>
                  </SelectItem>
                ))}
              </div>
            )}
          </SelectContent>
        </Select>

        <Select
          value={draft.operator}
          onValueChange={(v) => onChange({ ...draft, operator: v as ConditionDraft["operator"] })}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_OPERATOR_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
                <span className="ml-1 font-mono text-xs text-muted-foreground">{o.value}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove} aria-label="删除条件">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/*
        观察日字段的便捷构造器：选「第几天」+「看哪个量」直接拼出合法变量名。
        不这样做的话，用户得从 280 个名字里找一个 —— 那是把内部编码推给用户。
      */}
      {obsEnabled && (
        <div className="flex flex-wrap items-center gap-2 pl-24">
          <Select value={obsMode} onValueChange={(v) => setObsMode(v as "day" | "pullback")}>
            <SelectTrigger className="h-7 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">单日（T+k）</SelectItem>
              <SelectItem value="pullback">累积（T+1..T+k）</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={obsOffset === null ? "" : String(obsOffset)}
            onValueChange={(v) => {
              const k = v;
              if (obsMode === "day") {
                const field = obs.dayFields[0]?.field ?? "close";
                onChange({ ...draft, fieldName: `obs_${k}d.${field}` });
              } else {
                const stat = obs.pullbackStats[0]?.stat ?? "min_low";
                onChange({ ...draft, fieldName: `pullback_${stat}_${k}d` });
              }
            }}
          >
            <SelectTrigger className="h-7 w-24">
              <SelectValue placeholder="第几天" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: obs.maxOffset }, (_, i) => i + 1).map((k) => (
                <SelectItem key={k} value={String(k)}>
                  T+{k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={
              obsMode === "day"
                ? (/^obs_\d+d\.([a-z_]+)$/.exec(draft.fieldName)?.[1] ?? obs.dayFields[0]?.field ?? "")
                : (/^pullback_([a-z_]+)_\d+d$/.exec(draft.fieldName)?.[1] ?? obs.pullbackStats[0]?.stat ?? "")
            }
            onValueChange={(v) => {
              const k = obsOffset ?? 1;
              if (obsMode === "day") onChange({ ...draft, fieldName: `obs_${k}d.${v}` });
              else onChange({ ...draft, fieldName: `pullback_${v}_${k}d` });
            }}
          >
            <SelectTrigger className="h-7 w-56">
              <SelectValue placeholder="看哪个量" />
            </SelectTrigger>
            <SelectContent>
              {(obsMode === "day" ? obs.dayFields : obs.pullbackStats).map((o) => (
                <SelectItem key={(o.field ?? o.stat) as string} value={(o.field ?? o.stat) as string}>
                  {o.label}
                  <span className="ml-1 text-xs text-muted-foreground">({o.unit})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {obsOffset !== null && (
            <span className="text-xs text-muted-foreground">
              该字段在 T+{obsOffset} 收盘可观测；条件判定日不得早于 T+{obsOffset}
            </span>
          )}
        </div>
      )}

      {arity !== "NONE" && (
        <div className="flex items-center gap-2 pl-24">
          <Input
            className="h-8"
            value={draft.value}
            onChange={(e) => onChange({ ...draft, value: e.target.value })}
            placeholder={arity === "LIST" ? "逗号分隔，如 main,chinext" : arity === "TWO" ? "下界" : "值"}
          />
          {arity === "TWO" && (
            <>
              <span className="text-xs text-muted-foreground">~</span>
              <Input
                className="h-8"
                value={draft.value2}
                onChange={(e) => onChange({ ...draft, value2: e.target.value })}
                placeholder="上界"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ConditionGroupsEditor({
  groups,
  onChange,
  catalog,
  title = "条件",
  hint = "同一组内按「并且/或者/并且不」连接，组与组之间再按组连接符连接。首条条件与首组的连接符会被忽略。",
  disabled = false,
}: {
  groups: ConditionGroupDraft[];
  onChange: (next: ConditionGroupDraft[]) => void;
  catalog: ConditionFieldCatalog;
  title?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([...groups, createEmptyConditionGroup()])}
        >
          <PlusCircle className="mr-1 h-3.5 w-3.5" /> 加一组
        </Button>
      </div>

      {groups.map((group, gi) => (
        <div key={gi} className="space-y-1.5 rounded-md bg-muted/30 p-2">
          <div className="flex items-center gap-2">
            {gi > 0 ? (
              <>
                <span className="text-xs text-muted-foreground">与上一组的关系</span>
                <Select
                  value={group.logicalOperator}
                  onValueChange={(v) =>
                    onChange(
                      groups.map((g, i) =>
                        i === gi ? { ...g, logicalOperator: v as "AND" | "OR" } : g,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-7 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AND">并且</SelectItem>
                    <SelectItem value="OR">或者</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">条件组 {gi + 1}</span>
            )}
            {groups.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7"
                aria-label="删除条件组"
                disabled={disabled}
                onClick={() => onChange(groups.filter((_, i) => i !== gi))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {group.conditions.map((cond, ci) => (
            <ConditionRow
              key={ci}
              draft={cond}
              index={ci}
              isFirst={ci === 0}
              catalog={catalog}
              onChange={(next) =>
                onChange(
                  groups.map((g, i) =>
                    i === gi
                      ? { ...g, conditions: g.conditions.map((c, j) => (j === ci ? next : c)) }
                      : g,
                  ),
                )
              }
              onRemove={() =>
                onChange(
                  groups.map((g, i) =>
                    i === gi ? { ...g, conditions: g.conditions.filter((_, j) => j !== ci) } : g,
                  ),
                )
              }
            />
          ))}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              onChange(
                groups.map((g, i) =>
                  i === gi ? { ...g, conditions: [...g.conditions, createEmptyCondition()] } : g,
                ),
              )
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> 加条件
          </Button>
        </div>
      ))}
    </div>
  );
}
