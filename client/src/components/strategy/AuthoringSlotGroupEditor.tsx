/**
 * AuthoringSlotGroupEditor —— POSITION / COST 等「非退出」通用槽组的服务端驱动编辑器。
 *
 * 与 EntryConditionSlotEditor 的纪律一致：
 *   1. 槽、方案、参数全部来自服务端词表；本组件不拼 canonical 片段、不写参数 code。
 *   2. 认不出 ⇒ optionId: null，显示「本表单不识别（保持原样）」，不就近匹配。
 *   3. 参数折叠在一行槽里；只渲染服务端下发的参数，不显示模型类字段。
 */
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PresetParameter } from "@/components/strategy/authoringSlotParameter";

export type AuthoringSlotParameterValue = number | boolean | string;

export interface AuthoringGroupSlotOptionDto {
  readonly optionId: string;
  readonly displayName: string;
  /** 一句话说明（只作 tooltip / 技术细节，不作正文）。 */
  readonly summary: string;
  readonly parameters: readonly PresetParameter[];
}

export interface AuthoringGroupSlotDto {
  readonly slotId: string;
  readonly label: string;
  readonly question: string;
  readonly visibility: "PRIMARY" | "MORE" | "RESEARCH";
  readonly options: readonly AuthoringGroupSlotOptionDto[];
}

/** 服务端识别结果：认不出 ⇒ `optionId: null`（保持原样）。 */
export interface AuthoringGroupSlotRecognitionDto {
  readonly slotId: string;
  readonly optionId: string | null;
  readonly parameters: Readonly<Record<string, AuthoringSlotParameterValue>>;
  readonly atDefaults: boolean;
  readonly managedConditionIds?: readonly string[];
  readonly managedPaths?: readonly string[];
}

function unitOf(parameter: PresetParameter): string {
  return (parameter.unit ?? "").toUpperCase();
}

