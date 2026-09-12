/**
 * CandidateSketchFields — 候选**研究草图**的结构化编辑器。
 *
 * ## 为什么不是「五块字段名 + 一堆输入框」
 *
 * 后端只有 5 个 `*Json` 列，那是**存储**边界，不是给人看的目录。第一版表单直接把这 5 列
 * 铺成 5 个面板，结果只是把「人写 JSON」的复杂度搬成了「人读表单」的复杂度：
 * 40 多个输入框、三层框套框、满屏 `entryRule.extra.position.maxExposure` 级别的英文键，
 * 而且**可选字段和必填字段长得一模一样** —— 人根本不知道该填哪几个。
 *
 * 现在按**下单时的思路**分段（权威 `SKETCH_SEGMENTS`）：
 *   ① 买什么 → ② 什么价买 → ③ 怎么卖 → ④ 买多少 · 最多持几只 → ⑤ 成本与资金 → ⑥ 参数搜索空间
 *
 * 降噪的四个手段：
 *   - **默认折叠**，折叠态一行中文摘要（「首板 · 次日开盘买入 · 观察第 1–3 交易日」）；
 *   - **只有第一段有缺口的自动展开**，其余靠顶部「还差什么」的胶囊点击跳转 —— 一次面对一件事；
 *   - **中文优先**，英文键名降为小字（保留它是为了能跟后端错误信息对上）；
 *   - **可选的东西收起来**：事件参数、剔除条件、六项费率、以及语义重叠的「其他风控落点」
 *     都折进「进阶」，默认不占视线。
 *
 * 三条纪律照旧（与 `candidateSketchForm.ts` 同一约定）：
 *   1. **只提供后端认得的取值**。枚举来自 `candidateSketchVocabulary`（本地表 + 对表测试），
 *      转正不支持的运算符（BETWEEN / IS_NULL）在这里**根本不出现**。
 *   2. **不可表达 ⇒ 只读，而不是就地改写**。某一块含未知键 / 非法类型时，该块显示原始 JSON、
 *      **不参与提交**，只能由用户显式「丢弃」。表单化最隐蔽的回归不是崩溃，而是静默丢键。
 *   3. **不做默认值**。留空就是留空 —— 转正会响亮拒绝「缺必填」，不替你猜。
 *      唯一例外是成本段那个**用户自己按下去的**「套用 A 股标准」：按了才算他声明的。
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  BookmarkPlus,
  Check,
  ChevronRight,
  Plus,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CANDIDATE_CONDITION_ARITHMETIC_NOTE,
  CANDIDATE_CONDITION_FIELD_EXAMPLES,
  CANDIDATE_CONDITION_OPERATOR_OPTIONS,
  CANDIDATE_CONDITION_PRESETS,
  CANDIDATE_CONDITION_VALUE_TYPE_OPTIONS,
  CANDIDATE_COST_MODEL_OPTIONS,
  CANDIDATE_ENTRY_TIMING_OPTIONS,
  CANDIDATE_EVENT_OPTIONS,
  CANDIDATE_EVENT_PARAM_HINTS,
  CANDIDATE_FIELD_ROOT_OPTIONS,
  CANDIDATE_PARAMETER_TYPE_OPTIONS,
  CANDIDATE_QUANTITY_METHOD_OPTIONS,
  CANDIDATE_SIZING_METHOD_OPTIONS,
  CANDIDATE_TRIGGER_OPTIONS,
  CANDIDATE_WINDOW_UNIT_OPTIONS,
  buildCandidateFieldReference,
  candidateConditionOperatorOf,
  candidateFieldChoicesOf,
  candidateFieldRootOptionOf,
  describeCandidateCondition,
  splitCandidateFieldReference,
  type CandidateConditionPreset,
  type SketchOption,
} from "./candidateSketchVocabulary";
import {
  conditionsUseNonConjunction,
  describeFilterGroups,
  emptyExitRuleDraft,
  emptyFilterRuleGroups,
  emptyKeyValueRow,
  emptyParameterRow,
  emptyRiskRuleDraft,
  emptyEntryRuleDraft,
  sketchSegmentStatuses,
  type CandidateSketchDrafts,
  type EntryRuleDraft,
  type ExitRuleDraft,
  type KeyValueRowDraft,
  type ParameterRowDraft,
  type RiskRuleDraft,
  type SketchBlockKey,
  type SketchFieldAnchor,
  type SketchGap,
  type SketchRawState,
  type SketchSegmentKey,
  type SketchSegmentStatus,
} from "./candidateSketchForm";
import {
  applyCostPreset,
  describeCostPreset,
  formatCapital,
  formatCostRate,
  isCostAssumptionComplete,
  matchCostPreset,
  preferredCostPreset,
  rememberCostAssumption,
  type CostPreset,
} from "./candidateSketchCostPreset";
import {
  createEmptyCondition,
  createEmptyConditionGroup,
  type ConditionDraft,
  type ConditionGroupDraft,
} from "./createAnalysisForm";

// ---------------------------------------------------------------------------
// 基础控件（本文件私有）
// ---------------------------------------------------------------------------

/**
 * 一个字段的标签行：**中文在前，英文键名在后**。
 *
 * 英文键名不删 —— 它是与后端错误信息、`definitionBuild` 源码对照的唯一锚点；
 * 但它是小字灰字，不抢视线。`valueKey` 用来回显枚举当前选中的**原始值**（同样是给对照用的）。
 *
 * `missing` = 「转正必填但还没填」：由该段缺口的 `anchors` 驱动（**不是**另立一张必填表），
 * 因此清单说缺哪一项，琥珀标记就一定落在哪一项上。
 */
function Field({
  label,
  name,
  valueKey,
  hint,
  missing = false,
  children,
}: {
  label: string;
  name?: string;
  valueKey?: string;
  hint?: string;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <Label className="text-xs">{label}</Label>
        {missing && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] leading-tight text-amber-800">
            必填未填
          </span>
        )}
        {name !== undefined && (
          <code className="font-mono text-[10px] text-muted-foreground/70">{name}</code>
        )}
        {valueKey !== undefined && valueKey.trim() !== "" && (
          <code className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            {valueKey}
          </code>
        )}
      </div>
      <div className={missing ? "rounded-md ring-1 ring-amber-300" : undefined}>{children}</div>
      {hint !== undefined && hint.trim() !== "" && (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** 段内分节：细标题 + 分隔线，**不再套一层框**（第一版三层框套框的噪音主要来自这里）。 */
function Section({
  title,
  missing = false,
  children,
}: {
  title: string;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-baseline gap-1.5 text-[11px] font-medium text-muted-foreground">
        <span>{title}</span>
        {missing && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] leading-tight font-normal text-amber-800">
            必填未填
          </span>
        )}
      </p>
      <div className={missing ? "rounded-md p-1 ring-1 ring-amber-300" : undefined}>{children}</div>
    </div>
  );
}

