/**
 * STEP DATASET-003A — DatasetPluginRegistry / 内置插件单测。
 *
 * 覆盖：注册表语义（register / get / has / list / 重复拒绝 / 空表拒绝）、
 * 物理表派生（resolvePluginTables）、内置 first_limit_pullback 插件声明完整性。
 */

import { describe, expect, it } from "vitest";
import {
  DatasetPluginRegistry,
  createDefaultPluginRegistry,
  defaultDatasetPluginRegistry,
  firstLimitPullbackPlugin,
  resolvePluginTables,
  type DatasetPlugin,
} from "./plugins";
import { buildDatasetTableName } from "./naming";
import { makeFakeIO, makeFakeBuilder } from "./testHelpers";

function stubPlugin(
  datasetCode: string,
  roles: Array<"event" | "prefix" | "post" | "path" | "outcome"> = ["event"],
): DatasetPlugin {
  return {
    datasetCode,
    displayName: datasetCode,
    description: "stub",
    physicalTables: roles.map((role) => ({
      role,
      label: role,
      createSql: (t: string) => `CREATE TABLE IF NOT EXISTS \`${t}\` (id bigint)`,
    })),
    createIO: () => makeFakeIO(),
    createBuilder: () => makeFakeBuilder(),
  };
}

describe("DatasetPluginRegistry", () => {
  it("register / get / has / list（按 datasetCode 升序）", () => {
    const registry = new DatasetPluginRegistry();
    registry.register(stubPlugin("zebra"));
    registry.register(stubPlugin("alpha"));
    expect(registry.has("alpha")).toBe(true);
    expect(registry.has("nope")).toBe(false);
    expect(registry.get("alpha")?.datasetCode).toBe("alpha");
    expect(registry.get("nope")).toBeUndefined();
    expect(registry.list().map((p) => p.datasetCode)).toEqual(["alpha", "zebra"]);
  });

  it("同一 datasetCode 重复注册被拒（不静默覆盖）", () => {
    const registry = new DatasetPluginRegistry();
    registry.register(stubPlugin("alpha"));
    expect(() => registry.register(stubPlugin("alpha"))).toThrow(/已注册/);
  });

  it("未声明物理表的插件被拒（数据结构必须先声明）", () => {
    const registry = new DatasetPluginRegistry();
    expect(() => registry.register(stubPlugin("alpha", []))).toThrow(/物理表/);
  });

  it("unregister（仅验证脚本清理用）", () => {
    const registry = new DatasetPluginRegistry();
    registry.register(stubPlugin("alpha"));
    expect(registry.unregister("alpha")).toBe(true);
    expect(registry.has("alpha")).toBe(false);
    expect(registry.unregister("alpha")).toBe(false);
  });
});

describe("resolvePluginTables", () => {
  it("按 datasetCode 派生物理表名（ds_{code}_{role}）", () => {
    const tables = resolvePluginTables(stubPlugin("demo_set", ["event", "path", "outcome"]), "demo_set");
    expect(tables.map((t) => t.tableName)).toEqual([
      buildDatasetTableName("demo_set", "event"),
      buildDatasetTableName("demo_set", "path"),
      buildDatasetTableName("demo_set", "outcome"),
    ]);
    // DDL 内嵌正确表名（不依赖模板表存在）
    expect(tables[0]!.createSql).toContain("`ds_demo_set_event`");
    expect(tables[0]!.createSql).toContain("CREATE TABLE IF NOT EXISTS");
  });
});

describe("内置插件：first_limit_pullback", () => {
  it("createDefaultPluginRegistry 注册了 first_limit_pullback", () => {
    const registry = createDefaultPluginRegistry();
    expect(registry.list().map((p) => p.datasetCode)).toEqual(["first_limit_pullback"]);
    expect(defaultDatasetPluginRegistry.has("first_limit_pullback")).toBe(true);
  });

  it("声明 event / prefix / post / path / outcome 五张物理表，DDL 自包含（不依赖模板表）", () => {
    const tables = resolvePluginTables(firstLimitPullbackPlugin, "first_limit_pullback");
    expect(tables.map((t) => t.role)).toEqual(["event", "prefix", "post", "path", "outcome"]);
    for (const t of tables) {
      expect(t.createSql).toContain("CREATE TABLE IF NOT EXISTS");
      expect(t.createSql).not.toMatch(/LIKE\s+`/i); // 不使用 CREATE TABLE ... LIKE（避免依赖模板表）
      expect(t.createSql).toContain(`\`${t.tableName}\``);
    }
  });

  it("DDL 列与索引与迁移一致（关键列存在性 + PIT 结构防线）", () => {
    const byRole = new Map(
      resolvePluginTables(firstLimitPullbackPlugin, "first_limit_pullback").map((t) => [t.role, t.createSql]),
    );
    const eventSql = byRole.get("event")!;
    const prefixSql = byRole.get("prefix")!;
    const postSql = byRole.get("post")!;
    const pathSql = byRole.get("path")!;
    const outcomeSql = byRole.get("outcome")!;

    expect(eventSql).toContain("`isFirstLimit`");
    expect(eventSql).toContain("`previousClose`");
    expect(eventSql).toContain("`turnover`");
    expect(eventSql).toContain("`datasetVersionId`");
    expect(eventSql).toContain("uq_event_version_event");
    // event 不再承载逐日行情（跨表 t 日重复已消除）。
    for (const col of ["`open`", "`high`", "`low`", "`close`", "`volume`", "`amount`"]) {
      expect(eventSql).not.toContain(col);
    }

    // prefix / post 严格同构：除表名与索引前缀外逐字相同。
    expect(prefixSql.replace(/prefix/g, "X")).toBe(postSql.replace(/post/g, "X"));
    for (const sql of [prefixSql, postSql]) {
      expect(sql).toContain("`relativeDay`");
      expect(sql).toContain("`close`");
      // 原始行情表禁止出现衍生列（结构级 PIT 防线）。
      expect(sql).not.toContain("FromEventClose");
      expect(sql).not.toContain("isBreakout");
    }

    expect(pathSql).toContain("`relativeDay`");
    expect(pathSql).toContain("uq_path_version_event_day");
    expect(pathSql).toContain("`closeFromEventClose`");
    expect(pathSql).toContain("`pullbackFromEventHigh`");
    // 已删的原始列 / 死列 / 重复列。
    for (const col of ["`turnover`", "`returnFromEventClose`", "`pullbackFromEventClose`", "`volume`", "`amount`"]) {
      expect(pathSql).not.toContain(col);
    }

    expect(outcomeSql).toContain("`horizon`");
    expect(outcomeSql).toContain("uq_outcome_version_event_horizon");
  });
});
