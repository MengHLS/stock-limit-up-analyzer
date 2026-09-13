/**
 * 策略「列表 / 详情」分家的结构契约测试（静态扫真实源码 + 真实 `appRouter` 断言）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么用静态扫描
 * ═══════════════════════════════════════════════════════════════════════════
 * 本机 `agent-browser` 不可用、仓库也没有 `jsdom` / `@testing-library`
 * ⇒ 「路由指向哪 / 页面调了哪个端点」无法靠渲染测试证明。这里用与
 * `strategyCandidateUiContract.test.ts` 同一种口径：扫真实源码 + 用真实
 * `appRouter._def.procedures` 断言端点存在。
 *
 * 断言的是**结构不变量**（不是措辞，措辞会随需求变）：
 *   1. 列表与详情是两条独立路由，各有独立文件；
 *   2. 旧 `/strategy-editor` 仍可达（只做兼容改写），且**不存在第二个策略页面**；
 *   3. 导航指向列表页；
 *   4. 策略深链只有一个生成器，且指向详情路由；
 *   5. 详情页不承载「全库浏览」（不调 `research.strategy.list`）；
 *   6. 用到的端点全部真实存在；
 *   7. 新建草稿不复用模板身份（否则会撞上库里既有策略）；
 *   8. 已移除的运行开关不再出现在文案里（否则用户会去找不存在的开关）。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "../../../../server/routers";
import { strategyVersionPath } from "@/adapters/strategyCandidateAdapter";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const CLIENT = path.join(ROOT, "client", "src");

function read(rel: string): string {
  return readFileSync(path.join(CLIENT, rel), "utf8");
}

const PROCEDURES = Object.keys(appRouter._def.procedures);

describe("策略：列表页 / 详情页分家", () => {
  it("1) 两条独立路由：/strategies（列表）与 /strategies/:strategyId（详情）", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/<Route path="\/strategies" component=\{StrategyList\}/);
    expect(app).toMatch(
      /<Route path="\/strategies\/:strategyId" component=\{StrategyDetail\}/,
    );
  });

  it("2) 旧 /strategy-editor 仍可达（兼容改写），且不再有第二个策略页面组件", () => {
    const app = read("App.tsx");
    expect(app).toMatch(
      /<Route path="\/strategy-editor" component=\{LegacyStrategyRedirect\}/,
    );
    const pages = readdirSync(path.join(CLIENT, "pages"));
    expect(pages).toContain("StrategyList.tsx");
    expect(pages).toContain("StrategyDetail.tsx");
    // 旧的单页实现必须已删除 —— 否则「分家」会退化成「两套页面并存」
    expect(existsSync(path.join(CLIENT, "pages", "StrategyEditor.tsx"))).toBe(false);
  });

  it("3) 侧边导航指向列表页，且不再指向旧路由", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell).toContain('path: "/strategies"');
    expect(shell).not.toContain('path: "/strategy-editor"');
  });

  it("4) 策略深链生成器指向详情路由（不再产出旧地址）", () => {
    const p = strategyVersionPath("cand-180001", "1.0.0");
    expect(p).toBe("/strategies/cand-180001?version=1.0.0");
    expect(p).not.toContain("strategy-editor");
  });

  it("5) 详情页不承载「全库浏览」：不调 research.strategy.list", () => {
    const detail = read("pages/StrategyDetail.tsx");
    expect(detail).not.toMatch(/trpc\s*\.\s*research\s*\.\s*strategy\s*\.\s*list\b/);
    // 且筛选版本列表（listVersions）是允许的 —— 证明上一条不是「整个 strategy.* 都禁」
    expect(detail).toMatch(/trpc\s*\.\s*research\s*\.\s*strategy\s*\.\s*listVersions\b/);
  });

  it("6) 列表页走真实只读端点，且该端点确实挂在真实 appRouter 上", () => {
    expect(read("pages/StrategyList.tsx")).toMatch(
      /trpc\s*\.\s*research\s*\.\s*strategy\s*\.\s*list\b/,
    );
    expect(PROCEDURES).toContain("research.strategy.list");
  });

  it("7) 两个页面用到的策略端点全部真实存在", () => {
    const used = [
      "list",
      "load",
      "loadVersion",
      "listVersions",
      "validate",
      "save",
      "createVersion",
    ];
    expect(used.filter(x => !PROCEDURES.includes(`research.strategy.${x}`))).toEqual([]);
  });

  it("8) 新建草稿不复用模板身份（清空 strategyId，避免变成给既有策略加版本）", () => {
    expect(read("pages/StrategyDetail.tsx")).toMatch(/strategyId:\s*""/);
  });

  it("9) 已移除的运行开关不再出现在**用户可见文案**里（代码注释里的历史说明不算）", () => {
    const run = read("components/strategy/RunConfigPanel.tsx");
    const result = read("components/strategy/ClosedLoopRunResultPanel.tsx");
    // 下面每一条都是随开关一起删掉的**原界面文案**；
    // 「开关已移除」这件事本身仍在代码注释里说明（那是给维护者看的，不占用户视野）。
    expect(run).not.toContain("不由本页开关决定");
    expect(run).not.toContain("这是当前实现边界");
    expect(result).not.toContain("未开启「使用真实数据」");
    expect(result).not.toContain("「数据完整性已确认」未勾选");
  });
});
