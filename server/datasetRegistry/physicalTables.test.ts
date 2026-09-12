/**
 * STEP DATASET-003A — 物理表存储单测（表名白名单 + 内存编排语义）。
 *
 * 重点覆盖**安全**：assertSafeTableName 必须拒绝一切非派生表名（含 SQL 注入尝试），
 * 因为删表 / 删数据是不可逆操作，表名只允许来自 datasetCode 派生或 definition 落库值。
 */

import { describe, expect, it } from "vitest";
import {
  InMemoryDatasetPhysicalStore,
  assertSafeTableName,
  resolveDefinitionTables,
} from "./physicalTables";
import { resolvePluginTables } from "./plugins";
import { makeTestPlugin } from "./testHelpers";
import type { DatasetDefinition } from "./types";

function makeDefinition(code: string): DatasetDefinition {
  return {
    id: 1,
    datasetCode: code,
    name: code,
    description: null,
    datasetType: "EVENT",
    storageType: "DATABASE",
    status: "ACTIVE",
    eventTableName: `ds_${code}_event`,
    prefixTableName: `ds_${code}_prefix`,
    postTableName: `ds_${code}_post`,
    pathTableName: `ds_${code}_path`,
    outcomeTableName: `ds_${code}_outcome`,
    featureTableName: null,
  };
}

describe("assertSafeTableName（表名白名单，防注入）", () => {
  it("合法派生表名通过", () => {
    expect(() => assertSafeTableName("ds_first_limit_pullback_event", "first_limit_pullback", "event")).not.toThrow();
  });

  it("拒绝：与 datasetCode 不匹配的表名", () => {
    expect(() => assertSafeTableName("ds_other_event", "first_limit_pullback", "event")).toThrow(/命名规范/);
  });

  it("拒绝：role 不匹配", () => {
    expect(() => assertSafeTableName("ds_first_limit_pullback_path", "first_limit_pullback", "event")).toThrow();
  });

  it("拒绝：注入尝试（反引号 / 分号 / DROP / 空格）", () => {
    const evil = [
      "ds_first_limit_pullback_event`; DROP TABLE x; --",
      "ds_first_limit_pullback_event; DROP TABLE ds_first_limit_pullback_path",
      "`ds_first_limit_pullback_event`",
      "ds_first_limit_pullback_event ",
      "ds_first_limit_pullback_event\nDROP",
      "",
    ];
    for (const name of evil) {
      expect(() => assertSafeTableName(name, "first_limit_pullback", "event")).toThrow();
    }
  });
});

describe("resolveDefinitionTables", () => {
  it("按 definition 落库表名校验并返回", () => {
    const def = makeDefinition("first_limit_pullback");
    const tables = resolveDefinitionTables(def);
    expect(tables.map((t) => t.tableName)).toEqual([
      "ds_first_limit_pullback_event",
      "ds_first_limit_pullback_prefix",
      "ds_first_limit_pullback_post",
      "ds_first_limit_pullback_path",
      "ds_first_limit_pullback_outcome",
    ]);
  });

  it("落库表名为 null 的角色被跳过（如无 feature）", () => {
    const def = makeDefinition("first_limit_pullback");
    expect(resolveDefinitionTables(def).some((t) => t.role === "feature")).toBe(false);
  });

  it("落库表名被篡改 → 抛错（拒绝执行 DDL/DML）", () => {
    const def = { ...makeDefinition("first_limit_pullback"), eventTableName: "ds_hacked_event" };
    expect(() => resolveDefinitionTables(def)).toThrow(/命名规范/);
  });
});

describe("InMemoryDatasetPhysicalStore（编排语义）", () => {
  it("ensureTables → purgeVersionRows（保留表结构）→ dropTables（删表）", async () => {
    const store = new InMemoryDatasetPhysicalStore();
    const plugin = makeTestPlugin();
    const def = makeDefinition("first_limit_pullback");

    const created = await store.ensureTables(def, plugin);
    expect(created).toEqual(resolvePluginTables(plugin, def.datasetCode).map((t) => t.tableName));
    expect(store.hasTable("ds_first_limit_pullback_event")).toBe(true);

    store.seedRows(def, 101, 5);
    store.seedRows(def, 102, 7);
    const purged = await store.purgeVersionRows(def, 101);
    expect(purged.every((p) => !p.tableMissing)).toBe(true);
    expect(purged.reduce((s, p) => s + p.deleted, 0)).toBe(25); // 5 表 × 5
    expect(store.hasTable("ds_first_limit_pullback_event")).toBe(true); // 表结构保留

    const dropped = await store.dropTables(def);
    expect(dropped.every((d) => d.dropped)).toBe(true);
    expect(store.listTables()).toEqual([]);
  });

  it("表不存在时删除数据 → deleted=0 且 tableMissing=true（诚实 0，不报错）", async () => {
    const store = new InMemoryDatasetPhysicalStore();
    const def = makeDefinition("first_limit_pullback");
    const purged = await store.purgeVersionRows(def, 999);
    expect(purged.every((p) => p.tableMissing)).toBe(true);
    expect(purged.every((p) => p.deleted === 0)).toBe(true);
  });
});
