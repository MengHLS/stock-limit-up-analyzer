/**
 * 独立实验列表页「模式 → 口径」两级分组的结构契约测试（RESEARCH-EXPERIMENT-LIST-001）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 它挡住的五个真实失败形态
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. 🔴 **新增实验忘了归位** ⇒ 页面多出一个「其他（未归类）」组。这在页面上是**可见**的，
 *    但更早暴露更好：这里用**真实的** `EXPERIMENT_DEFINITIONS` 断言「每个已注册实验
 *    恰好落一个模式的一个口径」。所以「加了实验、忘了改 `experimentModes.ts`」会当场红。
 * 2. 🔴 **映射里写了不存在的 id**（改名 / 删除实验后的残留）⇒ 分组函数只会忽略它，
 *    页面上**完全看不出来**（静默少一个实验）。这里断言 dangling = 0。
 * 3. 🔴 **一级 key 写错**（例如把 `first-board-pullback` 敲成 `first-board-pullback/` 或
 *    `firstBoardPullback`）⇒ 一级分组会整个落进「未归类」，而页面上仍能渲染、不报错。
 *    这里断言「每个声明 id 都以 `idPrefix + "/"` 开头」且「一级 key 集合 = 真实命名空间集合」。
 * 4. 🔴 **二级口径键写错 / 重复** ⇒ 档位要么消失、要么两档抢同一个实验。断言：
 *    口径键唯一、都在 `EXPERIMENT_KINDS` 里、每个实验只被一个档认领。
 * 5. 🔴 **「分级 + 组内分页」被改回整页平铺**（把分组当成一次性 UI 调整、后续又 flatten 回去）
 *    ⇒ 源码级断言：列表页必须经 `groupExperimentsByModeAndKind` 拿组、必须有 `PaginationBar`、
 *    必须有**两级**锚点；既有探针依赖的行级锚点（`data-experiment-row` /
 *    `data-open-experiment`）必须仍在。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExperimentSummary } from "@shared/researchExperimentsContracts";
import {
  EXPERIMENT_KINDS,
  EXPERIMENT_MODES,
  EXPERIMENT_PAGE_SIZE_DEFAULT,
  EXPERIMENT_PAGE_SIZE_OPTIONS,
  UNCLASSIFIED_KIND_KEY,
  UNCLASSIFIED_MODE_KEY,
  danglingModeExperimentIds,
  groupExperimentsByModeAndKind,
  modeKeyOf,
  modeKindStateKey,
  resolvePageWindow,
  unclaimedExperimentIds,
} from "@/pages/researchExperiments/experimentModes";
import { EXPERIMENT_DEFINITIONS } from "../../../../research-experiments/manifest";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const LIST_PAGE = readFileSync(
  path.join(ROOT, "client", "src", "pages", "researchExperiments", "ExperimentList.tsx"),
  "utf8"
);

const REGISTERED_IDS = EXPERIMENT_DEFINITIONS.map(definition => definition.descriptor.id);

/** 当前一审定的分档规模（改了映射就要同步改这里 —— 这是**故意**的一次显式确认）。 */
const EXPECTED_MODE_COUNTS: Record<string, { total: number; kinds: Record<string, number> }> = {
  "first-board-pullback": {
    total: 33,
    kinds: { "single-factor": 6, "multi-factor": 10, "other-scope": 17 },
  },
  "combo-backtest": { total: 1, kinds: { "other-scope": 1 } },
};

/**
 * 造一条列表行（只填分组与统计用得到的字段）。
 *
 * `ExperimentSummary` 的描述符有十几个字段，逐一填会把测试写成 schema 抄写；
 * 分组逻辑只读 `descriptor.id` 与 `runCount` / `runsAvailable`，因此这里断言的是
 * 「分组函数的契约」，不是 schema 的形状（schema 由 `contract.test.ts` 管）。
 */
function row(id: string, runCount = 0, runsAvailable = true): ExperimentSummary {
  return {
    descriptor: { id, name: id, version: "1.0.0", description: "", source: "", parameters: [] },
    runCount,
    latestRun: null,
    runsAvailable,
    runsError: null,
  } as unknown as ExperimentSummary;
}

