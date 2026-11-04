/**
 * FE-PLAN-004 —— 「出场」块的 **9 个规则槽**编辑器。
 *
 * ## 形态（紧凑版，2026-10-03 按用户反馈收）
 *
 *   常显 3 槽：止损位置 · 止盈 · 到期
 *   折叠 5 槽：止损确认 · 止损收紧 · 止损时间表 · 分批止损 · 续持（收进「再加规则」）
 *   最底 1 槽：研究路径（收进「研究专用」，默认关闭）
 *
 * 🔴 **默认形态 = 一行一槽**：`标签 | 方案下拉 | 状态 | ▸ 参数（N）`。
 *    参数折叠在那一行的「参数（N）」里（这就是 NN/g 说的第 2 层）—— 否则一个槽铺开
 *    2–4 个输入框，9 个槽立刻变成一堵墙。槽的人话问题走 `title` 悬浮提示，不占正文高度。
 *
 * ## 🔴 三条纪律
 *
 * 1. **语义全在服务端**：识别（`recognizeExitPolicySlots`）与拼装（`applyExitPolicySlot`）
 *    都是服务端调用 —— 本组件**不拼 policy、不判"这是哪个方案"**。
 * 2. **认不出就不动**：某槽返回 `optionId: null` ⇒ 显示「本表单不识别（保持原样）」，
 *    下拉停在空值；**不会**因为打开页面就把既有政策改写成"最接近的方案"。
 * 3. **不提供整表 Reset**（NN/g I-13）：只有逐槽「恢复该方案默认参数」。
 */
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TechnicalHint } from "@/components/common/FieldTechnicalDetails";
import type { PresetParameter } from "@/components/strategy/authoringSlotParameter";

export type ExitSlotParameterValue = number | boolean | string;

export interface ExitPolicySlotOptionDto {
  readonly optionId: string;
  readonly displayName: string;
  /** 一句话说明（只作 tooltip / 技术细节，不作正文）。 */
  readonly summary: string;
  readonly parameters: readonly PresetParameter[];
}

export interface ExitPolicySlotDto {
  readonly slotId: string;
  readonly label: string;
  readonly question: string;
  readonly visibility: "PRIMARY" | "MORE" | "RESEARCH";
  readonly options: readonly ExitPolicySlotOptionDto[];
}

/** 服务端识别结果：认不出 ⇒ `optionId: null`（**保持原样**）。 */
export interface ExitPolicySlotRecognition {
  readonly slotId: string;
  readonly optionId: string | null;
  readonly parameters: Readonly<Record<string, ExitSlotParameterValue>>;
  readonly atDefaults: boolean;
}

