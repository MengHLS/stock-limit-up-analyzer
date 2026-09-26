/**
 * 独立实验列表页的「模式 → 口径」两级分组（RESEARCH-EXPERIMENT-LIST-001，**展示层分类**）。
 *
 * ## 它解决什么
 *
 * 平台注册的实验已经到 **34 个**，平铺成一张表时「谁和谁是一族的」只存在于作者脑子里：
 * 读者看到的是 `composite-factor-4f-equ...` 与 `hold-open-price-pullback` 混在一起，
 * 分不清哪些是同一个研究范式下的并列实例、哪些是另一条线索。
 *
 * ## 分级口径（2026-09-26 按用户口径改定）
 *
 * ```
 * 一级 = 模式（= experimentId 的命名空间段）   first-board-pullback / combo-backtest
 *   └─ 二级 = 口径（自变量是不是「因子」）      单因子 / 多因子 / 其他口径
 *        └─ 三级 = 实验行（沿用原表格）+ 组内分页
 * ```
 *
 * - **一级用 `descriptor.id` 的**命名空间段**（`id.split("/")[0]`）**，不是文案：
 *   它与 `research-experiments/<namespace>/**` 目录、与 Run 记录里的 `experimentId` 前缀
 *   **逐字一致** ⇒ 页面上看到的分组名可以直接拿去 grep 代码与数据库。
 * - **二级回答「自变量是不是因子」**：单因子（一个特征单独测）/ 多因子（多个因子合成一个
 *   排序键，含 OOS 变体）/ 其他口径（自变量是入场时点、持有与守线、条件状态机、稳健性矩阵）。
 *   ⚠️ 「其他口径」不是垃圾桶而是**如实的三分类之一**：`hold-open-price-pullback` 这类实验
 *   本来就不是因子实验，硬塞进「单因子」才是错误归类。
 *
 * ## 🔴 四条纪律
 *
 * 1. **这是展示层分类，不是研究结论**。模式只回答「这些实验在回答同一类问题」，
 *    不含任何「哪一族更好 / 更该留下」的判断 —— 那类判断在
 *    `docs/research/FIRST-BOARD-PULLBACK-EXPERIMENT-CURATION.md`（策展分层 A/B/C/D）
 *    与各处 RESULT 文档里，是**另一件事**，不要混进本文件。
 * 2. **映射是显式清单，不是关键词推断**。与 `research-experiments/manifest.ts`、
 *    `client/src/researchExperiments/pages.ts` 同一范式（无目录扫描、无 `import.meta.glob`、
 *    无 codegen）：可 diff、可 review、行为确定。按 id 前缀做正则猜测会在下一个实验
 *    命名稍有不同时**静默分错组**，而分错组在页面上看不出来。
 * 3. **一级的 `key` 必须等于真实 id 前缀**（`modeKeyOf` 用它判定归属），测试会断言
 *    「每个声明 id 都以 `idPrefix + "/"` 开头」—— 写错前缀会当场红，而不是静默少一个实验。
 * 4. **漏登记必须可见**。没被任何模式认领的实验，按它自己的命名空间段单独成组并**在页面上
 *    带提示**（既有命名空间内漏登记一个 kind、或整个新命名空间没注册，都走这条路），
 *    而不是消失或悄悄并进某个模式 —— 「新增实验忘了归位」应当表现为一条可见的提示。
 *    结构上由 `tests/client/src/pages/researchExperimentModeGrouping.test.ts` 钉死。
 *
 * ## 新增实验时
 *
 * 在下面的 `EXPERIMENT_MODES` 里给它的 id 归位（加进某个模式的某个口径的 `experimentIds`）
 * —— 与「`manifest.ts` 加一行 + `pages.ts` 加一行」并列的第 3 个（但**不是必须**）改动点：
 * 不归位不会白屏，只会落到「未归类」。
 */

import type { ExperimentSummary } from "@shared/researchExperimentsContracts";

/** 一级兜底：整个命名空间都没登记的组的键前缀（与真实命名空间段拼在一起）。 */
export const UNCLASSIFIED_MODE_KEY = "unclassified";

/** 二级兜底：命名空间已登记、但该实验没被任何口径认领时的占位口径键。 */
export const UNCLASSIFIED_KIND_KEY = "unclassified-kind";

