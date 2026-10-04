/**
 * 「策略定义」页的**五个任务块**（骨架 + 完成度 + 跳转）。
 *
 * ## 为什么是"五块"而不是"七段"
 *
 * 七段是 **schema 的分段**（`DEFINITION_SEGMENTS`），不是用户的思考顺序。
 * 用户关心的是五个问题：**买什么 / 什么时候卖 / 买多少 / 怎么成交 / 哪些值可调**。
 * 本组件把七段**归位到五块**（映射见 `BLOCKS`），每块平铺出：
 *   - 该块的**方案**（预设：① 信号配方 / ② 退出政策 / ③ 仓位 / ④ 成本与成交 —— 有就给）；
 *   - 该块下各**字段段**的状态（齐 / 还差 N / 待填 / 可选）。
 *
 * ## 纪律
 *   - **不另立必填表**：段状态全部来自既有 `definitionSegmentStatuses(drafts)`
 *     （与折叠段、与保存前校验同源）⇒ 不会出现"概览说齐了、段里还红着"；
 *   - **只读**：本组件不改草稿；跳段靠广播事件（`dispatchDefinitionFocusSegment`），
 *     跳预设靠滚动到调用方给的 DOM id。
 *   - **不新增口径**：方案状态由调用方算好传进来（`presetSegments`）。
 */
import { CheckCircle2, CircleDashed, CircleAlert, Sparkles } from "lucide-react";
import {
  DEFINITION_SEGMENTS,
  definitionSegmentStatuses,
  dispatchDefinitionFocusSegment,
  type DefinitionDrafts,
  type DefinitionSegmentKey,
} from "@/components/strategy/definitionDraft";

/**
 * 「预设槽」状态（方案不是"段"，但同样是定义的一部分）。
 *
 * 例如「信号配方」是**必填**：缺它装配层会落到 DEFAULT 配方（策略跑的就不是你写的那套）。
 */
export interface DefinitionProgressPresetSegment {
  readonly key: string;
  readonly label: string;
  readonly state: "SET" | "OPTIONAL" | "MISSING" | "INVALID";
  readonly hint: string;
  /** 点击时滚到哪个 DOM id（由调用方给对应区块设 id）。 */
  readonly domId?: string;
}

/**
 * 五个任务块 → 它们各自覆盖的定义段 + 预设槽 key。
 *
 * 🔴 这是**展示层分组**，不改 `DEFINITION_SEGMENTS` 的数据分段：
 *    每个段仍然只出现一次，五块是对七段的一次「归位」。
 */
export const DEFINITION_BLOCKS: readonly {
  readonly key: string;
  readonly index: number;
  readonly title: string;
  readonly hint: string;
  readonly segments: readonly DefinitionSegmentKey[];
  readonly presetKeys: readonly string[];
}[] = [
  { key: "selection", index: 1, title: "选股", hint: "买什么样的股（事件 / 条件 / 时点 + 信号配方）", segments: ["what", "condition", "when"], presetKeys: ["SELECTION", "ENTRY_CONDITION"] },
  { key: "exit", index: 2, title: "出场", hint: "什么时候卖（退出政策 + 出场规则）", segments: ["exit"], presetKeys: ["EXIT_POLICY"] },
  { key: "position", index: 3, title: "仓位", hint: "每笔买多少 / 最多同时持有几只", segments: ["sizing"], presetKeys: ["POSITION"] },
  { key: "cost", index: 4, title: "成本与成交", hint: "怎么成交 / 花多少钱", segments: ["cost"], presetKeys: ["COST"] },
  { key: "parameters", index: 5, title: "可调参数", hint: "上面四块里，哪些值允许被搜索", segments: ["parameters"], presetKeys: [] },
] as const;

interface SegmentView {
  readonly segment: DefinitionSegmentKey;
  readonly label: string;
  readonly gapCount: number;
  readonly summary: string;
  /** 该段「没填任何东西」（与缺口无关：可选段留空是**合法**的，但不该显示成"齐"）。 */
  readonly empty: boolean;
  readonly required: boolean;
}

const DIGITS = ["①", "②", "③", "④", "⑤"] as const;

