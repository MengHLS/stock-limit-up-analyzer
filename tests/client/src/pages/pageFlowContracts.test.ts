/**
 * PAGE-FLOW-001 —— 页面流程三缺口的结构契约测试（静态扫真实源码 + 真实 `appRouter` 断言）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么用静态扫描
 * ═══════════════════════════════════════════════════════════════════════════
 * 仓库没有 `jsdom` / `@testing-library`（`vitest.config.ts` 的 `environment: "node"`）
 * ⇒ 组件渲染无法在单测里证明。这里沿用本仓既有口径
 * （`strategyListDetailSplit.test.ts` / `strategyCandidateUiContract.test.ts`）：
 * **扫真实源码结构 + 用真实 `appRouter._def.procedures` 断言端点存在**。
 *
 * 断言的是**结构不变量**（不是措辞）：
 *   PD-01：观察页有研究入口，且入口**不携带**数据集坐标（观察页 dataset-unaware）；
 *   PD-04：稳健性 / OOS 不再手填源 Run，三块验证各带「是否重跑」标识；
 *   PD-03：候选列表端点真实存在 + 路由 / 侧栏可达 + 页面只读。
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "../../../../server/routers";
import { RESEARCH_STAGES } from "@/components/research/ResearchFlowNav";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const CLIENT = path.join(ROOT, "client", "src");
const read = (rel: string): string => readFileSync(path.join(CLIENT, rel), "utf8");
const PROCEDURES = Object.keys(appRouter._def.procedures);

const OBSERVATION_PAGES = [
  "pages/Dashboard.tsx",
  "pages/Market.tsx",
  "pages/SentimentAnalysis.tsx",
  "pages/LeaderCandidates.tsx",
  "pages/LimitUpReview.tsx",
];

describe("PD-01 · 观察 → 研究实验入口", () => {
  it("1) 5 个观察页都渲染 ResearchEntryLink", () => {
    for (const rel of OBSERVATION_PAGES) {
      expect(read(rel), rel).toContain("ResearchEntryLink");
    }
  });

  it("2) 入口 href 是常量且不含任何 query（观察页 dataset-unaware，不得携带坐标）", () => {
    const src = read("components/research/ResearchEntryLink.tsx");
    expect(src).toContain('const ENTRY_HREF = "/research-experiments";');
    expect(src).not.toMatch(/ENTRY_HREF\s*=\s*`/); // 不是模板串 ⇒ 不可能拼接参数
    expect(src).not.toContain("datasetVersionId=");
  });

  it("3) 入口副文案强制包含「需在实验中选择 Dataset 版本」", () => {
    expect(read("components/research/ResearchEntryLink.tsx")).toContain("需在实验中选择 Dataset 版本");
  });

  it("4) 观察页未引入 datasetRegistry 依赖", () => {
    for (const rel of OBSERVATION_PAGES) {
      expect(read(rel), rel).not.toContain("datasetRegistry");
    }
  });
});

describe("PD-04 · 验证域输入来源显式化", () => {
  const PANELS = {
    robustness: "components/robustness/SearchRobustnessPanel.tsx",
    oos: "components/oos/OosValidationPanel.tsx",
    walkForward: "components/walkForward/WalkForwardPanel.tsx",
  } as const;

  it("5) 稳健性 / OOS 不再把 sourceSearchRunId 绑到 <Input>（改为选择器）", () => {
    for (const rel of [PANELS.robustness, PANELS.oos]) {
      const src = read(rel);
      expect(src, rel).toContain("ValidationSourcePicker");
      // 关键：不得存在「Input + sourceSearchRunId」的组合（手填来源）
      expect(src, rel).not.toMatch(/<Input[\s\S]{0,200}?sourceSearchRunId/);
    }
  });

  it("6) 三块验证各带正确的「是否重跑」标识", () => {
    expect(read(PANELS.robustness)).toContain('RerunBadge kind="NO_RERUN"');
    expect(read(PANELS.oos)).toContain('RerunBadge kind="RERUN"');
    expect(read(PANELS.walkForward)).toContain('RerunBadge kind="PER_FOLD_RERUN"');
  });

  it("7) 来源选择器只把 COMPLETED 的搜索 Run 放进选项，且带空态指引", () => {
    const src = read("components/validation/ValidationSourcePicker.tsx");
    expect(src).toContain('run.status === "COMPLETED"');
    expect(src).toContain('data-validation-source-empty="true"');
    expect(src).toContain("/parameter-search");
  });

  it("8) 来源卡片展示 datasetVersionId（可复现判据）", () => {
    expect(read("components/validation/ValidationSourcePicker.tsx")).toContain("selected.datasetVersionId");
  });
});

describe("PD-03 · 候选列表（只读）", () => {
  it("9) 真实 appRouter 存在 strategyDomain.strategyCandidate.list", () => {
    expect(PROCEDURES).toContain("strategyDomain.strategyCandidate.list");
  });

  it("10) 路由 /candidates 与侧栏入口都存在，且详情路由保留", () => {
    const app = read("App.tsx");
    expect(app).toContain('<Route path="/candidates" component={CandidateList} />');
    expect(app).toContain('component={StrategyCandidateDetail}');
    expect(read("components/AppShell.tsx")).toContain('label: "候选", path: "/candidates"');
  });

  it("11) 列表页只读：不含任何写操作（update / transition / promote）", () => {
    const src = read("pages/candidates/CandidateList.tsx");
    expect(src).toContain("strategyCandidate.list.useQuery");
    expect(src).not.toMatch(/useMutation/) ;
    expect(src).not.toMatch(/strategyCandidate\.(update|transition|promote)/);
  });

  it("12) 列表页不使用旧链遗留列做筛选（experimentId / conclusionId）", () => {
    const src = read("pages/candidates/CandidateList.tsx");
    // 注释里**允许**说明这两个列已退役；断言只看**代码**（剥块注释 + 整行注释后不得出现）。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bexperimentId\b/);
    expect(code).not.toMatch(/\bconclusionId\b/);
  });

  it("13) 列表页显示来源/执行分歧标记（来源 ≠ 执行绑定）", () => {
    expect(read("pages/candidates/CandidateList.tsx")).toContain("hasSourceDatasetDivergence");
  });
});

describe("FLOW-001 · 侧栏按研究闭环阶段重组", () => {
  /** 把 navGroups 解析成 [{ label, paths }]（按分组标签切段，不依赖缩进/换行风格）。 */
  function navGroupsOf(src: string): Array<{ label: string; paths: string[] }> {
    const block = src.slice(src.indexOf("const navGroups"), src.indexOf("function normalizePath"));
    const labels = [...block.matchAll(/label: "([①②③④⑤⑥][^"]*)"/g)];
    return labels.map((m, i) => {
      const from = m.index ?? 0;
      const to = i + 1 < labels.length ? labels[i + 1].index ?? block.length : block.length;
      const seg = block.slice(from, to);
      return { label: m[1], paths: [...seg.matchAll(/path: "([^"]+)"/g)].map((x) => x[1]) };
    });
  }

  const groups = navGroupsOf(read("components/AppShell.tsx"));

  it("14) 6 个分组按「数据 → 观察 → 研究 → 策略 → 验证 → 前向与复盘」排序", () => {
    expect(groups.map((g) => g.label)).toEqual([
      "① 数据", "② 观察", "③ 研究", "④ 策略", "⑤ 验证", "⑥ 前向与复盘",
    ]);
  });

  it("15) 导航项一项不丢：恰好 28 项，且与原 27 项 + /candidates 集合一致", () => {
    const all = groups.flatMap((g) => g.paths).sort();
    const EXPECTED = [
      "/backtest", "/backtest-compare", "/backtest-runs", "/candidates", "/data-health",
      "/datasets", "/historical-state", "/leader-candidates", "/limit-up", "/market",
      "/operation-logs", "/paper-trading", "/paper-trading-3570001", "/parameter-search",
      "/performance", "/regime-report", "/research-experiments", "/review-workbench",
      "/sentiment-alerts", "/sentiment-analysis", "/stock-sync", "/strategies",
      "/strategy-final-evaluation", "/upload", "/validation", "/validation/oos",
      "/validation/robustness", "/validation/walk-forward",
    ].sort();
    expect(all).toEqual(EXPECTED);
  });

  it("16) 分组归位正确（数据类进①、观察类进②、验证报告进⑤、复盘进⑥）", () => {
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.paths]));
    for (const p of ["/data-health", "/datasets", "/historical-state", "/stock-sync", "/upload", "/operation-logs"]) {
      expect(byLabel["① 数据"], p).toContain(p);
    }
    for (const p of ["/limit-up", "/market", "/sentiment-analysis", "/leader-candidates", "/sentiment-alerts"]) {
      expect(byLabel["② 观察"], p).toContain(p);
    }
    expect(byLabel["③ 研究"]).toEqual(["/research-experiments", "/candidates"]);
    expect(byLabel["⑤ 验证"]).toContain("/regime-report");
    expect(byLabel["⑥ 前向与复盘"]).toEqual(["/paper-trading", "/paper-trading-3570001", "/review-workbench"]);
  });

  it("17) 🔒 组合回测保持原样：仍在④策略组、未改名、未挪位置（FLOW-001 §5）", () => {
    const strategies = groups.find((g) => g.label === "④ 策略")!;
    expect(strategies.paths).toContain("/backtest");
    expect(read("components/AppShell.tsx")).toContain('label: "组合回测", path: "/backtest"');
  });

  it("18) ⑤验证总览提供旧技术预览入口（/walk-forward 不在侧栏但可达）", () => {
    expect(groups.flatMap((g) => g.paths)).not.toContain("/walk-forward");
    expect(read("pages/validation/ValidationIndexPage.tsx")).toContain('href="/walk-forward"');
  });
});