/** 一个「口径」（二级：自变量是不是因子）的声明。 */
export interface ExperimentKind {
  /** 稳定键（`data-*` 锚点 / 折叠与分页状态的键，禁止随文案改）。 */
  readonly key: string;
  /** 二级标题文案。 */
  readonly label: string;
  /** 一句话说明「这一档在问什么」（显示在二级标题下方）。 */
  readonly description: string;
}

/**
 * 口径清单（**顺序 = 页面上的显示顺序**）。
 *
 * 只有三档，且顺序固定为「单 → 多 → 其他」：读者从上往下读就是「一个因子的证据 →
 * 多个因子的证据 → 与因子无关的口径」。
 */
export const EXPERIMENT_KINDS: readonly ExperimentKind[] = [
  {
    key: "single-factor",
    label: "单因子",
    description:
      "一个特征单独测：换手率、实体高度、事件前上下文、事件后振幅、同日横截面分位…。回答「这个特征本身有没有区分度」，**不做合成**。",
  },
  {
    key: "multi-factor",
    label: "多因子",
    description:
      "把多个冻结因子合成分 / 排序键，再分档或取 Top-N（含 OOS 后置窗口验证：成员与权重逐字冻结，只换读取窗口）。自变量 = 「成员集合」与「权重方案」。",
  },
  {
    key: "other-scope",
    label: "其他口径",
    description:
      "自变量不是「因子」而是**时点与路径**：入场日 / 决策时点、持有与守线口径、条件状态机、阈值止盈止损、稳健性矩阵。它们不是单因子实验，归到「单因子」会是错误归类。",
  },
];

/** 某个模式下、某一档口径认领的实验 id 清单。 */
export interface ExperimentKindDeclaration {
  /** 指向 `EXPERIMENT_KINDS` 里的键。 */
  readonly kindKey: string;
  /** 属于本档的实验 id（= `descriptor.id`；**id 是身份，文案会变，不要按名字匹配**）。 */
  readonly experimentIds: readonly string[];
}

/** 一个「模式」（一级 = experimentId 的命名空间段）的声明。 */
export interface ExperimentMode {
  /** 稳定键 = **真实 id 前缀**（`first-board-pullback` / `combo-backtest`）。 */
  readonly key: string;
  /** 一级标题里的中文名（给人看）。 */
  readonly label: string;
  /** 原始 id 前缀（小字标注，保证与目录 / experimentId 可对照）。 */
  readonly idPrefix: string;
  /** 一句话说明「这一族在回答什么」（显示在一级标题下方）。 */
  readonly description: string;
  /** 二级口径声明（**顺序 = 页面上的显示顺序**）。 */
  readonly kinds: readonly ExperimentKindDeclaration[];
}

/**
 * 模式清单（**顺序 = 页面上的显示顺序**，不参与任何计算）。
 *
 * 一级的分族依据 = **代码里的命名空间**（`research-experiments/<namespace>/**`），
 * 而不是「质量档位」或「谁更有用」—— 命名空间是仓库里既有的事实，不需要再发明一套。
 */
