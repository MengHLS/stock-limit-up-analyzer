/**
 * CandidateSketchCard — 候选**研究草图**的只读展示（RESEARCH-006.4.1 §4）。
 *
 * 术语纪律：这些字段是 **Research Candidate Sketch**（研究意图草图），
 * **不是**已经生成的 `StrategyDefinition` —— 页面文案必须把这件事讲清楚，
 * 否则用户会以为「候选已经等于一个策略」。
 *
 * 展示纪律：
 *   - 分组与编辑表单**同一套**（`SKETCH_SEGMENTS`：买什么 → 什么价买 → 怎么卖 →
 *     买多少 → 成本与资金 → 参数搜索空间）。只读视图如果还用后端的 5 个列名分组，
 *     用户点开「编辑」会看到完全另一套目录结构，等于要学两遍。
 *   - **按结构渲染**：枚举给人话标签、带单位、条件按 字段/运算符/值 摊开，不直接吐一整块 JSON；
 *   - **只显示有值的行**，缺什么由底部「距离可转正还差」统一列出 —— 逐行铺满「未填写」
 *     只是把噪音搬到只读视图里；
 *   - **不做推断**：没有的项就是没有，**不**补默认值、**不**猜语义；
 *   - 含表单表达不了的内容的块，原样展示 JSON 并说明原因 —— 如实呈现，而不是替用户
 *     「整理」成看起来干净的样子。
 */

import { AlertTriangle, Braces, Check, ChevronRight } from "lucide-react";
import { SectionCard } from "@/components/common";
import type { CandidateRawLike } from "@/adapters/strategyCandidateAdapter";
import {
  CANDIDATE_COST_MODEL_OPTIONS,
  CANDIDATE_ENTRY_TIMING_OPTIONS,
  CANDIDATE_EVENT_OPTIONS,
  CANDIDATE_QUANTITY_METHOD_OPTIONS,
  CANDIDATE_SIZING_METHOD_OPTIONS,
  CANDIDATE_TRIGGER_OPTIONS,
  CANDIDATE_WINDOW_UNIT_OPTIONS,
  describeCandidateCondition,
  type SketchOption,
} from "./candidateSketchVocabulary";
import {
  SKETCH_BLOCK_HOME_SEGMENT,
  SKETCH_BLOCK_LABELS,
  conditionsUseNonConjunction,
  sketchSegmentStatuses,
  toSketchDrafts,
  validateSketchDrafts,
  type CandidateSketchDrafts,
  type SketchBlockKey,
  type SketchRawState,
  type SketchSegmentKey,
} from "./candidateSketchForm";
import type { ConditionGroupDraft } from "./createAnalysisForm";

/** 词表标签；词表外的值**明说**是词表外的，不假装它是个正常选项。 */
function labelOf(options: readonly SketchOption[], value: string): string {
  if (value.trim() === "") return "未填写";
  const option = options.find((o) => o.value === value);
  return option === undefined ? `${value}（词表外的值）` : option.label;
}

function Dash() {
  return <span className="text-muted-foreground">未填写</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 border-b py-1 last:border-b-0">
      <span className="w-44 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs">{children}</span>
    </div>
  );
}

function Num({ text, unit }: { text: string; unit?: string }) {
  if (text.trim() === "") return <Dash />;
  return (
    <span className="font-mono">
      {text}
      {unit === undefined ? "" : ` ${unit}`}
    </span>
  );
}

function Mono({ items }: { items: string[] }) {
  if (items.length === 0) return <Dash />;
  return <span className="font-mono">{items.join("，")}</span>;
}

function EmptySegment() {
  return <p className="px-1 py-1 text-xs text-muted-foreground">这一段还没有任何内容。</p>;
}

function RawBlock({ state }: { state: SketchRawState }) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>该块含结构化表单表达不了的内容，原样展示：{state.reason}</span>
      </p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{state.rawText}</pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 每段的只读内容（与编辑表单同序、同名）
// ---------------------------------------------------------------------------

/**
 * 买入条件的只读展示。
 *
 * ⚠️ 这一块**不是**「剔除条件」—— 它的唯一去向是 `entry.conditions`，
 * 语义是「**全部满足才产生买入信号**」（`definitionBuild.ts:506-508`）。
 * 沿用「剔除」这个词会让用户把条件方向写反。
 */
