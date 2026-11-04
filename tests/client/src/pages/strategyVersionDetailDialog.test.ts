/**
 * 策略版本演化页：版本设置弹窗的结构契约测试。
 *
 * 本仓前端测试运行在 node 环境，不加载 jsdom；这里扫真实源码并核对真实 appRouter，
 * 证明不是只加了一个孤立的弹窗文件。
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

const PAGE = read("pages/StrategyVersionCompare.tsx");
const DIALOG = read("components/strategy/StrategyVersionDetailDialog.tsx");
const DETAIL_PAGE = read("pages/StrategyDetail.tsx");
const DETAIL_HEADER = read("components/strategy/StrategyHeader.tsx");
const POOL_SUMMARY = read("components/strategy/FirstLimitPoolSummary.tsx");
const PROCEDURES = Object.keys(appRouter._def.procedures);

describe("策略版本演化页：设置详情弹窗", () => {
  it("详情读取使用真实存在的只读 loadBundle 端点", () => {
    expect(DIALOG).toMatch(
      /trpc\s*\.\s*strategyDomain\s*\.\s*strategy\s*\.\s*loadBundle\s*\.\s*useQuery/
    );
    expect(PROCEDURES).toContain("strategyDomain.strategy.loadBundle");
  });

  it("详情读取卡片对应的回测留档并展示实际运行口径", () => {
    expect(DIALOG).toMatch(
      /trpc\s*\.\s*researchRun\s*\.\s*getBacktest\s*\.\s*useQuery/
    );
    expect(DIALOG).toContain("target?.archiveId");
    for (const section of [
      "回测留档实际口径",
      "运行装配与数据口径",
      "可复现运行快照",
      "参数快照",
      "策略决策摘要",
      "策略执行政策",
      "回测执行政策",
    ]) {
      expect(DIALOG).toContain(section);
    }
  });

  it("详情展示模式研究结论与分钟字段作用，不再展示模式族目录", () => {
    for (const section of [
      "模式定位与研究结论",
      "关键差异",
      "留档观察",
      "实验配置与作用阶段",
      "前端可调",
      "文档固定",
      "装配固定",
      "研究边界与留档注意",
      "分钟字段作用",
      "当前口径限制",
    ]) {
      expect(DIALOG).toContain(section);
    }
    expect(DIALOG).not.toContain("模式族目录与分钟阶段");
    expect(DIALOG).not.toContain("族级独有维度");
    expect(DIALOG).not.toContain("分钟作用阶段");
    expect(DIALOG).toContain("target?.study");
    expect(PAGE).toContain("study: row.study");
  });

  it("版本默认设置可展示 JSON 数组参数而不显示空白", () => {
    expect(DIALOG).toContain('case "json"');
    expect(DIALOG).toContain("JSON.stringify(p.defaultValue)");
  });

  it("详情正文在弹窗内独立纵向滚动", () => {
    expect(DIALOG).toContain("max-h-[92dvh]");
    expect(DIALOG).toContain("flex-1");
    expect(DIALOG).toContain("overflow-y-auto");
    expect(DIALOG).toContain("overscroll-contain");
  });

  it("每张正式版本卡片都有设置入口", () => {
    expect(PAGE).toContain('aria-label="查看版本设置"');
    expect(PAGE).not.toContain("disabled={!row.isPersisted}");
    expect(PAGE).toContain("onOpenDetail(node.row.row)");
  });

  it("设置按钮不会触发节点选中", () => {
    const settingsClick =
      PAGE.match(
        /aria-label="查看版本设置"[\s\S]*?onClick=\{event => \{([\s\S]*?)onOpenDetail\(node\.row\.row\)/
      )?.[1] ?? "";
    expect(settingsClick).toContain("event.preventDefault()");
    expect(settingsClick).toContain("event.stopPropagation()");
  });

  it("页面只保留演化树数据源，不再引用对比运行、曲线、运行配置或分页明细", () => {
    expect(PAGE).toContain("listVersionCatalog");
    expect(PAGE).not.toContain("compareStrategyVersions");
    expect(PAGE).not.toContain("RunConfigPanel");
    expect(PAGE).not.toContain("recharts");
    expect(PAGE).not.toContain("BacktestTradeDetailsTable");
    expect(PAGE).not.toContain("PaginationBar");
    expect(PAGE).not.toContain("净值曲线");
    expect(PAGE).not.toContain("成交明细");
    expect(PAGE).not.toContain("批量选择");
  });

  it("单击选中节点，双击打开完整版本设置弹窗", () => {
    expect(PAGE).toContain("aria-pressed={selected}");
    expect(PAGE).toContain("onClick={() => onSelect(node.version)}");
    expect(PAGE).toContain("onDoubleClick={() => onOpenDetail(node.row.row)}");
    expect(PAGE).toContain("StrategyVersionDetailDialog");
  });

  it("节点保留星标切换，并读取研究注解渲染族 / arm 与最多三条变化", () => {
    expect(PAGE).toMatch(
      /trpc\s*\.\s*strategyDomain\s*\.\s*strategy\s*\.\s*setVersionStarred\s*\.\s*useMutation/
    );
    expect(PAGE).toContain("onToggleStar(node.row.row)");
    expect(PAGE).toContain("study.familyDirectory");
    expect(PAGE).toContain("item.strategyVersion === version");
    expect(PAGE).toContain("familyLabel");
    expect(PAGE).toContain("armId");
    expect(PAGE).toContain("study.signals");
    expect(PAGE).toContain(".slice(0, 3)");
    expect(PAGE).toContain("node.row.changes.map");
  });

  it("弹窗覆盖策略设置的主要信息区块", () => {
    for (const section of [
      "基础信息",
      "执行与资金",
      "仓位与参数",
      "交易规则",
      "股票池",
    ]) {
      expect(DIALOG).toContain(section);
    }
  });

  it("池化版本展示池化执行语义（入池 / 两段评分 / 失效 / 预算 / 评分不影响退出）", () => {
    for (const section of [
      "池化执行语义",
      "池化稳定错误码",
      "评分不影响退出",
    ]) {
      expect(POOL_SUMMARY).toContain(section);
    }
    expect(DIALOG).toContain("池化早期评分不读取分钟字段");
    expect(DIALOG).toContain("study.firstLimitPool");
    expect(POOL_SUMMARY).toContain("pool.earlyScoreStage");
    expect(POOL_SUMMARY).toContain("pool.fullScoreStage");
    expect(POOL_SUMMARY).toMatch(/scoreAffectsExit/);
  });

  it("池化策略详情页头部直接展示执行语义，不只藏在对比页弹窗", () => {
    expect(DETAIL_PAGE).toContain("FirstLimitPoolSummary");
    expect(DETAIL_PAGE).toContain("当前版本使用首板股票池 · 滚动 3F");
    expect(DETAIL_PAGE).toContain("loadedPoolSemantics");
  });

  it("详情页头部展示模式族类型徽标，且池化语义未就绪时仍有可见占位", () => {
    // 头部类型徽标：让「首板股票池每日评分」与「三因子 Top-N」在同一位置可区分。
    expect(DETAIL_HEADER).toContain("strategyTypeLabel");
    expect(DETAIL_HEADER).toContain("strategyTypeBadgeClass");
    expect(DETAIL_HEADER).toContain("vm.extra.strategyType");
    // 池化语义详情未就绪时，不能整块消失（否则看起来像「前端没改」）。
    expect(DETAIL_PAGE).toContain("loadedStrategyType");
    expect(DETAIL_PAGE).toContain("正在读取池化语义");
  });
});
