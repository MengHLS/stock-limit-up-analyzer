/**
 * ENTRY_CONDITION —— 入场规则槽编辑器（第 ② 段“什么条件买”顶部）。
 *
 * 纪律与 `ExitPolicySlotEditor` 相同：
 *   1. 槽表、识别、物化全部由服务端裁定；本组件不拼 conditions / parameter code。
 *   2. 认不出 ⇒ `optionId: null`，显示“本表单不识别（保持原样）”，不就近匹配。
 *   3. 参数折叠在一行槽里；ratio 只做百分比展示，写回值仍是 canonical 小数。
 */
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PresetParameter } from "@/components/strategy/authoringSlotParameter";

export type EntryConditionSlotParameterValue = number | boolean | string;

export interface EntryConditionSlotOptionDto {
  readonly optionId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly parameters: readonly PresetParameter[];
}

export interface EntryConditionSlotDto {
  readonly slotId: string;
  readonly label: string;
  readonly question: string;
  readonly visibility: "PRIMARY" | "MORE" | "RESEARCH";
  readonly options: readonly EntryConditionSlotOptionDto[];
}

/** 服务端识别结果：认不出 ⇒ `optionId: null`（保持原样）。 */
export interface EntryConditionSlotRecognition {
  readonly slotId: string;
  readonly optionId: string | null;
  readonly parameters: Readonly<Record<string, EntryConditionSlotParameterValue>>;
  /** 槽拥有的 canonical condition.id；旧服务端可能省略，缺省按空数组处理。 */
  readonly managedConditionIds?: readonly string[];
  readonly atDefaults: boolean;
}

function unitOf(parameter: PresetParameter): string {
  return (parameter.unit ?? "").toUpperCase();
}