describe("断链守卫 · 不得引用已移除的旧 Research 路由", () => {
  /** 递归收集 client/src 下的 ts/tsx。 */
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
    }
    return out;
  }

  it("19) 客户端代码不得出现 /research（旧工作台）、/findings、/conclusions 路由引用", () => {
    const offenders: string[] = [];
    for (const file of walk(CLIENT)) {
      const rel = path.relative(CLIENT, file).replace(/\\/g, "/");
      // 剥块注释 + 整行注释：注释里**允许**说明这些路由已退役。
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const m of code.matchAll(/["'`](\/(?:research|findings|conclusions)(?:\/|["'`]))/g)) {
        const hit = m[1];
        // `/research-experiments` 是**现行**研究入口，必须排除。
        if (hit.startsWith("/research-experiments")) continue;
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** 就地解析 navGroups（与 §14 的解析口径相同；此处不跨 describe 共享变量）。 */
  function parsedNavGroups(): Array<{ label: string; paths: string[] }> {
    const shell = read("components/AppShell.tsx");
    const block = shell.slice(shell.indexOf("const navGroups"), shell.indexOf("function normalizePath"));
    const labels = [...block.matchAll(/label: "([①②③④⑤⑥][^"]*)"/g)];
    return labels.map((m, i) => {
      const from = m.index ?? 0;
      const to = i + 1 < labels.length ? labels[i + 1].index ?? block.length : block.length;
      return {
        label: m[1],
        paths: [...block.slice(from, to).matchAll(/path: "([^"]+)"/g)].map((x) => x[1]),
      };
    });
  }

  it("20) 首页六阶段入口带与侧栏分组**逐条一致**（顺序 + 各阶段首个入口页）", () => {
    const parsed = parsedNavGroups();
    expect(RESEARCH_STAGES.map((s) => s.label)).toEqual(parsed.map((g) => g.label));
    RESEARCH_STAGES.forEach((stage, i) => {
      expect(stage.href, `${stage.label} 应跳到该阶段首个入口页`).toBe(parsed[i].paths[0]);
    });
  });

  it("21) 首页渲染六阶段入口带；该组件是纯导航（不取数、不算指标）", () => {
    expect(read("pages/Dashboard.tsx")).toContain('<ResearchFlowNav current="OBSERVE"');
    const src = read("components/research/ResearchFlowNav.tsx");
    expect(src).not.toContain("trpc");
    expect(src).not.toContain("useQuery");
    expect(src).toContain('data-research-flow-nav="true"');
  });
});

describe("FLOW-001 · 策略「验证状态」（⑤→⑥ 交接缺口）", () => {
  it("22) 验证状态台账：三块验证 + 三种重跑口径 + 免责声明，且**无结论性词汇**", () => {
    const src = read("components/strategy/StrategyValidationStatus.tsx");
    // 三块验证入口与「是否重跑」口径（与 /validation 逐条对齐）
    for (const h of ["/validation/robustness", "/validation/oos", "/validation/walk-forward"]) {
      expect(src, h).toContain(h);
    }
    for (const k of ["零重跑", "真重跑", "每 Fold 真重跑"]) expect(src, k).toContain(k);
    // 🔴 只表示「跑没跑过」，不得暗示好坏（Frontend Skill §3）
    expect(src).toContain("不代表结论好坏");
    expect(src).not.toMatch(/最优|最佳|推荐|评级|winner|best|optimal/i);
    // 只读：不得出现写操作
    expect(src).not.toMatch(/useMutation/);
    expect(src).not.toMatch(/\.(create|start|cancel|promote)\w*\(/);
  });

  it("23) 策略详情页挂载「验证状态」Tab 并传入策略坐标", () => {
    const page = read("pages/StrategyDetail.tsx");
    expect(page).toContain('data-tab="validation"');
    expect(page).toContain('strategyId={vm.strategyId} strategyVersion={vm.version}');
  });
});

describe("FLOW-001 · ⑥→② 闭环表达（阶段是环，不是直线）", () => {
  it("24) 首页流程带显式写出「⑥ → 回到 ② 观察」", () => {
    const src = read("components/research/ResearchFlowNav.tsx");
    expect(src).toContain('data-research-flow-loop="true"');
    expect(src).toMatch(/回到 ② 观察/);
  });

  it("25) 复盘工作台提供回到 ②观察 / ③研究 的出口（此前无任何回跳）", () => {
    const src = read("pages/ReviewWorkbench.tsx");
    expect(src).toContain('data-review-loop-exits="true"');
    for (const h of ["/limit-up", "/sentiment-analysis", "/research-experiments"]) {
      expect(src, h).toContain(`href="${h}"`);
    }
    // 诚实口径：只回跳，不替用户下结论
    expect(src).toContain("不替你下研究结论");
  });
});

describe("前端 DOM 可验证性 · Tab 锚点约定", () => {
  const TAB_PAGES = [
    "pages/DataHealth.tsx",
    "pages/datasets/DatasetDetail.tsx",
    "pages/datasets/VersionDetail.tsx",
    "pages/Market.tsx",
    "pages/StrategyDetail.tsx",
  ];

  it("26) 每个 TabsTrigger 都带 data-tab 锚点（否则 Radix Tab 只能靠文案定位，DOM 验证不可靠）", () => {
    for (const f of TAB_PAGES) {
      const src = read(f);
      const segments = src.split("<TabsTrigger").slice(1);
      expect(segments.length, `${f} 应至少有一个 TabsTrigger`).toBeGreaterThan(0);
      for (const seg of segments) {
        const tag = seg.slice(0, seg.indexOf(">"));
        expect(tag, `${f} 的 TabsTrigger 缺 data-tab：${tag.slice(0, 60)}`).toContain("data-tab=");
      }
    }
  });
  it("27) 策略详情的验证状态 Tab 同时带 data-tab 与对应 TabsContent 锚点", () => {
    const src = read("pages/StrategyDetail.tsx");
    expect(src).toContain('data-tab="validation"');
    expect(src).toContain('data-tab-content="validation"');
  });
});

describe("前端一致性 · 破坏性操作必须走统一 ConfirmDialog", () => {
  it("28) 客户端不再使用原生 window.confirm（会阻塞页面且无法被无头 DOM 断言）", () => {
    function walk(dir: string, out: string[] = []): string[] {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
      }
      return out;
    }
    const offenders: string[] = [];
    for (const file of walk(CLIENT)) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/window\.confirm\s*\(/.test(code)) offenders.push(path.relative(CLIENT, file).replace(/\\/g, "/"));
    }
    expect(offenders).toEqual([]);
  });

  it("29) 两处破坏性操作改为 ConfirmDialog（删除记录 / 换版本丢草稿）", () => {
    const limitUp = read("pages/LimitUpReview.tsx");
    expect(limitUp).toContain("<ConfirmDialog");
    expect(limitUp).toContain("setConfirmDeleteOpen(true)");
    expect(limitUp).toContain("tone=\"danger\"");
    const detail = read("pages/StrategyDetail.tsx");
    expect(detail).toContain("<ConfirmDialog");
    expect(detail).toContain("setPendingVersionSwitch");
    expect(detail).toMatch(/丢弃并切换/);
  });
});

describe("前端可访问性 · 纯图标交互必须自带可访问名称", () => {
  it("30) 顶栏情绪预警铃（渲染在每一页）带状态相关的 aria-label 与 title", () => {
    const src = read("components/SentimentAlertBell.tsx");
    expect(src).toMatch(/aria-label=\{unreadCount > 0 \?[^}]*\}/);
    expect(src).toContain("title={unreadCount > 0");
  });

  it("31) 模拟盘「暂停 / 恢复」纯图标按钮带状态相关 aria-label（此前无名）", () => {
    const src = read("pages/PaperTrading.tsx");
    expect(src).toMatch(/aria-label=\{run\.status === "active" \? "暂停该模拟盘运行" : "恢复该模拟盘运行"\}/);
    expect(src).toContain('title={run.status === "active" ? "暂停" : "恢复"}');
  });
});

describe("前端可访问性 · 表单控件必须具备可访问名称", () => {
  it("32) 曾无名的表单控件均已建立关联（id+htmlFor 或 aria-label）", () => {
    const EXPECT: Array<readonly [string, readonly string[]]> = [
      ["pages/HistoricalState.tsx", [
        'htmlFor="hs-trade-date"', 'id="hs-trade-date"',
        'htmlFor="hs-asof"', 'id="hs-asof"',
        'aria-label="① 代码解析（可选）"', 'aria-label="② securityId（sec_…）"',
      ]],
      ["pages/Dashboard.tsx", ['htmlFor="dashboard-date-select"', 'id="dashboard-date-select"' ]],
      ["pages/ParameterSearch.tsx", [
        'aria-label="种子（seed）"', 'aria-label="迭代次数（iterations，默认 500）"',
        'aria-label="策略 ID"', 'aria-label="版本"',
        'aria-label="决策起（YYYY-MM-DD）"', 'aria-label="决策止"',
      ]],
      ["pages/RegimeReport.tsx", [
        'aria-label="基准指数代码"', 'aria-label="起始日期（含）"', 'aria-label="结束日期（含）"',
      ]],
      ["pages/WalkForwardAnalysis.tsx", [
        'aria-label="日期区间 · 起始"', 'aria-label="日期区间 · 结束"',
      ]],
      ["pages/StockSync.tsx", ['aria-label="搜索股票代码或名称"' ]],
      ["pages/LimitUpReview.tsx", ['aria-label="搜索股票代码或名称"' ]],
      ["pages/LeaderCandidates.tsx", ['aria-label="手动最低评分阈值"' ]],
      ["components/oos/OosValidationPanel.tsx", [
        'aria-label="OOS 窗口起始日（YYYY-MM-DD）"', 'aria-label="OOS 窗口结束日（YYYY-MM-DD）"',
      ]],
    ];
    for (const [file, needles] of EXPECT) {
      const src = read(file);
      for (const n of needles) expect(src, `${file} 缺 ${n}`).toContain(n);
    }
  });
});

describe("前端可访问性 · 可点击 chips 必须是真按钮（键盘可达）", () => {
  it("33) 板块 / 阶段筛选 chips 用 Badge asChild 渲染真 <button> 并带 aria-pressed", () => {
    for (const f of ["components/CandidateInsightCharts.tsx", "components/CandidatePhaseFunnel.tsx"]) {
      const src = read(f);
      expect(src, `${f} 应使用 Badge asChild`).toContain("asChild");
      expect(src, `${f} 应渲染真 button`).toMatch(/<Badge[\s\S]{0,120}asChild[\s\S]{0,200}<button/);
      expect(src, `${f} 应带 aria-pressed`).toContain("aria-pressed={");
      // 不得再出现「span/div 上挂 onClick 当筛选开关」（键盘不可达）
      expect(src, `${f} 不应再有 Badge 直接挂 onClick`).not.toMatch(/<Badge[^>]*onClick=/);
    }
  });

  it("34) 阶段筛选的指引文案已说明键盘操作（此前只写「点击」）", () => {
    expect(read("components/CandidatePhaseFunnel.tsx")).toMatch(/回车|空格/);
  });
});

describe("前端可访问性 · 对话框焦点还原在包装层统一兜底", () => {
  it("36) 两个 Radix 包装层都接入共享 hook（一处修复覆盖全部对话框）", () => {
    for (const f of ["components/ui/dialog.tsx", "components/ui/alert-dialog.tsx"]) {
      const src = read(f);
      expect(src, `${f} 应 import hook`).toContain('useDialogFocusRestore');
      expect(src, `${f} 应调 onOpenAutoFocus`).toContain("focusRestore.onOpenAutoFocus()");
      expect(src, `${f} 应调 onCloseAutoFocus`).toContain("focusRestore.onCloseAutoFocus(event)");
      expect(src, `${f} 应把调用方 handler 透传`).toMatch(/onOpenAutoFocus\?\.\(event\)/);
    }
  });

  it("37) 共享 hook 的实现契约：打开时捕获、关闭时还原且有 contains 守卫", () => {
    const src = read("lib/dialogFocusRestore.ts");
    expect(src).toContain("document.activeElement");
    expect(src).toContain("event.preventDefault()");
    expect(src).toContain("document.contains(target)");
  });

  it("38) ConfirmDialog 不再各写一份（去重，统一走包装层）", () => {
    const src = read("components/common/ConfirmDialog.tsx");
    expect(src).not.toContain("lastFocusedRef");
    expect(src).not.toContain("onCloseAutoFocus");
  });
});

describe("前端可访问性 · 键盘焦点必须有可见指示", () => {
  it("39) 共用 TabsList 自带 focus-visible ring（Radix List 自身可进入焦点顺序）", () => {
    const src = read("components/ui/tabs.tsx");
    expect(src).toContain("focus-visible:ring-2");
    expect(src).toContain("focus-visible:ring-ring");
  });

  it("40) 策略版本演化的无边框搜索框由容器 focus-within 显示焦点环", () => {
    const src = read("pages/StrategyVersionCompare.tsx");
    expect(src).toContain("focus-within:border-ring");
    expect(src).toContain("focus-within:ring-2");
    expect(src).toContain("focus-within:ring-ring/50");
  });

  it("41) 侧栏账户菜单触发器不能只清除 outline，必须提供 focus-visible ring", () => {
    const src = read("components/AppShell.tsx");
    expect(src).toContain("focus-visible:ring-2");
    expect(src).toContain("focus-visible:ring-sidebar-ring");
    expect(src).not.toContain('group-data-[collapsible=icon]:flex-none focus:outline-none');
  });
});
