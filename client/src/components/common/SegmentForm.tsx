/**
 * SegmentForm — 「分段式决策表单」的公用渲染层（纯展示，无业务判定）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么抽出来（2026-09-13）
 * ═══════════════════════════════════════════════════════════════════════════
 * 仓库里现在有**两处**按「下单思路」分段的结构化编辑器：
 *   - 研究实验 → 策略候选的**草图**（`research/CandidateSketchFields.tsx`，六段/七段）；
 *   - 策略详情 → 策略定义的编辑器（`strategy/DefinitionFields.tsx`，七段）。
 * 两者的词表与去向完全不同（前者写 `*Json` 列、转正才变成定义；后者直接写
 * `StrategyDocument.definition`），**但人对它们的心智模型是同一件事** ——
 * 用户明确要求过「策略详情里的规则要与研究草图的规则对齐」。
 *
 * 若把「折叠段外壳 / 缺口胶囊 / 中文优先字段行 / 必填未填琥珀标记」各抄一份，
 * 结果是两处会随各自的下一次改动**缓慢漂移**（先是间距，然后是徽标文案，
 * 最后是「还差几项」的算法），而漂移发生时没有任何测试会红。
 * ⇒ 这里收成一份**纯展示**实现；两份编辑器的差异只剩「词表 + 分段定义 + 校验函数」，
 *   而那三样本来就应该不同。
 *
 * 纪律（沿用草图第一版踩坑后的结论）：
 *   1. 本文件**不做任何业务判定**：不校验、不派生、不猜默认值。
 *   2. `status` 只按**结构**消费（`SegmentStatusLike`）⇒ 两边的状态类型都不必改造，
 *      只要字段齐就能用；缺字段会在类型层面报错，而不是运行时静默空白。
 *   3. 英文键名（`name`）**不删**，它是与后端错误信息对照的唯一锚点；但降为小字灰字。
 */