function FilterRuleReadonly({ groups }: { groups: readonly ConditionGroupDraft[] }) {
  const effective = groups
    .map((group) => group.conditions.filter((condition) => condition.fieldName.trim() !== ""))
    .filter((conditions) => conditions.length > 0);
  const nonConjunction = conditionsUseNonConjunction(groups);

  return (
    <>
      <Row label="买入条件">
        {effective.length === 0 ? (
          <span className="text-muted-foreground">
            没有条件 —— 观察窗口内出现事件即视为满足（也就是只要出现事件就买）
          </span>
        ) : (
          <div className="space-y-1">
            {groups.map((group, groupIndex) => {
              const conditions = group.conditions.filter((condition) => condition.fieldName.trim() !== "");
              if (conditions.length === 0) return null;
              return (
                <div key={groupIndex}>
                  {groups.length > 1 && (
                    <span className="text-[10px] text-muted-foreground">
                      第 {groupIndex + 1} 组
                      {groupIndex > 0 && `（与上一组：${group.logicalOperator === "OR" ? "满足任一" : "同时满足"}）`}：
                    </span>
                  )}
                  {conditions.map((condition, conditionIndex) => (
                    <span key={conditionIndex} className="block pl-2 text-xs">
                      <span className="text-muted-foreground">
                        {conditionIndex === 0
                          ? ""
                          : condition.logicalOperator === "OR"
                            ? "或者 "
                            : condition.logicalOperator === "NOT"
                              ? "并且不 "
                              : "并且 "}
                      </span>
                      {describeCandidateCondition(condition.fieldName, condition.operator, condition.value)}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                        {condition.fieldName}
                      </span>
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Row>
      {nonConjunction && (
        <Row label="⚠️ 逻辑运算符">
          <span className="text-amber-800">
            用了「或者 / 并且不」—— 转正会把所有条件当成「并且」（不会报错，但含义会变）
          </span>
        </Row>
      )}
    </>
  );
}

function ParameterSpaceReadonly({ drafts }: { drafts: CandidateSketchDrafts }) {
  if (drafts.parameterSpace.kind !== "structured") return null;
  const rows = drafts.parameterSpace.draft.filter((row) => row.code.trim() !== "");
  if (rows.length === 0) return <EmptySegment />;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[11px] text-muted-foreground">
          <th className="py-1 text-left font-normal">参数名</th>
          <th className="py-1 text-left font-normal">类型</th>
          <th className="py-1 text-left font-normal">取值域</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-t">
            <td className="py-1 font-mono">{row.code}</td>
            <td className="py-1 font-mono">{row.type}</td>
            <td className="py-1 font-mono">
              {row.type === "number"
                ? `min ${row.min || "?"} · max ${row.max || "?"}${row.step.trim() === "" ? "" : ` · step ${row.step}`}`
                : row.allowedValuesText || "（未填写）"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 段 → 只读内容。`raw` 块只在自己的「归属段」展示一次，其余段给一行指路。 */
const SEGMENT_READONLY: Record<SketchSegmentKey, (drafts: CandidateSketchDrafts) => React.ReactNode> = {
  what: (drafts) => {
    const entry = drafts.entryRule;
    if (entry.kind !== "structured") return <EmptySegment />;
    const params = entry.draft.eventParams.filter((row) => row.key.trim() !== "");
    return (
      <>
        <Row label="事件类型">{labelOf(CANDIDATE_EVENT_OPTIONS, entry.draft.event)}</Row>
        <Row label="事件参数">
          <Mono items={params.map((row) => `${row.key}=${row.value}`)} />
        </Row>
      </>
    );
  },

  when: (drafts) => {
    const filter = drafts.filterRule;
    const entry = drafts.entryRule;
    if (filter.kind !== "structured" && entry.kind !== "structured") return <EmptySegment />;
    const draft = entry.kind === "structured" ? entry.draft : null;
    const win = draft?.observationWindow;
    return (
      <>
        {filter.kind === "structured" && <FilterRuleReadonly groups={filter.draft} />}
        {draft !== null && win !== undefined && (
          <>
            <Row label="入场时点">{labelOf(CANDIDATE_ENTRY_TIMING_OPTIONS, draft.timing)}</Row>
            <Row label="观察窗口">
              {[win.start, win.end, win.unit].every((text) => text.trim() === "") ? (
                <Dash />
              ) : (
                <span className="font-mono">
                  第 {win.start || "?"} ~ {win.end || "?"} {labelOf(CANDIDATE_WINDOW_UNIT_OPTIONS, win.unit)}
                </span>
              )}
            </Row>
            <Row label="触发时点">{labelOf(CANDIDATE_TRIGGER_OPTIONS, draft.trigger)}</Row>
          </>
        )}
      </>
    );
  },

  exit: (drafts) => {
    const state = drafts.exitRule;
    if (state.kind !== "structured") {
      return <p className="px-1 py-1 text-xs text-muted-foreground">未设置出场规则 —— 会持有到回测期末。</p>;
    }
    const draft = state.draft;
    return (
      <>
        <Row label="止损">
          <Num text={draft.stopLoss} unit="（比例）" />
        </Row>
        <Row label="止盈">
          <Num text={draft.takeProfit} unit="（比例）" />
        </Row>
        <Row label="持有交易日数">
          <Num text={draft.holdingDays} unit="个交易日" />
        </Row>
      </>
    );
  },

  sizing: (drafts) => {
    const riskDraft = drafts.riskRule.kind === "structured" ? drafts.riskRule.draft : null;
    const entryDraft = drafts.entryRule.kind === "structured" ? drafts.entryRule.draft : null;
    if (riskDraft === null && entryDraft === null) return <EmptySegment />;

    const exec = entryDraft?.execution ?? null;
    const position = entryDraft?.position ?? null;
    const risk = entryDraft?.risk ?? null;
    const constraints = (exec?.constraintsText ?? "")
      .split(/[,，]/)
      .map((text) => text.trim())
      .filter((text) => text !== "");
    const extensions = (risk?.extensions ?? []).filter((row) => row.key.trim() !== "");
    const otherRisk: Array<readonly [string, string]> = risk === null
      ? []
      : (
          [
            ["止损比例", risk.stopLoss],
            ["最大回撤", risk.maxDrawdown],
            ["最大暴露", risk.maxExposure],
            ["单标的上限", risk.maxSinglePosition],
            ["最大持仓数", risk.maxPositions],
            ["单日亏损上限", risk.dailyLossLimit],
            ["集中度上限", risk.concentrationLimit],
          ] as const
        ).filter(([, value]) => value.trim() !== "");
    const otherPosition: string[] = position === null
      ? []
      : [
          position.positionRatio.trim() === "" ? "" : `单笔比例 ${position.positionRatio}`,
          position.fixedAmount.trim() === "" ? "" : `固定金额 ${position.fixedAmount}`,
          position.maxExposure.trim() === "" ? "" : `最大暴露 ${position.maxExposure}`,
          position.maxSinglePosition.trim() === "" ? "" : `单标的上限 ${position.maxSinglePosition}`,
        ].filter((text) => text !== "");

    return (
      <>
        <Row label="最多同时持有">
          <Num text={riskDraft?.maxPositions ?? ""} unit="只" />
        </Row>
        <Row label="单标的仓位上限">
          <Num text={riskDraft?.maxPositionWeight ?? ""} unit="（占总资金）" />
        </Row>
        {entryDraft !== null && (
          <>
            <Row label="仓位方式">
              {labelOf(CANDIDATE_SIZING_METHOD_OPTIONS, position?.sizingMethod ?? "")}
            </Row>
            <Row label="下单口径">
              {labelOf(CANDIDATE_QUANTITY_METHOD_OPTIONS, exec?.quantityMethod ?? "")}
            </Row>
            <Row label="每手股数">
              <Num text={exec?.lotSize ?? ""} />
            </Row>
          </>
        )}
        {otherPosition.length > 0 && (
          <Row label="其他仓位落点">
            <Mono items={otherPosition} />
          </Row>
        )}
        {exec !== null && (exec.slippageModel.trim() !== "" || exec.commissionModel.trim() !== "") && (
          <Row label="滑点 / 佣金模型">
            <span>
              滑点 {labelOf(CANDIDATE_COST_MODEL_OPTIONS, exec.slippageModel)} · 佣金{" "}
              {labelOf(CANDIDATE_COST_MODEL_OPTIONS, exec.commissionModel)}
            </span>
          </Row>
        )}
        {constraints.length > 0 && (
          <Row label="执行约束">
            <Mono items={constraints} />
          </Row>
        )}
        {(otherRisk.length > 0 || extensions.length > 0) && (
          <Row label="扩展风控">
            <span className="font-mono">
              {[
                ...otherRisk.map(([label, value]) => `${label} ${value}`),
                ...extensions.map((row) => `${row.key}=${row.value}`),
              ].join("；")}
            </span>
          </Row>
        )}
      </>
    );
  },

  cost: (drafts) => {
    const entry = drafts.entryRule;
    if (entry.kind !== "structured") return <EmptySegment />;
    const doc = entry.draft.document;
    const costs: Array<readonly [string, string]> = (
      [
        ["佣金率", doc.commissionRate],
        ["印花税率", doc.stampDutyRate],
        ["过户费率", doc.transferFeeRate],
        ["滑点", doc.slippageBps],
        ["每手股数", doc.lotSize],
        ["最低佣金", doc.minCommission],
      ] as const
    ).filter(([, value]) => value.trim() !== "");
    return (
      <>
        <Row label="初始资金">
          <Num text={doc.initialCapital} unit="元" />
        </Row>
        <Row label="回测最大持仓数">
          <Num text={doc.maxPositions} />
        </Row>
        <Row label="成本假设">
          {costs.length === 0 ? <Dash /> : <span className="font-mono">{costs.map(([k, v]) => `${k} ${v}`).join(" · ")}</span>}
        </Row>
      </>
    );
  },

  parameters: (drafts) => (
    <>
      {drafts.parameterSpace.kind === "structured" && drafts.parameterSpace.draft.length > 0 ? (
        <ParameterSpaceReadonly drafts={drafts} />
      ) : (
        <p className="px-1 py-1 text-xs text-muted-foreground">没有声明任何待搜参数（这一段是可选的研究配置）。</p>
      )}
    </>
  ),
};

// ---------------------------------------------------------------------------
// 卡片
// ---------------------------------------------------------------------------

export function CandidateSketchCard({
  raw,
  right,
}: {
  /** 后端原始候选行 —— 结构化渲染必须看原值，不能从展示文本反推。 */
  raw: CandidateRawLike;
  right?: React.ReactNode;
}) {
  const drafts = toSketchDrafts(raw);
  const statuses = sketchSegmentStatuses(drafts);
  const { gaps, gapDetails, warnings } = validateSketchDrafts(drafts);

  return (
    <SectionCard
      title="研究草图（Research Candidate Sketch）"
      icon={Braces}
      description="从研究结论提炼出的入场 / 出场 / 仓位 / 成本草案，按「下单时的思路」排列。它还不是 StrategyDefinition —— 转正时由后端转换并校验，任何缺失字段都会在转正时被响亮拒绝。"
      right={right}
    >
      <div className="space-y-2">
        {statuses.map((status, index) => {
          const rawState = status.rawBlocks
            .filter((block) => SKETCH_BLOCK_HOME_SEGMENT[block] === status.segment)
            .map((block) => ({ block, state: drafts[block] as SketchRawState }));
          const missingElsewhere = status.rawBlocks.filter(
            (block) => SKETCH_BLOCK_HOME_SEGMENT[block] !== status.segment,
          );
          return (
            <section key={status.segment} className="rounded-lg border" data-sketch-segment={status.segment}>
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium">
                  <span className="mr-1 text-muted-foreground">{index + 1}</span>
                  {status.title}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
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
              </div>
              <div className="px-3 py-2">
                {rawState.length > 0 ? (
                  <div className="space-y-2">
                    {rawState.map((item) => (
                      <div key={item.block}>
                        <p className="mb-1 text-[10px] text-muted-foreground">
                          只读块：{SKETCH_BLOCK_LABELS[item.block]}
                        </p>
                        <RawBlock state={item.state} />
                      </div>
                    ))}
                  </div>
                ) : (
                  SEGMENT_READONLY[status.segment](drafts)
                )}
                {missingElsewhere.length > 0 && (
                  <p className="mt-1.5 text-[10px] text-amber-800">
                    （另有一段涉及的「
                    {missingElsewhere.map((block) => SKETCH_BLOCK_LABELS[block]).join(" / ")}
                    」块含表单表达不了的内容，原始内容见它所属的那一段）
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {gaps.length > 0 && (
        <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
          <p className="text-[11px] font-medium text-sky-900">
            距离「可转正」还差 {gaps.length} 项（转正时后端会逐条拒绝）
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-sky-900">
            {statuses
              .filter((status) => status.gapCount > 0)
              .map((status) => (
                <li key={status.segment}>
                  <span className="font-medium">{status.title}：</span>
                  {gapDetails
                    .filter((item) => item.segment === status.segment)
                    .map((item) => item.label)
                    .join("；")}
                </li>
              ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-[11px] font-medium text-amber-900">
            内容合法、转正也会通过，但结果可能与你的意图不同：
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-amber-900">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