/** 折叠的「进阶」区（原生 `details`，无状态、可被浏览器搜索）。 */
function Advanced({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-md border border-dashed border-muted-foreground/30">
      <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">
        {title}
        {hint !== undefined && <span className="ml-1.5 text-[10px] opacity-80">{hint}</span>}
      </summary>
      <div className="space-y-3 border-t px-2.5 py-2.5">{children}</div>
    </details>
  );
}

/**
 * 枚举下拉。
 *
 * 用**原生 `select`** 而非 Radix：这里多数枚举是「可选」的，需要一个**真正的空选项**
 * 表示「不填」，而 Radix 的 `SelectItem` 不接受空值。
 * 选项文字只放中文 —— 原始值改由 `Field` 的 `valueKey` 回显，避免每项都拖着
 * 一串 `FIRST_LIMIT_UP` 把下拉撑得很吵。
 */
function EnumSelect({
  value,
  options,
  onChange,
  emptyLabel = "未选择",
}: {
  value: string;
  options: readonly SketchOption[];
  onChange: (next: string) => void;
  emptyLabel?: string;
}) {
  return (
    <select
      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled === true}>
          {option.label}
          {option.disabled === true ? "（当前不可选）" : ""}
        </option>
      ))}
    </select>
  );
}

function NumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      className="h-8 font-mono text-xs"
      value={value}
      placeholder={placeholder ?? "留空 = 不填"}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** 键值行编辑（事件参数 / 风控具名阈值共用）。 */
function KeyValueRows({
  rows,
  onChange,
  keyPlaceholder,
  addLabel,
}: {
  rows: KeyValueRowDraft[];
  onChange: (next: KeyValueRowDraft[]) => void;
  keyPlaceholder: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            className="h-8 w-40 font-mono text-xs"
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(event) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))
            }
          />
          <select
            className="h-8 shrink-0 rounded-md border bg-background px-1.5 text-xs"
            value={row.valueType}
            onChange={(event) =>
              onChange(
                rows.map((r, i) =>
                  i === index
                    ? { ...r, valueType: event.target.value as KeyValueRowDraft["valueType"] }
                    : r,
                ),
              )
            }
          >
            <option value="string">文本</option>
            <option value="number">数字</option>
            <option value="boolean">布尔</option>
          </select>
          <Input
            className="h-8 flex-1 font-mono text-xs"
            value={row.value}
            placeholder="值"
            onChange={(event) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="删除该行"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, emptyKeyValueRow()])}>
        <Plus className="mr-1 h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

/**
 * 只读块提示：表单表达不了这一块 ⇒ 原样展示 + 不参与提交。
 *
 * 不提供「就地编辑」是有意的：把未知键悄悄改写成表单认得的形状再提交，等于替用户删字段。
 */
function RawBlockNotice({ state, onDiscard }: { state: SketchRawState; onDiscard: () => void }) {
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
        <Ban className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          这一段含表单表达不了的内容，已转为只读：{state.reason}
          <br />
          为避免丢数据，本次保存**不会提交**它。想改用表单表达，请先复制下面的内容，再点「丢弃并重填」。
        </span>
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
        {state.rawText}
      </pre>
      <Button type="button" size="sm" variant="outline" onClick={onDiscard}>
        <Trash2 className="mr-1 h-3.5 w-3.5" /> 丢弃并重填（提交 null）
      </Button>
    </div>
  );
}

/** 只读块共用：把 raw 状态渲染出来，或返回 `null` 让调用方走正常路径。 */
function rawOf(drafts: CandidateSketchDrafts, block: SketchBlockKey): SketchRawState | null {
  const state = drafts[block];
  return state.kind === "raw" ? state : null;
}

const segmentDomId = (segment: SketchSegmentKey) => `candidate-sketch-segment-${segment}`;

// ---------------------------------------------------------------------------
// 段外壳：折叠 + 摘要 + 缺口徽标
// ---------------------------------------------------------------------------

/**
 * 段内「转正还差」清单：把 `status.gaps` 的逐条文案原样列出来。
 *
 * 🔴 这一段不是装饰。编辑器此前只在段上显示「还差 N 项」这个**数量**，
 * 于是用户把段里看得见的东西都填完之后，徽标仍停在「还差 1 项」而完全无从下手
 * （真实案例：`when` 段缺 `entryRule.timing`，而它与「触发时点」看着像同一件事）。
 * 逐条列出「差的是谁」是这一段最基本的可用性要求。
 */