export const EXPERIMENT_MODES: readonly ExperimentMode[] = [
  {
    key: "first-board-pullback",
    idPrefix: "first-board-pullback",
    label: "首板回撤研究",
    description:
      "以「首次涨停（首板）」事件为研究对象：事件前后上下文、入场与退出路径、持有与守线、因子与合成。目录 = research-experiments/first-board-pullback/**。",
    kinds: [
      {
        kindKey: "single-factor",
        experimentIds: [
          "first-board-pullback/single-factor-v1",
          "first-board-pullback/turnover-study",
          "first-board-pullback/first-board-body-study",
          "first-board-pullback/pre-event-context-study",
          "first-board-pullback/post-event-amplitude-study",
          "first-board-pullback/dynamic-state-factor-expansion-study",
        ],
      },
      {
        kindKey: "multi-factor",
        experimentIds: [
          "first-board-pullback/twelve-factor-composite-study",
          "first-board-pullback/twelve-factor-topn-ranking-study",
          "first-board-pullback/composite-factor-equal-weight-study",
          "first-board-pullback/composite-factor-four-strong-study",
          "first-board-pullback/composite-factor-2f-amplitude-study",
          "first-board-pullback/composite-factor-3f-amplitude-volume-study",
          "first-board-pullback/composite-factor-4f-weighted-study",
          // OOS 后置窗口验证三方案：成员与权重逐字复制自上面的合成实例，**只换读取窗口**
          "first-board-pullback/composite-factor-3f-amplitude-volume-oos-study",
          "first-board-pullback/composite-factor-4f-equal-weight-oos-study",
          "first-board-pullback/composite-factor-12f-equal-weight-oos-study",
        ],
      },
      {
        kindKey: "other-scope",
        experimentIds: [
          "first-board-pullback/entry-day",
          "first-board-pullback/fundamental-study",
          "first-board-pullback/decision-forward-study",
          "first-board-pullback/dynamic-entry-path-distribution-study",
          "first-board-pullback/conditional-pullback-state-exit-study",
          "first-board-pullback/hold-open-price-pullback",
          "first-board-pullback/threshold-race-policy-study",
          "first-board-pullback/volume-relationship-dynamic-entry-study",
          "first-board-pullback/volume-recovery-filtered-validation",
          "first-board-pullback/body-filtered-exit-curve-study",
          "first-board-pullback/body-ma-support-screen-study",
          "first-board-pullback/entry-aligned-exit-horizon-study",
          "first-board-pullback/hold-streak-amplitude-t10-study",
          "first-board-pullback/limit-up-close-hold-study",
          "first-board-pullback/limit-up-price-hold-streak-study",
          "first-board-pullback/stability-validation",
          "first-board-pullback/oversold-gap-reversal-validation",
        ],
      },
    ],
  },
  {
    key: "combo-backtest",
    idPrefix: "combo-backtest",
    label: "组合回测迁移",
    description:
      "从 /backtest 组合回测侧迁进来的实验。⚠️ 迁移不等于复刻 —— 与生产策略口径的对应关系与已知差异见该实验自己的 README。",
    kinds: [
      {
        kindKey: "other-scope",
        experimentIds: ["combo-backtest/leader-candidate-baseline"],
      },
    ],
  },
];

/** 一级兜底模式的文案（**只在真有未归类实验时渲染**）。 */
export const UNCLASSIFIED_MODE_DESCRIPTION =
  "这个命名空间下的实验没有登记到 experimentModes.ts 的任何模式 / 口径里。不归位不影响运行（实验照常能跑、能打开），但这里会一直把它们单列出来 —— 这是一条可见的提醒，不是错误。";

/** 二级兜底口径的文案（命名空间已登记、个别实验漏登记时出现）。 */
export const UNCLASSIFIED_KIND: ExperimentKind = {
  key: UNCLASSIFIED_KIND_KEY,
  label: "未归类",
  description:
    "该命名空间已登记，但这个实验没被写进任何口径。请在 experimentModes.ts 里给它归位（单因子 / 多因子 / 其他口径）。",
};

/**
 * 组内分页默认每页条数。
 *
 * 🔴 为什么是 5 而不是 10：现在最深的切片单位是「模式 × 口径」，最大的两档各 10 / 17 个
 *    ⇒ 默认 10 会让 10 的那档永远只有 1 页、分页形同不存在。5 才让「分级 + 分页」
 *    两件事同时成立（想要一览时把每页条数调到 20/50 即可）。
 */
export const EXPERIMENT_PAGE_SIZE_DEFAULT = 5;

/** 组内分页可选的每页条数。 */
export const EXPERIMENT_PAGE_SIZE_OPTIONS: readonly number[] = [5, 10, 20, 50];

/** 组装好的二级分组（一个模式内的一档口径）。 */
export interface ExperimentKindGroup {
  readonly kind: ExperimentKind;
  readonly items: readonly ExperimentSummary[];
  /** 本档实验数（= `items.length`，页面二级标题用）。 */
  readonly experimentCount: number;
  /** 本档 Run 事实**取得到**的实验的 Run 总数（取不到的**不计入**，不按 0 假装）。 */
  readonly runCount: number;
  /** 本档「Run 事实取不到」的实验数（>0 时二级标题如实标注）。 */
  readonly runsUnavailableCount: number;
  /** 是否为未归类档（页面加提示样式）。 */
  readonly unclassified: boolean;
}

