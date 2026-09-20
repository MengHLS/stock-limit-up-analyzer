/**
 * PromotionEligibilityCard — 候选**转正资格**（FRONTEND-FINAL-001 §八 / P1-3）。
 *
 * 为什么需要这张卡：转正失败的 gate 原因此前**只**写在「转正为策略」按钮的 `title`
 * 悬停提示里，而弹窗内的解释文案在按钮 `disabled` 时永远不可达（disabled 不触发 onClick
 * ⇒ 弹窗根本不打开）。结果就是「看不到为什么不能转正」。本卡片把它摊在页面上：
 * **不需要任何点击与悬停**就能看到每条 gate 的当前值 / 要求 / 失败原因。
 *
 * 🔴 判定纪律（与本仓「前端不重算」口径一致）：
 *   ① 只做**后端已经存在**的判定 —— 每条 gate 都在下方注释里给出后端权威位置；
 *   ② 只「读已有字段 + 与后端已声明的条件对比」，**不**新增业务规则、**不**补默认值、
 *      **不**复制一份 promote 逻辑（草稿缺口复用既有 `validateSketchDrafts`，
 *      状态门槛复用既有 `isPromotableStatus`）；
 *   ③ 前端确实判不了的（definition 由后端构建并校验），如实标注「需后端校验」，
 *      **不**猜成通过或不通过。
 *
 * 判定的后端依据一览（逐条对应下表一行）：
 *   - `CANDIDATE_NOT_ACCEPTED`       → `server/research/strategyCandidate/service.ts:1041-1047`
 *   - `PROMOTE_SOURCE_INCOMPLETE`    → `server/research/strategyCandidate/service.ts:1049-1056`
 *   - `PROMOTE_SKETCH_INCOMPLETE`    → `server/research/strategyCandidate/definitionBuild.ts:633-634 / 770 / 779-781`
 *                                      （以及 `requireEnum` / `requireNonEmptyString` / `requireFiniteNumber`）
 *   - `PROMOTE_SKETCH_INVALID`       → `server/research/strategyCandidate/definitionBuild.ts:153-159`
 *                                      （扩展键白名单见同文件 `:77-97`）
 *   - `PROMOTE_DEFINITION_INVALID`   → `server/research/strategyCandidate/definitionBuild.ts:1085-1090`
 *                                      / `strategyPromotionPort.ts:188,243`
 *   幂等闸门（`CONVERTED` 时先于状态门槛）→ `service.ts:923-1030`；前端读不到 provenance
 *   ⇒ 该行如实标为「信息不足」。
 */

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { SectionCard, StatusBadge } from "@/components/common";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PROMOTE_DOMAIN_HINTS,
  type CandidateDetailVm,
  type CandidateRawLike,
  type PromoteDomainHint,
} from "@/adapters/strategyCandidateAdapter";
import { PROMOTABLE_STATUS, isPromotableStatus } from "./promoteForm";
import { toSketchDrafts, validateSketchDrafts } from "./candidateSketchForm";

// ---------------------------------------------------------------------------
// 领域码（后端**真实字面量**，见 server/research/strategyCandidate/candidateTypes.ts:131-139）
// ---------------------------------------------------------------------------

const PROMOTE_CODES = {
  NOT_ACCEPTED: "STRATEGY_CANDIDATE_NOT_ACCEPTED",
  SOURCE_INCOMPLETE: "STRATEGY_CANDIDATE_PROMOTE_SOURCE_INCOMPLETE",
  SKETCH_INCOMPLETE: "STRATEGY_CANDIDATE_PROMOTE_SKETCH_INCOMPLETE",
  SKETCH_INVALID: "STRATEGY_CANDIDATE_PROMOTE_SKETCH_INVALID",
  DEFINITION_INVALID: "STRATEGY_CANDIDATE_PROMOTE_DEFINITION_INVALID",
} as const;

// ---------------------------------------------------------------------------
// 判定模型
// ---------------------------------------------------------------------------

/** 整卡结论。`UNKNOWN` = 前端**信息不足**（不是「通过」，也不是「不通过」）。 */
export type PromotionEligibilityStatus = "ELIGIBLE" | "BLOCKED" | "UNKNOWN";

