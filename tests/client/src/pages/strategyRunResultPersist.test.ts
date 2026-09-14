/**
 * 「跑过的回测刷新后就没了」的修复契约（静态扫真实源码 + 真实 `appRouter` 端点断言）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么要有这个测试
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-09-14 用户报障「我刚才跑过的回测，结果又没了」。实查根因**不是**没跑、也**不是**
 * 没落库（`closed_loop_backtest_run` 里那次运行完整在库），而是**展示层**：
 * `StrategyDetail.tsx` 的 `RunTab` 把运行结果**只**存进 `useState`，而 `dev` 是单进程
 * `tsx watch server/_core/index.ts` —— 任何 `server/**` 改动触发的热重启、或用户手动刷新，
 * 都会整页重载 ⇒ 结果从内存里消失，空态还写着「还没跑过」，看起来就像「跑过的回测又没了」。
 *
 * 修复不是加样式，而是**改数据来源**：无本次结果时，从留档恢复该策略最近一次运行。
 * 本文件用与 `strategyListDetailSplit.test.ts` 同一种口径（本机无 `jsdom` / `agent-browser`，
 * 无法做渲染测试）把这条修复的**结构不变量**钉住 —— 断言的是「谁优先 / 走哪个端点 / 复用哪套
 * 渲染」，不是措辞：
 *   1. 恢复路径真的调了留档端点，且这些端点真实挂在 `appRouter` 上；
 *   2. 恢复按**策略**取最近一次（不是全表最后一条）；
 *   3. **本次运行结果优先**，不会被旧留档顶掉；
 *   4. 恢复复用运行工作台**同一套** ViewModel 构建 + 面板（零口径漂移）；
 *   5. 无留档时的空态**不再谎称**「还没跑过」，并给出 `/backtest-runs` 入口；
 *   6. 「有留档但缺完整结果」必须明说 —— 不把「记录坏了」伪装成「没跑过」。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "../../../../server/routers";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const CLIENT = path.join(ROOT, "client", "src");

function read(rel: string): string {
  return readFileSync(path.join(CLIENT, rel), "utf8");
}

const DETAIL = read("pages/StrategyDetail.tsx");
const HISTORY_PAGE = read("pages/BacktestRuns.tsx");
const PROCEDURES = Object.keys(appRouter._def.procedures);

describe("运行结果：刷新后可恢复（不再只活在内存里）", () => {
  it("1) 恢复路径真的调了留档端点，且端点真实存在", () => {
    const used = [
      ["listBacktests", "researchRun.listBacktests"],
      ["getBacktest", "researchRun.getBacktest"],
    ] as const;
    for (const [method, procedure] of used) {
      expect(DETAIL).toMatch(new RegExp(`trpc\\s*\\.\\s*researchRun\\s*\\.\\s*${method}\\b`));
      expect(PROCEDURES).toContain(procedure);
    }
  });

  it("2) 恢复按「策略 + 最近一次」取，不是全表最后一条", () => {
    // 过滤坐标必须是当前策略；条数收敛为 1
    expect(DETAIL).toMatch(/strategyId:\s*vm\.strategyId/);
    expect(DETAIL).toMatch(/limit:\s*1\b/);
    // 详情查询必须被启用条件守卫（否则会拿 id=0 去打端点）
    expect(DETAIL).toMatch(/enabled:\s*latestRun\s*!==\s*null/);
  });

  it("3) 🔴 本次运行结果优先：runResult 的分支必须排在留档恢复之前", () => {
    const freshIndex = DETAIL.indexOf("runResult !== null ?");
    const archiveIndex = DETAIL.indexOf("restoredFromArchive !== null ?");
    expect(freshIndex).toBeGreaterThan(-1);
    expect(archiveIndex).toBeGreaterThan(-1);
    expect(freshIndex).toBeLessThan(archiveIndex);
  });

  it("4) 恢复复用运行工作台同一套构建 + 面板（零口径漂移）", () => {
    expect(DETAIL).toContain("buildClosedLoopRunViewModel");
    expect(DETAIL).toMatch(/<ClosedLoopRunResultPanel\s+result=\{restoredFromArchive\}\s*\/>/);
    // 「回测历史」页必须用同一套 —— 否则就是两套渲染口径
    expect(HISTORY_PAGE).toContain("buildClosedLoopRunViewModel");
    expect(HISTORY_PAGE).toContain("ClosedLoopRunResultPanel");
  });

  it("5) 无留档时的空态不再谎称「还没跑过」，并给出回测历史入口", () => {
    // 旧文案把「本次会话没跑过」说成「还没跑过」，正是用户困惑的来源
    expect(DETAIL).not.toContain("还没跑过。点上方「运行策略」后");
    expect(DETAIL).toContain("这个策略还没有运行记录");
    // 空态必须有通往留档列表的入口（否则用户仍无处可查）
    expect(DETAIL).toMatch(/to="\/backtest-runs"/);
    // 该路由真实存在
    expect(read("App.tsx")).toContain('path="/backtest-runs"');
  });

  it("6) 「有留档但缺完整结果」明说原因，不伪装成「没跑过」", () => {
    expect(DETAIL).toContain("resultJson 为空");
  });

  it("7) 运行成功后让「最近一次留档」立即对齐", () => {
    expect(DETAIL).toMatch(/utils\s*\.\s*researchRun\s*\.\s*listBacktests\s*\.\s*invalidate\(\)/);
  });
});