/** 展平出「(modeKey, kindKey, experimentId)」三元组，供覆盖面断言复用。 */
function placements(): Array<{ modeKey: string; kindKey: string; experimentId: string }> {
  return EXPERIMENT_MODES.flatMap(mode =>
    mode.kinds.flatMap(declaration =>
      declaration.experimentIds.map(experimentId => ({
        modeKey: mode.key,
        kindKey: declaration.kindKey,
        experimentId,
      }))
    )
  );
}

describe("独立实验列表：两级分组（展示层分类）", () => {
  it("1) 每个已注册实验**恰好**落一个模式的一个口径：无未归类、无冒名 id、无重复认领", () => {
    expect(REGISTERED_IDS.length).toBeGreaterThan(0);

    expect(unclaimedExperimentIds(REGISTERED_IDS)).toEqual([]);
    expect(danglingModeExperimentIds(REGISTERED_IDS)).toEqual([]);

    const owners = new Map<string, string[]>();
    for (const placement of placements()) {
      const owner = `${placement.modeKey}::${placement.kindKey}`;
      owners.set(placement.experimentId, [
        ...(owners.get(placement.experimentId) ?? []),
        owner,
      ]);
    }
    expect([...owners.entries()].filter(([, list]) => list.length > 1)).toEqual([]);
  });

  it("2) 一级 key = 真实 id 命名空间段，且每个声明 id 都以 `idPrefix + /` 开头", () => {
    const keys = EXPERIMENT_MODES.map(mode => mode.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const mode of EXPERIMENT_MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.description.length).toBeGreaterThan(0);
      expect(mode.kinds.length).toBeGreaterThan(0);
      expect(mode.idPrefix).toBe(mode.key);
      // 兜底键不得被当成正式模式占用（否则「未归类」会被吸进某个模式里）
      expect(mode.key).not.toContain(UNCLASSIFIED_MODE_KEY);
      for (const declaration of mode.kinds) {
        expect(declaration.experimentIds.length).toBeGreaterThan(0);
        for (const id of declaration.experimentIds) {
          // 一级归属靠 id 前缀判定 ⇒ 前缀写错会让整个模式静默落进「未归类」
          expect(id.startsWith(`${mode.idPrefix}/`)).toBe(true);
        }
      }
    }

    // 真实命名空间集合 = 一级 key 集合（不多不少）—— 增删命名空间会当场红
    const realNamespaces = [...new Set(REGISTERED_IDS.map(modeKeyOf))].sort();
    expect([...keys].sort()).toEqual(realNamespaces);
  });

  it("3) 二级口径键唯一、都在 EXPERIMENT_KINDS 里，且分档规模与审定的台账一致", () => {
    const kindKeys = EXPERIMENT_KINDS.map(kind => kind.key);
    expect(new Set(kindKeys).size).toBe(kindKeys.length);
    for (const kind of EXPERIMENT_KINDS) {
      expect(kind.key).not.toBe(UNCLASSIFIED_KIND_KEY);
      expect(kind.label.length).toBeGreaterThan(0);
      expect(kind.description.length).toBeGreaterThan(0);
    }

    const groups = groupExperimentsByModeAndKind(REGISTERED_IDS.map(id => row(id)));
    expect(groups.map(group => group.mode.key)).toEqual(Object.keys(EXPECTED_MODE_COUNTS));
    for (const group of groups) {
      const expected = EXPECTED_MODE_COUNTS[group.mode.key];
      expect(group.experimentCount).toBe(expected.total);
      expect(
        Object.fromEntries(
          group.kindGroups.map(kindGroup => [kindGroup.kind.key, kindGroup.experimentCount])
        )
      ).toEqual(expected.kinds);
      // 各档之和必须等于一级计数（不许出现「档里没算进去」的实验）
      const sum = group.kindGroups.reduce((acc, g) => acc + g.experimentCount, 0);
      expect(sum).toBe(group.experimentCount);
      for (const kindGroup of group.kindGroups) {
        expect(kindKeys).toContain(kindGroup.kind.key);
      }
    }
  });

  it("4) 分组顺序 = 声明顺序；档内保持传入顺序；一/二级都不出现空组空档", () => {
    const ids = REGISTERED_IDS;
    const rows = ids.map((id, index) => row(id, index, true));
    const groups = groupExperimentsByModeAndKind(rows);

    expect(groups.map(group => group.mode.key)).toEqual(EXPERIMENT_MODES.map(mode => mode.key));
    expect(groups.some(group => group.unclassified)).toBe(false);
    expect(groups.flatMap(group => group.kindGroups).every(g => g.experimentCount > 0)).toBe(true);

    const covered = groups.flatMap(group => group.items.map(item => item.descriptor.id));
    expect(covered.length).toBe(ids.length);
    expect(new Set(covered).size).toBe(ids.length);

    // 档内顺序 = 传入顺序
    const mode = EXPERIMENT_MODES[0];
    const source = ids.filter(id => mode.kinds[1].experimentIds.includes(id));
    expect(groups[0].kindGroups[1].items.map(item => item.descriptor.id)).toEqual(source);
  });

  it("5) 未登记的**命名空间**整族落「未归类」并压尾（漏归位可见，而不是消失）", () => {
    const groups = groupExperimentsByModeAndKind([
      row("first-board-pullback/single-factor-v1"),
      row("some-group/not-classified-yet", 3),
    ]);

    expect(groups.map(group => group.mode.key)).toEqual([
      "first-board-pullback",
      `${UNCLASSIFIED_MODE_KEY}:some-group`,
    ]);
    const tail = groups[groups.length - 1];
    expect(tail.unclassified).toBe(true);
    expect(tail.mode.idPrefix).toBe("some-group");
    expect(tail.items.map(item => item.descriptor.id)).toEqual([
      "some-group/not-classified-yet",
    ]);
    expect(tail.kindGroups.map(g => g.kind.key)).toEqual([UNCLASSIFIED_KIND_KEY]);
    expect(tail.kindGroups[0].unclassified).toBe(true);
  });

  it("6) 已登记命名空间内**漏登记一个实验** ⇒ 多出一个「未归类」档，而不是静默吞掉", () => {
    const groups = groupExperimentsByModeAndKind([
      row("first-board-pullback/single-factor-v1"),
      row("first-board-pullback/a-brand-new-study"),
    ]);

    const group = groups[0];
    expect(group.mode.key).toBe("first-board-pullback");
    expect(group.kindGroups.map(g => g.kind.key)).toEqual(["single-factor", UNCLASSIFIED_KIND_KEY]);
    const stray = group.kindGroups[group.kindGroups.length - 1];
    expect(stray.unclassified).toBe(true);
    expect(stray.items.map(item => item.descriptor.id)).toEqual([
      "first-board-pullback/a-brand-new-study",
    ]);
  });

  it("7) 统计如实：Run 事实取不到的实验不计入 runCount，并在一级与二级各自计数", () => {
    const groups = groupExperimentsByModeAndKind([
      row("first-board-pullback/turnover-study", 2, true),
      row("first-board-pullback/single-factor-v1", 0, false),
      row("first-board-pullback/composite-factor-4f-weighted-study", 5, true),
    ]);
    const group = groups[0];
    expect(group.experimentCount).toBe(3);
    expect(group.runCount).toBe(7);
    expect(group.runsUnavailableCount).toBe(1);

    const [single, multi] = group.kindGroups;
    expect(single.kind.key).toBe("single-factor");
    expect(single.experimentCount).toBe(2);
    expect(single.runCount).toBe(2); // 取不到的那个**不计入**，不按 0 假装
    expect(single.runsUnavailableCount).toBe(1);
    expect(multi.runCount).toBe(5);
    expect(multi.runsUnavailableCount).toBe(0);
  });

  it("8) 空输入 ⇒ 零组（不伪造空模式）", () => {
    expect(groupExperimentsByModeAndKind([])).toEqual([]);
  });

  it("8b) 分页窗口：切片正确、页码越界夹取、非法输入退回可用页、空集合算 1 页", () => {
    const all = Array.from({ length: 10 }, (_unused, index) => index);

    const second = resolvePageWindow(all, 2, 3);
    expect(second.totalPages).toBe(4);
    expect(second.safePage).toBe(2);
    expect(second.startIndex).toBe(3);
    expect(second.items).toEqual([3, 4, 5]);

    // 页码越界：往上/往下都夹到可用的那一页（否则页面会出现空表或「第 99 / 4 页」）
    expect(resolvePageWindow(all, 99, 3).safePage).toBe(4);
    expect(resolvePageWindow(all, 99, 3).items).toEqual([9]);
    expect(resolvePageWindow(all, 0, 3).safePage).toBe(1);
    expect(resolvePageWindow(all, -5, 3).items).toEqual([0, 1, 2]);

    // 非法输入（NaN / 0 / 小数）不得渲染出「第 NaN 页」或空切片
    expect(resolvePageWindow(all, Number.NaN, 3).safePage).toBe(1);
    expect(resolvePageWindow(all, 1, 0).items).toEqual([0]);
    expect(resolvePageWindow(all, 1, 2.7).items).toEqual([0, 1]);

    // 空集合：1 页、空切片（`totalPages` 为 0 会让分页条显示「第 1 / 0 页」）
    const empty = resolvePageWindow([], 1, 5);
    expect(empty.totalPages).toBe(1);
    expect(empty.items).toEqual([]);
    expect(empty.startIndex).toBe(0);
  });

  it("9) 分页常量：默认页大小在可选项内，且小于「最大档的实验数」", () => {
    expect(EXPERIMENT_PAGE_SIZE_OPTIONS).toContain(EXPERIMENT_PAGE_SIZE_DEFAULT);
    const largestKind = Math.max(
      ...EXPERIMENT_MODES.flatMap(mode => mode.kinds.map(d => d.experimentIds.length))
    );
    // 默认页大小一旦 ≥ 最大档规模，最深的那个分页控件就永远只有 1 页
    expect(EXPERIMENT_PAGE_SIZE_DEFAULT).toBeLessThan(largestKind);
  });

  it("10) 折叠 / 分页状态键：一级与二级组合，且同名口径不互相覆盖", () => {
    expect(modeKindStateKey("first-board-pullback", "single-factor")).not.toBe(
      modeKindStateKey("combo-backtest", "single-factor")
    );
    // 状态键必须与页面用的锚点值一致（页面把同一个键写进 `data-experiment-kind-pager`）
    expect(LIST_PAGE).toContain("modeKindStateKey(modeKey, kindGroup.kind.key)");
    expect(modeKeyOf("first-board-pullback/entry-day")).toBe("first-board-pullback");
    expect(modeKeyOf("no-slash")).toBe("no-slash");
  });
});

