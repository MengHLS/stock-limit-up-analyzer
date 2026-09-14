# -*- coding: utf-8 -*-
"""向 drizzle/schema.ts（**纯 CRLF**）末尾追加闭环回测结果表定义。

为什么不直接用行级编辑：`drizzle/schema.ts` 1909 行全部是 CRLF、零 LF，
若插入 LF 会污染行尾（混合行尾），故用显式 `\\r\\n` 拼接并断言。

幂等：已包含 `closed_loop_backtest_run` 则跳过。
"""
import sys

SCHEMA = "drizzle/schema.ts"
ANCHOR = "export type InsertResearchAnalysisTemplateItemRow = typeof researchAnalysisTemplateItem.$inferInsert;"
MARKER = "closed_loop_backtest_run"

BLOCK_LINES = [
    "",
    "// ===========================================================================",
    "// 闭环回测结果持久化（CLOSED-LOOP-BACKTEST-PERSIST-001，2026-09-14）",
    "// ===========================================================================",
    "",
    "/**",
    " * 闭环回测结果表 —— 把 `researchRun.loopRun` 的一次真实执行**完整留档**。",
    " *",
    " * 背景：`loopRun` 原为**无状态、不落库**的一次性调用（其注释即如此声明），跑完即弃 ⇒",
    " * 界面刷新后无法回看，也无法回答「上次到底跑出什么」。本表补上「每次运行都有结果可查」。",
    " *",
    " * 语义边界（🔴 不得混淆）：",
    " *   - 与 legacy 的 `backtest_runs` **不是同一张表、不共用口径**：那张存的是龙头候选回测",
    " *     （`LeaderCandidateBacktestResult`），本表存闭环 14 阶段运行结果（`ClosedLoopRunResult`）；",
    " *   - `resultJson` 是运行结果的原样投影（展示层只做恒等搬运，禁估算/重算）；",
    " *     列表页**不读** `resultJson`（只读摘要列），避免长文本扫描；",
    " *   - 本表**不参与任何执行路径**：清空它不影响回测正确性，只影响「能不能回看」。",
    " *",
    " * 引用形态：`strategyId` / `datasetVersionId` 等均为**快照值 + 零 FK**（项目既有原则）；",
    " * `runId` UNIQUE 用于把「同一次运行的重试」幂等收敛为一行（`ON DUPLICATE KEY UPDATE`）。",
    " */",
    'export const closedLoopBacktestRun = mysqlTable("closed_loop_backtest_run", {',
    '  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),',
    "  /** 闭环运行 id（`loopRun` 返回的 runId，形如 `clrun-…`）。UNIQUE：重试幂等收敛为一行。 */",
    '  runId: varchar("runId", { length: 80 }).notNull(),',
    "  /** 谱系锚点（§28 实验谱系）。 */",
    '  experimentId: varchar("experimentId", { length: 80 }).notNull(),',
    "  /** 策略坐标快照（软引用，无 FK）。 */",
    '  strategyId: varchar("strategyId", { length: 64 }).notNull(),',
    '  strategyVersion: varchar("strategyVersion", { length: 32 }).notNull(),',
    "  /** 回测窗口（含两端）。 */",
    '  startDate: date("startDate", { mode: "string" }).notNull(),',
    '  endDate: date("endDate", { mode: "string" }).notNull(),',
    "  /** Dataset label 快照（仅显示用）。 */",
    '  datasetVersion: varchar("datasetVersion", { length: 96 }),',
    "  /** 真实 Dataset 坐标 → `dataset_version.id`（软引用）；直读未命中时为 NULL。 */",
    '  datasetVersionId: bigint("datasetVersionId", { mode: "number" }),',
    "  /** 数据来源：`registry`（直读已落库数据集）| `rebuild`（回落从零重建）。 */",
    '  datasetSource: varchar("datasetSource", { length: 16 }),',
    "  /** 本次使用的配方 id（装配层记录的事实，软引用）。 */",
    '  recipeId: varchar("recipeId", { length: 96 }),',
    "  /** 整体状态：ALL_EXECUTED / PARTIAL_BLOCKED / NO_STAGE_EXECUTED。 */",
    '  status: varchar("status", { length: 24 }).notNull(),',
    '  executedStageCount: int("executedStageCount").notNull(),',
    '  blockedStageCount: int("blockedStageCount").notNull(),',
    '  skippedStageCount: int("skippedStageCount").notNull(),',
    "  /** 首个阻塞原因码（无阻塞为 NULL）。 */",
    '  firstBlockedReasonCode: varchar("firstBlockedReasonCode", { length: 64 }),',
    "  /** 摘要：初始资金（元）—— 仅列表页展示，权威值在 `resultJson`。 */",
    '  initialCapital: double("initialCapital"),',
    "  /** 摘要：期末权益（元）。 */",
    '  finalEquity: double("finalEquity"),',
    "  /** 摘要：成交笔数。 */",
    '  tradeCount: int("tradeCount"),',
    "  /** 摘要：权益曲线点数。 */",
    '  equityCurvePointCount: int("equityCurvePointCount"),',
    "  /** 扁平摘要 JSON（列表页展示；口径自描述）。 */",
    '  summaryJson: text("summaryJson"),',
    "  /** 运行结果完整投影（详情页用；**列表页不读此列**）。 */",
    '  resultJson: longtext("resultJson"),',
    '  createdAt: timestamp("createdAt").defaultNow().notNull(),',
    "}, (table) => ({",
    '  runUnique: uniqueIndex("uq_closed_loop_backtest_run_run").on(table.runId),',
    '  createdIdx: index("idx_closed_loop_backtest_run_created").on(table.createdAt),',
    '  strategyIdx: index("idx_closed_loop_backtest_run_strategy").on(table.strategyId, table.createdAt),',
    "}));",
    "",
    "export type ClosedLoopBacktestRunRow = typeof closedLoopBacktestRun.$inferSelect;",
    "export type InsertClosedLoopBacktestRunRow = typeof closedLoopBacktestRun.$inferInsert;",
]

raw = open(SCHEMA, "rb").read()
text = raw.decode("utf-8")

if MARKER in text:
    print("SKIP：schema.ts 已包含 %s" % MARKER)
    sys.exit(0)

if ANCHOR not in text:
    print("FAIL：锚点缺失：%s" % ANCHOR)
    sys.exit(1)

block = "".join(line + "\r\n" for line in BLOCK_LINES)
new_text = text + "\r\n" + block

# 断言：锚点仍在 + 新内容在末尾 + 行尾仍是纯 CRLF
assert ANCHOR in new_text, "锚点丢失"
assert new_text.endswith("\r\n"), "结尾行尾异常"
assert MARKER in new_text, "新表未写入"
# 行尾纯度：不允许出现「非 CRLF 结尾的 \n」
lf_only = new_text.count("\n") - new_text.count("\r\n")
assert lf_only == 0, "出现非 CRLF 行尾：%d 处" % lf_only

open(SCHEMA, "wb").write(new_text.encode("utf-8"))

lines = new_text.splitlines()
print("OK：schema.ts 行数 = %d（追加 %d 行）" % (len(lines), len(BLOCK_LINES) + 1))
print("锚点行 = %d" % (lines.index(ANCHOR) + 1))
print("末行 = %s" % lines[-1][:100])
