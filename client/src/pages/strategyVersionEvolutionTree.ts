/**
 * 策略版本演化树纯逻辑。
 *
 * 抽取原因：本仓前端测试跑在 node 环境，不加载 jsdom / @testing-library。树的构建、
 * 排序、折叠与搜索规则放在这里，测试可以直接调用，不必把整页组件（trpc）拖进测试进程。
 *
 * 数据纪律：
 *   - 节点唯一来源是正式版本行；本模块不生成占位节点、不补造父子关系；
 *   - 父版本必须真实存在且不形成环，否则该节点按「独立根」展示；
 *   - 排序只按版本号，不依赖目录返回的「星标置顶」顺序。
 */

import { compareStrategyVersionDesc } from "./strategyVersionCompareList";

export interface EvolutionTreeRow {
  readonly version: string;
  /** 已解析的父版本号；父行缺失时为 null（调用方按无父处理）。 */
  readonly parentVersion: string | null;
}

export interface EvolutionTreeNode<Row extends EvolutionTreeRow> {
  readonly version: string;
  readonly row: Row;
  readonly parentVersion: string | null;
  readonly children: readonly EvolutionTreeNode<Row>[];
}

export interface EvolutionForest<Row extends EvolutionTreeRow> {
  readonly roots: readonly EvolutionTreeNode<Row>[];
  readonly nodesByVersion: ReadonlyMap<string, EvolutionTreeNode<Row>>;
  /** 先序（根降序、子降序）遍历的版本列表。 */
  readonly orderedVersions: readonly string[];
  /** 全体版本里版本号最大的节点；没有节点时为 null。 */
  readonly newestVersion: string | null;
}

export interface EvolutionTreeFilter {
  readonly visibleVersions: ReadonlySet<string>;
  readonly expandedVersions: ReadonlySet<string>;
  readonly matchCount: number;
}

interface MutableNode<Row extends EvolutionTreeRow> {
  readonly version: string;
  readonly row: Row;
  parentVersion: string | null;
  children: MutableNode<Row>[];
}

/** 版本号降序；非法版本号退回数字感知的字符串比较，避免 NaN 破坏排序。 */
function compareVersionsDesc(left: string, right: string): number {
  const delta = compareStrategyVersionDesc(left, right);
  return Number.isNaN(delta)
    ? right.localeCompare(left, "en", { numeric: true })
    : delta;
}

function sortByVersionDesc<T extends { readonly version: string }>(
  items: readonly T[]
): T[] {
  return [...items].sort((left, right) =>
    compareVersionsDesc(left.version, right.version)
  );
}

function newestVersionOf(versions: Iterable<string>): string | null {
  let newest: string | null = null;
  for (const version of versions) {
    if (newest === null || compareVersionsDesc(version, newest) < 0) {
      newest = version;
    }
  }
  return newest;
}

/**
 * 把目录行构建成演化森林。
 *
 * - 无父、父记录缺失、自引用、环形父链都按独立根处理，绝不伪造连接；
 * - 同一父下子节点与根节点按版本号降序；
 * - 重复版本号只保留第一条（正式版本身份是 version）。
 */