/** 单行判定。`BACKEND` = 该 gate 只能由后端在提交时判定（前端不预判）。 */
export type PromotionGateState = "PASS" | "BLOCKED" | "UNKNOWN" | "BACKEND";

export interface PromotionGateRow {
  /** gate 名称（人话）。 */
  gate: string;
  /** 对应后端领域码（失败时后端会以该码拒绝）。 */
  code: string;
  /** 补充说明（可选）：该行判定的来历 / 为什么前端判不了。 */
  note?: string;
  currentValue: string;
  required: string;
  /** 失败原因 —— 取自 `PROMOTE_DOMAIN_HINTS` 的中文解释。 */
  failureReason: string;
  state: PromotionGateState;
}

export interface PromotionEligibility {
  status: PromotionEligibilityStatus;
  /** 结论的解释（明确说清「ELIGIBLE 不等于提交必成功」）。 */
  statusNote: string;
  /** 下一步该做什么（纯文案，**不含**任何会写库的按钮）。 */
  nextStep: string;
  rows: PromotionGateRow[];
}

/** `@/lib/status` 里已有的语义色：ACCEPTED=绿 / BLOCKED=红 / UNKNOWN=灰。 */
const ELIGIBILITY_BADGE_STATUS: Record<PromotionEligibilityStatus, string> = {
  ELIGIBLE: "ACCEPTED",
  BLOCKED: "BLOCKED",
  UNKNOWN: "UNKNOWN",
};

const GATE_BADGE: Record<PromotionGateState, { status: string; label: string }> = {
  PASS: { status: "PASS", label: "满足" },
  BLOCKED: { status: "BLOCKED", label: "不满足" },
  UNKNOWN: { status: "UNKNOWN", label: "信息不足" },
  BACKEND: { status: "NOT_RUN", label: "需后端校验" },
};

/**
 * 领域码 → 失败原因。
 *
 * 命中 `PROMOTE_DOMAIN_HINTS` 就用其中文解释（与转正弹窗失败提示**同一份**文案，
 * 不各写一份）；未收录时如实说明「后端 message 会带原始说明」，**不编**一句听起来合理的解释。
 */
function failureReasonOf(code: string): string {
  const hint: PromoteDomainHint | undefined = PROMOTE_DOMAIN_HINTS[code];
  return hint === undefined
    ? "本页未收录该领域码的解释；后端会在错误 message 里带回原始说明与出错路径。"
    : hint.explanation;
}