/** 组装好的一级分组（一个模式）。 */
export interface ExperimentModeGroup {
  readonly mode: ExperimentMode;
  /** 本模式下的全部实验（含各档之和）。 */
  readonly items: readonly ExperimentSummary[];
  /** 本模式实验数（= `items.length`，页面一级标题用）。 */
  readonly experimentCount: number;
  /** 本模式 Run 事实**取得到**的实验的 Run 总数（取不到的**不计入**）。 */
  readonly runCount: number;
  /** 本模式「Run 事实取不到」的实验数（>0 时一级标题如实标注）。 */
  readonly runsUnavailableCount: number;
  /** 二级分组（**空档不渲染**；顺序 = `EXPERIMENT_MODES[].kinds` 声明顺序）。 */
  readonly kindGroups: readonly ExperimentKindGroup[];
  /** 整个命名空间未登记（一级兜底组）。 */
  readonly unclassified: boolean;
}

/** 取一个 experimentId 的命名空间段（`a/b/c` ⇒ `a`；无 `/` 则整串）。 */
export function modeKeyOf(experimentId: string): string {
  const index = experimentId.indexOf("/");
  return index < 0 ? experimentId : experimentId.slice(0, index);
}

/** 折叠 / 分页状态的键（一级 + 二级拼在一起，避免两级同名互相覆盖）。 */
export function modeKindStateKey(modeKey: string, kindKey: string): string {
  return `${modeKey}::${kindKey}`;
}

/**
 * 按「模式 → 口径」两级分组。
 *
 * - 一级顺序 = `EXPERIMENT_MODES` 声明顺序；**未归类命名空间恒压尾**（按前缀字典序）；
 * - 二级顺序 = 该模式 `kinds` 的声明顺序；**未归类档恒压尾**；
 * - 空模式 / 空档不渲染；
 * - 组内 / 档内**保持传入顺序**（上游 registry 已按 id 排序 ⇒ 顺序当然是稳定的）。
 *
 * 认领不存在的 id 不会报错（多写一个 id 只会被忽略），但**测试会失败**
 * ⇒ 写错的 id 在 CI 里当场暴露，而不是在页面上静默少一个实验。
 */
export function groupExperimentsByModeAndKind(
  rows: readonly ExperimentSummary[]
): ExperimentModeGroup[] {
  const registeredNamespaces = new Set(EXPERIMENT_MODES.map(mode => mode.key));
  const groups: ExperimentModeGroup[] = [];

  // 🔴 一级归属**只看命名空间段**，不看它有没有被口径认领：
  //    「命名空间已登记、但某个实验没写进任何口径」必须留在本模式里多出一个「未归类」档，
  //    而不是被甩到尾部 —— 后者会让读者以为整个命名空间都没登记。
  for (const mode of EXPERIMENT_MODES) {
    const items = rows.filter(row => modeKeyOf(row.descriptor.id) === mode.key);
    if (items.length === 0) continue;
    const kindGroups: ExperimentKindGroup[] = [];
    for (const declaration of mode.kinds) {
      const kind = kindOf(declaration.kindKey);
      const kindItems = items.filter(row => declaration.experimentIds.includes(row.descriptor.id));
      if (kindItems.length === 0) continue;
      kindGroups.push(buildKindGroup(kind, kindItems, false));
    }
    // 命名空间已登记、但个别实验没写进任何口径 ⇒ 带一条可见提醒（不静默吞掉）
    const declaredIds = new Set(mode.kinds.flatMap(declaration => declaration.experimentIds));
    const leftovers = items.filter(row => !declaredIds.has(row.descriptor.id));
    if (leftovers.length > 0) {
      kindGroups.push(buildKindGroup(UNCLASSIFIED_KIND, leftovers, true));
    }
    groups.push({
      mode,
      items,
      experimentCount: items.length,
      runCount: sumRuns(items),
      runsUnavailableCount: items.length - items.filter(row => row.runsAvailable).length,
      kindGroups,
      unclassified: false,
    });
  }

  // 未登记的命名空间：按真实前缀各自成组，恒压尾（按前缀字典序，保证渲染顺序稳定）
  const unclaimed = rows.filter(row => !registeredNamespaces.has(modeKeyOf(row.descriptor.id)));
  const byPrefix = new Map<string, ExperimentSummary[]>();
  for (const row of unclaimed) {
    const prefix = modeKeyOf(row.descriptor.id);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), row]);
  }
  for (const prefix of [...byPrefix.keys()].sort()) {
    const items = byPrefix.get(prefix) ?? [];
    if (items.length === 0) continue;
    groups.push({
      mode: {
        key: `${UNCLASSIFIED_MODE_KEY}:${prefix}`,
        idPrefix: prefix,
        label: `其他（未归类）：${prefix}`,
        description: UNCLASSIFIED_MODE_DESCRIPTION,
        kinds: [],
      },
      items,
      experimentCount: items.length,
      runCount: sumRuns(items),
      runsUnavailableCount: items.length - items.filter(row => row.runsAvailable).length,
      kindGroups: [buildKindGroup(UNCLASSIFIED_KIND, items, true)],
      unclassified: true,
    });
  }

  return groups;
}