/** ratio / count 的展示换算：不改写 canonical 值。 */
export function humanEntryParameterValue(
  parameter: PresetParameter,
  value: EntryConditionSlotParameterValue,
): string | null {
  if (parameter.valueType === "boolean") return value === true ? "是" : "否";
  if (typeof value !== "number") return null;
  const unit = unitOf(parameter);
  if (unit === "RATIO" || unit === "PERCENT") {
    return `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  }
  if (unit === "BOOLEAN_0_1") return value === 1 ? "是" : "否";
  if (unit === "TRADING_DAY" || unit === "COUNT") return `${value} 个交易日`;
  return String(value);
}

/** 一行槽的短摘要；只展示决定行为的主要参数，不把技术 code 暴露成主文案。 */
export function summarizeEntryConditionSlotValues(
  option: EntryConditionSlotOptionDto | null,
  parameters: Readonly<Record<string, EntryConditionSlotParameterValue>>,
): string {
  if (option === null) return "";
  const parts: string[] = [];
  for (const parameter of option.parameters) {
    const text = humanEntryParameterValue(parameter, parameters[parameter.code] ?? parameter.defaultValue);
    if (text === null) continue;
    parts.push(text);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ");
}

export function summarizeEntryConditionSlots(
  slots: readonly EntryConditionSlotDto[],
  recognitions: readonly EntryConditionSlotRecognition[],
): string {
  const byId = new Map(recognitions.map((item) => [item.slotId, item] as const));
  const parts: string[] = [];
  for (const slot of slots) {
    const recognized = byId.get(slot.slotId);
    if (recognized === undefined || recognized.optionId === null || recognized.optionId === "off") continue;
    const option = slot.options.find((item) => item.optionId === recognized.optionId) ?? null;
    if (option === null) continue;
    const values = summarizeEntryConditionSlotValues(option, recognized.parameters ?? {});
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
  value: EntryConditionSlotParameterValue;
  disabled: boolean;
  onChange: (next: EntryConditionSlotParameterValue) => void;
}) {
  const unit = unitOf(parameter);
  const hint = humanEntryParameterValue(parameter, value);

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

  if (unit === "BOOLEAN_0_1") {
    return (
      <label className="flex flex-col gap-0.5 text-[11px]" title={parameter.description}>
        <span className="text-muted-foreground">{parameter.label}</span>
        <select
          className="h-7 rounded-md border bg-background px-1.5 text-xs disabled:opacity-50"
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        >
          <option value="0">否</option>
          <option value="1">是</option>
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
  slot: EntryConditionSlotDto;
  recognition: EntryConditionSlotRecognition | null;
  disabled: boolean;
  onApply: (input: {
    slotId: string;
    optionId: string;
    parameters: Readonly<Record<string, EntryConditionSlotParameterValue>>;
  }) => void;
}) {
  const [showParams, setShowParams] = useState(false);
  const current = recognition?.optionId ?? "";
  const selected = slot.options.find((option) => option.optionId === current) ?? null;
  const parameters = recognition?.parameters ?? {};
  const unrecognized = recognition !== null && recognition.optionId === null;
  const tuned = selected !== null && recognition !== null && !recognition.atDefaults;
  const optionParameters = selected?.parameters ?? [];
  const valueSummary = summarizeEntryConditionSlotValues(selected, parameters);
  const applyWith = (
    optionId: string,
    next: Readonly<Record<string, EntryConditionSlotParameterValue>>,
  ) => onApply({ slotId: slot.slotId, optionId, parameters: next });

  return (
    <div className="py-2" data-entry-condition-slot={slot.slotId}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1" title={slot.question}>
        <span className="w-[5.5rem] shrink-0 text-xs font-medium">{slot.label}</span>
        <select
          className="h-8 min-w-[14rem] flex-1 rounded-md border bg-background px-1.5 text-xs disabled:opacity-50"
          value={current}
          disabled={disabled}
          title={selected?.summary ?? slot.question}
          data-entry-condition-select={slot.slotId}
          onChange={(event) => {
            const optionId = event.target.value;
            if (optionId === "") return;
            const option = slot.options.find((item) => item.optionId === optionId);
            if (option === undefined) return;
            applyWith(
              optionId,
              Object.fromEntries(option.parameters.map((item) => [item.code, item.defaultValue])),
            );
          }}
        >
          <option value="">{unrecognized ? "— 本表单不识别（保持原样）—" : "— 未设置 —"}</option>
          {slot.options.map((option) => (
            <option key={option.optionId} value={option.optionId}>{option.displayName}</option>
          ))}
        </select>
        {tuned && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] text-amber-800" data-entry-condition-tuned={slot.slotId}>
            已改
          </span>
        )}
        {valueSummary !== "" && (
          <span className="text-[11px] tabular-nums text-muted-foreground" data-entry-condition-value={slot.slotId}>
            {valueSummary}
          </span>
        )}
        {unrecognized && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] text-amber-800" data-entry-condition-unrecognized={slot.slotId}>
            本表单不识别（保持原样）
          </span>
        )}
        {optionParameters.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-entry-condition-params-toggle={slot.slotId}
            onClick={() => setShowParams((previous) => !previous)}
          >
            {showParams ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            参数（{optionParameters.length}）
          </button>
        )}
      </div>

      {selected !== null && selected.summary.trim() !== "" && (
        <p className="mt-1 pl-[5.5rem] text-[10px] leading-relaxed text-muted-foreground" data-entry-condition-option-summary={slot.slotId}>
          {selected.summary}
        </p>
      )}

      {showParams && optionParameters.length > 0 && selected !== null && (
        <div className="mt-1.5 space-y-1.5 pl-[5.5rem]">
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
              data-entry-condition-reset={slot.slotId}
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

export function EntryConditionSlotEditor({
  slots,
  recognitions,
  domId,
  disabled = false,
  busy = false,
  onApply,
}: {
  readonly slots: readonly EntryConditionSlotDto[];
  readonly recognitions: readonly EntryConditionSlotRecognition[];
  readonly domId?: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onApply: (input: {
    slotId: string;
    optionId: string;
    parameters: Readonly<Record<string, EntryConditionSlotParameterValue>>;
  }) => void;
}) {
  const byId = new Map(recognitions.map((item) => [item.slotId, item] as const));
  const summary = summarizeEntryConditionSlots(slots, recognitions);

  return (
    <section id={domId} className="scroll-mt-2 rounded-lg border bg-muted/10 p-3" data-entry-condition-slots>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">入场规则槽（服务端方案）</h3>
        <span className="text-[11px] text-muted-foreground">选方案、调参数；条件由服务端物化后写回定义</span>
        {busy && <span className="text-[11px] text-muted-foreground">计算中…</span>}
      </div>

      <p
        className="mt-1 text-[11px] text-muted-foreground"
        data-entry-condition-summary={summary === "" ? "empty" : "set"}
      >
        {summary === "" ? "（还没有启用入场规则槽 —— 事件出现后按其它买入条件判断）" : summary}
      </p>

      {slots.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground" data-entry-condition-empty>
          服务端当前没有下发入场规则槽。
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