describe("独立实验列表：页面接线（源码级）", () => {
  it("11) 列表页经两级分组函数取组、逐模式渲染，且不再对全量 rows 平铺", () => {
    expect(LIST_PAGE).toMatch(/groupExperimentsByModeAndKind\(/);
    expect(LIST_PAGE).toMatch(/EXPERIMENT_PAGE_SIZE_OPTIONS/);
    expect(LIST_PAGE).toMatch(/groups\.map\(/);
    // 一级锚点
    expect(LIST_PAGE).toMatch(/data-experiment-mode=/);
    expect(LIST_PAGE).toMatch(/data-experiment-mode-toggle=/);
    // 二级锚点（档容器 / 折叠开关 / 档内分页）
    expect(LIST_PAGE).toMatch(/data-experiment-kind=/);
    expect(LIST_PAGE).toMatch(/data-experiment-kind-toggle=/);
    expect(LIST_PAGE).toMatch(/data-experiment-kind-pager=/);
    // 反证：整页平铺的写法（对 rows 直接 map 出表格行）必须不存在
    expect(LIST_PAGE).not.toMatch(/rows\.map\(/);
  });

  it("12) 档内分页经既有 PaginationBar，且沿用既有行级锚点（既有探针依赖）", () => {
    expect(LIST_PAGE).toMatch(/<PaginationBar/);
    expect(LIST_PAGE).toMatch(/data-experiment-row=\{descriptor\.id\}/);
    expect(LIST_PAGE).toMatch(/data-open-experiment=\{descriptor\.id\}/);
    expect(LIST_PAGE).toMatch(/data-experiment-runs-unavailable=/);
  });

  it("13) 诚实口径仍在：`runsAvailable=false` 不显示「0 条 Run」，也不显示「未运行」", () => {
    // LatestRunCell / StatusCell 里的两处 runsAvailable 分支必须保留
    expect(LIST_PAGE).toMatch(/if \(!summary\.runsAvailable\) \{/);
    expect(LIST_PAGE).toMatch(/text="取不到"/);
  });

  it("14) 一级标题同时给出中文名与原始 id（可拿 idPrefix 直接 grep 代码 / Run 记录）", () => {
    expect(LIST_PAGE).toMatch(/group\.mode\.label/);
    expect(LIST_PAGE).toMatch(/group\.mode\.idPrefix/);
  });
});
