/**
 * 「策略配方」选择器（通用槽位编辑器）。
 *
 * ## 设计原则（来自用户反馈，2026-10-03）
 *
 * 用户看的是**策略**，不是代码。所以：
 *   1. 🔴 **下拉里显示「规则式中文名」**（`displayName`），**不显示** recipeId / 实验编号 / presetId；
 *      名字本身就要把规则说清楚（例：「6%止损｜8%回撤保护｜破均线走｜最长20日」）；
 *   2. 🔴 **不堆解释段落**：`summary` 只作 `title` 悬浮提示，**不作为正文渲染**；
 *   3. 🔴 **参数只显示中文名 + 取值含义**（如 `0.06 → 6%`），**不显示** JSON Pointer code；
 *   4. 🔴 **技术细节默认折叠**：presetId / 预设版本 / 源码来源 / 内容指纹 / 生成的 JSON
 *      全部收进「技术细节」，默认关闭 —— 排障时才打开；
 *   5. 词表仍来自服务端（`strategyDomain.authoring.getVocabulary`），本组件**不含任何 presetId 字面量**。
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";

export type PresetParameterValue = number | boolean | string;

export interface PresetParameter {
  readonly code: string;
  readonly label: string;
  readonly description: string;
  readonly path: string;
  readonly valueType: "number" | "boolean" | "string";
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly allowedValues?: readonly string[];
  /** 枚举取值的**中文标签**（值不变，只换显示）。 */
  readonly optionLabels?: Readonly<Record<string, string>>;
  readonly required: boolean;
  readonly defaultValue: PresetParameterValue;
}

export interface PresetSummary {
  readonly presetId: string;
  readonly slot: string;
  /** 技术标识（只进「技术细节」）。 */
  readonly label: string;
  readonly description: string;
  /** 规则式中文名（下拉显示）。 */
  readonly displayName: string;
  /** 更长的口径说明（只作 tooltip，不作正文）。 */
  readonly summary: string;
  readonly status: "REGISTERED" | "EXPERIMENTAL" | "DEPRECATED";
  readonly version: string;
  readonly sourceRef: string;
  readonly advancedOnly: boolean;
  readonly parameters: readonly PresetParameter[];
}

export interface PresetSelection {
  /** 该预设**自己的槽位**（例：退出政策可以来自 `EXIT_POLICY` 组合预设，也可以来自 `EXIT_BASE` 基座）。 */
  readonly slot: string;
  readonly presetId: string;
  readonly parameters: Readonly<Record<string, PresetParameterValue>>;
}

export interface PresetMaterializeResult {
  readonly slot: string;
  readonly presetId: string;
  readonly payload: unknown;
  readonly resolvedParameters: Readonly<Record<string, PresetParameterValue>>;
  readonly fingerprint: string;
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}

const STATUS_LABEL: Record<PresetSummary["status"], string> = {
  REGISTERED: "已登记",
  EXPERIMENTAL: "实验性",
  DEPRECATED: "已弃用",
};

function defaultsOf(preset: PresetSummary): Record<string, PresetParameterValue> {
  return Object.fromEntries(preset.parameters.map(parameter => [parameter.code, parameter.defaultValue]));
}

/**
 * 参数取值的**人话**：`0.06 → 6%` / `5 → 5 个交易日`。
 *
 * 只做展示换算，**不改写 canonical 值**（存储仍是 0.06 / 5，避免语义漂移）。
 */