function SegmentGapList({ gaps }: { gaps: readonly SketchGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <ul className="space-y-0.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
      {gaps.map((item, index) => (
        <li key={`${index}-${item.label}`} className="flex gap-1.5">
          <span className="shrink-0 tabular-nums">{index + 1}.</span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function SegmentShell({
  index,
  status,
  open,
  onToggle,
  hint,
  children,
}: {
  index: number;
  status: SketchSegmentStatus;
  open: boolean;
  onToggle: () => void;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={segmentDomId(status.segment)}
      data-sketch-segment={status.segment}
      className="scroll-mt-2 rounded-lg border bg-card"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="shrink-0 text-sm font-medium">
          <span className="mr-1 text-muted-foreground">{index}</span>
          {status.title}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {status.summary === "" ? "还没填任何内容" : status.summary}
        </span>
        {status.gapCount > 0 ? (
          <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
            还差 {status.gapCount} 项
          </span>
        ) : status.required ? (
          <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800">
            <Check className="mr-0.5 inline h-2.5 w-2.5" />
            齐了
          </span>
        ) : (
          <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            可选
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <SegmentGapList gaps={status.gaps} />
          <p className="text-[11px] text-muted-foreground">{hint}</p>
          {children}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function CandidateSketchFields({
  drafts,
  onChange,
}: {
  drafts: CandidateSketchDrafts;
  onChange: (next: CandidateSketchDrafts) => void;
}) {
  const statuses = useMemo(() => sketchSegmentStatuses(drafts), [drafts]);
  /** 用户手动开合过的段（`undefined` ⇒ 用「有缺口自动展开」的默认判定）。 */
  const [overrides, setOverrides] = useState<Partial<Record<SketchSegmentKey, boolean>>>({});

  /**
   * 只自动展开**第一段**有缺口的段。
   *
   * 为什么不把所有有缺口的都展开：新候选六段里四段都有缺口，全开会立刻退回「一屏 40 个输入框」，
   * 正是这次要修掉的东西。填完一段，下一段自然接上。
   */
  const autoOpenSegment: SketchSegmentKey | null =
    statuses.find((status) => status.gapCount > 0)?.segment ?? null;
  const isOpen = (status: SketchSegmentStatus) =>
    overrides[status.segment] ?? status.segment === autoOpenSegment;

  const toggle = (segment: SketchSegmentKey, next: boolean) =>
    setOverrides((prev) => ({ ...prev, [segment]: next }));

  const focusSegment = (segment: SketchSegmentKey) => {
    setOverrides((prev) => ({ ...prev, [segment]: true }));
    // 等一帧让 `details`/条件渲染的 DOM 出来再滚。
    requestAnimationFrame(() => {
      document.getElementById(segmentDomId(segment))?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  const setBlock = <K extends SketchBlockKey>(key: K, state: CandidateSketchDrafts[K]) =>
    onChange({ ...drafts, [key]: state });

  // ---- entryRule 的局部写入：把「第一次输入」自动物化成结构化草稿 ----
  const entryStructured = drafts.entryRule.kind === "structured" ? drafts.entryRule.draft : null;
  const entryRaw = rawOf(drafts, "entryRule");
  const setEntry = (part: Partial<EntryRuleDraft>) => {
    if (entryRaw !== null) return;
    const base = entryStructured ?? emptyEntryRuleDraft();
    setBlock("entryRule", { kind: "structured", draft: { ...base, ...part } });
  };

  const exitStructured = drafts.exitRule.kind === "structured" ? drafts.exitRule.draft : null;
  const exitRaw = rawOf(drafts, "exitRule");
  const setExit = (part: Partial<ExitRuleDraft>) => {
    if (exitRaw !== null) return;
    setBlock("exitRule", { kind: "structured", draft: { ...(exitStructured ?? emptyExitRuleDraft()), ...part } });
  };

  const riskStructured = drafts.riskRule.kind === "structured" ? drafts.riskRule.draft : null;
  const riskRaw = rawOf(drafts, "riskRule");
  const setRisk = (part: Partial<RiskRuleDraft>) => {
    if (riskRaw !== null) return;
    setBlock("riskRule", { kind: "structured", draft: { ...(riskStructured ?? emptyRiskRuleDraft()), ...part } });
  };

  const filterGroups = drafts.filterRule.kind === "structured" ? drafts.filterRule.draft : [];
  const filterRaw = rawOf(drafts, "filterRule");
  const parameterRows = drafts.parameterSpace.kind === "structured" ? drafts.parameterSpace.draft : [];
  const parameterRaw = rawOf(drafts, "parameterSpace");

  const totalGaps = statuses.reduce((sum, status) => sum + status.gapCount, 0);

  /**
   * 某个输入框是否「必填未填」。
   *
   * 判据**只来自该段缺口声明的 `anchors`**，不另立一张必填表 —— 否则「清单说缺 A、
   * 高亮落在 B」就是迟早的事（`candidateSketchForm.ts` 里 label 与 anchors 在同一处配对）。
   */
  const missingAt = (segment: SketchSegmentKey, anchor: SketchFieldAnchor): boolean =>
    statuses.some(
      (status) => status.segment === segment && status.gaps.some((item) => item.anchors.includes(anchor)),
    );

  return (
    <div className="space-y-2">
      {totalGaps > 0 && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
          <p className="text-[11px] font-medium text-sky-900">
            距离「可转正」还差 {totalGaps} 项（不影响保存；点一下跳到那一段）
          </p>
          {/*
            ⚠️ 这里必须列**逐条文案**而不是「段名 · 数量」。
            只给数量时，用户把段里看得见的东西都填完、徽标仍停在「还差 1 项」，
            就只能靠猜 —— 这正是「永远还差一项、没法继续」的根因。
          */}
          <ul className="mt-1.5 space-y-0.5">
            {statuses
              .filter((status) => status.gapCount > 0)
              .map((status) => (
                <li key={status.segment}>
                  <button
                    type="button"
                    onClick={() => focusSegment(status.segment)}
                    className="text-left text-[11px] text-sky-900 underline decoration-dotted underline-offset-2 hover:text-sky-700"
                  >
                    <span className="font-medium">{status.title}：</span>
                    {status.gaps.map((item) => item.label).join("；")}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* ① 买什么 ---------------------------------------------------------- */}
      <SegmentShell
        index={1}
        status={statuses[0]}
        open={isOpen(statuses[0])}
        onToggle={() => toggle("what", !isOpen(statuses[0]))}
        hint="这一步只定「观察哪一类事件」。事件类型是转正必填；事件参数可以留空。"
      >
        {entryRaw !== null ? (
          <RawBlockNotice state={entryRaw} onDiscard={() => setBlock("entryRule", { kind: "empty" })} />
        ) : (
          <>
            <Field
              label="事件类型"
              name="entryRule.event"
              valueKey={entryStructured?.event}
              missing={missingAt("what", "entryRule.event")}
              hint="落到 definition.entry.event.type"
            >
              <EnumSelect
                value={entryStructured?.event ?? ""}
                options={CANDIDATE_EVENT_OPTIONS}
                onChange={(value) => setEntry({ event: value })}
                emptyLabel="选一个事件"
              />
            </Field>

            {entryStructured?.event === "CUSTOM_EVENT" && (
              <p className="text-[11px] text-amber-800">
                自定义事件本身没有语义，转正后只认得一个空的 CUSTOM_EVENT —— 请在下面的
                「事件参数」里给出 eventCode 之类的具体标识。
              </p>
            )}

            <Advanced
              title="事件参数（可选）"
              hint={
                (entryStructured?.eventParams ?? []).filter((r) => r.key.trim() !== "").length > 0
                  ? `${(entryStructured?.eventParams ?? []).filter((r) => r.key.trim() !== "").length} 项`
                  : "没有就不用展开"
              }
            >
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">
                  键名**没有白名单**：服务端对 `eventParams` 的键名不作限制，会**原样**透传到
                  `definition.entry.event.params`。下面是两个常见键，点「填入」直接加一行。
                </p>
                <ul className="space-y-1">
                  {CANDIDATE_EVENT_PARAM_HINTS.map((hint) => (
                    <li key={hint.key} className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] text-muted-foreground">
                      <code className="font-mono text-foreground">{hint.key}</code>
                      <span>（{hint.label}）</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() =>
                          setEntry({
                            eventParams: [
                              ...(entryStructured?.eventParams ?? []),
                              { key: hint.key, valueType: hint.valueType, value: hint.example },
                            ],
                          })
                        }
                      >
                        <Plus className="mr-0.5 h-2.5 w-2.5" /> 填入
                      </Button>
                      <span className="basis-full">{hint.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <KeyValueRows
                rows={entryStructured?.eventParams ?? []}
                onChange={(rows) => setEntry({ eventParams: rows })}
                keyPlaceholder="如 eventCode"
                addLabel="加一条事件参数"
              />
            </Advanced>
          </>
        )}
      </SegmentShell>

      {/* ② 什么价买 -------------------------------------------------------- */}
      <SegmentShell
        index={2}
        status={statuses[1]}
        open={isOpen(statuses[1])}
        onToggle={() => toggle("when", !isOpen(statuses[1]))}
        hint="这一段有「什么条件买」和「什么时候买」两组东西。买入条件决定「哪一天算满足」；下面三项是**三个互不相同的必填项**：观察窗口（看事件后哪几根）、触发时点（哪天产生信号）、入场时点（信号出现后在哪根 bar 成交）。三项都没有默认值，缺哪一项就看段首那条琥珀清单。"
      >
        <Section title="满足这些条件才买（全部满足才产生买入信号）">
          {filterRaw !== null ? (
            <RawBlockNotice state={filterRaw} onDiscard={() => setBlock("filterRule", { kind: "empty" })} />
          ) : drafts.filterRule.kind === "empty" ? (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">
                留空 = 「观察窗口里出现事件就买」，不加任何价格/量能条件。
                要表达「T 日涨停 → 观察 5 日 → 回撤到某个价位才买」，就在这里加条件
                —— 窗口内**第一个**同时满足全部条件的交易日就是买入信号日（配合下面的触发时点）。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setBlock("filterRule", { kind: "structured", draft: emptyFilterRuleGroups() })}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> 添加买入条件
              </Button>
            </div>
          ) : (
            <FilterRuleForm
              groups={filterGroups}
              onChange={(next) => setBlock("filterRule", { kind: "structured", draft: next })}
            />
          )}
        </Section>

        {entryRaw !== null ? (
          <RawBlockNotice state={entryRaw} onDiscard={() => setBlock("entryRule", { kind: "empty" })} />
        ) : (
          <>
            <Field
              label="入场时点"
              name="entryRule.timing"
              valueKey={entryStructured?.timing}
              missing={missingAt("when", "entryRule.timing")}
              hint={
                CANDIDATE_ENTRY_TIMING_OPTIONS.find((o) => o.value === entryStructured?.timing)?.note
                ?? "决定「信号在哪根 bar、成交在哪根 bar、按什么价成交」。"
                  + "**与下面的「触发时点」不是同一个字段**：触发时点回答「什么时候产生信号」，"
                  + "这一项回答「信号出现后在哪根 bar 成交」。两个都要选。"
              }
            >
              <EnumSelect
                value={entryStructured?.timing ?? ""}
                options={CANDIDATE_ENTRY_TIMING_OPTIONS}
                onChange={(value) => setEntry({ timing: value })}
                emptyLabel="选一个入场时点"
              />
            </Field>

            <Section
              title="观察窗口（相对事件日的第几根开始看）"
              missing={missingAt("when", "entryRule.observationWindow")}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="起始" name="…observationWindow.start" hint="≥ 1 的整数">
                  <NumInput
                    value={entryStructured?.observationWindow.start ?? ""}
                    placeholder="如 1"
                    onChange={(value) =>
                      setEntry({
                        observationWindow: { ...(entryStructured ?? emptyEntryRuleDraft()).observationWindow, start: value },
                      })
                    }
                  />
                </Field>
                <Field label="结束" name="…observationWindow.end" hint="≥ 起始">
                  <NumInput
                    value={entryStructured?.observationWindow.end ?? ""}
                    placeholder="如 3"
                    onChange={(value) =>
                      setEntry({
                        observationWindow: { ...(entryStructured ?? emptyEntryRuleDraft()).observationWindow, end: value },
                      })
                    }
                  />
                </Field>
                <Field label="单位" name="…observationWindow.unit" hint="必须显式选，不会被默认">
                  <EnumSelect
                    value={entryStructured?.observationWindow.unit ?? ""}
                    options={CANDIDATE_WINDOW_UNIT_OPTIONS}
                    onChange={(value) =>
                      setEntry({
                        observationWindow: { ...(entryStructured ?? emptyEntryRuleDraft()).observationWindow, unit: value },
                      })
                    }
                    emptyLabel="选单位"
                  />
                </Field>
              </div>
            </Section>

            <Field
              label="触发时点"
              name="entryRule.extra.trigger"
              valueKey={entryStructured?.trigger}
              missing={missingAt("when", "entryRule.trigger")}
              hint={
                CANDIDATE_TRIGGER_OPTIONS.find((o) => o.value === entryStructured?.trigger)?.note
                ?? "条件满足后，在哪一天产生信号。要表达「T 日涨停 → 观察 5 日 → 回踩到位才买」，"
                  + "选「首个有效日」。**与上面的「入场时点」是两件事**，两个都要选。"
              }
            >
              <EnumSelect
                value={entryStructured?.trigger ?? ""}
                options={CANDIDATE_TRIGGER_OPTIONS}
                onChange={(value) => setEntry({ trigger: value })}
                emptyLabel="选一个触发时点"
              />
            </Field>
          </>
        )}
      </SegmentShell>

      {/* ③ 怎么卖 ---------------------------------------------------------- */}
      <SegmentShell
        index={3}
        status={statuses[2]}
        open={isOpen(statuses[2])}
        onToggle={() => toggle("exit", !isOpen(statuses[2]))}
        hint="三项都是可选的。**转正不要求**这里非空 —— 但三项都留空等于「没有出场规则」，回测会一路持有到期末，通常不是你想表达的。"
      >
        {exitRaw !== null ? (
          <RawBlockNotice state={exitRaw} onDiscard={() => setBlock("exitRule", { kind: "empty" })} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="止损" name="exitRule.stopLoss" hint="比例，0.05 = 亏 5% 卖出">
                <NumInput
                  value={exitStructured?.stopLoss ?? ""}
                  placeholder="如 0.05"
                  onChange={(value) => setExit({ stopLoss: value })}
                />
              </Field>
              <Field label="止盈" name="exitRule.takeProfit" hint="比例，0.10 = 赚 10% 卖出">
                <NumInput
                  value={exitStructured?.takeProfit ?? ""}
                  placeholder="如 0.1"
                  onChange={(value) => setExit({ takeProfit: value })}
                />
              </Field>
              <Field label="持有天数" name="exitRule.holdingDays" hint="到期按收盘卖出">
                <NumInput
                  value={exitStructured?.holdingDays ?? ""}
                  placeholder="如 3"
                  onChange={(value) => setExit({ holdingDays: value })}
                />
              </Field>
            </div>
            {(exitStructured === null
              || [exitStructured.stopLoss, exitStructured.takeProfit, exitStructured.holdingDays].every(
                (text) => text.trim() === "",
              )) && (
              <p className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900">
                三项都为空：这份草图**没有出场规则**。这不是错误（转正会接受），但请确认这就是你的意思。
              </p>
            )}
          </>
        )}
      </SegmentShell>

      {/* ④ 买多少 · 最多持几只 ---------------------------------------------- */}
      <SegmentShell
        index={4}
        status={statuses[3]}
        open={isOpen(statuses[3])}
        onToggle={() => toggle("sizing", !isOpen(statuses[3]))}
        hint="「最多同时持有几只」是转正必填，且它是 position.maxPositions 的唯一来源；其余三项也是必填。"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="最多同时持有"
            name="riskRule.maxPositions"
            missing={missingAt("sizing", "riskRule.maxPositions")}
            hint="≥ 1 的整数，如 5"
          >
            {riskRaw !== null ? (
              <RawBlockNotice state={riskRaw} onDiscard={() => setBlock("riskRule", { kind: "empty" })} />
            ) : (
              <NumInput
                value={riskStructured?.maxPositions ?? ""}
                placeholder="如 5"
                onChange={(value) => setRisk({ maxPositions: value })}
              />
            )}
          </Field>
          <Field
            label="单标的仓位上限"
            name="riskRule.maxPositionWeight"
            hint="占总资金比例 (0,1]，可留空；与下方进阶里的同名项二选一"
          >
            {riskRaw !== null ? (
              <p className="text-[11px] text-muted-foreground">见左侧只读提示</p>
            ) : (
              <NumInput
                value={riskStructured?.maxPositionWeight ?? ""}
                placeholder="如 0.2"
                onChange={(value) => setRisk({ maxPositionWeight: value })}
              />
            )}
          </Field>
        </div>

        {entryRaw !== null ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
            这一段下面几项属于「入场规则」块，而该块含表单表达不了的内容（只读）—— 原因与原始内容见第 1 段。
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="仓位方式"
                name="…position.sizingMethod"
                valueKey={entryStructured?.position.sizingMethod}
                missing={missingAt("sizing", "entryRule.position.sizingMethod")}
                hint="怎么决定每只买多少钱"
              >
                <EnumSelect
                  value={entryStructured?.position.sizingMethod ?? ""}
                  options={CANDIDATE_SIZING_METHOD_OPTIONS}
                  onChange={(value) => setEntry({ position: { ...(entryStructured ?? emptyEntryRuleDraft()).position, sizingMethod: value } })}
                  emptyLabel="选仓位方式"
                />
              </Field>
              <Field
                label="下单口径"
                name="…execution.quantityMethod"
                valueKey={entryStructured?.execution.quantityMethod}
                missing={missingAt("sizing", "entryRule.execution.quantityMethod")}
                hint="数量按什么算"
              >
                <EnumSelect
                  value={entryStructured?.execution.quantityMethod ?? ""}
                  options={CANDIDATE_QUANTITY_METHOD_OPTIONS}
                  onChange={(value) => setEntry({ execution: { ...(entryStructured ?? emptyEntryRuleDraft()).execution, quantityMethod: value } })}
                  emptyLabel="选下单口径"
                />
              </Field>
              <Field
                label="每手股数"
                name="…execution.lotSize"
                missing={missingAt("sizing", "entryRule.execution.lotSize")}
                hint="A 股是 100"
              >
                <NumInput
                  value={entryStructured?.execution.lotSize ?? ""}
                  placeholder="如 100"
                  onChange={(value) => setEntry({ execution: { ...(entryStructured ?? emptyEntryRuleDraft()).execution, lotSize: value } })}
                />
              </Field>
            </div>

            <Advanced title="进阶：其他仓位与风控落点（一般不用填）" hint="与上方语义重叠，转正时不能两处都填">
              <p className="text-[10px] text-muted-foreground">
                这些是后端定义里另几个可选的落点。它们与上面的字段**说的是同一件事的不同位置**
                （比如「单标的仓位上限」这里也有一份），两处都填会在转正时被明确拒绝。
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="单笔比例" name="position.positionRatio">
                  <NumInput
                    value={entryStructured?.position.positionRatio ?? ""}
                    onChange={(value) => setEntry({ position: { ...(entryStructured ?? emptyEntryRuleDraft()).position, positionRatio: value } })}
                  />
                </Field>
                <Field label="固定金额" name="position.fixedAmount">
                  <NumInput
                    value={entryStructured?.position.fixedAmount ?? ""}
                    onChange={(value) => setEntry({ position: { ...(entryStructured ?? emptyEntryRuleDraft()).position, fixedAmount: value } })}
                  />
                </Field>
                <Field label="最大暴露（仓位）" name="position.maxExposure">
                  <NumInput
                    value={entryStructured?.position.maxExposure ?? ""}
                    onChange={(value) => setEntry({ position: { ...(entryStructured ?? emptyEntryRuleDraft()).position, maxExposure: value } })}
                  />
                </Field>
                <Field label="单标的上限（仓位）" name="position.maxSinglePosition">
                  <NumInput
                    value={entryStructured?.position.maxSinglePosition ?? ""}
                    onChange={(value) => setEntry({ position: { ...(entryStructured ?? emptyEntryRuleDraft()).position, maxSinglePosition: value } })}
                  />
                </Field>
              </div>
              <Section title="扩展风控（落到 definition.risk）">
                <div className="grid gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["stopLoss", "止损比例"],
                      ["maxDrawdown", "最大回撤"],
                      ["maxExposure", "最大暴露"],
                      ["maxSinglePosition", "单标的上限"],
                      ["maxPositions", "最大持仓数"],
                      ["dailyLossLimit", "单日亏损上限"],
                      ["concentrationLimit", "集中度上限"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} label={label} name={`risk.${key}`}>
                      <NumInput
                        value={entryStructured?.risk[key] ?? ""}
                        onChange={(value) => setEntry({ risk: { ...(entryStructured ?? emptyEntryRuleDraft()).risk, [key]: value } })}
                      />
                    </Field>
                  ))}
                </div>
                <KeyValueRows
                  rows={entryStructured?.risk.extensions ?? []}
                  onChange={(rows) => setEntry({ risk: { ...(entryStructured ?? emptyEntryRuleDraft()).risk, extensions: rows } })}
                  keyPlaceholder="如 maxBoardHeight"
                  addLabel="加一条具名阈值"
                />
              </Section>
              <Section title="执行成本模型与约束（落到 execution）">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="滑点模型" name="execution.slippageModel" valueKey={entryStructured?.execution.slippageModel}>
                    <EnumSelect
                      value={entryStructured?.execution.slippageModel ?? ""}
                      options={CANDIDATE_COST_MODEL_OPTIONS}
                      onChange={(value) => setEntry({ execution: { ...(entryStructured ?? emptyEntryRuleDraft()).execution, slippageModel: value } })}
                    />
                  </Field>
                  <Field label="佣金模型" name="execution.commissionModel" valueKey={entryStructured?.execution.commissionModel}>
                    <EnumSelect
                      value={entryStructured?.execution.commissionModel ?? ""}
                      options={CANDIDATE_COST_MODEL_OPTIONS}
                      onChange={(value) => setEntry({ execution: { ...(entryStructured ?? emptyEntryRuleDraft()).execution, commissionModel: value } })}
                    />
                  </Field>
                </div>
                <Field label="执行约束" name="execution.executionConstraints" hint="逗号分隔，可留空">
                  <Input
                    className="h-8 font-mono text-xs"
                    value={entryStructured?.execution.constraintsText ?? ""}
                    onChange={(event) =>
                      setEntry({ execution: { ...(entryStructured ?? emptyEntryRuleDraft()).execution, constraintsText: event.target.value } })
                    }
                  />
                </Field>
              </Section>
            </Advanced>
          </>
        )}
      </SegmentShell>

      {/* ⑤ 成本与资金 ------------------------------------------------------- */}
      <SegmentShell
        index={5}
        status={statuses[4]}
        open={isOpen(statuses[4])}
        onToggle={() => toggle("cost", !isOpen(statuses[4]))}
        hint="初始资金与六项成本费率都是转正必填，而且**没有默认值** —— 所以这里给了一键套用，但你得自己按下去。"
      >
        {entryRaw !== null ? (
          <RawBlockNotice state={entryRaw} onDiscard={() => setBlock("entryRule", { kind: "empty" })} />
        ) : (
          <CostAssumptionPanel
            document={entryStructured?.document ?? emptyEntryRuleDraft().document}
            onChange={(next) => setEntry({ document: next })}
            backtestMaxPositions={entryStructured?.document.maxPositions ?? ""}
            onBacktestMaxPositionsChange={(value) =>
              setEntry({ document: { ...(entryStructured ?? emptyEntryRuleDraft()).document, maxPositions: value } })
            }
            missingCapital={missingAt("cost", "entryRule.document.initialCapital")}
            missingCostModel={missingAt("cost", "entryRule.document.costModel")}
          />
        )}
      </SegmentShell>

      {/* ⑥ 参数搜索空间 ----------------------------------------------------- */}
      <SegmentShell
        index={6}
        status={statuses[5]}
        open={isOpen(statuses[5])}
        onToggle={() => toggle("parameters", !isOpen(statuses[5]))}
        hint="这一段是**可选**的：不填就是「不做参数搜索」。填了的参数角色恒为「待搜索（TUNABLE）」，因此数值参数必须给出 min 与 max。"
      >
        {parameterRaw !== null ? (
          <RawBlockNotice state={parameterRaw} onDiscard={() => setBlock("parameterSpace", { kind: "empty" })} />
        ) : parameterRows.length === 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setBlock("parameterSpace", { kind: "structured", draft: [emptyParameterRow()] })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> 添加待搜索参数
          </Button>
        ) : (
          <ParameterSpaceForm
            rows={parameterRows}
            onChange={(next) => setBlock("parameterSpace", { kind: "structured", draft: next })}
          />
        )}
      </SegmentShell>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ⑤ 成本与资金：一键预设 + 本机记忆
// ---------------------------------------------------------------------------

/**
 * 成本假设面板。
 *
 * 🔴 预设**不会自动写入**：按钮上的那套只是「你上次用的 / A 股标准」，
 *    必须由用户点一下才落进草稿。点下去写进去之后，它就是**用户在草稿里声明的假设**。
 */
function CostAssumptionPanel({
  document,
  onChange,
  backtestMaxPositions,
  onBacktestMaxPositionsChange,
  missingCapital,
  missingCostModel,
}: {
  document: EntryRuleDraft["document"];
  onChange: (next: EntryRuleDraft["document"]) => void;
  backtestMaxPositions: string;
  onBacktestMaxPositionsChange: (next: string) => void;
  missingCapital: boolean;
  missingCostModel: boolean;
}) {
  const [preset, setPreset] = useState<CostPreset>(() => preferredCostPreset());
  const matched = matchCostPreset(document);
  const complete = isCostAssumptionComplete(document);
  const capital = formatCapital(document.initialCapital);

  const applyPreset = () => {
    onChange(applyCostPreset(document, preset) as EntryRuleDraft["document"]);
    rememberCostAssumption(preset.values);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/20 p-2.5">
        <p className="text-xs font-medium">
          {matched !== null
            ? `已套用「${matched.name}」`
            : complete
              ? "自定义成本假设（七项都齐了）"
              : "还没套用成本假设"}
        </p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {describeCostPreset(matched ?? preset)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={applyPreset}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" /> 套用「{preset.name}」
          </Button>
          {complete && matched === null && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                rememberCostAssumption(document);
                setPreset(preferredCostPreset());
              }}
            >
              <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" /> 记为我的常用
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          套用只会写入下面这七项，不会动「回测最大持仓数」。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="初始资金"
          name="…document.backtestConfig.initialCapital"
          hint="元；必须 > 0"
          missing={missingCapital}
          valueKey={capital === "" ? undefined : capital}
        >
          <NumInput
            value={document.initialCapital}
            placeholder="如 100000"
            onChange={(value) => onChange({ ...document, initialCapital: value })}
          />
        </Field>
        <Field label="回测最大持仓数" name="…document.backtestConfig.maxPositions" hint="可留空（与第 4 段的「最多同时持有」不是同一个字段）">
          <NumInput value={backtestMaxPositions} placeholder="可留空" onChange={onBacktestMaxPositionsChange} />
        </Field>
      </div>

      <Section title="六项成本费率（转正必填，六项都要有）" missing={missingCostModel}>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["commissionRate", "佣金率", "0.0003"],
              ["stampDutyRate", "印花税率", "0.001"],
              ["transferFeeRate", "过户费率", "0.00001"],
              ["slippageBps", "滑点（基点）", "10"],
              ["lotSize", "每手股数", "100"],
              ["minCommission", "最低佣金", "5"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <Field
              key={key}
              label={label}
              name={`…costModel.${key}`}
              valueKey={document[key] === "" ? undefined : formatCostRate(document[key])}
            >
              <NumInput
                value={document[key]}
                placeholder={placeholder}
                onChange={(value) => onChange({ ...document, [key]: value })}
              />
            </Field>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 买入条件（唯一去向是 `entry.conditions`，即「全部满足才产生买入信号」）
// ---------------------------------------------------------------------------

/**
 * 一行买入条件。
 *
 * ## 为什么是「部位 + 相对日 + 字段」三格，而不是让人手打 `prefix.rd0.close`
 *
 * `prefix.rd0.close` 是**后端字段引用文法**，不是人的语言。用户想的是「首板日那天的收盘价」，
 * 界面却要他背出「prefix + rd + 0 + .close」—— 这正是「只有很抽象的代码」的来源。
 * 三格选择器写回的仍然是**同一个 `fieldName` 字符串**，模型层与后端契约**一行没变**。
 *
 * 🔴 不可解析的既有值**绝不重建**：`splitCandidateFieldReference` 返回 `null` 时退回自由文本输入，
 *    原样保留。否则「改一下运算符」就会把用户原来的字段名冲掉（典型的静默丢数据）。
 */
function ConditionRow({
  condition,
  index,
  onChange,
  onRemove,
}: {
  condition: ConditionDraft;
  index: number;
  onChange: (next: ConditionDraft) => void;
  onRemove: () => void;
}) {
  const rawField = condition.fieldName.trim();
  const parts = splitCandidateFieldReference(rawField);
  const rootOption = candidateFieldRootOptionOf(parts?.kind ?? "");
  const choices = candidateFieldChoicesOf(parts?.kind ?? "currentBar");
  const operatorOption = candidateConditionOperatorOf(condition.operator);
  const preview = rawField === "" ? null : describeCandidateCondition(rawField, condition.operator, condition.value);

  /** 写字段引用：只有能拆回三段时才重建，否则保持原样。 */
  const writeField = (next: { kind?: string; relativeDay?: string; field?: string }) => {
    if (parts === null) return;
    const kind = next.kind ?? parts.kind;
    const day = next.relativeDay ?? parts.relativeDay;
    const field = next.field ?? parts.field;
    onChange({ ...condition, fieldName: buildCandidateFieldReference(kind, day, field) });
  };

  return (
    <div className="space-y-1.5 rounded-md border bg-background p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {index > 0 && (
          <select
            className="h-8 rounded-md border bg-background px-1.5 text-xs"
            value={condition.logicalOperator}
            onChange={(event) =>
              onChange({ ...condition, logicalOperator: event.target.value as ConditionDraft["logicalOperator"] })
            }
          >
            <option value="AND">并且</option>
            <option value="OR">或者</option>
            <option value="NOT">并且不</option>
          </select>
        )}

        {parts === null ? (
          <>
            <Input
              className="h-8 flex-1 font-mono text-xs"
              list="candidate-condition-field-examples"
              value={condition.fieldName}
              placeholder="字段引用，如 prefix.rd0.close"
              onChange={(event) => onChange({ ...condition, fieldName: event.target.value })}
            />
            {rawField !== "" && (
              <span className="basis-full text-[10px] text-amber-800">
                这个写法不是「部位.相对日.字段」的形状，因此只能用文本编辑；原始内容已原样保留。
              </span>
            )}
          </>
        ) : (
          <>
            <select
              className="h-8 rounded-md border bg-background px-1.5 text-xs"
              value={parts.kind}
              onChange={(event) => {
                const next = candidateFieldRootOptionOf(event.target.value);
                // 换部位时，若字段属于另一张表就清掉（否则会拼出白名单外的组合）。
                const stillValid = next !== undefined
                  && candidateFieldChoicesOf(next.kind).some((choice) => choice.value === parts.field);
                writeField({ kind: event.target.value, field: stillValid ? parts.field : "" });
              }}
            >
              {CANDIDATE_FIELD_ROOT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {rootOption?.takesRelativeDay === true && (
              <Input
                className="h-8 w-20 font-mono text-xs"
                value={parts.relativeDay}
                placeholder={rootOption.dayDefault}
                title={rootOption.dayHint}
                onChange={(event) => writeField({ relativeDay: event.target.value })}
              />
            )}

            <select
              className="h-8 rounded-md border bg-background px-1.5 text-xs"
              value={parts.field}
              onChange={(event) => writeField({ field: event.target.value })}
            >
              <option value="">选择字段</option>
              {choices.some((choice) => choice.value === parts.field) || parts.field === ""
                ? choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))
                : [
                    ...choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    )),
                    <option key="__outside__" value={parts.field}>
                      {parts.field}（不在服务端白名单内，转正会被拒）
                    </option>,
                  ]}
            </select>
          </>
        )}

        <select
          className="h-8 rounded-md border bg-background px-1.5 text-xs"
          value={condition.operator}
          onChange={(event) =>
            onChange({ ...condition, operator: event.target.value as ConditionDraft["operator"] })
          }
        >
          {CANDIDATE_CONDITION_OPERATOR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <Input
          className="h-8 w-44 font-mono text-xs"
          value={condition.value}
          placeholder={operatorOption?.arity === "LIST" ? "逗号分隔，如 main,chinext" : "比较值（可以是另一处行情值）"}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="删除条件"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {preview !== null && (
        <p className="text-[10px] text-muted-foreground">
          = {preview}
          {parts !== null && parts.field !== "" && (
            <span className="ml-1 font-mono opacity-60">{condition.fieldName}</span>
          )}
        </p>
      )}
    </div>
  );
}

function FilterRuleForm({
  groups,
  onChange,
}: {
  groups: ConditionGroupDraft[];
  onChange: (next: ConditionGroupDraft[]) => void;
}) {
  const replaceCondition = (groupIndex: number, conditionIndex: number, next: ConditionDraft) =>
    onChange(
      groups.map((group, i) =>
        i === groupIndex
          ? { ...group, conditions: group.conditions.map((c, j) => (j === conditionIndex ? next : c)) }
          : group,
      ),
    );

  const appendCondition = (next: ConditionDraft) => {
    if (groups.length === 0) {
      onChange([{ logicalOperator: "AND", conditions: [next] }]);
      return;
    }
    onChange(
      groups.map((group, i) =>
        i === groups.length - 1 ? { ...group, conditions: [...group.conditions, next] } : group,
      ),
    );
  };

  const addPreset = (preset: CandidateConditionPreset) =>
    appendCondition({
      ...createEmptyCondition(),
      fieldName: preset.field,
      operator: preset.operator as ConditionDraft["operator"],
      value: preset.value,
    });

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>常用（点一下加一条）：</span>
          {CANDIDATE_CONDITION_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              title={preset.description}
              onClick={() => addPreset(preset)}
            >
              <Plus className="mr-0.5 h-2.5 w-2.5" />
              {preset.name}
            </Button>
          ))}
        </p>
        <p className="text-[10px] text-muted-foreground">{CANDIDATE_CONDITION_ARITHMETIC_NOTE}</p>
      </div>

      {conditionsUseNonConjunction(groups) && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            你用了「或者 / 并且不」。⚠️ **转正会把所有条件当成「并且」** —— Strategy 的条件模型里没有逻辑
            运算符的位置（`entry.conditions` 就是一个 AND 列表），所以「或」会被静默变成「且」，含义会变，
            而且**不会报错**。若这不是你要的，请拆成多条独立条件，或只保留「并且」。
          </span>
        </p>
      )}

      <datalist id="candidate-condition-field-examples">
        {CANDIDATE_CONDITION_FIELD_EXAMPLES.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>

      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="space-y-1.5 rounded-md border bg-muted/20 p-2">
          <div className="flex items-center gap-2">
            {groupIndex > 0 ? (
              <>
                <span className="text-[11px] text-muted-foreground">与上一组</span>
                <select
                  className="h-7 rounded-md border bg-background px-1.5 text-xs"
                  value={group.logicalOperator}
                  onChange={(event) =>
                    onChange(
                      groups.map((g, i) =>
                        i === groupIndex ? { ...g, logicalOperator: event.target.value as "AND" | "OR" } : g,
                      ),
                    )
                  }
                >
                  <option value="AND">同时满足</option>
                  <option value="OR">满足任一</option>
                </select>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">条件组 {groupIndex + 1}</span>
            )}
            {groups.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7"
                aria-label="删除条件组"
                onClick={() => onChange(groups.filter((_, i) => i !== groupIndex))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {group.conditions.map((condition, conditionIndex) => (
            <ConditionRow
              key={conditionIndex}
              condition={condition}
              index={conditionIndex}
              onChange={(next) => replaceCondition(groupIndex, conditionIndex, next)}
              onRemove={() =>
                onChange(
                  groups.map((g, i) =>
                    i === groupIndex
                      ? { ...g, conditions: g.conditions.filter((_, j) => j !== conditionIndex) }
                      : g,
                  ),
                )
              }
            />
          ))}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange(
                groups.map((g, i) =>
                  i === groupIndex ? { ...g, conditions: [...g.conditions, createEmptyCondition()] } : g,
                ),
              )
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> 加一条
          </Button>
        </div>
      ))}

      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...groups, createEmptyConditionGroup()])}>
        <Plus className="mr-1 h-3.5 w-3.5" /> 加一组
      </Button>

      {groups.length > 0 && describeFilterGroups(groups) !== "" && (
        <p className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-[11px]">
          当前买入条件：{describeFilterGroups(groups)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ⑥ 参数搜索空间
// ---------------------------------------------------------------------------

function ParameterSpaceForm({
  rows,
  onChange,
}: {
  rows: ParameterRowDraft[];
  onChange: (next: ParameterRowDraft[]) => void;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="space-y-1.5 rounded-md border bg-muted/20 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              className="h-8 w-44 font-mono text-xs"
              value={row.code}
              placeholder="参数名，如 turnoverLow"
              onChange={(event) => onChange(rows.map((r, i) => (i === index ? { ...r, code: event.target.value } : r)))}
            />
            <select
              className="h-8 rounded-md border bg-background px-1.5 text-xs"
              value={row.type}
              onChange={(event) => onChange(rows.map((r, i) => (i === index ? { ...r, type: event.target.value } : r)))}
            >
              {CANDIDATE_PARAMETER_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8"
              aria-label="删除参数"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-4">
            {row.type === "number" ? (
              <>
                <Input
                  className="h-8 font-mono text-xs"
                  value={row.min}
                  placeholder="min（必填）"
                  onChange={(event) => onChange(rows.map((r, i) => (i === index ? { ...r, min: event.target.value } : r)))}
                />
                <Input
                  className="h-8 font-mono text-xs"
                  value={row.max}
                  placeholder="max（必填）"
                  onChange={(event) => onChange(rows.map((r, i) => (i === index ? { ...r, max: event.target.value } : r)))}
                />
                <Input
                  className="h-8 font-mono text-xs"
                  value={row.step}
                  placeholder="step（可选）"
                  onChange={(event) => onChange(rows.map((r, i) => (i === index ? { ...r, step: event.target.value } : r)))}
                />
              </>
            ) : (
              <Input
                className="h-8 font-mono text-xs sm:col-span-3"
                value={row.allowedValuesText}
                placeholder="候选集合（逗号分隔，必填）"
                onChange={(event) =>
                  onChange(rows.map((r, i) => (i === index ? { ...r, allowedValuesText: event.target.value } : r)))
                }
              />
            )}
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, emptyParameterRow()])}>
        <Plus className="mr-1 h-3.5 w-3.5" /> 添加待搜索参数
      </Button>
      <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>参数角色恒为「待搜索（TUNABLE）」：数值参数必须给 min 与 max，非数值参数必须给非空候选集合。</span>
      </p>
    </div>
  );
}