import type { ReactNode } from "react";
import { Check, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// 结构契约
// ---------------------------------------------------------------------------

/** 下拉项：只要求「值 + 中文标签」，`disabled` 用于「服务端有此键但选了必被拒」。 */
export interface OptionLike {
  readonly value: string;
  readonly label: string;
  readonly note?: string;
  readonly disabled?: boolean;
}

/** 一条缺口（`label` 必须是**可执行的一句话**，见 `SegmentGapList` 的注释）。 */
export interface GapLike {
  readonly label: string;
}

/**
 * 段状态的结构契约。
 *
 * 刻意**不** import 任何一侧的 `SketchSegmentStatus` / `DefinitionSegmentStatus`：
 * 那两个模块属于各自领域，公共层反向依赖它们会把领域拉进每个使用方。
 * 结构类型同样能保证「字段写错就编译不过」。
 *
 * `hint` 是**可选**的：段提示由 `SegmentShell` 的 `hint` 属性传入（每一段在调用处
 * 各写一句更贴切的话），状态对象带不带它都不影响渲染。
 */
export interface SegmentStatusLike {
  readonly segment: string;
  readonly title: string;
  readonly hint?: string;
  readonly required: boolean;
  readonly gapCount: number;
  readonly gaps: readonly GapLike[];
  readonly summary: string;
}

/** 键值行（事件参数 / 风控具名阈值共用）的最小形状。 */
export interface KeyValueRowLike {
  key: string;
  valueType: "string" | "number" | "boolean";
  value: string;
}

/** 段的 DOM id（供「缺口胶囊点击跳转」用）。 */
export function segmentDomId(prefix: string, segment: string): string {
  return `${prefix}-${segment}`;
}

// ---------------------------------------------------------------------------
// 字段行
// ---------------------------------------------------------------------------

/**
 * 一个字段的标签行：**中文在前，英文键名在后**。
 *
 * `valueKey` 用来回显枚举当前选中的**原始值**（同样是给对照用的）。
 * `missing` = 「必填但还没填」：由该段缺口的驱动方传入（**不是**另立一张必填表），
 * 因此清单说缺哪一项，琥珀标记就一定落在哪一项上。
 */
export function Field({
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
  children: ReactNode;
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

/** 段内分节：细标题 + 分隔线，**不再套一层框**（三层框套框是噪音的主要来源）。 */
export function Section({
  title,
  missing = false,
  children,
}: {
  title: string;
  missing?: boolean;
  children: ReactNode;
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
export function Advanced({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
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

// ---------------------------------------------------------------------------
// 基础控件
// ---------------------------------------------------------------------------

/**
 * 枚举下拉。
 *
 * 用**原生 `select`** 而非 Radix：这里多数枚举是「可选」的，需要一个**真正的空选项**
 * 表示「不填」，而 Radix 的 `SelectItem` 不接受空值。
 * 选项文字只放中文 —— 原始值改由 `Field` 的 `valueKey` 回显，避免每项都拖着
 * 一串 `FIRST_LIMIT_UP` 把下拉撑得很吵。
 */
export function EnumSelect({
  value,
  options,
  onChange,
  emptyLabel = "未选择",
  disabled = false,
}: {
  value: string;
  options: readonly OptionLike[];
  onChange: (next: string) => void;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="h-8 w-full rounded-md border bg-background px-2 text-xs disabled:opacity-60"
      value={value}
      disabled={disabled}
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

/** 单行文本框（等宽、小号）—— 数值与字段引用共用。 */
export function NumInput({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      className="h-8 font-mono text-xs"
      value={value}
      disabled={disabled}
      placeholder={placeholder ?? "留空 = 不填"}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * 键值行编辑（事件参数 / 风控具名阈值共用）。
 *
 * 泛型保留调用方的行类型 ⇒ 回调仍是 `T[]`，不必在调用处做断言。
 */
export function KeyValueRows<T extends KeyValueRowLike>({
  rows,
  onChange,
  newRow,
  keyPlaceholder,
  addLabel,
  disabled = false,
}: {
  rows: T[];
  onChange: (next: T[]) => void;
  newRow: () => T;
  keyPlaceholder: string;
  addLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            className="h-8 w-40 font-mono text-xs"
            value={row.key}
            disabled={disabled}
            placeholder={keyPlaceholder}
            onChange={(event) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))
            }
          />
          <select
            className="h-8 shrink-0 rounded-md border bg-background px-1.5 text-xs disabled:opacity-60"
            value={row.valueType}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                rows.map((r, i) =>
                  i === index
                    ? { ...r, valueType: event.target.value as KeyValueRowLike["valueType"] }
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
            disabled={disabled}
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
            disabled={disabled}
            aria-label="删除该行"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => onChange([...rows, newRow()])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 段外壳
// ---------------------------------------------------------------------------

/**
 * 段内「还差什么」清单：把 `status.gaps` 的逐条文案**原样**列出来。
 *
 * 🔴 这一段不是装饰。若只显示「还差 N 项」这个**数量**，用户把段里看得见的东西
 * 都填完之后，徽标仍停在「还差 1 项」而完全无从下手。逐条列出「差的是谁」
 * 是分段表单最基本的可用性要求。
 */
export function SegmentGapList({ gaps }: { gaps: readonly GapLike[] }) {
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

/**
 * 段外壳：折叠 + 一行摘要 + 缺口徽标。
 *
 * 折叠态必须给**一句中文摘要**（「首板 · 次日开盘买入 · 观察第 1–3 交易日」）——
 * 只显示「展开」的折叠段等于把内容藏起来。
 */
export function SegmentShell({
  index,
  status,
  open,
  onToggle,
  hint,
  domIdPrefix,
  children,
}: {
  index: number;
  status: SegmentStatusLike;
  open: boolean;
  onToggle: () => void;
  hint: string;
  /** 段 DOM id 前缀（跳转锚点用；两侧各给一个，避免同页 id 冲突）。 */
  domIdPrefix: string;
  children: ReactNode;
}) {
  return (
    <section
      id={segmentDomId(domIdPrefix, status.segment)}
      data-segment={status.segment}
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

/**
 * 顶部「还差什么」胶囊清单。
 *
 * 🔴 必须列**逐条文案**而不是「段名 · 数量」。只给数量时，用户把段里看得见的东西
 * 都填完、徽标仍停在「还差 1 项」，就只能靠猜 —— 这正是「永远还差一项、没法继续」的根因。
 *
 * 对 `S` 泛型化是为了让 `onFocus` 拿到**调用方自己的段键联合类型**
 * （`SketchSegmentKey` / `DefinitionSegmentKey`），而不是被放宽成 `string`
 * —— 否则调用方要么报类型错，要么得写一个 `as` 断言把类型安全丢掉。
 */
export function SegmentGapCapsules<S extends SegmentStatusLike>({
  statuses,
  onFocus,
  lead,
}: {
  statuses: readonly S[];
  onFocus: (segment: S["segment"]) => void;
  /** 首句（通常含「还差 N 项」与一句「不影响保存」的说明）。 */
  lead: string;
}) {
  const withGaps = statuses.filter((status) => status.gapCount > 0);
  if (withGaps.length === 0) return null;
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
      <p className="text-[11px] font-medium text-sky-900">{lead}</p>
      <ul className="mt-1.5 space-y-0.5">
        {withGaps.map((status) => (
          <li key={status.segment}>
            <button
              type="button"
              onClick={() => onFocus(status.segment)}
              className="text-left text-[11px] text-sky-900 underline decoration-dotted underline-offset-2 hover:text-sky-700"
            >
              <span className="font-medium">{status.title}：</span>
              {status.gaps.map((item) => item.label).join("；")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
