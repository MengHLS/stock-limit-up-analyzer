/**
 * 回测对比页契约（纯函数 + 静态扫真实源码 + 真实 `appRouter` 端点断言）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么要有这个测试
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户诉求：「加一个回测对比的页面，展示形式类似于组合回测中的折线图，然后在这个页面中加入
 * 之前的那个交易明细」；随后明确修正：「不要重新运行，而是要查看已经留档的数据」。
 * 这条诉求的**风险**有两条，都不在样式：
 *   1. 对比页必须**只读留档**（`listBacktests` / `getBacktests`），绝不能偷偷重新跑回测
 *      （没有任何 mutation / `compareStrategyVersions` 触发路径）；
 *   2. 曲线口径必须与组合回测一致：「该留档权益 ÷ 该留档初始资金 − 1」的恒等换算，
 *      跨留档不合并账户、不插值、不补 0；且交易明细复用既有组件，不另写一张表。
 *
 * 本文件钉住这些结构不变量（本机无 `jsdom` / `@testing-library`，渲染测试不可做）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildVersionCompareCurve,
  VERSION_COMPARE_COLORS,
} from "@/pages/backtestCompareCurve";
import { appRouter } from "../../../../server/routers";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const CLIENT = path.join(ROOT, "client", "src");

function read(rel: string): string {
  return readFileSync(path.join(CLIENT, rel), "utf8");
}

/**
 * 与留档 `result`（`ClosedLoopRunResult`）同构的最小 backtest 结果。
 *
 * 只放适配器真正读取的字段：`stages[].output` 是唯一数据源。
 */
function rawRun(options: {
  runId?: string;
  initialCapital?: number | null;
  finalEquity?: number | null;
  tradeCount?: number | null;
  equityCurve?: Array<{ date: string; equity: number }>;
  totalReturnPct?: number | null;
} = {}): Record<string, unknown> {
  const {
    runId = "clrun-test",
    initialCapital = 100_000,
    finalEquity = 123_456,
    tradeCount = 3,
    equityCurve = [],
    totalReturnPct = null,
  } = options;

  const stages: unknown[] = [
    {
      stageId: "backtest",
      state: "EXECUTED",
      outputKind: "backtestSummary",
      output: {
        kind: "backtestSummary",
        initialCapital,
        finalEquity,
        tradeCount,
        equityCurve,
        trades: [],
      },
    },
  ];
  if (totalReturnPct !== null) {
    stages.push({
      stageId: "evaluation",
      state: "EXECUTED",
      outputKind: "evaluationRef",
      output: { kind: "evaluationRef", performance: { totalReturnPct } },
    });
  }
  return { runId, stages };
}

describe("回测对比曲线 — 多留档权益合并为累计收益率", () => {
  it("按日期并集合并：各留档只在自己的日期上有值，横轴升序", () => {
    const { data, series } = buildVersionCompareCurve([
      {
        label: "#1 · v1.0.0",
        result: rawRun({
          equityCurve: [
            { date: "2026-01-06", equity: 110_000 },
            { date: "2026-01-05", equity: 100_000 },
          ],
        }),
      },
      {
        label: "#2 · v1.1.0",
        result: rawRun({
          initialCapital: 200_000,
          equityCurve: [
            { date: "2026-01-06", equity: 200_000 },
            { date: "2026-01-07", equity: 180_000 },
          ],
        }),
      },
    ]);

    expect(series.map(item => item.key)).toEqual(["s0", "s1"]);
    expect(series.map(item => item.label)).toEqual(["#1 · v1.0.0", "#2 · v1.1.0"]);
    expect(series.map(item => item.pointCount)).toEqual([2, 2]);

    expect(data.map(row => row.date)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);
    expect(data[0]).toEqual({ date: "2026-01-05", s0: 0 });
    // 各留档用自己的初始资金换算，绝不跨留档对齐账户
    expect(data[1]).toEqual({ date: "2026-01-06", s0: 10, s1: 0 });
    expect(data[2]).toEqual({ date: "2026-01-07", s1: -10 });
  });

  it("收益率 = 权益 ÷ 该留档初始资金 − 1，保留 2 位小数", () => {
    const { data } = buildVersionCompareCurve([
      {
        label: "#1",
        result: rawRun({
          equityCurve: [{ date: "2026-01-05", equity: 105_003 }],
        }),
      },
    ]);
    expect(data[0].s0).toBe(5);
  });

  it("dataKey 用安全键 s0/s1：展示标签只作图例，绝不进数据键", () => {
    const { data, series } = buildVersionCompareCurve([
      {
        label: "#7 · v1.2.3",
        result: rawRun({ equityCurve: [{ date: "2026-01-05", equity: 100_000 }] }),
      },
    ]);
    const rowKeys = Object.keys(data[0]);
    expect(rowKeys).toContain("s0");
    expect(rowKeys).not.toContain("#7 · v1.2.3");
    expect(series[0].label).toBe("#7 · v1.2.3");
  });

  it("初始资金缺失 / 非正 ⇒ 该留档不出曲线点（无曲线，不伪造 0）", () => {
    for (const initialCapital of [null, 0, -1] as const) {
      const { data, series } = buildVersionCompareCurve([
        {
          label: "#1",
          result: rawRun({
            initialCapital,
            equityCurve: [{ date: "2026-01-05", equity: 100_000 }],
          }),
        },
      ]);
      expect(data).toEqual([]);
      expect(series[0].pointCount).toBe(0);
    }
  });

  it("无完整结果（result 为 null / 非对象）无点、不抛，且仍占一个序列位", () => {
    const { data, series } = buildVersionCompareCurve([
      { label: "#1", result: null },
      { label: "#2", result: "not-a-run" },
      { label: "#3", result: undefined },
    ]);
    expect(data).toEqual([]);
    expect(series.map(item => item.pointCount)).toEqual([0, 0, 0]);
    expect(series.map(item => item.label)).toEqual(["#1", "#2", "#3"]);
  });

  it("非有限权益点被跳过，不污染曲线", () => {
    const { data, series } = buildVersionCompareCurve([
      {
        label: "#1",
        result: rawRun({
          equityCurve: [
            { date: "2026-01-05", equity: Number.POSITIVE_INFINITY },
            { date: "2026-01-06", equity: 100_000 },
          ],
        }),
      },
    ]);
    expect(series[0].pointCount).toBe(1);
    expect(data.map(row => row.date)).toEqual(["2026-01-06"]);
  });

  it("配色按 VERSION_COMPARE_COLORS 顺序分配，超出长度后循环", () => {
    const entries = Array.from({ length: VERSION_COMPARE_COLORS.length + 1 }, (_unused, index) => ({
      label: `#${index}`,
      result: null,
    }));
    const { series } = buildVersionCompareCurve(entries);
    expect(series.map(item => item.color)).toEqual([
      ...VERSION_COMPARE_COLORS,
      VERSION_COMPARE_COLORS[0],
    ]);
  });

  it("摘要直搬：totalReturnPct 来自 evaluation，缺失为 null；tradeCount 缺省 0", () => {
    const { series } = buildVersionCompareCurve([
      {
        label: "#1",
        result: rawRun({ totalReturnPct: 7.5 }),
      },
      {
        label: "#2",
        result: rawRun({ tradeCount: null }),
      },
    ]);
    expect(series[0].totalReturnPct).toBe(7.5);
    expect(series[1].totalReturnPct).toBeNull();
    // backtest 的 tradeCount 缺失 ⇒ 回落到 trades 数量（夹具为空数组 ⇒ 0）
    expect(series[1].tradeCount).toBe(0);
  });
});