export function buildEvolutionForest<Row extends EvolutionTreeRow>(
  rows: readonly Row[]
): EvolutionForest<Row> {
  const nodesByVersion = new Map<string, MutableNode<Row>>();
  for (const row of rows) {
    if (row.version === "" || nodesByVersion.has(row.version)) continue;
    nodesByVersion.set(row.version, {
      version: row.version,
      row,
      parentVersion: null,
      children: [],
    });
  }

  // 解析父边：父版本必须真实存在，且不能自引用。
  for (const node of nodesByVersion.values()) {
    const rawParent = node.row.parentVersion;
    if (rawParent === null || rawParent === node.version) continue;
    if (!nodesByVersion.has(rawParent)) continue;
    node.parentVersion = rawParent;
  }

  // 环形父链防护：环里的每个节点都断开入边，作为独立根展示。
  // 不留在环里的节点仍可指向环内某个已提升为根的父版本。
  for (const start of sortByVersionDesc([...nodesByVersion.values()])) {
    const path: MutableNode<Row>[] = [];
    const indexByVersion = new Map<string, number>();
    let current: MutableNode<Row> | undefined = start;
    while (current !== undefined && !indexByVersion.has(current.version)) {
      indexByVersion.set(current.version, path.length);
      path.push(current);
      current =
        current.parentVersion === null
          ? undefined
          : nodesByVersion.get(current.parentVersion);
    }
    if (current === undefined || !indexByVersion.has(current.version)) {
      continue;
    }
    const cycleStart = indexByVersion.get(current.version)!;
    for (let index = cycleStart; index < path.length; index += 1) {
      path[index]!.parentVersion = null;
    }
  }

  const roots: MutableNode<Row>[] = [];
  for (const node of nodesByVersion.values()) {
    const parent =
      node.parentVersion === null
        ? undefined
        : nodesByVersion.get(node.parentVersion);
    if (parent === undefined) {
      node.parentVersion = null;
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  for (const node of nodesByVersion.values()) {
    node.children = sortByVersionDesc(node.children);
  }

  const orderedRoots = sortByVersionDesc(roots);
  const orderedVersions: string[] = [];
  const visit = (node: MutableNode<Row>): void => {
    orderedVersions.push(node.version);
    for (const child of node.children) visit(child);
  };
  for (const root of orderedRoots) visit(root);

  return {
    roots: orderedRoots,
    nodesByVersion,
    orderedVersions,
    newestVersion: newestVersionOf(nodesByVersion.keys()),
  };
}

/** 全部版本（先序），用于「展开全部」等批量场景。 */
export function collectAllVersions<Row extends EvolutionTreeRow>(
  forest: EvolutionForest<Row>
): string[] {
  return [...forest.orderedVersions];
}

/**
 * 默认展开集合：最新版本到根节点的整条祖先路径（含最新版本自身）。
 *
 * 展开祖先即可看到主干每一层；非主干的兄弟版本以「折叠节点」形式出现，
 * 不会被隐藏成「不存在」。
 */
export function computeDefaultExpandedVersions<Row extends EvolutionTreeRow>(
  forest: EvolutionForest<Row>
): Set<string> {
  const expanded = new Set<string>();
  if (forest.newestVersion === null) return expanded;
  let current = forest.nodesByVersion.get(forest.newestVersion);
  while (current !== undefined && !expanded.has(current.version)) {
    expanded.add(current.version);
    current =
      current.parentVersion === null
        ? undefined
        : forest.nodesByVersion.get(current.parentVersion);
  }
  return expanded;
}

function collectSubtree<Row extends EvolutionTreeRow>(
  node: EvolutionTreeNode<Row>,
  visible: Set<string>,
  expanded: Set<string>
): void {
  visible.add(node.version);
  if (node.children.length > 0) expanded.add(node.version);
  for (const child of node.children) collectSubtree(child, visible, expanded);
}

/**
 * 搜索过滤。
 *
 * 命中节点连同其祖先路径与完整子树保留：祖先用于定位，子树用于看清该版本的后续演化。
 * 关键词为空返回 null，调用方沿用普通折叠状态。
 */
export function filterEvolutionForest<Row extends EvolutionTreeRow>(
  forest: EvolutionForest<Row>,
  keyword: string,
  describe: (row: Row) => string
): EvolutionTreeFilter | null {
  const trimmed = keyword.trim().toLowerCase();
  if (trimmed === "") return null;

  const matched = new Set<string>();
  for (const [version, node] of forest.nodesByVersion) {
    if (describe(node.row).toLowerCase().includes(trimmed)) {
      matched.add(version);
    }
  }

  const visible = new Set<string>();
  const expanded = new Set<string>();
  for (const version of matched) {
    const node = forest.nodesByVersion.get(version);
    if (node !== undefined) collectSubtree(node, visible, expanded);
  }

  for (const version of matched) {
    let current = forest.nodesByVersion.get(version);
    while (current !== undefined && current.parentVersion !== null) {
      const parent = forest.nodesByVersion.get(current.parentVersion);
      if (parent === undefined || visible.has(parent.version)) break;
      visible.add(parent.version);
      expanded.add(parent.version);
      current = parent;
    }
  }

  return { visibleVersions: visible, expandedVersions: expanded, matchCount: matched.size };
}

/** 节点后代总数（不含自身），用于折叠态的「+N」提示。 */
export function countDescendants<Row extends EvolutionTreeRow>(
  node: EvolutionTreeNode<Row>
): number {
  let total = 0;
  for (const child of node.children) {
    total += 1 + countDescendants(child);
  }
  return total;
}