/** 与后端 `service.ts:347-349#isPositiveInt` 同一判据（只读字段，不复算任何业务量）。 */
function isPositiveInt(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// ---------------------------------------------------------------------------
// 构造（纯函数；组件只渲染）
// ---------------------------------------------------------------------------

/**
 * 候选（后端读回的事实）→ 转正资格判定。
 *
 * 输入只用到页面**已经**拿到的两份数据（`CandidateDetailVm` + 后端原始候选行），
 * 不额外发请求、不引入新的字段。
 */
export function buildPromotionEligibility(
  vm: CandidateDetailVm,
  raw: CandidateRawLike,
): PromotionEligibility {
  // ---- ① 候选状态（service.ts:1041-1047：只有 ACCEPTED 允许转正）----
  const statusRow: PromotionGateRow = isPromotableStatus(vm.status)
    ? {
        gate: "候选状态",
        code: PROMOTE_CODES.NOT_ACCEPTED,
        currentValue: `${vm.status}（${vm.statusLabel}）`,
        required: `${PROMOTABLE_STATUS}（已采纳）`,
        failureReason: failureReasonOf(PROMOTE_CODES.NOT_ACCEPTED),
        state: "PASS",
      }
    : vm.status === "CONVERTED"
      ? {
          // 已转正：后端会先命中幂等闸门（service.ts:923-1030）。是「幂等复用」还是
          // 「状态与溯源不一致」，取决于 frontend 读不到的 provenance 行 ⇒ 信息不足。
          gate: "候选状态",
          code: PROMOTE_CODES.NOT_ACCEPTED,
          note: "已转正：后端会先命中幂等闸门（service.ts:923-1030）复用既有 Strategy 版本；"
            + "前端读不到 provenance，无法预判本次是「幂等复用」还是「状态与溯源不一致」。",
          currentValue: `${vm.status}（${vm.statusLabel}）`,
          required: `${PROMOTABLE_STATUS}（已采纳）`,
          failureReason: failureReasonOf(PROMOTE_CODES.NOT_ACCEPTED),
          state: "UNKNOWN",
        }
      : {
          gate: "候选状态",
          code: PROMOTE_CODES.NOT_ACCEPTED,
          currentValue: `${vm.status}（${vm.statusLabel}）`,
          required: `${PROMOTABLE_STATUS}（已采纳）`,
          failureReason: failureReasonOf(PROMOTE_CODES.NOT_ACCEPTED),
          state: "BLOCKED",
        };

  // ---- ② 来源研究链完整性（service.ts:1049-1056：conclusionId / experimentId 必须是正整数）----
  //
  // 🔴 读的是**候选列**（`conclusionId` / `experimentId`），与后端读的是同一处；
  //    上游行是否还在（`source.missing`）**不是**这条 gate 的判据 —— 拿它当判据会误报。
  const conclusionId = raw.conclusionId ?? null;
  const experimentId = raw.experimentId ?? null;
  const sourceComplete = isPositiveInt(conclusionId) && isPositiveInt(experimentId);
  const sourceRow: PromotionGateRow = {
    gate: "来源研究链完整性",
    code: PROMOTE_CODES.SOURCE_INCOMPLETE,
    currentValue: `conclusionId=${conclusionId ?? "—"} / experimentId=${experimentId ?? "—"}`,
    required: "两个来源锚都是正整数的结论锚与实验锚（转正要写进溯源）",
    failureReason: failureReasonOf(PROMOTE_CODES.SOURCE_INCOMPLETE),
    state: sourceComplete ? "PASS" : "BLOCKED",
  };

  // ---- ③ 候选草图完整性（definitionBuild.ts:633-634 / 770 / 779-781）----
  //
  // 草稿缺口复用既有纯函数 `validateSketchDrafts`（与「研究草图」卡同一份口径），
  // 这里**不**另写一套必填判据：
  //   - 带 `anchors` 的缺口 = 必填项缺失（对应后端 `PROMOTE_SKETCH_INCOMPLETE`）；
  //   - 无 `anchors` 的缺口 = 该草稿块含表单表达不了的内容（前端不代提交，见下条）。
  const drafts = toSketchDrafts(raw);
  const sketchValidation = validateSketchDrafts(drafts);
  const missingItems = sketchValidation.gapDetails.filter((item) => item.anchors.length > 0);
  const unreadableItems = sketchValidation.gapDetails.filter((item) => item.anchors.length === 0);
  // entryRule / riskRule 是后端**必填**的两块；它们一旦「超出表单表达能力」，
  // 前端就无法核对必填项 ⇒ 如实标为信息不足，不假装已齐备。
  const requiredBlockUnreadable = drafts.entryRule.kind === "raw" || drafts.riskRule.kind === "raw";
  const sketchRequired =
    "entryRule（event / timing / extra.observationWindow / extra.trigger / extra.execution / "
    + "extra.position / extra.document）与 riskRule.maxPositions 齐备"
    + "（filterRule / exitRule / parameterSpace 可以为空）";
  const sketchRow: PromotionGateRow = requiredBlockUnreadable
    ? {
        gate: "候选草图完整性",
        code: PROMOTE_CODES.SKETCH_INCOMPLETE,
        note: "entryRule / riskRule 含结构化表单表达不了的内容，前端不代填也不预判其必填项。",
        currentValue: "—（信息不足：该草稿块用了表单表达不了的写法）",
        required: sketchRequired,
        failureReason: failureReasonOf(PROMOTE_CODES.SKETCH_INCOMPLETE),
        state: "UNKNOWN",
      }
    : missingItems.length > 0
      ? {
          gate: "候选草图完整性",
          code: PROMOTE_CODES.SKETCH_INCOMPLETE,
          currentValue: `缺 ${missingItems.length} 项：${missingItems
            .flatMap((item) => item.anchors)
            .join(" / ")}`,
          required: sketchRequired,
          failureReason: failureReasonOf(PROMOTE_CODES.SKETCH_INCOMPLETE),
          state: "BLOCKED",
        }
      : {
          gate: "候选草图完整性",
          code: PROMOTE_CODES.SKETCH_INCOMPLETE,
          currentValue: "必填项已齐备（按 definitionBuild 的必填口径逐项核对）",
          required: sketchRequired,
          failureReason: failureReasonOf(PROMOTE_CODES.SKETCH_INCOMPLETE),
          state: "PASS",
        };

  // ---- ④ 草图合法性（definitionBuild.ts:153-159；扩展键白名单 :77-97）----
  //
  // 前端只能覆盖「表单能表达的那部分」的非法项（枚举 / 数值 / 字段引用 / 扩展键），
  // 因此没有非法项时**也不**等于合法 ⇒ 标 `BACKEND`，不猜成通过。
  const illegalItems = sketchValidation.errors;
  const sketchValidRow: PromotionGateRow = illegalItems.length > 0
    ? {
        gate: "草图合法性",
        code: PROMOTE_CODES.SKETCH_INVALID,
        note: "以下非法项由前端的草图校验发现（与后端词表同一口径）；改完再提交。",
        currentValue: `${illegalItems.length} 项：${illegalItems.join("；")}`,
        required: "取值都在 Strategy 词表内（事件 / 时点 / 触发 / 仓位 / 成本 / 运算符 / 字段引用），"
          + "且 entryRule.extra 只含白名单扩展键",
        failureReason: failureReasonOf(PROMOTE_CODES.SKETCH_INVALID),
        state: "BLOCKED",
      }
    : {
        gate: "草图合法性",
        code: PROMOTE_CODES.SKETCH_INVALID,
        note: unreadableItems.length > 0
          ? "该候选有草稿块含表单表达不了的内容，合法性只能由后端判定。"
          : "前端未见非法项；但这只覆盖表单能表达的字段。",
        currentValue: "—（前端不可判定，提交后由后端返回）",
        required: "取值都在 Strategy 词表内（事件 / 时点 / 触发 / 仓位 / 成本 / 运算符 / 字段引用），"
          + "且 entryRule.extra 只含白名单扩展键",
        failureReason: failureReasonOf(PROMOTE_CODES.SKETCH_INVALID),
        state: "BACKEND",
      };

  // ---- ⑤ 生成出的策略定义合法性（definitionBuild.ts:1085-1090）----
  //
  // definition **完全由后端**从草稿构建（前端不构造、不提交），且校验含 Look-Ahead L1–L8
  // 时序规则 ⇒ 前端结构性无法判定。
  const definitionRow: PromotionGateRow = {
    gate: "生成出的策略定义合法性",
    code: PROMOTE_CODES.DEFINITION_INVALID,
    note: "definition 由后端唯一转换器从草稿构建，前端不构造、不提交。",
    currentValue: "—（前端不可判定，提交后由后端返回）",
    required: "构建出的 StrategyDefinition 通过既有校验器（含 Look-Ahead L1–L8 时序规则）",
    failureReason: failureReasonOf(PROMOTE_CODES.DEFINITION_INVALID),
    state: "BACKEND",
  };

  const rows = [statusRow, sourceRow, sketchRow, sketchValidRow, definitionRow];
  const status: PromotionEligibilityStatus = rows.some((row) => row.state === "BLOCKED")
    ? "BLOCKED"
    : rows.some((row) => row.state === "UNKNOWN")
      ? "UNKNOWN"
      : "ELIGIBLE";

  const statusNote =
    status === "BLOCKED"
      ? "存在前端可判定的阻断项 —— 逐行见下表；未补齐前提交转正会被后端以对应领域码拒绝。"
      : status === "UNKNOWN"
        ? "有前置条件无法在前端判定（信息不足）—— 见下表标为「信息不足 / 需后端校验」的行，"
          + "这些行既不算满足也不算不满足。"
        : "前端可判定的前置条件全部满足。⚠️ 这不等于「提交一定成功」："
          + "StrategyDefinition 的构建与合法性（含 Look-Ahead 时序规则）只能由后端在提交时判定。";

  const nextStep =
    vm.status === "CONVERTED"
      ? "下一步：该候选已转正。再次提交会命中后端幂等闸门、复用既有 Strategy 版本（不会产生第二份）"
        + "—— 不要新建候选来「重来一次」。"
      : statusRow.state === "BLOCKED"
        ? "下一步：到本页右上角「状态流转」把候选流转到 ACCEPTED（已采纳），"
          + "再回到「转正为 Strategy」入口提交。"
        : status === "BLOCKED"
          ? "下一步：按上表逐行补齐「当前值」不满足的项（草图缺口到「研究草图」区修改），"
            + "再回到本卡核对。"
          : status === "UNKNOWN"
            ? "下一步：上表标为「信息不足 / 需后端校验」的项只能由后端判定 —— "
              + "提交转正后按后端返回的 message（含出错路径）补齐。"
            : "下一步：到本页「转正为 Strategy」入口提交；执行 Dataset 与分歧原因在那里选择。";

  return { status, statusNote, nextStep, rows };
}

// ---------------------------------------------------------------------------
// 卡片
// ---------------------------------------------------------------------------

/**
 * 转正资格卡。
 *
 * props 刻意只用页面**已加载**的两份数据（视图对象 + 后端原始候选行），
 * 因此可以**直接渲染在页面上**，不需要任何点击 / 悬停 / 额外请求。
 */
export function PromotionEligibilityCard({
  vm,
  raw,
}: {
  /** 候选详情视图（`StrategyCandidateDetail` 当前已经拿到的那个 VM）。 */
  vm: CandidateDetailVm;
  /** 后端原始候选行 —— 草图必填项与来源锚只能看原值，不能从展示文本反推。 */
  raw: CandidateRawLike;
}) {
  const eligibility = buildPromotionEligibility(vm, raw);

  return (
    <SectionCard
      title="Promotion Eligibility"
      icon={ShieldCheck}
      description="转正资格：逐条列出后端的 gate、候选当前值、要求与失败原因 —— 不依赖任何按钮的悬停提示。"
      right={
        <StatusBadge
          status={ELIGIBILITY_BADGE_STATUS[eligibility.status]}
          label={eligibility.status}
        />
      }
    >
      <p className="mb-3 text-[11px] text-muted-foreground">{eligibility.statusNote}</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44 whitespace-normal">Gate</TableHead>
            <TableHead className="whitespace-normal">Current Value</TableHead>
            <TableHead className="whitespace-normal">Required Condition</TableHead>
            <TableHead className="whitespace-normal">Failure Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {eligibility.rows.map((row) => (
            <TableRow key={row.code + row.gate}>
              <TableCell className="whitespace-normal align-top">
                <div className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={GATE_BADGE[row.state].status} label={GATE_BADGE[row.state].label} />
                    <span className="text-xs font-medium">{row.gate}</span>
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{row.code}</span>
                  {row.note !== undefined && (
                    <span
                      className={
                        row.state === "BLOCKED" || row.state === "UNKNOWN"
                          ? "text-[10px] text-amber-800"
                          : "text-[10px] text-muted-foreground"
                      }
                    >
                      {row.note}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal align-top text-xs">{row.currentValue}</TableCell>
              <TableCell className="whitespace-normal align-top text-xs text-muted-foreground">
                {row.required}
              </TableCell>
              <TableCell className="whitespace-normal align-top text-xs text-muted-foreground">
                {row.failureReason}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          另有一处前端未建模的必填子槽：<code className="font-mono">entryRule.extra.recipe</code>
          （执行配方引用）若在草稿里声明，后端还要求其
          <code className="font-mono"> recipeId / featureVersions / requiredData / rankingConfig </code>
          等子字段齐备（<code className="font-mono">definitionBuild.ts:997-1031</code>，缺失同样报
          <code className="font-mono">STRATEGY_CANDIDATE_PROMOTE_SKETCH_INCOMPLETE</code>）；
          本页不读该槽，需提交后由后端校验。
        </span>
      </p>

      <p className="mt-2 text-[11px] text-muted-foreground">{eligibility.nextStep}</p>
    </SectionCard>
  );
}

export default PromotionEligibilityCard;
