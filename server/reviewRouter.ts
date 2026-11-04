/**
 * FE-9 — 复盘工作台 tRPC 端点（Review Router）：复盘纪律 + 生产闭环（传输层）。
 *
 * 职责：把 C-24.1 tradeJournal / C-24.2 disciplineFeedback / C-23.1 paperAccount
 * 三个「注入式纯函数」引擎暴露为可序列化输入 → 可序列化结果的 tRPC 端点。
 *
 * 纪律（对齐 researchRouter FE-0 的传输层 → 领域层边界投递范式）：
 * - **只读复用**：本层只调用既有纯函数（reconcilePlanVsActual /
 *   buildJournalDraftsFromRun / buildDisciplineFeedbackRun / assemblePaperAccountRun），
 *   不重写任何语义；输入 schema 一律 `z.custom` 类型透传，由后端权威校验器
 *   （assertValidSignalToPnlRun / assertFiniteRecord / reconcile 内部断言 / 账户不变量）
 *   作权威校验，shared 层不复制领域 schema，避免双份口径漂移；
 * - **错误不静默**：引擎抛出的结构化错误（TradeJournalError / DisciplineFeedbackError /
 *   PaperAccountError，均带稳定 code）原样冒泡为 tRPC 错误，不吞异常、不返回
 *   「成功但为空」的假结果；
 * - **诚实边界（数据注入未完成）**：tradeJournal 的「计划 vs 实际」与 disciplineFeedback
 *   的「人工标注（reason/emotion/rule violation）」需人工/上游注入；真实数据源
 *   （legacy 前向纸面 `PaperTradingState`、生产回测 `realisticSimulation.trades`）与引擎
 *   契约（SignalToPnlRun / PaperAccountRunInput / TradeJournalEntry）形态不同，桥接属
 *   C-23.2 编排（当前退出策略未完成）。故本层端点一律**接收可序列化引擎原生输入**，
 *   不擅自把 legacy 数据伪装成引擎契约；缺失人工标注时由引擎以受控词表显式缺省码
 *   （TJ_UNASSESSED_REASON_CODES / DFA_ENV_UNLABELED / annotation=null）表达，绝不编造。
 * - **状态不冒充**：C-24.1/24.2/25.1 仍为 CODE_READY（待数据链就绪后认证），本 router
 *   不改变任何认证状态；结果一律属「技术预览·非 RESEARCH_READY 口径」（前端 R7 标注）。
 *
 * 注意：本 router 尚未合并进 `server/routers.ts` 的 `appRouter`（由协调者统一合并），
 * 前端暂以类型断言方式消费（见 ReviewWorkbench.tsx），合并后改回 `trpc.review.*`。
 */

import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { reconcilePlanVsActual } from "./research/tradeJournal/reconcile";
import { buildJournalDraftsFromRun } from "./research/tradeJournal/drafts";
import { buildDisciplineFeedbackRun } from "./research/disciplineFeedback/run";
import { assemblePaperAccountRun } from "./research/paperAccount/run";
import type { PaperAccountRunInput } from "./research/paperAccount/run";
import type { ReconcilePlanVsActualInput } from "./research/tradeJournal/types";
import type { SignalToPnlRun } from "./research/signalToPnl/types";
import type { BuildDisciplineFeedbackRunInput } from "./research/disciplineFeedback/types";

// ---------------------------------------------------------------------------
// 传输层透传 schema（不含函数字段；语义由后端权威校验器判定）
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** C-24.1 reconcile 入参（planned + actual fills + 未成交审计 + 可选交易日历）。 */
const reconcileInputSchema = z.custom<ReconcilePlanVsActualInput>(isPlainObject, {
  message: "journal.reconcile 入参必须是对象（ReconcilePlanVsActualInput）",
});

/** C-23.2 SignalToPnlRun 记录透传（结构 + 指纹由 assertValidSignalToPnlRun 权威校验）。 */
const signalToPnlRunSchema = z.custom<SignalToPnlRun>(isPlainObject, {
  message: "journal.drafts.run 必须是 SignalToPnlRun 对象",
});

/** C-24.2 buildDisciplineFeedbackRun 入参透传。 */
const disciplineRunInputSchema = z.custom<BuildDisciplineFeedbackRunInput>(isPlainObject, {
  message: "discipline.run 入参必须是对象（BuildDisciplineFeedbackRunInput）",
});

/** C-23.1 assemblePaperAccountRun 入参透传。 */
const paperRunInputSchema = z.custom<PaperAccountRunInput>(isPlainObject, {
  message: "paper.run 入参必须是对象（PaperAccountRunInput）",
});

// ---------------------------------------------------------------------------
// reviewRouter
// ---------------------------------------------------------------------------

export const reviewRouter = router({
  journal: router({
    /**
     * 计划 vs 实际 机器核对（C-24.1 reconcilePlanVsActual，纯函数）。
     * 产出 JournalDeviation：fillState / 数量差 / 价格差 / 时机偏移 / 未成交原因
     * / 机器可算偏差维度；缺失处显式 unassessed + reasonCode，不猜。
     */
    reconcile: publicProcedure
      .input(reconcileInputSchema)
      .mutation(({ input }) => reconcilePlanVsActual(input)),

    /**
     * 从 SignalToPnlRun 提取 journal draft（C-24.1 buildJournalDraftsFromRun）。
     * 每笔订单 → 一条待标注 draft（annotation=null）；记录不一致/非终态 → 诚实跳过
     * 计数（skipped + counts），不静默丢记录。来源 run 指纹不一致会响亮抛错。
     */
    drafts: publicProcedure
      .input(
        z.object({
          run: signalToPnlRunSchema,
          createdAt: z.string().min(1, "createdAt 必填（ISO-8601 UTC）"),
        }),
      )
      .mutation(({ input }) =>
        buildJournalDraftsFromRun(input.run, { createdAt: input.createdAt }),
      ),
  }),

  discipline: router({
    /**
     * 纪律反馈分析（C-24.2 buildDisciplineFeedbackRun）。
     * 四类聚合（违规原因 / 重复错误 / 最差执行策略 / 易错环境）+ 描述性结论
     * （stable / patternsFound / inconclusive + DFA reasonCode）。只消费已标注
     * entry；空账本 / 全 draft / 单 entry → 显式 inconclusive，不硬出结论。
     */
    run: publicProcedure
      .input(disciplineRunInputSchema)
      .mutation(({ input }) => buildDisciplineFeedbackRun(input)),
  }),

  paper: router({
    /**
     * 组装 paper account run（C-23.1 assemblePaperAccountRun）。
     * 返回不可变 PaperAccountRun（含 PnL 分解 pnlBreakdown、订单流/成交流/持仓快照/
     * 现金账本/权益曲线/双声明指纹 + 能力矩阵快照 + sha256 指纹）。
     */
    run: publicProcedure
      .input(paperRunInputSchema)
      .mutation(({ input }) => assemblePaperAccountRun(input)),
  }),
});

export type ReviewRouter = typeof reviewRouter;
