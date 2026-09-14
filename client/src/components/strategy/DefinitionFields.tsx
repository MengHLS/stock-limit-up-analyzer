/**
 * DefinitionFields — 策略 **Canonical 定义**（`StrategyDocument.definition`）的结构化编辑器。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么要有它（2026-09-13）
 * ═══════════════════════════════════════════════════════════════════════════
 * 本页此前的「策略定义」页签编辑的是 **v1 兼容视图**（`entryRules` / `exitRules` /
 * `riskRules` / `positionSizing`），配一张 `strategyAdapter.ts` 里的**自造字段表**
 * （`candidate.rank` / `price.pctChange` / `account.maxDrawdownPct` …）。实测（真实库 9 个策略）：
 *   - **8 个**策略都带 Canonical `definition`，真正进回测的是它的 `entry.conditions`；
 *   - v1 视图是它的**有损派生结果**，且回测侧对 `entryRules` 的引用数为 **0**；
 *   - 因为 `map.ts#alignDefinitionViews` 是**深度比对**，在那层做的**任何**编辑都会让保存
 *     撞 `SCHEMA_DEFINITION_VIEW_CONFLICT` ⇒ 那个页签既不是真相来源、也存不下去。
 *
 * ⇒ 规则编辑必须落到 `definition`，且**与研究实验的「候选草图」保持同一套交互**
 *   （用户明确要求「这个地方的各种规则理应跟研究实验中的策略候选中的草图应该对齐」）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 与草图「对齐」到什么程度
 * ═══════════════════════════════════════════════════════════════════════════
 * **一样的三件事**（这才是用户能感知的「对齐」）：
 *   1. **七段同序同标题**（`definitionDraft.ts#DEFINITION_SEGMENTS` 由测试锁死与
 *      `SKETCH_SEGMENTS` 逐项相同）：买什么 → 什么条件买 → 什么时候买 → 怎么卖 →
 *      买多少·最多持几只 → 成本与资金 → 参数搜索空间；
 *   2. **同一套渲染外壳**（`@/components/common/SegmentForm`：折叠 + 一行摘要 +
 *      「还差 N 项」徽标 + 顶部逐条缺口胶囊 + 中文优先的字段行 + 琥珀「必填未填」标记）；
 *   3. **同一批词表**（字段引用文法 / 条件运算符与右值类型 / 事件与触发与仓位与成本枚举，
 *      全部从 `research/candidateSketchVocabulary` 复用，**客户端只有一份**）。
 *
 * **刻意不同的一件事**：草图的五个块是「整块替换」（`entryRule` 全部字段一起提交），
 * 所以它只能「整块降级为只读」；这里的 `definition` 是**字段级**的，每一行草稿都带着
 * 服务端原对象（`original`），重建时是 `{ ...original, ...edited }` ⇒
 * 表单不编辑的键（`exit.rules[].condition` / `position.parameter` / `parameters[].derivedFrom`
 * / `conditions[].id` …）**原样穿过**，不需要整块降级。这是 `definition` 结构本身给的便利，
 * 不是纪律上的退让。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 三条纪律（与草图一致）
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. **只提供后端认得的取值**。枚举来自 `definitionVocabulary`（本地表 + 对表测试），
 *      被后端 L6 拒绝的组合（`signalTiming=T_CLOSE` + `executionTiming=T_CLOSE`）在
 *      下拉里**带警告说明**，并在保存前被本地校验拦下（附后端规则名）。
 *   2. **不做语义默认值**。留空就是留空；只有 `operator` / `priority` / `valueType`
 *      这类**结构性**取值给合法初值（否则「刚点添加就报错」，而不是「还没填」）。
 *   3. **不可表达 ⇒ 说清楚**，绝不静默改写。右值里的算术表达式（`prefix.rd0.volume * 0.3`）
 *      在本编辑器里**看得见、改得动、原样保留**，但**无法新拼** —— 这一条如实写在条件段里。
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Ban, Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Advanced,
  EnumSelect,
  Field,
  KeyValueRows,
  NumInput,
  SegmentGapCapsules,
  SegmentShell,
  Section,
  segmentDomId,
} from "@/components/common/SegmentForm";
import {
  CANDIDATE_CONDITION_ARITHMETIC_NOTE,
  CANDIDATE_CONDITION_FIELD_EXAMPLES,
  CANDIDATE_CONDITION_PRESETS,
  CANDIDATE_FIELD_ROOT_OPTIONS,
  buildCandidateFieldReference,
  candidateFieldChoicesOf,
  candidateFieldRootOptionOf,
  describeCandidateCondition,
  splitCandidateFieldReference,
  type CandidateConditionPreset,
} from "@/components/research/candidateSketchVocabulary";
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
} from "@/components/research/candidateSketchCostPreset";
import {
  DEFINITION_CONDITION_OPERATOR_OPTIONS,
  DEFINITION_CONDITION_VALUE_TYPE_OPTIONS,
  DEFINITION_COST_MODEL_OPTIONS,
  DEFINITION_DATASET_ROLE_OPTIONS,
  DEFINITION_EVENT_OPTIONS,
  DEFINITION_EXECUTION_TIMING_OPTIONS,
  DEFINITION_EXIT_RULE_TYPE_OPTIONS,
  DEFINITION_EXIT_THRESHOLD_UNIT_OPTIONS,
  DEFINITION_EXIT_TRIGGER_OPTIONS,
  DEFINITION_PARAMETER_ROLE_OPTIONS,
  DEFINITION_PARAMETER_TYPE_OPTIONS,
  DEFINITION_PRICE_TYPE_OPTIONS,
  DEFINITION_QUANTITY_METHOD_OPTIONS,
  DEFINITION_SIGNAL_TIMING_OPTIONS,
  DEFINITION_SIZING_METHOD_OPTIONS,
  DEFINITION_TRIGGER_OPTIONS,
  DEFINITION_WINDOW_UNIT_OPTIONS,
  definitionConditionOperatorOf,
  definitionOptionLabel,
  symbolToDefinitionOperator,
} from "./definitionVocabulary";
import {
  DEFINITION_SEGMENTS,
  describeConditionRow,
  emptyConditionRow,
  emptyExitRuleRow,
  emptyKeyValueRowDraft,
  emptyParameterRow,
  definitionSegmentStatuses,
  resolveEarliestSignalOffset,
  uneditedKeysOf,
  validateDefinitionDrafts,
  type ConditionRowDraft,
  type DefinitionDrafts,
  type DefinitionFieldAnchor,
  type DefinitionSegmentKey,
  type DefinitionSegmentStatus,
  type ExitRuleRowDraft,
  type ParameterRowDraft,
} from "./definitionDraft";

// ---------------------------------------------------------------------------
// 段 DOM id 前缀（与草图的 `candidate-sketch-segment` 刻意不同，避免同页 id 冲突）
// ---------------------------------------------------------------------------

const SEGMENT_DOM_PREFIX = "definition-segment";

// ---------------------------------------------------------------------------
// 局部控件
// ---------------------------------------------------------------------------

/** 勾选框（`enabled` / `required` 共用）。 */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