/** 参数取值的**人话**（0.06 → 6%；只做展示换算，不写回 canonical 值）。 */
function humanValue(parameter: PresetParameter, value: ExitSlotParameterValue): string | null {
  if (parameter.valueType !== "number" || typeof value !== "number") return null;
  if (parameter.unit === "ratio") return `= ${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
  if (parameter.unit === "TRADING_DAY") return `= ${String(value)} 个交易日`;
  if (parameter.unit === "CNY") return `= ${value.toLocaleString("zh-CN")} 元`;
  return null;
}

function ParameterInput({
  parameter,
  value,
  disabled,
  onChange,
}: {
  parameter: PresetParameter;
  value: ExitSlotParameterValue;
  disabled: boolean;
  onChange: (next: ExitSlotParameterValue) => void;
}) {
  const hint = humanValue(parameter, value);
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
  if (parameter.allowedValues !== undefined) {
    return (
      <label className="flex flex-col gap-0.5 text-[11px]" title={parameter.description}>
        <span className="text-muted-foreground">{parameter.label}</span>
        <select
          className="h-7 rounded-md border bg-background px-1.5 text-xs"
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

/** 判定阈值时附带的上下限 —— 它们不是这个方案的「身份值」，不参与行内摘要。 */
const SECONDARY_PARAMETER_CODES = new Set(["minStopRatio", "maxStopRatio"]);

/** 单值 → 极短人话：0.06(ratio) → 6%；1.5(MULTIPLE) → 1.5×；5(TRADING_DAY) → 5日。 */
export function compactParameterValue(parameter: PresetParameter, value: ExitSlotParameterValue): string | null {
  if (parameter.valueType === "boolean") return value === true ? "是" : "否";
  if (typeof value !== "number") return null;
  if (parameter.unit === "ratio") return (value * 100).toFixed(2).replace(/\.?0+$/, "") + "%";
  if (parameter.unit === "TRADING_DAY" || parameter.unit === "COUNT") return String(value) + "日";
  if (parameter.unit === "MULTIPLE") return String(value) + "×";
  return String(value);
}

/**
 * 一个槽现在的**取值摘要**（P2）：最多两个「身份值」，用 · 连。
 *
 * 🔴 默认全折叠参数时，用户看不到 6% / 8% 这些真正决定行为的值 —— 摘要就是为此存在。
 *    上下限（min/maxStopRatio）与开关类不进来，免得摘要比方案名还长。
 */
export function summarizeSlotValues(
  option: ExitPolicySlotOptionDto | null,
  parameters: Readonly<Record<string, ExitSlotParameterValue>>,
): string {
  if (option === null) return "";
  const parts: string[] = [];
  for (const parameter of option.parameters) {
    if (SECONDARY_PARAMETER_CODES.has(parameter.code)) continue;
    if (parameter.valueType === "boolean") continue;
    const text = compactParameterValue(parameter, parameters[parameter.code] ?? parameter.defaultValue);
    if (text !== null) parts.push(text);
    if (parts.length >= 2) break;
  }
  return parts.join(" · ");
}

/**
 * 整份退出政策的**一行总述**（P3）—— 由各槽的识别结果拼出来，不展开也看得懂。
 *
 * 只列**实际启用的**槽（off / 认不出 的都跳过），顺序 = 槽表顺序。
 */
export function summarizeExitPolicySlots(
  slots: readonly ExitPolicySlotDto[],
  recognitions: readonly ExitPolicySlotRecognition[],
): string {
  const byId = new Map(recognitions.map((item) => [item.slotId, item] as const));
  const parts: string[] = [];
  for (const slot of slots) {
    const recognized = byId.get(slot.slotId);
    if (recognized === undefined || recognized.optionId === null || recognized.optionId === "off") continue;
    const option = slot.options.find((item) => item.optionId === recognized.optionId) ?? null;
    if (option === null) continue;
    const values = summarizeSlotValues(option, recognized.parameters);
    parts.push(values === "" ? option.displayName : option.displayName + " " + values);
  }
  return parts.join(" · ");
}
function SlotRow({ slot, recognition, disabled, onApply }: {
  slot: ExitPolicySlotDto;
  recognition: ExitPolicySlotRecognition | null;
  disabled: boolean;
  onApply: (input: { slotId: string; optionId: string; parameters: Readonly<Record<string, ExitSlotParameterValue>> }) => void;
}) {
  const [showParams, setShowParams] = useState(false);
  const current = recognition?.optionId ?? "";
  const selected = slot.options.find((option) => option.optionId === current) ?? null;
  const parameters = recognition?.parameters ?? {};
  const unrecognized = recognition !== null && recognition.optionId === null;
  const tuned = selected !== null && recognition !== null && !recognition.atDefaults;
  const params = selected?.parameters ?? [];
  const valueSummary = summarizeSlotValues(selected, parameters);
  const applyWith = (optionId: string, next: Readonly<Record<string, ExitSlotParameterValue>>) =>
    onApply({ slotId: slot.slotId, optionId, parameters: next });

  return (
    <div className="py-1.5" data-exit-slot={slot.slotId}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1" title={slot.question}>
        <span className="w-[4.5rem] shrink-0 text-xs font-medium">{slot.label}</span>
        <select
          className="h-8 min-w-[12rem] flex-1 rounded-md border bg-background px-1.5 text-xs disabled:opacity-50"
          value={current}
          disabled={disabled}
          title={selected?.summary ?? slot.question}
          data-exit-slot-select={slot.slotId}
          onChange={(event) => {
            const optionId = event.target.value;
            if (optionId === "") return;
            const option = slot.options.find((item) => item.optionId === optionId);
            if (option === undefined) return;
            // 换方案 ⇒ 参数回到该方案自己的默认值（不留上一个方案的残留参数）。
            applyWith(optionId, Object.fromEntries(option.parameters.map((item) => [item.code, item.defaultValue])));
          }}
        >
          <option value="">{unrecognized ? "— 本表单不识别（保持原样）—" : "— 未设置 —"}</option>
          {slot.options.map((option) => (
            <option key={option.optionId} value={option.optionId}>{option.displayName}</option>
          ))}
        </select>
        {valueSummary !== "" && (
          <span className="text-[11px] tabular-nums text-muted-foreground" data-exit-slot-value={slot.slotId}>
            {valueSummary}
          </span>
        )}
        {unrecognized && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] text-amber-800">本表单不识别（保持原样）</span>
        )}
        {params.length > 0 && (
          <button type="button" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-exit-slot-params-toggle={slot.slotId} onClick={() => setShowParams((previous) => !previous)}>
            {showParams ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            参数（{params.length}）
          </button>
        )}
      </div>

      {showParams && params.length > 0 && selected !== null && (
        <div className="mt-1.5 space-y-1.5 pl-[4.5rem]">
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {params.map((parameter) => (
              <ParameterInput key={parameter.code} parameter={parameter}
                value={parameters[parameter.code] ?? parameter.defaultValue} disabled={disabled}
                onChange={(next) => applyWith(selected.optionId, { ...parameters, [parameter.code]: next })} />
            ))}
          </div>
          {tuned && (
            <button type="button" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" disabled={disabled}
              onClick={() => applyWith(selected.optionId, Object.fromEntries(params.map((item) => [item.code, item.defaultValue])))}>
              <RotateCcw className="h-3 w-3" />恢复该方案默认参数
            </button>
          )}
        </div>
      )}
    </div>
  );
}
/** 一条「本表单不编辑」的字段（P3）。 */
export interface ExitPolicyUneditedField {
  readonly path: string;
  readonly value: string;
  /** 🔴 两种标注**不能混**：无执行实现 vs 会参与回测但本表单不管。 */
  readonly note: string;
}

/**
 * 列出**本表单不编辑**的退出政策字段（P3）。
 *
 * 两类必须分开说（否则就是误导）：
 *   - stop.contexts 与 capitalRecycle：**仅声明，不参与回测**（全仓零求值器，见 FE-PLAN-004 §1.3）
 *     ⇒ 不提供编辑面，只在技术细节里只读展示；
 *   - strongHold.scaleOutRatio / runnerExitAtHoldingDays …：**会参与回测**，
 *     只是本表单还没做编辑面 ⇒ 必须标成「原样保留」，不能跟着前一类一起说「不参与回测」。
 */
export function uneditedExitPolicyFields(
  policy: Record<string, unknown> | null | undefined,
): readonly ExitPolicyUneditedField[] {
  if (policy === null || policy === undefined) return [];
  const out: ExitPolicyUneditedField[] = [];
  const stop = (policy.stop ?? {}) as Record<string, unknown>;
  if (stop.contexts !== undefined && stop.contexts !== null) {
    out.push({ path: "definition...stop.contexts", value: JSON.stringify(stop.contexts), note: "仅声明，不参与回测（无执行实现）" });
  }
  if (policy.capitalRecycle !== undefined && policy.capitalRecycle !== null) {
    out.push({ path: "definition...policy.capitalRecycle", value: JSON.stringify(policy.capitalRecycle), note: "仅声明，不参与回测（无执行实现；字段与「续持」重复）" });
  }
  const strongHold = (policy.strongHold ?? {}) as Record<string, unknown>;
  for (const key of ["scaleOutRatio", "runnerExitAtHoldingDays", "maxConcurrentRunners", "replacementScoreMargin"]) {
    if (strongHold[key] !== undefined && strongHold[key] !== null) {
      out.push({ path: "definition...strongHold." + key, value: JSON.stringify(strongHold[key]), note: "本表单不编辑，原样保留（会参与回测）" });
    }
  }
  return out;
}
export function ExitPolicySlotEditor({
  slots,
  recognitions,
  policy,
  domId,
  startOptions = [],
  startPresetId = null,
  onStartChange,
  onResetToBase,
  baseLabel,
  disabled = false,
  busy = false,
  onApply,
}: {
  readonly slots: readonly ExitPolicySlotDto[];
  readonly recognitions: readonly ExitPolicySlotRecognition[];
  /** 当前政策（P3：只读展示「本表单不编辑的键」）。 */
  readonly policy?: Record<string, unknown> | null;
  /** 跳转锚点（「完成度概览」的退出政策芯片滚到这里）。 */
  readonly domId?: string;
  /** P4：整包起点（推荐组合）。不传 ⇒ 不渲染起点行。 */
  readonly startOptions?: readonly { readonly presetId: string; readonly displayName: string }[];
  readonly startPresetId?: string | null;
  readonly onStartChange?: (presetId: string) => void;
  /** P4：「改为实验基准」。不传 ⇒ 不渲染该按钮。 */
  readonly onResetToBase?: () => void;
  readonly baseLabel?: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onApply: (input: { slotId: string; optionId: string; parameters: Readonly<Record<string, ExitSlotParameterValue>> }) => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const byId = new Map(recognitions.map((item) => [item.slotId, item] as const));
  const pick = (visibility: ExitPolicySlotDto["visibility"]) => slots.filter((slot) => slot.visibility === visibility);
  const policySummary = summarizeExitPolicySlots(slots, recognitions);

  return (
    <section id={domId} className="scroll-mt-2 rounded-lg border bg-muted/10 p-3" data-exit-policy-slots>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">退出规则（逐槽设置）</h3>
        <span className="text-[11px] text-muted-foreground">
          逐槽选方案；要改就调「参数」
        </span>
        {busy && <span className="text-[11px] text-muted-foreground">计算中…</span>}
      </div>

      {/* P3：一行人话总述 —— 不展开参数也知道自己配的是什么。 */}
      <p className="mt-1 text-[11px] text-muted-foreground" data-exit-policy-summary={policySummary === "" ? "empty" : "set"}>
        {policySummary === "" ? "（还没有启用任何退出规则 —— 会一路持有到回测期末）" : policySummary}
      </p>

      {/* P4：整包起点压成一行（可选；也可以直接逐槽设）。 */}
      {(startOptions.length > 0 || onResetToBase !== undefined) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2" data-exit-policy-start>
          <span className="w-[4.5rem] shrink-0 text-xs font-medium">起点</span>
          <select
            className="h-8 min-w-[12rem] flex-1 rounded-md border bg-background px-1.5 text-xs disabled:opacity-50"
            value={startPresetId ?? ""}
            disabled={disabled}
            data-exit-policy-start-select
            onChange={(event) => {
              const presetId = event.target.value;
              if (presetId === "" || onStartChange === undefined) return;
              onStartChange(presetId);
            }}
          >
            <option value="">— 不用推荐组合（逐槽设 / 用实验基准）—</option>
            {startOptions.map((option) => (
              <option key={option.presetId} value={option.presetId}>{option.displayName}</option>
            ))}
          </select>
          {onResetToBase !== undefined && (
            <button type="button" className="text-[11px] text-muted-foreground underline hover:text-foreground" disabled={disabled}
              data-exit-policy-reset-base onClick={onResetToBase}>
              改为实验基准
            </button>
          )}
          {baseLabel !== undefined && (
            <span className="basis-full pl-[4.5rem] text-[10px] text-muted-foreground">{baseLabel}</span>
          )}
        </div>
      )}

      <div className="mt-1 divide-y">
        {pick("PRIMARY").map((slot) => (
          <SlotRow key={slot.slotId} slot={slot} recognition={byId.get(slot.slotId) ?? null} disabled={disabled} onApply={onApply} />
        ))}
      </div>

      {pick("MORE").length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-exit-slot-more-toggle
            onClick={() => setShowMore((previous) => !previous)}
          >
            {showMore ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            再加规则（{pick("MORE").length} 项：止损确认 / 止损收紧 / 止损时间表 / 分批止损 / 续持）
          </button>
          {showMore && (
            <div className="mt-1 divide-y">
              {pick("MORE").map((slot) => (
                <SlotRow key={slot.slotId} slot={slot} recognition={byId.get(slot.slotId) ?? null} disabled={disabled} onApply={onApply} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- P3：本表单不编辑的键（只读；两个已知无执行实现的字段在这里如实标注） ---- */}
      <TechnicalHint>
        <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2" data-exit-declared-only-fields>
          <p className="text-[10px] font-medium text-muted-foreground">
            以下字段**本表单不编辑**（值原样保留，保存时不会丢）
          </p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
            <li>
              <span className="font-mono">stop.contexts</span> / <span className="font-mono">policy.capitalRecycle</span>
              ：**仅声明，不参与回测** ⇒ 不提供编辑面（FE-PLAN-004 裁定 3）
            </li>
            {uneditedExitPolicyFields(policy).map(field => (
              <li key={field.path}>
                <span className="font-mono">{field.path}</span>：{field.value}
                <span className="ml-1 text-amber-800">（{field.note}）</span>
              </li>
            ))}
            {uneditedExitPolicyFields(policy).length === 0 && <li>（当前政策没有这类字段）</li>}
          </ul>
        </div>
      </TechnicalHint>

      {pick("RESEARCH").length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            data-exit-slot-research-toggle
            onClick={() => setShowResearch((previous) => !previous)}
          >
            {showResearch ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            研究专用路径（单变量研究用，默认不用）
          </button>
          {showResearch && (
            <div className="mt-1 divide-y">
              {pick("RESEARCH").map((slot) => (
                <SlotRow key={slot.slotId} slot={slot} recognition={byId.get(slot.slotId) ?? null} disabled={disabled} onApply={onApply} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