describe("回测对比页 — 只读留档 / 组件 / 入口的结构不变量", () => {
  const PAGE = read("pages/BacktestCompare.tsx");
  const APP = read("App.tsx");
  const SHELL = read("components/AppShell.tsx");
  const PROCEDURES = Object.keys((appRouter as any)._def.procedures) as string[];

  it("1) 数据源是只读留档端点（真实挂在 appRouter 上）", () => {
    expect(PAGE).toMatch(/trpc\s*\.\s*researchRun\s*\.\s*listBacktests\s*\.\s*useQuery/);
    expect(PAGE).toMatch(/trpc\s*\.\s*researchRun\s*\.\s*getBacktests\s*\.\s*useQuery/);
    expect(PROCEDURES).toContain("researchRun.listBacktests");
    expect(PROCEDURES).toContain("researchRun.getBacktests");
  });

  it("2) 绝不重新运行回测：没有 mutation，也不碰 compareStrategyVersions", () => {
    expect(PAGE).not.toMatch(/useMutation/);
    expect(PAGE).not.toMatch(/compareStrategyVersions/);
    expect(PAGE).not.toMatch(/loopRun/);
  });

  it("3) 交易明细复用既有 BacktestTradeDetailsTable（不另写一张表）", () => {
    expect(PAGE).toContain("BacktestTradeDetailsTable");
    expect(PAGE).toMatch(
      /<BacktestTradeDetailsTable\s+backtest=\{row\.backtest!\}\s*\/>/
    );
  });

  it("4) 折线图用 Recharts，数据来自纯函数 buildVersionCompareCurve", () => {
    expect(PAGE).toContain("buildVersionCompareCurve");
    expect(PAGE).toMatch(/from\s*"recharts"/);
    expect(PAGE).toContain("LineChart");
    expect(PAGE).toContain("ResponsiveContainer");
  });

  it("5) 选中坐标走 URL（?strategyId=），可刷新 / 分享复原", () => {
    expect(PAGE).toMatch(/URLSearchParams\(search\)\.get\("strategyId"\)/);
    expect(PAGE).toMatch(/\/backtest-compare\?strategyId=/);
  });

  it("6) 留档数下限 2 / 上限 10 与后端批量入参契约一致", () => {
    expect(PAGE).toMatch(/MAX_COMPARE_RECORDS\s*=\s*10/);
    expect(PAGE).toMatch(/MIN_COMPARE_RECORDS\s*=\s*2/);
    expect(PAGE).toMatch(/orderedSelected\.length\s*>=\s*MIN_COMPARE_RECORDS/);
  });

  it("7) 页面复用运行工作台同一套 ViewModel 构建（零口径漂移）", () => {
    expect(PAGE).toContain("buildClosedLoopRunViewModel");
  });

  it("8) 路由与侧栏入口都真实存在", () => {
    expect(APP).toContain('path="/backtest-compare"');
    expect(SHELL).toContain('path: "/backtest-compare"');
  });
});