function humanValue(parameter: PresetParameter, value: PresetParameterValue): string | null {
  if (parameter.valueType !== "number" || typeof value !== "number") return null;
  if (parameter.unit === "ratio") return `= ${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  if (parameter.unit === "TRADING_DAY") return `= ${String(value)} 个交易日`;
  return null;
}

/** 参数输入（无 code 标签；取值含义以人话后缀呈现）。 */
function ParameterField({
  parameter,
  value,
  disabled,
  onChange,
}: {
  parameter: PresetParameter;
  value: PresetParameterValue;
  disabled: boolean;
  onChange: (next: PresetParameterValue) => void;
}) {
  const hint = humanValue(parameter, value);
  const common = "h-8 w-full rounded-md border bg-background px-2 text-xs";
  return (
    <label className="space-y-1 text-xs" title={parameter.description}>
      <span className="font-medium">{parameter.label}</span>
      {parameter.allowedValues !== undefined ? (
        <select className={common} value={String(value)} disabled={disabled} onChange={e => onChange(e.target.value)}>
          {parameter.allowedValues.map(option => (
            <option key={option} value={option}>{parameter.optionLabels?.[option] ?? option}</option>
          ))}
        </select>
      ) : parameter.valueType === "boolean" ? (
        <select className={common} value={value === true ? "true" : "false"} disabled={disabled} onChange={e => onChange(e.target.value === "true")}>
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
      ) : (
        <Input
          className="h-8 text-xs"
          type={parameter.valueType === "number" ? "number" : "text"}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          value={String(value)}
          disabled={disabled}
          onChange={e => onChange(parameter.valueType === "number" ? Number(e.target.value) : e.target.value)}
        />
      )}
      {hint !== null && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function PresetEditor({
  title,
  hint,
  presets,
  value,
  onChange,
  materialized,
  materializing,
  disabled = false,
  domId,
}: {
  title: string;
  /** 一段话说明这个槽**做什么**（例："决定买什么样的股"）。 */
  hint?: string;
  presets: readonly PresetSummary[];
  value: PresetSelection | null;
  onChange: (next: PresetSelection | null) => void;
  materialized: PresetMaterializeResult | null;
  materializing: boolean;
  disabled?: boolean;
  domId?: string;
}) {
  const [showMore, setShowMore] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  const primary = presets.filter(preset => !preset.advancedOnly);
  const advanced = presets.filter(preset => preset.advancedOnly);
  const visible = showMore ? [...primary, ...advanced] : primary;
  const selected = value === null
    ? null
    : visible.find(preset => preset.presetId === value.presetId)
      ?? primary.find(preset => preset.presetId === value.presetId)
      ?? null;
  const locked = disabled || materializing;
  /** 与方案默认值不同的参数个数（只用于折叠入口上的「已改 N」提示）。 */
  const changedCount = selected === null || value === null
    ? 0
    : selected.parameters.filter(parameter => {
        const current = value.parameters[parameter.code];
        return current !== undefined && current !== parameter.defaultValue;
      }).length;

  const select = (presetId: string) => {
    if (presetId === "") { onChange(null); return; }
    const preset = visible.find(item => item.presetId === presetId);
    if (preset === undefined) return;
    onChange({ slot: preset.slot, presetId, parameters: defaultsOf(preset) });
  };

  return (
    <div id={domId} className="scroll-mt-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {selected !== null && selected.status !== "REGISTERED" && (
          <Badge variant="outline" className="text-[10px]">{STATUS_LABEL[selected.status]}</Badge>
        )}
      </div>
      {hint !== undefined && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}

      <div className="mt-3 space-y-3">
        <label className="block space-y-1 text-xs">
          <span className="font-medium">配方</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-xs"
            value={value?.presetId ?? ""}
            disabled={locked}
            title={selected?.summary ?? undefined}
            onChange={event => select(event.target.value)}
          >
            <option value="">— 未选择 —</option>
            {primary.map(preset => (
              <option key={preset.presetId} value={preset.presetId}>{preset.displayName}</option>
            ))}
            {showMore && advanced.length > 0 && (
              <optgroup label={`其余 ${String(advanced.length)} 个方案`}>
                {advanced.map(preset => (
                  <option key={preset.presetId} value={preset.presetId}>{preset.displayName}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        {advanced.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowMore(previous => !previous)}
          >
            {showMore ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            再显示 {advanced.length} 个方案
          </button>
        )}

        {/* I-1/I-3：参数**折叠**在「调整参数（N 项）」里 —— 默认只留方案下拉一行。 */}
        {selected !== null && selected.parameters.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-preset-params-toggle
            onClick={() => setShowParams(previous => !previous)}
          >
            {showParams ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {changedCount > 0 ? `调整参数（${String(selected.parameters.length)} 项 · 已改 ${String(changedCount)}）` : `调整参数（${String(selected.parameters.length)} 项）`}
          </button>
        )}

        {showParams && selected !== null && selected.parameters.length > 0 && (
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            {selected.parameters.map(parameter => (
              <ParameterField
                key={parameter.code}
                parameter={parameter}
                value={value?.parameters[parameter.code] ?? parameter.defaultValue}
                disabled={locked}
                onChange={next => {
                  if (value === null) return;
                  onChange({ slot: value.slot, presetId: value.presetId, parameters: { ...value.parameters, [parameter.code]: next } });
                }}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {showParams && selected !== null && changedCount > 0 && (
            <Button
              type="button" size="sm" variant="ghost" className="h-7 text-[11px]"
              disabled={locked}
              onClick={() => { if (selected !== null) onChange({ slot: selected.slot, presetId: selected.presetId, parameters: defaultsOf(selected) }); }}
            >
              <RotateCcw className="mr-1 h-3 w-3" />恢复默认参数
            </Button>
          )}
          {materializing && <span className="text-[11px] text-muted-foreground">计算中…</span>}
          {materialized !== null && materialized.issues.length === 0 && selected !== null && (
            <span className="text-[11px] text-emerald-700">已就绪</span>
          )}
        </div>

        {materialized !== null && materialized.issues.length > 0 && (
          <ul className="space-y-1 rounded-md border border-rose-200 bg-rose-50/60 p-2">
            {materialized.issues.map(issue => (
              <li key={`${issue.code}:${issue.path}`} className="text-[11px] text-rose-800">
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        {/* ---- 技术细节（默认折叠；排障用，不是给策略作者看的） ---- */}
        <div className="border-t pt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-preset-technical-toggle
            onClick={() => setShowTechnical(previous => !previous)}
          >
            {showTechnical ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            技术细节
          </button>
          {showTechnical && (
            <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
              {selected === null ? (
                <p>未选择配方。</p>
              ) : (
                <>
                  <p>配方标识：<span className="font-mono">{selected.presetId}</span></p>
                  <p>技术名：<span className="font-mono">{selected.label}</span></p>
                  <p>预设版本：<span className="font-mono">{selected.version}</span></p>
                  <p>口径：{selected.summary}</p>
                  <p>来源：<span className="font-mono">{selected.sourceRef}</span></p>
                  {materialized !== null && materialized.issues.length === 0 && (
                    <p>内容指纹：<span className="font-mono">{materialized.fingerprint}</span></p>
                  )}
                  <button
                    type="button"
                    className="underline"
                    disabled={materialized === null}
                    onClick={() => setShowPayload(previous => !previous)}
                  >
                    {showPayload ? "收起生成的配置" : "查看生成的配置"}
                  </button>
                  {showPayload && materialized !== null && (
                    <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 text-[10px] leading-relaxed">
                      {JSON.stringify(materialized.payload, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}