/** 「声明了但当前不存在」的实验 id（供测试与排查使用）。 */
export function danglingModeExperimentIds(
  registeredIds: readonly string[]
): Array<{ modeKey: string; kindKey: string; experimentId: string }> {
  const registered = new Set(registeredIds);
  const dangling: Array<{ modeKey: string; kindKey: string; experimentId: string }> = [];
  for (const mode of EXPERIMENT_MODES) {
    for (const declaration of mode.kinds) {
      for (const id of declaration.experimentIds) {
        if (!registered.has(id)) {
          dangling.push({ modeKey: mode.key, kindKey: declaration.kindKey, experimentId: id });
        }
      }
    }
  }
  return dangling;
}

/** 「已注册但没被任何模式 / 口径认领」的实验 id（供测试与排查使用）。 */
export function unclaimedExperimentIds(registeredIds: readonly string[]): string[] {
  const claimed = new Set(
    EXPERIMENT_MODES.flatMap(mode =>
      mode.kinds.flatMap(declaration => declaration.experimentIds)
    )
  );
  return registeredIds.filter(id => !claimed.has(id));
}

function kindOf(kindKey: string): ExperimentKind {
  const found = EXPERIMENT_KINDS.find(kind => kind.key === kindKey);
  if (found) return found;
  // 声明了不存在的口径键 ⇒ 用「未归类」兜底，同时测试会把这个键当成错误钉住
  return { key: kindKey, label: kindKey, description: UNCLASSIFIED_KIND.description };
}

function sumRuns(items: readonly ExperimentSummary[]): number {
  return items
    .filter(item => item.runsAvailable)
    .reduce((sum, item) => sum + item.runCount, 0);
}

function buildKindGroup(
  kind: ExperimentKind,
  items: readonly ExperimentSummary[],
  unclassified: boolean
): ExperimentKindGroup {
  return {
    kind,
    items,
    experimentCount: items.length,
    runCount: sumRuns(items),
    runsUnavailableCount: items.length - items.filter(item => item.runsAvailable).length,
    unclassified,
  };
}

/** 一页窗口（页码夹取后的结果）。 */
export interface PageWindow<T> {
  /** 总页数（至少 1 —— 空集合也算 1 页，避免页面上出现「第 1 / 0 页」）。 */
  readonly totalPages: number;
  /** 夹取后的当前页（非法输入退回可用的那一页）。 */
  readonly safePage: number;
  /** 本页首条在该集合中的下标（从 0 起；空集合为 0）。 */
  readonly startIndex: number;
  /** 本页要渲染的条目。 */
  readonly items: readonly T[];
}

/**
 * 取分页窗口（**纯函数**，页面上唯一的切片点）。
 *
 * 为什么要单独抽出来：页码夹取、页码越界、「每页条数变小/数据变少导致当前页不存在」
 * 这三件事只有一处实现才好断言。`9bf` 在 `/backtest` 的分页是同一口径
 * （前端切片、只改渲染层，不动任何统计口径）。
 */
export function resolvePageWindow<T>(
  all: readonly T[],
  page: number,
  pageSize: number
): PageWindow<T> {
  const size =
    Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 1;
  const totalPages = Math.max(1, Math.ceil(all.length / size));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const safePage = Math.min(Math.max(1, requested), totalPages);
  const startIndex = (safePage - 1) * size;
  return {
    totalPages,
    safePage,
    startIndex,
    items: all.slice(startIndex, startIndex + size),
  };
}
