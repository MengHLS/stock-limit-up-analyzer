import { describe, expect, it } from "vitest";

import {
  buildEvolutionForest,
  collectAllVersions,
  computeDefaultExpandedVersions,
  countDescendants,
  filterEvolutionForest,
} from "@/pages/strategyVersionEvolutionTree";

interface TreeRow {
  readonly version: string;
  readonly parentVersion: string | null;
  readonly label: string;
}

function row(
  version: string,
  parentVersion: string | null = null,
  label = version
): TreeRow {
  return { version, parentVersion, label };
}

describe("策略版本演化树纯逻辑", () => {
  it("按真实父版本构建森林，根与兄弟节点按版本号降序", () => {
    const forest = buildEvolutionForest([
      row("1.0.0"),
      row("1.1.0", "1.0.0"),
      row("1.10.0", "1.0.0"),
      row("1.2.0", "1.1.0"),
      row("2.0.0"),
    ]);

    expect(forest.roots.map(node => node.version)).toEqual(["2.0.0", "1.0.0"]);
    expect(
      forest.nodesByVersion.get("1.0.0")?.children.map(node => node.version)
    ).toEqual(["1.10.0", "1.1.0"]);
    expect(forest.orderedVersions).toEqual([
      "2.0.0",
      "1.0.0",
      "1.10.0",
      "1.1.0",
      "1.2.0",
    ]);
    expect(countDescendants(forest.nodesByVersion.get("1.0.0")!)).toBe(3);
  });

  it("父行缺失与自引用都作为独立根，不伪造父子连接", () => {
    const forest = buildEvolutionForest([
      row("1.0.0", "9.9.9"),
      row("2.0.0", "2.0.0"),
      row("3.0.0", null),
    ]);

    expect(forest.roots.map(node => node.version)).toEqual([
      "3.0.0",
      "2.0.0",
      "1.0.0",
    ]);
    expect(forest.nodesByVersion.get("1.0.0")?.parentVersion).toBeNull();
    expect(forest.nodesByVersion.get("2.0.0")?.parentVersion).toBeNull();
  });

  it("环形父链中的节点全部断开入边并作为独立根", () => {
    const forest = buildEvolutionForest([
      row("1.0.0", "2.0.0"),
      row("2.0.0", "3.0.0"),
      row("3.0.0", "1.0.0"),
      row("4.0.0", "1.0.0"),
    ]);

    expect(forest.roots.map(node => node.version)).toEqual([
      "3.0.0",
      "2.0.0",
      "1.0.0",
    ]);
    for (const version of ["1.0.0", "2.0.0", "3.0.0"]) {
      expect(forest.nodesByVersion.get(version)?.parentVersion).toBeNull();
    }
    expect(
      forest.nodesByVersion.get("1.0.0")?.children.map(node => node.version)
    ).toEqual(["4.0.0"]);
  });

  it("默认只展开最新版本到根节点的祖先路径", () => {
    const forest = buildEvolutionForest([
      row("1.0.0"),
      row("1.1.0", "1.0.0"),
      row("1.2.0", "1.1.0"),
      row("2.0.0"),
    ]);

    expect(forest.newestVersion).toBe("2.0.0");
    expect([...computeDefaultExpandedVersions(forest)].sort()).toEqual([
      "2.0.0",
    ]);

    const deeper = buildEvolutionForest([
      row("1.0.0"),
      row("1.1.0", "1.0.0"),
      row("1.2.0", "1.1.0"),
    ]);
    expect([...computeDefaultExpandedVersions(deeper)].sort()).toEqual([
      "1.0.0",
      "1.1.0",
      "1.2.0",
    ]);
  });

  it("搜索保留命中节点、祖先路径与后续子树，并自动展开", () => {
    const forest = buildEvolutionForest([
      row("1.0.0", null, "基线"),
      row("1.1.0", "1.0.0", "首板回踩"),
      row("1.2.0", "1.1.0", "三因子 Top3"),
      row("2.0.0", null, "另一族"),
    ]);

    const filter = filterEvolutionForest(
      forest,
      "top3",
      node => node.label
    );

    expect(filter).not.toBeNull();
    expect(filter?.matchCount).toBe(1);
    expect([...filter!.visibleVersions].sort()).toEqual([
      "1.0.0",
      "1.1.0",
      "1.2.0",
    ]);
    expect([...filter!.expandedVersions].sort()).toEqual([
      "1.0.0",
      "1.1.0",
    ]);
    expect(collectAllVersions(forest)).toEqual([
      "2.0.0",
      "1.0.0",
      "1.1.0",
      "1.2.0",
    ]);
  });
});