export function DefinitionProgressOverview({
  drafts,
  presetSegments = [],
}: {
  readonly drafts: DefinitionDrafts;
  /** 预设槽状态（RECIPE / EXIT_POLICY…）；缺省 = 不显示。 */
  readonly presetSegments?: readonly DefinitionProgressPresetSegment[];
}) {
  const statuses = definitionSegmentStatuses(drafts);
  const bySegment = new Map(statuses.map(status => [status.segment, status] as const));

  const segmentViews = new Map<DefinitionSegmentKey, SegmentView>(
    DEFINITION_SEGMENTS.map(definition => {
      const status = bySegment.get(definition.key);
      return [definition.key, {
        segment: definition.key,
        label: definition.title,
        gapCount: status?.gapCount ?? 0,
        summary: status?.summary ?? "",
        empty: status?.empty ?? true,
        required: definition.required,
      }] as const;
    }),
  );

  const allSegments = [...segmentViews.values()];
  const totalGaps = allSegments.reduce((sum, item) => sum + item.gapCount, 0);
  /** 「已齐」= 没有缺口**且**确实填了东西（留空的可选段不算齐）。 */
  const readyCount = allSegments.filter(item => item.gapCount === 0 && !item.empty).length;
  const presetReady = presetSegments.filter(item => item.state === "SET" || item.state === "OPTIONAL").length;
  const presetMissing = presetSegments.filter(item => item.state === "MISSING").length;
  const presetInvalid = presetSegments.filter(item => item.state === "INVALID").length;

  const scrollTo = (domId: string | undefined) => {
    if (domId === undefined || typeof document === "undefined") return;
    document.getElementById(domId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="rounded-lg border bg-card p-4" data-definition-overview>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">定义完成度</h3>
        <p className="text-[11px] text-muted-foreground">
          {allSegments.length} 段 · 已齐 <span className="font-semibold text-foreground">{readyCount}</span>
          {totalGaps > 0
            ? <> · 还差 <span className="font-semibold text-amber-700">{totalGaps}</span> 项</>
            : <> · <span className="font-semibold text-emerald-700">没有必填缺口</span></>}
          {presetSegments.length > 0 && (
            <> · 方案 {presetReady}/{presetSegments.length}
              {presetMissing > 0 && <> · <span className="font-semibold text-amber-700">{presetMissing} 项待选</span></>}
              {presetInvalid > 0 && <> · <span className="font-semibold text-rose-700">{presetInvalid} 项有问题</span></>}
            </>
          )}
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {DEFINITION_BLOCKS.map(block => {
          const presetItems = presetSegments.filter(item => block.presetKeys.includes(item.key));
          const segmentItems = block.segments.map(seg => segmentViews.get(seg)).filter((item): item is SegmentView => item !== undefined);
          return (
            <div key={block.key} className="flex flex-wrap items-center gap-2" data-definition-block={block.key}>
              <span className="w-44 shrink-0 text-[11px]" title={block.hint}>
                <span className="mr-1 font-semibold">{DIGITS[block.index - 1]}</span>
                <span className="font-medium">{block.title}</span>
              </span>

              {presetItems.map(item => {
                const tone = item.state === "INVALID"
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : item.state === "MISSING"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : item.state === "OPTIONAL"
                      ? "border-dashed text-muted-foreground"
                      : "border-emerald-200 bg-emerald-50/50 text-emerald-900";
                const label = item.state === "SET" ? "已选" : item.state === "OPTIONAL" ? "可选" : item.state === "MISSING" ? "待选" : "有问题";
                const Icon = item.state === "SET" ? CheckCircle2 : (item.state === "OPTIONAL" ? CircleDashed : CircleAlert);
                return (
                  <button
                    key={item.key}
                    type="button"
                    title={item.hint}
                    onClick={() => scrollTo(item.domId)}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition hover:brightness-[0.98] ${tone}`}
                    data-preset-chip={item.key}
                    data-preset-state={item.state}
                  >
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span className="font-medium">{item.label}</span>
                    <span className="opacity-80">{label}</span>
                    <Icon className="hidden h-3 w-3" />
                  </button>
                );
              })}

              {segmentItems.map(item => {
                const filled = !item.empty;
                const complete = item.gapCount === 0;
                const Icon = complete && filled ? CheckCircle2 : (complete ? CircleDashed : CircleAlert);
                const tone = complete
                  ? (filled ? "border-emerald-200 bg-emerald-50/50 text-emerald-900" : "border-dashed text-muted-foreground")
                  : "border-amber-300 bg-amber-50 text-amber-900";
                const state = !complete ? `还差 ${String(item.gapCount)}` : (filled ? "齐" : (item.required ? "待填" : "可选"));
                return (
                  <button
                    key={item.segment}
                    type="button"
                    title={filled ? item.summary : "这一段还是空的；点击展开填写"}
                    onClick={() => dispatchDefinitionFocusSegment(item.segment)}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition hover:brightness-[0.98] ${tone}`}
                    data-segment-chip={item.segment}
                    data-segment-state={state}
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    <span className="font-medium">{item.label}</span>
                    <span className="tabular-nums opacity-80">{state}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {totalGaps > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          点击任一段可展开并滚动到它；缺口判定与保存前校验**同源**（`definitionSegmentStatuses`）。
        </p>
      )}
    </div>
  );
}