/** 只读块提示（形状不符 ⇒ 只读展示，绝不就地改写）。 */
function ReadOnlyNotice({ title, reason, raw }: { title: string; reason: string; raw: string }) {
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
        <Ban className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          {title}：{reason}
          <br />
          为避免丢数据，这里只做只读展示，**原样保留**在定义里。
        </span>
      </p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
        {raw}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ② 买入条件：一行
// ---------------------------------------------------------------------------

/**
 * 一行买入条件。
 *
 * ## 为什么是「部位 + 相对日 + 字段」三格，而不是让人手打 `prefix.rd0.close`
 *
 * `prefix.rd0.close` 是**后端字段引用文法**，不是人的语言。用户想的是「首板日那天的收盘价」。
 * 三格选择器写回的仍是**同一个字符串**，模型层与后端契约一行没变。
 *
 * 🔴 不可解析的既有值**绝不重建**：`splitCandidateFieldReference` 返回 `null` 时退回自由文本，
 * 原样保留。否则「只改一下运算符」就会把用户原来的字段名冲掉（典型的静默丢数据）。
 */
function ConditionRowForm({
  row,
  index,
  onChange,
  onRemove,
}: {
  row: ConditionRowDraft;
  index: number;
  onChange: (next: ConditionRowDraft) => void;
  onRemove: () => void;
}) {
  const rawField = row.field.trim();
  const parts = splitCandidateFieldReference(rawField);
  const rootOption = candidateFieldRootOptionOf(parts?.kind ?? "");
  const choices = candidateFieldChoicesOf(parts?.kind ?? "currentBar");
  const operatorOption = definitionConditionOperatorOf(row.operator);
  const preview = rawField === "" ? null : describeConditionRow(row);

  /** 写字段引用：只有能拆回三段时才重建，否则保持原样。 */
  const writeField = (next: { kind?: string; relativeDay?: string; field?: string }) => {
    if (parts === null) return;
    const kind = next.kind ?? parts.kind;
    const day = next.relativeDay ?? parts.relativeDay;
    const field = next.field ?? parts.field;
    onChange({ ...row, field: buildCandidateFieldReference(kind, day, field) });
  };

  return (
    <div className="space-y-1.5 rounded-md border bg-background p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {parts === null ? (
          <>
            <Input
              className="h-8 flex-1 font-mono text-xs"
              list="definition-condition-field-examples"
              value={row.field}
              placeholder="字段引用，如 bar.low"
              onChange={(event) => onChange({ ...row, field: event.target.value })}
            />
            {rawField !== "" && (
              <span className="basis-full text-[10px] text-amber-800">
                这个写法不是「部位.相对日.字段」的形状，因此只能用文本编辑；**原始内容已原样保留**。
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
                const stillValid =
                  next !== undefined
                  && candidateFieldChoicesOf(next.kind).some((choice) => choice.value === parts.field);
                writeField({ kind: event.target.value, field: stillValid ? parts.field : "" });
              }}
            >
              {CANDIDATE_FIELD_ROOT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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
                      {parts.field}（不在服务端白名单内，保存会被拒）
                    </option>,
                  ]}
            </select>
          </>
        )}

        <select
          className="h-8 rounded-md border bg-background px-1.5 text-xs"
          value={row.operator}
          onChange={(event) => onChange({ ...row, operator: event.target.value })}
        >
          {DEFINITION_CONDITION_OPERATOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <Input
          className="h-8 w-52 font-mono text-xs"
          value={row.value}
          placeholder={
            operatorOption?.arity === "LIST"
              ? "逗号分隔，如 main,chinext"
              : "比较值（可以是另一处行情值）"
          }
          onChange={(event) => onChange({ ...row, value: event.target.value })}
        />

        <select
          className="h-8 rounded-md border bg-background px-1.5 text-xs"
          value={row.valueType}
          title="后端按「能当字段引用解析 ⇒ 字段引用；命中参数名 ⇒ 参数引用；其余 ⇒ 常量」判定，这里让你显式声明它会变成哪种比较"
          onChange={(event) => onChange({ ...row, valueType: event.target.value })}
        >
          {DEFINITION_CONDITION_VALUE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <Toggle
          checked={row.enabled}
          onChange={(enabled) => onChange({ ...row, enabled })}
          label="启用"
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
          <span className="ml-1 font-mono opacity-60">{row.field}</span>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function DefinitionFields({
  drafts,
  onChange,
}: {
  drafts: DefinitionDrafts;
  onChange: (next: DefinitionDrafts) => void;
}) {
  const statuses = useMemo(() => definitionSegmentStatuses(drafts), [drafts]);
  const validation = useMemo(() => validateDefinitionDrafts(drafts), [drafts]);
  const unedited = useMemo(() => uneditedKeysOf(drafts), [drafts]);

  /** 用户手动开合过的段（`undefined` ⇒ 用「第一段有缺口自动展开」的默认判定）。 */
  const [overrides, setOverrides] = useState<Partial<Record<DefinitionSegmentKey, boolean>>>({});

  /**
   * 只自动展开**第一段**有缺口的段 —— 全开就退回「一屏几十个输入框」。
   */
  const autoOpenSegment: DefinitionSegmentKey | null =
    statuses.find((status) => status.gapCount > 0)?.segment ?? null;
  const isOpen = (status: DefinitionSegmentStatus) =>
    overrides[status.segment] ?? status.segment === autoOpenSegment;

  const toggle = (segment: DefinitionSegmentKey, next: boolean) =>
    setOverrides((prev) => ({ ...prev, [segment]: next }));

  const focusSegment = (segment: DefinitionSegmentKey) => {
    toggle(segment, true);
    requestAnimationFrame(() => {
      document.getElementById(segmentDomId(SEGMENT_DOM_PREFIX, segment))?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  };

  const set = <K extends keyof DefinitionDrafts>(key: K, value: DefinitionDrafts[K]) =>
    onChange({ ...drafts, [key]: value });

  const totalGaps = statuses.reduce((sum, status) => sum + status.gapCount, 0);

  /**
   * 某个输入框是否「必填未填」。
   *
   * 判据**只来自该段缺口声明的 `anchors`**（`definitionDraft.ts#DEFINITION_GAP_ANCHORS`），
   * 不另立一张必填表 —— 否则「清单说缺 A、高亮落在 B」就是迟早的事。
   */
  const missingAt = (segment: DefinitionSegmentKey, anchor: DefinitionFieldAnchor): boolean =>
    statuses.some(
      (status) =>
        status.segment === segment && status.gaps.some((item) => item.anchors.includes(anchor)),
    );

  // ---- 早期信号偏移（决定买入条件里能前视到第几根）----
  const startNum = Number(drafts.window.start);
  const endNum = Number(drafts.window.end);
  const timeline = resolveEarliestSignalOffset(
    drafts.trigger.type,
    Number.isFinite(startNum) ? startNum : 0,
    Number.isFinite(endNum) ? endNum : 0,
    drafts.window.unit,
  );

  /** 出场规则可用的下一个优先级（后端要求非负整数且同一出场定义内唯一）。 */
  const nextExitPriority =
    Math.max(-1, ...drafts.exitRules.map((row) => (row.priority.trim() === "" ? -1 : Number(row.priority)))) + 1;

  const addExitPreset = (preset: { type: string; trigger: string; threshold: string; thresholdUnit: string }) =>
    set("exitRules", [
      ...drafts.exitRules,
      { ...emptyExitRuleRow(nextExitPriority), ...preset },
    ]);

  const addConditionPreset = (preset: CandidateConditionPreset) => {
    // 🔴 预设是**草图侧**的符号形运算符（`>=`），而 `definition` 存的是服务端**名称**
    // （`GREATER_THAN_OR_EQUAL`）⇒ 必须先翻译。翻译不了就不插入 —— 插一条必被拒的行
    // 比不插入更糟（用户要到保存时才发现）。
    const operator = symbolToDefinitionOperator(preset.operator);
    if (operator === "") {
      toast.error("这个预设的运算符在定义侧没有对应值，未插入", {
        description: `预设「${preset.name}」用的是 ${JSON.stringify(preset.operator)}`,
      });
      return;
    }
    set("conditions", [
      ...drafts.conditions,
      { ...emptyConditionRow(), field: preset.field, operator, value: preset.value },
    ]);
  };

  return (
    <div className="space-y-2">
      {/* ---- 校验：错误拦住保存，警告只提醒 ---- */}
      {validation.errors.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-red-800">
            <AlertTriangle className="h-3 w-3" /> 有 {validation.errors.length} 项填错，保存会被后端拒绝
          </p>
          <ul className="mt-1 space-y-0.5">
            {validation.errors.map((message, index) => (
              <li key={`${index}-${message}`} className="flex gap-1.5 text-[11px] text-red-900">
                <span className="shrink-0 tabular-nums">{index + 1}.</span>
                <span>{message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {validation.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-900">
            <Info className="h-3 w-3" /> {validation.warnings.length} 项提醒（不阻止保存，但含义会变）
          </p>
          <ul className="mt-1 space-y-0.5">
            {validation.warnings.map((message, index) => (
              <li key={`${index}-${message}`} className="flex gap-1.5 text-[11px] text-amber-900">
                <span className="shrink-0 tabular-nums">{index + 1}.</span>
                <span>{message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SegmentGapCapsules
        statuses={statuses}
        onFocus={focusSegment}
        lead={`距离「后端会接受」还差 ${totalGaps} 项（本页不拦你保存；服务端校验会拒）`}
      />

      {/* ① 买什么 ---------------------------------------------------------- */}
      <SegmentShell
        index={1}
        domIdPrefix={SEGMENT_DOM_PREFIX}
        status={statuses[0]}
        open={isOpen(statuses[0])}
        onToggle={() => toggle("what", !isOpen(statuses[0]))}
        hint={DEFINITION_SEGMENTS[0].hint}
      >
        <Field
          label="事件类型"
          name="definition.entry.event.type"
          valueKey={drafts.event.type}
          missing={missingAt("what", "event.type")}
          hint="决定「哪些交易日算候选」，也是后面所有相对日（rd0 / rd-1 …）的原点"
        >
          <EnumSelect
            value={drafts.event.type}
            options={DEFINITION_EVENT_OPTIONS}
            onChange={(value) => set("event", { ...drafts.event, type: value })}
            emptyLabel="选一个事件"
          />
        </Field>

        {drafts.event.type === "CUSTOM_EVENT" && (
          <p className="text-[11px] text-amber-800">
            自定义事件要靠参数里的 <code className="font-mono">eventCode</code> 说明语义，
            否则这是一个没有任何含义的空事件。
          </p>
        )}

        <Advanced
          title="事件参数（可选）"
          hint={
            drafts.event.params.filter((row) => row.key.trim() !== "").length > 0
              ? `${drafts.event.params.filter((row) => row.key.trim() !== "").length} 项`
              : undefined
          }
        >
          {drafts.event.paramsExpressible ? (
            <>
              <p className="text-[10px] text-muted-foreground">
                键名无白名单，会原样透传到 <code className="font-mono">entry.event.params</code>。
                真实库里用的是 <code className="font-mono">limitUpRatio</code>。
              </p>
              <KeyValueRows
                rows={drafts.event.params}
                onChange={(rows) => set("event", { ...drafts.event, params: rows })}
                newRow={emptyKeyValueRowDraft}
                keyPlaceholder="如 limitUpRatio"
                addLabel="加一条事件参数"
              />
            </>
          ) : (
            <ReadOnlyNotice
              title="事件参数含表单表达不了的值"
              reason="`params` 里出现了非标量值"
              raw={JSON.stringify(drafts.event.original.params ?? null, null, 2)}
            />
          )}
        </Advanced>

        <Section title="数据集绑定（由转正 / 持久化层写入，本页不编辑）">
          {drafts.datasets.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              这份定义没有声明数据集绑定（<code className="font-mono">definition.datasets</code> 为空）。
            </p>
          ) : (
            <ul className="space-y-1">
              {drafts.datasets.map((row, index) => (
                <li
                  key={`${row.datasetId}-${index}`}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border bg-muted/20 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="font-medium">
                    {definitionOptionLabel(DEFINITION_DATASET_ROLE_OPTIONS, row.role) || row.role}
                  </span>
                  <code className="font-mono">{row.datasetId}</code>
                  <code className="font-mono text-muted-foreground">{row.datasetVersion}</code>
                  {row.datasetVersionId !== "" && (
                    <code className="font-mono text-muted-foreground">
                      datasetVersionId={row.datasetVersionId}
                    </code>
                  )}
                  {typeof row.original.note === "string" && row.original.note.trim() !== "" && (
                    <span className="basis-full text-muted-foreground">{row.original.note}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-muted-foreground">
            坐标是「基础信息」里的 <code className="font-mono">datasetVersionId</code>（= <code className="font-mono">dataset_version.id</code>）。
            上面这一行是定义自己的绑定快照，保存时**原样保留**（含 `note`），不由本表单改写。
          </p>
        </Section>
      </SegmentShell>

      {/* ② 什么条件买（可空） ------------------------------------------------ */}
      <SegmentShell
        index={2}
        domIdPrefix={SEGMENT_DOM_PREFIX}
        status={statuses[1]}
        open={isOpen(statuses[1])}
        onToggle={() => toggle("condition", !isOpen(statuses[1]))}
        hint={DEFINITION_SEGMENTS[1].hint}
      >
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
                onClick={() => addConditionPreset(preset)}
              >
                <Plus className="mr-0.5 h-2.5 w-2.5" />
                {preset.name}
              </Button>
            ))}
          </p>
          <p className="text-[10px] text-muted-foreground">{CANDIDATE_CONDITION_ARITHMETIC_NOTE}</p>
        </div>

        <datalist id="definition-condition-field-examples">
          {CANDIDATE_CONDITION_FIELD_EXAMPLES.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>

        {drafts.conditions.length === 0 ? (
          <p className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900">
            没有买入条件 ⇒ 观察窗口内**一出现该事件就产生买入信号**。要「回踩到位才买」，就在这里加条件。
          </p>
        ) : (
          <div className="space-y-1.5">
            {drafts.conditions.map((row, index) => (
              <ConditionRowForm
                key={index}
                row={row}
                index={index}
                onChange={(next) =>
                  set("conditions", drafts.conditions.map((r, i) => (i === index ? next : r)))
                }
                onRemove={() => set("conditions", drafts.conditions.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => set("conditions", [...drafts.conditions, emptyConditionRow()])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> 加一条买入条件
        </Button>

        <p className="text-[10px] text-muted-foreground">
          ⚠️ 已有的算术右值（如 <code className="font-mono">prefix.rd0.volume * 0.3</code>）会被
          <strong>原样保留</strong>，也改得动；但本表单**无法新拼**一个算式 —— 那是后端
          `ConditionDefinition` 的表达边界，不是界面省事。
        </p>
      </SegmentShell>

      {/* ③ 什么时候买 -------------------------------------------------------- */}
      <SegmentShell
        index={3}
        domIdPrefix={SEGMENT_DOM_PREFIX}
        status={statuses[2]}
        open={isOpen(statuses[2])}
        onToggle={() => toggle("when", !isOpen(statuses[2]))}
        hint={DEFINITION_SEGMENTS[2].hint}
      >
        <Section
          title="观察窗口（相对事件日的第几根开始看）"
          missing={missingAt("when", "window")}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="起始" name="…observationWindow.start">
              <NumInput
                value={drafts.window.start}
                placeholder="如 1"
                onChange={(value) => set("window", { ...drafts.window, start: value })}
              />
            </Field>
            <Field label="结束" name="…observationWindow.end">
              <NumInput
                value={drafts.window.end}
                placeholder="如 5"
                onChange={(value) => set("window", { ...drafts.window, end: value })}
              />
            </Field>
            <Field label="单位" name="…observationWindow.unit">
              <EnumSelect
                value={drafts.window.unit}
                options={DEFINITION_WINDOW_UNIT_OPTIONS}
                onChange={(value) => set("window", { ...drafts.window, unit: value })}
                emptyLabel="选单位"
              />
            </Field>
          </div>
        </Section>

        <Field
          label="触发时点"
          name="definition.entry.trigger.type"
          valueKey={drafts.trigger.type}
          missing={missingAt("when", "trigger")}
          hint={DEFINITION_TRIGGER_OPTIONS.find((o) => o.value === drafts.trigger.type)?.note}
        >
          <EnumSelect
            value={drafts.trigger.type}
            options={DEFINITION_TRIGGER_OPTIONS}
            onChange={(value) => set("trigger", { ...drafts.trigger, type: value })}
            emptyLabel="条件满足后哪天出信号"
          />
        </Field>

        {/*
          信号时间线是「前视红线」的所在：它决定买入条件里最多能引用到事件后第几根。
          这里把结论摊开写，而不是等用户在条件段里踩到前视警告才发现。
        */}
        <p className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-[11px]">
          {timeline.resolvable && timeline.maxOffset !== null ? (
            <>
              按当前设置，信号最早出现在**事件后第 {timeline.maxOffset} 个交易日** ⇒
              买入条件里引用 <code className="font-mono">post.rd{"{n}"}</code> 时，n 最多到{" "}
              <strong>{timeline.maxOffset}</strong>；再往后就是前视。
            </>
          ) : (
            <>
              按当前设置**无法解析出信号偏移**（触发时点未选，或窗口单位是自然日）⇒
              任何前视引用（<code className="font-mono">post.rd{"{n}"}</code>）都会被后端按「不可解析」拒绝。
            </>
          )}
        </p>

        <Advanced
          title="触发参数（可选）"
          hint={
            drafts.trigger.params.filter((row) => row.key.trim() !== "").length > 0
              ? `${drafts.trigger.params.filter((row) => row.key.trim() !== "").length} 项`
              : undefined
          }
        >
          {drafts.trigger.paramsExpressible ? (
            <KeyValueRows
              rows={drafts.trigger.params}
              onChange={(rows) => set("trigger", { ...drafts.trigger, params: rows })}
              newRow={emptyKeyValueRowDraft}
              keyPlaceholder="如 offset"
              addLabel="加一条触发参数"
            />
          ) : (
            <ReadOnlyNotice
              title="触发参数含表单表达不了的值"
              reason="`trigger.params` 里出现了非标量值"
              raw={JSON.stringify(drafts.trigger.original.params ?? null, null, 2)}
            />
          )}
        </Advanced>
      </SegmentShell>

      {/* ④ 怎么卖 ---------------------------------------------------------- */}
      <SegmentShell
        index={4}
        domIdPrefix={SEGMENT_DOM_PREFIX}
        status={statuses[3]}
        open={isOpen(statuses[3])}
        onToggle={() => toggle("exit", !isOpen(statuses[3]))}
        hint={DEFINITION_SEGMENTS[3].hint}
      >
        <div className="space-y-2">
          {drafts.exitRules.length === 0 && (
            <p className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900">
              没有出场规则 ⇒ 会一路持有到回测期末。后端会接受，确认这是你要的即可。
            </p>
          )}

          {drafts.exitRules.map((row, index) => (
            <div key={index} className="space-y-1.5 rounded-md border bg-background p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  className="h-8 rounded-md border bg-background px-1.5 text-xs"
                  value={row.type}
                  onChange={(event) =>
                    set(
                      "exitRules",
                      drafts.exitRules.map((r, i) =>
                        i === index ? { ...r, type: event.target.value } : r,
                      ),
                    )
                  }
                >
                  <option value="">选类型</option>
                  {DEFINITION_EXIT_RULE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  className="h-8 rounded-md border bg-background px-1.5 text-xs"
                  value={row.trigger}
                  onChange={(event) =>
                    set(
                      "exitRules",
                      drafts.exitRules.map((r, i) =>
                        i === index ? { ...r, trigger: event.target.value } : r,
                      ),
                    )
                  }
                >
                  <option value="">判定时点</option>
                  {DEFINITION_EXIT_TRIGGER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <Input
                  className="h-8 w-24 font-mono text-xs"
                  value={row.threshold}
                  placeholder="阈值"
                  onChange={(event) =>
                    set(
                      "exitRules",
                      drafts.exitRules.map((r, i) =>
                        i === index ? { ...r, threshold: event.target.value } : r,
                      ),
                    )
                  }
                />

                <select
                  className="h-8 rounded-md border bg-background px-1.5 text-xs"
                  value={row.thresholdUnit}
                  onChange={(event) =>
                    set(
                      "exitRules",
                      drafts.exitRules.map((r, i) =>
                        i === index ? { ...r, thresholdUnit: event.target.value } : r,
                      ),
                    )
                  }
                >
                  <option value="">单位</option>
                  {DEFINITION_EXIT_THRESHOLD_UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <Input
                  className="h-8 w-16 font-mono text-xs"
                  value={row.priority}
                  title="优先级：数值越小越先判定；同一出场定义内不得重复"
                  placeholder="优先级"
                  onChange={(event) =>
                    set(
                      "exitRules",
                      drafts.exitRules.map((r, i) =>
                        i === index ? { ...r, priority: event.target.value } : r,
                      ),
                    )
                  }
                />

                <Toggle
                  checked={row.enabled}
                  onChange={(enabled) =>
                    set(
                      "exitRules",
                      drafts.exitRules.map((r, i) => (i === index ? { ...r, enabled } : r)),
                    )
                  }
                  label="启用"
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label="删除出场规则"
                  onClick={() => set("exitRules", drafts.exitRules.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {typeof row.original.condition === "object" && row.original.condition !== null && (
                <p className="text-[10px] text-amber-800">
                  这条规则还带一个 condition（不在本表单的编辑范围内）—— 保存时**原样保留**。
                </p>
              )}
              {typeof row.original.parameter === "string" && row.original.parameter.trim() !== "" && (
                <p className="text-[10px] text-muted-foreground">
                  这条规则的阈值来自参数 <code className="font-mono">{row.original.parameter}</code>
                  （表单不编辑 parameter；上面的「阈值」留空即沿用参数）。
                </p>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => set("exitRules", [...drafts.exitRules, emptyExitRuleRow(nextExitPriority)])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> 加一条出场规则
            </Button>
            <span className="text-[10px] text-muted-foreground">常用（取自真实库内策略）：</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() =>
                addExitPreset({ type: "STOP_LOSS", trigger: "INTRADAY", threshold: "0.05", thresholdUnit: "RATIO" })
              }
            >
              止损 5%
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() =>
                addExitPreset({ type: "TIME_EXIT", trigger: "ON_CLOSE", threshold: "5", thresholdUnit: "TRADING_DAY" })
              }
            >
              持有 5 个交易日
            </Button>
          </div>
        </div>
      </SegmentShell>

      {/* ⑤ 买多少 · 最多持几只 ---------------------------------------------- */}
      <SegmentShell
        index={5}
        domIdPrefix={SEGMENT_DOM_PREFIX}
        status={statuses[4]}
        open={isOpen(statuses[4])}
        onToggle={() => toggle("sizing", !isOpen(statuses[4]))}
        hint={DEFINITION_SEGMENTS[4].hint}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="仓位方式"
            name="definition.position.sizingMethod"
            valueKey={drafts.position.sizingMethod}
            missing={missingAt("sizing", "position.sizingMethod")}
          >
            <EnumSelect
              value={drafts.position.sizingMethod}
              options={DEFINITION_SIZING_METHOD_OPTIONS}
              onChange={(value) => set("position", { ...drafts.position, sizingMethod: value })}
              emptyLabel="选仓位方式"
            />
          </Field>
          <Field
            label="最多同时持有"
            name="definition.position.maxPositions"
            missing={missingAt("sizing", "position.maxPositions")}
            hint="≥ 1 的整数"
          >
            <NumInput
              value={drafts.position.maxPositions}
              placeholder="如 5"
              onChange={(value) => set("position", { ...drafts.position, maxPositions: value })}
            />
          </Field>
          <Field
            label="单标的仓位上限"
            name="definition.position.maxSinglePosition"
            hint="占总资金比例 (0,1]，如 0.2"
          >
            <NumInput
              value={drafts.position.maxSinglePosition}
              placeholder="如 0.2"
              onChange={(value) =>
                set("position", { ...drafts.position, maxSinglePosition: value })
              }
            />
          </Field>
          <Field
            label="下单口径"
            name="definition.execution.quantityMethod"
            valueKey={drafts.execution.quantityMethod}
            missing={missingAt("sizing", "execution.quantityMethod")}
            hint="数量按什么算"
          >
            <EnumSelect
              value={drafts.execution.quantityMethod}
              options={DEFINITION_QUANTITY_METHOD_OPTIONS}
              onChange={(value) => set("execution", { ...drafts.execution, quantityMethod: value })}
              emptyLabel="选下单口径"
            />
          </Field>
          <Field
            label="每手股数"
            name="definition.execution.lotSize"
            missing={missingAt("sizing", "execution.lotSize")}
            hint="A 股是 100"
          >
            <NumInput
              value={drafts.execution.lotSize}
              placeholder="如 100"
              onChange={(value) => set("execution", { ...drafts.execution, lotSize: value })}
            />
          </Field>
          <Field
            label="风控里的最多持仓数"
            name="definition.risk.maxPositions"
            missing={missingAt("sizing", "risk.maxPositions")}
            hint="与上面的 position.maxPositions 含义重叠；两者都给且不一致会提醒"
          >
            <NumInput
              value={drafts.risk.maxPositions}
              placeholder="通常与上面同值"
              onChange={(value) => set("risk", { ...drafts.risk, maxPositions: value })}
            />
          </Field>
        </div>

        <Advanced title="进阶：其余仓位与风控落点" hint="表单不常编辑，但会原样保存">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="单笔比例" name="position.positionRatio" hint="(0,1]">
              <NumInput
                value={drafts.position.positionRatio}
                onChange={(value) => set("position", { ...drafts.position, positionRatio: value })}
              />
            </Field>
            <Field label="固定金额" name="position.fixedAmount">
              <NumInput
                value={drafts.position.fixedAmount}
                onChange={(value) => set("position", { ...drafts.position, fixedAmount: value })}
              />
            </Field>
            <Field label="最大暴露（仓位）" name="position.maxExposure" hint="[0,1]">
              <NumInput
                value={drafts.position.maxExposure}
                onChange={(value) => set("position", { ...drafts.position, maxExposure: value })}
              />
            </Field>
            <Field label="风控单标的上限" name="risk.maxSinglePosition" hint="[0,1]">
              <NumInput
                value={drafts.risk.maxSinglePosition}
                onChange={(value) => set("risk", { ...drafts.risk, maxSinglePosition: value })}
              />
            </Field>
          </div>
          <Section title="扩展风控（落到 definition.risk 的具名阈值）">
            <div className="grid gap-3 sm:grid-cols-4">
              {(
                [
                  ["stopLoss", "止损比例"],
                  ["maxDrawdown", "最大回撤"],
                  ["maxExposure", "最大暴露"],
                  ["dailyLossLimit", "单日亏损上限"],
                  ["concentrationLimit", "集中度上限"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label} name={`risk.${key}`}>
                  <NumInput
                    value={drafts.risk[key]}
                    onChange={(value) => set("risk", { ...drafts.risk, [key]: value })}
                  />
                </Field>
              ))}
            </div>
            {drafts.risk.extensionsExpressible ? (
              <KeyValueRows
                rows={drafts.risk.extensions}
                onChange={(rows) => set("risk", { ...drafts.risk, extensions: rows })}
                newRow={emptyKeyValueRowDraft}
                keyPlaceholder="如 maxBoardHeight"
                addLabel="加一条具名阈值"
              />
            ) : (
              <ReadOnlyNotice
                title="扩展风控含表单表达不了的值"
                reason="`risk.extensions` 里出现了非标量值"
                raw={JSON.stringify(drafts.risk.original.extensions ?? null, null, 2)}
              />
            )}
          </Section>
        </Advanced>
      </SegmentShell>

      {/* ⑥ 成本与资金 ------------------------------------------------------- */}
      <SegmentShell
        index={6}
        domIdPrefix={SEGMENT_DOM_PREFIX}
        status={statuses[5]}
        open={isOpen(statuses[5])}
        onToggle={() => toggle("cost", !isOpen(statuses[5]))}
        hint={DEFINITION_SEGMENTS[5].hint}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="信号时点"
            name="definition.execution.signalTiming"
            valueKey={drafts.execution.signalTiming}
            missing={missingAt("cost", "execution.signalTiming")}
          >
            <EnumSelect
              value={drafts.execution.signalTiming}
              options={DEFINITION_SIGNAL_TIMING_OPTIONS}
              onChange={(value) => set("execution", { ...drafts.execution, signalTiming: value })}
              emptyLabel="信号在哪根 bar 判定"
            />
          </Field>
          <Field
            label="成交时点"
            name="definition.execution.executionTiming"
            valueKey={drafts.execution.executionTiming}
            missing={missingAt("cost", "execution.executionTiming")}
            hint={DEFINITION_EXECUTION_TIMING_OPTIONS.find(
              (o) => o.value === drafts.execution.executionTiming,
            )?.note}
          >
            <EnumSelect
              value={drafts.execution.executionTiming}
              options={DEFINITION_EXECUTION_TIMING_OPTIONS}
              onChange={(value) => set("execution", { ...drafts.execution, executionTiming: value })}
              emptyLabel="哪根 bar 成交"
            />
          </Field>
          <Field
            label="成交价格类型"
            name="definition.execution.priceType"
            valueKey={drafts.execution.priceType}
            missing={missingAt("cost", "execution.priceType")}
          >
            <EnumSelect
              value={drafts.execution.priceType}
              options={DEFINITION_PRICE_TYPE_OPTIONS}
              onChange={(value) => set("execution", { ...drafts.execution, priceType: value })}
              emptyLabel="选价格类型"
            />
          </Field>
        </div>

        <p className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          后端的硬约束：<strong>L6</strong> 成交不得早于或等于信号时点
          （`signalTiming=T_CLOSE` + `executionTiming=T_CLOSE` 必被拒，规则名
          `SIGNAL_EXECUTION_TIMING_CONFLICT`）；<strong>L7</strong> 触发时点为「次一交易日」时不能
          同 bar 成交（`TRIGGER_EXECUTION_INCONSISTENT`）。填错了上面的红色清单会直接点出来。
        </p>

        <Section title="成本与资金（文档级 executionAssumptions，不属于 definition）">
          <CostFields drafts={drafts} onChange={onChange} missingCapital={missingAt("cost", "cost.initialCapital")} missingRates={missingAt("cost", "cost.rates")} />
        </Section>

        <Advanced title="进阶：费用模型与执行约束（落到 definition.execution）">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="滑点模型"
              name="execution.slippageModel"
              valueKey={drafts.execution.slippageModel}
            >
              <EnumSelect
                value={drafts.execution.slippageModel}
                options={DEFINITION_COST_MODEL_OPTIONS}
                onChange={(value) => set("execution", { ...drafts.execution, slippageModel: value })}
              />
            </Field>
            <Field
              label="佣金模型"
              name="execution.commissionModel"
              valueKey={drafts.execution.commissionModel}
            >
              <EnumSelect
                value={drafts.execution.commissionModel}
                options={DEFINITION_COST_MODEL_OPTIONS}
                onChange={(value) => set("execution", { ...drafts.execution, commissionModel: value })}
              />
            </Field>
          </div>
          <Field
            label="执行约束"
            name="execution.executionConstraints"
            hint="逗号分隔，可留空"
          >
            <Input
              className="h-8 font-mono text-xs"
              value={drafts.execution.constraintsText}
              onChange={(event) =>
                set("execution", { ...drafts.execution, constraintsText: event.target.value })
              }
            />
          </Field>
        </Advanced>
      </SegmentShell>

      {/* ⑦ 参数搜索空间 ----------------------------------------------------- */}
      <SegmentShell
        index={7}
        domIdPrefix={SEGMENT_DOM_PREFIX}
        status={statuses[6]}
        open={isOpen(statuses[6])}
        onToggle={() => toggle("parameters", !isOpen(statuses[6]))}
        hint={DEFINITION_SEGMENTS[6].hint}
      >
        {drafts.parameters.length === 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => set("parameters", [emptyParameterRow()])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> 添加待搜索参数
          </Button>
        ) : (
          <div className="space-y-2">
            {drafts.parameters.map((row, index) => (
              <ParameterRowForm
                key={index}
                row={row}
                onChange={(next) =>
                  set("parameters", drafts.parameters.map((r, i) => (i === index ? next : r)))
                }
                onRemove={() => set("parameters", drafts.parameters.filter((_, i) => i !== index))}
              />
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => set("parameters", [...drafts.parameters, emptyParameterRow()])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> 添加待搜索参数
            </Button>
          </div>
        )}
        <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            数值参数若角色是「待搜索（TUNABLE）」就**必须给 min 与 max**（搜索不会替你定界）；
            字符串 / 布尔参数必须给非空候选集合。「推导值（DERIVED）」必须另外带 derivedFrom 表达式
            —— 那个键不在本表单里，缺了会由上面的红色清单点出来。
          </span>
        </p>
      </SegmentShell>

      {/* ---- 表单不编辑的键：明说，而不是让它悄悄消失 ---- */}
      {unedited.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            这份定义里还有 {unedited.length} 处**本表单不编辑的键**（
            {unedited.slice(0, 6).join("、")}
            {unedited.length > 6 ? " 等" : ""}）—— 它们会**原样保留**在保存内容里，不会丢。
          </span>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ⑥ 成本与资金：一键预设 + 六项费率
// ---------------------------------------------------------------------------

/**
 * 成本面板。
 *
 * 🔴 预设**不会自动写入**：按钮上的那套只是「你上次用的 / A 股标准」，必须由用户点一下
 * 才落进草稿。点下去之后它就是**用户在草稿里声明的假设**。
 *
 * 「套用」只覆盖 `COST_ASSUMPTION_FIELDS` 那七项 —— `backtestConfig.maxPositions`
 * 是另一个概念，不能被套一次成本预设清掉。
 */
function CostFields({
  drafts,
  onChange,
  missingCapital,
  missingRates,
}: {
  drafts: DefinitionDrafts;
  onChange: (next: DefinitionDrafts) => void;
  missingCapital: boolean;
  missingRates: boolean;
}) {
  const [preset, setPreset] = useState<CostPreset>(() => preferredCostPreset());
  const matched = matchCostPreset(drafts.cost);
  const complete = isCostAssumptionComplete(drafts.cost);
  const capital = formatCapital(drafts.cost.initialCapital);

  const setCost = (patch: Partial<DefinitionDrafts["cost"]>) =>
    onChange({ ...drafts, cost: { ...drafts.cost, ...patch } });

  const applyPreset = () => {
    onChange({ ...drafts, cost: { ...drafts.cost, ...applyCostPreset(drafts.cost, preset) } });
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
            套用「{preset.name}」
          </Button>
          {complete && matched === null && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                rememberCostAssumption(drafts.cost);
                setPreset(preferredCostPreset());
              }}
            >
              记为我的常用
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          套用只写入下面七项，不会动「回测最大持仓数」。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="回测初始资金"
          name="executionAssumptions.backtestConfig.initialCapital"
          hint="元；必须 > 0"
          missing={missingCapital}
          valueKey={capital === "" ? undefined : capital}
        >
          <NumInput
            value={drafts.cost.initialCapital}
            placeholder="如 100000"
            onChange={(value) => setCost({ initialCapital: value })}
          />
        </Field>
        <Field
          label="回测最大持仓数"
          name="executionAssumptions.backtestConfig.maxPositions"
          hint="可留空；与第 5 段的「最多同时持有」不是同一个字段"
        >
          <NumInput
            value={drafts.cost.maxPositions}
            placeholder="可留空"
            onChange={(value) => setCost({ maxPositions: value })}
          />
        </Field>
      </div>

      <Section title="六项成本费率（服务端要求六项都要有）" missing={missingRates}>
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
              name={`executionAssumptions.costModel.${key}`}
              valueKey={drafts.cost[key] === "" ? undefined : formatCostRate(drafts.cost[key])}
            >
              <NumInput
                value={drafts.cost[key]}
                placeholder={placeholder}
                onChange={(value) => setCost({ [key]: value })}
              />
            </Field>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          ⚠️ 这里的「每手股数」在 <code className="font-mono">costModel</code> 下，与第 5 段
          <code className="font-mono">definition.execution.lotSize</code> **是两个字段** ——
          两者都由后端校验，本页不替你统一。
        </p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ⑦ 参数搜索空间：一行
// ---------------------------------------------------------------------------

function ParameterRowForm({
  row,
  onChange,
  onRemove,
}: {
  row: ParameterRowDraft;
  onChange: (next: ParameterRowDraft) => void;
  onRemove: () => void;
}) {
  const roleOption = DEFINITION_PARAMETER_ROLE_OPTIONS.find((o) => o.value === row.parameterRole);

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          className="h-8 w-44 font-mono text-xs"
          value={row.code}
          placeholder="参数名，如 max_volume_ratio"
          onChange={(event) => onChange({ ...row, code: event.target.value })}
        />
        <Input
          className="h-8 w-40 text-xs"
          value={row.name}
          placeholder="中文名（可留空）"
          onChange={(event) => onChange({ ...row, name: event.target.value })}
        />
        <EnumSelect
          value={row.dataType}
          options={DEFINITION_PARAMETER_TYPE_OPTIONS}
          onChange={(value) => onChange({ ...row, dataType: value })}
        />
        <select
          className="h-8 rounded-md border bg-background px-1.5 text-xs"
          value={row.parameterRole}
          title={roleOption?.note}
          onChange={(event) => onChange({ ...row, parameterRole: event.target.value })}
        >
          {DEFINITION_PARAMETER_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Toggle
          checked={row.required}
          onChange={(required) => onChange({ ...row, required })}
          label="必填"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-8 w-8"
          aria-label="删除参数"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-4">
        {row.dataType === "number" ? (
          <>
            <Input
              className="h-8 font-mono text-xs"
              value={row.min}
              placeholder="min（TUNABLE 必填）"
              onChange={(event) => onChange({ ...row, min: event.target.value })}
            />
            <Input
              className="h-8 font-mono text-xs"
              value={row.max}
              placeholder="max（TUNABLE 必填）"
              onChange={(event) => onChange({ ...row, max: event.target.value })}
            />
            <Input
              className="h-8 font-mono text-xs"
              value={row.step}
              placeholder="step（可选）"
              onChange={(event) => onChange({ ...row, step: event.target.value })}
            />
          </>
        ) : (
          <Input
            className="h-8 font-mono text-xs sm:col-span-3"
            value={row.allowedValuesText}
            placeholder="候选集合（逗号分隔，必填）"
            onChange={(event) => onChange({ ...row, allowedValuesText: event.target.value })}
          />
        )}
        <Input
          className="h-8 font-mono text-xs"
          value={row.defaultValue}
          placeholder="默认值（可选）"
          onChange={(event) => onChange({ ...row, defaultValue: event.target.value })}
        />
      </div>

      {row.parameterRole === "DERIVED" && (
        <p className="text-[10px] text-amber-800">
          角色是「推导值」时必须同时带 <code className="font-mono">derivedFrom</code> 表达式 ——
          那个键不在本表单里，缺了会由段外的红色清单点出来。
        </p>
      )}
    </div>
  );
}