/** ratio / 金额 / 股数 / 天数等展示换算：只做展示，不改写 canonical 值。 */
export function humanAuthoringParameterValue(
  parameter: PresetParameter,
  value: AuthoringSlotParameterValue,
): string | null {
  if (parameter.valueType === "boolean") return value === true ? "是" : "否";
  if (typeof value !== "number") return null;
  const unit = unitOf(parameter);
  if (unit === "BOOLEAN_0_1") return value === 1 ? "是" : "否";
  if (unit === "RATIO" || unit === "PERCENT") {
    return `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  }
  if (unit === "CNY") return `${value.toLocaleString("zh-CN")} 元`;
  if (unit === "BPS") return `${value} bp`;
  if (unit === "TRADING_DAY") return `${value} 个交易日`;
  if (unit === "COUNT" || unit === "SHARES") return `${value} ${unit === "SHARES" ? "股" : "个"}`;
  return String(value);
}

/** 一行槽的短摘要；只展示决定行为的主要参数，不把技术 code 暴露成主文案。 */
export function summarizeAuthoringSlotValues(
  option: AuthoringGroupSlotOptionDto | null,
  parameters: Readonly<Record<string, AuthoringSlotParameterValue>>,
): string {
  if (option === null) return "";
  const parts: string[] = [];
  for (const parameter of option.parameters) {
    const text = humanAuthoringParameterValue(parameter, parameters[parameter.code] ?? parameter.defaultValue);
    if (text === null) continue;
    parts.push(text);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ");
}

export function summarizeAuthoringSlots(
  slots: readonly AuthoringGroupSlotDto[],
  recognitions: readonly AuthoringGroupSlotRecognitionDto[],
): string {
  const byId = new Map(recognitions.map((item) => [item.slotId, item] as const));
  const parts: string[] = [];
  for (const slot of slots) {
    const recognized = byId.get(slot.slotId);
    if (recognized === undefined || recognized.optionId === null || recognized.optionId === "off") continue;
    const option = slot.options.find((item) => item.optionId === recognized.optionId) ?? null;
    if (option === null) continue;
    const values = summarizeAuthoringSlotValues(option, recognized.parameters ?? {});
    parts.push(values === "" ? option.displayName : `${option.displayName} · ${values}`);
  }
  return parts.join(" · ");
}

function ParameterInput({
  parameter,
  value,
  disabled,
  onChange,
}: {
  parameter: PresetParameter;
  value: AuthoringSlotParameterValue;
  disabled: boolean;
  onChange: (next: AuthoringSlotParameterValue) => void;
}) {
  const hint = humanAuthoringParameterValue(parameter, value);

  const unit = unitOf(parameter);
  if (parameter.valueType === "boolean") {
    return (
      <label className="flex items-center gap-1.5 text-[11px]" title={parameter.description}>
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {parameter.label}
      </label>
    );
  }

  if (unit === "BOOLEAN_0_1" && parameter.valueType === "number") {
    return (
      <label className="flex flex-col gap-0.5 text-[11px]" title={parameter.description}>
        <span className="text-muted-foreground">{parameter.label}</span>
        <select
          className="h-7 rounded-md border bg-background px-1.5 text-xs disabled:opacity-50"
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        >
          <option value="1">是</option>
          <option value="0">否</option>
        </select>
      </label>
    );
  }

  if (parameter.allowedValues !== undefined) {
    return (
      <label className="flex flex-col gap-0.5 text-[11px]" title={parameter.description}>
        <span className="text-muted-foreground">{parameter.label}</span>
        <select
          className="h-7 rounded-md border bg-background px-1.5 text-xs disabled:opacity-50"
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {parameter.allowedValues.map((option) => (
            <option key={option} value={option}>
              {parameter.optionLabels?.[option] ?? option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="flex flex-col gap-0.5 text-[11px]" title={parameter.description}>
      <span className="text-muted-foreground">
        {parameter.label}
        {hint === null ? "" : `（${hint}）`}
      </span>
      <Input
        className="h-7 font-mono text-xs"
        type={parameter.valueType === "number" ? "number" : "text"}
        value={String(value)}
        disabled={disabled}
        step={parameter.step}
        min={parameter.min}
        max={parameter.max}
        onChange={(event) =>
          onChange(parameter.valueType === "number" ? Number(event.target.value) : event.target.value)
        }
      />
    </label>
  );
}

function SlotRow({
  slot,
  recognition,
  disabled,
  onApply,
}: {
  readonly slot: AuthoringGroupSlotDto;
  readonly recognition: AuthoringGroupSlotRecognitionDto | null;
  readonly disabled: boolean;
  readonly onApply: (input: {
    readonly slotId: string;
    readonly optionId: string;
    readonly parameters: Readonly<Record<string, AuthoringSlotParameterValue>>;
  }) => void;
}) {
  const [showParams, setShowParams] = useState(false);
  const selected = recognition?.optionId === null || recognition?.optionId === undefined
    ? null
    : slot.options.find((option) => option.optionId === recognition.optionId) ?? null;
  const unrecognized = recognition !== null && recognition.optionId === null;
  const parameters = recognition?.parameters ?? {};
  const optionParameters = selected?.parameters ?? [];
  const valueSummary = summarizeAuthoringSlotValues(selected, parameters);
  const tuned = selected !== null && optionParameters.some(
    (parameter) => (parameters[parameter.code] ?? parameter.defaultValue) !== parameter.defaultValue,
  );

  const applyWith = (
    optionId: string,
    nextParameters: Readonly<Record<string, AuthoringSlotParameterValue>>,
  ) => onApply({ slotId: slot.slotId, optionId, parameters: nextParameters });

  return (
    <div className="py-2" data-authoring-slot={slot.slotId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-[7rem] shrink-0 text-xs font-medium" title={slot.question}>
          {slot.label}
        </span>
        <select
          className="h-8 min-w-[13rem] flex-1 rounded-md border bg-background px-1.5 text-xs disabled:opacity-50"
          value={recognition?.optionId ?? ""}
          disabled={disabled}
          data-authoring-slot-select={slot.slotId}
          onChange={(event) => {
            const optionId = event.target.value;
            if (optionId === "") return;
            const option = slot.options.find((item) => item.optionId === optionId);
            if (option === undefined) return;
            applyWith(
              optionId,
              Object.fromEntries(option.parameters.map((parameter) => [parameter.code, parameter.defaultValue])),
            );
          }}
        >
          <option value="">— 选择方案 —</option>
          {slot.options.map((option) => (
            <option key={option.optionId} value={option.optionId}>{option.displayName}</option>
          ))}
        </select>
        {tuned && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] text-amber-800" data-authoring-slot-tuned={slot.slotId}>
            已改
          </span>
        )}
        {valueSummary !== "" && (
          <span className="text-[11px] tabular-nums text-muted-foreground" data-authoring-slot-value={slot.slotId}>
            {valueSummary}
          </span>
        )}
        {unrecognized && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] text-amber-800" data-authoring-slot-unrecognized={slot.slotId}>
            本表单不识别（保持原样）
          </span>
        )}
        {optionParameters.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-authoring-slot-params-toggle={slot.slotId}
            onClick={() => setShowParams((previous) => !previous)}
          >
            {showParams ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            参数（{optionParameters.length}）
          </button>
        )}
      </div>

      {selected !== null && selected.summary.trim() !== "" && (
        <p className="mt-1 pl-[7rem] text-[10px] leading-relaxed text-muted-foreground" data-authoring-slot-option-summary={slot.slotId}>
          {selected.summary}
        </p>
      )}

      {showParams && selected !== null && optionParameters.length > 0 && (
        <div className="mt-1.5 space-y-1.5 pl-[7rem]">
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {optionParameters.map((parameter) => (
              <ParameterInput
                key={parameter.code}
                parameter={parameter}
                value={parameters[parameter.code] ?? parameter.defaultValue}
                disabled={disabled}
                onChange={(next) => applyWith(selected.optionId, { ...parameters, [parameter.code]: next })}
              />
            ))}
          </div>
          {tuned && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              disabled={disabled}
              data-authoring-slot-reset={slot.slotId}
              onClick={() =>
                applyWith(
                  selected.optionId,
                  Object.fromEntries(optionParameters.map((item) => [item.code, item.defaultValue])),
                )
              }
            >
              <RotateCcw className="mr-1 h-3 w-3" />恢复该方案默认参数
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function AuthoringSlotGroupEditor({
  slots,
  recognitions,
  domId,
  title,
  group,
  groupLabel,
  hint,
  disabled = false,
  busy = false,
  onApply,
}: {
  readonly slots: readonly AuthoringGroupSlotDto[];
  readonly recognitions: readonly AuthoringGroupSlotRecognitionDto[];
  readonly domId?: string;
  readonly title: string;
  readonly group: string;
  readonly groupLabel: string;
  readonly hint: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onApply: (input: {
    readonly slotId: string;
    readonly optionId: string;
    readonly parameters: Readonly<Record<string, AuthoringSlotParameterValue>>;
  }) => void;
}) {
  const byId = new Map(recognitions.map((item) => [item.slotId, item] as const));
  const summary = summarizeAuthoringSlots(slots, recognitions);

  return (
    <section
      id={domId}
      className="scroll-mt-2 rounded-lg border bg-muted/10 p-3"
      data-authoring-slot-group={group}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
        {busy && <span className="text-[11px] text-muted-foreground">计算中…</span>}
      </div>

      <p
        className="mt-1 text-[11px] text-muted-foreground"
        data-authoring-slot-group-summary={summary === "" ? "empty" : "set"}
      >
        {summary === "" ? `（还没有启用${groupLabel}规则槽）` : summary}
      </p>

      {slots.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground" data-authoring-slot-empty>
          服务端当前没有下发{groupLabel}规则槽。
        </p>
      ) : (
        <div className="mt-1 divide-y">
          {slots.map((slot) => (
            <SlotRow
              key={slot.slotId}
              slot={slot}
              recognition={byId.get(slot.slotId) ?? null}
              disabled={disabled}
              onApply={onApply}
            />
          ))}
        </div>
      )}
    </section>
  );
}
