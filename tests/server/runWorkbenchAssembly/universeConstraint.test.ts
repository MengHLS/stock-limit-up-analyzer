/**
 * DATASET-SCOPE-INHERIT-001 — 「回落重建继承数据集 universe 约束」纯函数测试。
 *
 * 背景（2026-09-14 真实库实查）：`dataset_version.id=390002` 声明 `boards:["main"]`，
 * 但直读不可撮合 ⇒ 回落 `buildResearchDataset` 重建时**未继承**该约束，重建产物变成
 * 全市场（`datasetSecurityCount=5146`），成交明细里出现 300/301/688 标的。
 *
 * 本测试钉住四条判据：
 *   A. build_config 是**权威来源**，优先于版本自述；
 *   B. 版本自述（`universeDefinitionJson`）在无 build_config 时兜底；
 *   C. 两个来源都无约束 ⇒ `source=none` 且空 boards（**不猜**，不是「随便给个 main」）；
 *   D. 非法 / 不可选板块取值 ⇒ **响亮抛错**（`unknown` 不得作为白名单；静默丢弃 = 悄悄放宽范围）。
 */

import { describe, expect, it } from "vitest";
import {
  pickUniverseConstraint,
  UniverseConstraintError,
} from "../../../server/runWorkbenchAssembly/datasetFromRegistry";

describe("pickUniverseConstraint — 回落重建的 universe 约束继承", () => {
  it("A. build_config 优先：boards 与 excludeSt 一律取自权威生成参数", () => {
    const result = pickUniverseConstraint(
      { boards: ["main"], excludeSt: true },
      { boards: ["chinext"], excludeSt: false }, // 版本自述与配置冲突 ⇒ 必须听配置
    );
    expect(result).toEqual({ boards: ["main"], excludeSt: true, source: "build-config" });
  });

  it("B. 无 build_config 时兜底读版本自述（实测 390002 就是这个形状）", () => {
    const result = pickUniverseConstraint(null, {
      universe: "all-a-shares",
      source: "stock_daily_prices",
      boards: ["main"],
      excludeSt: true,
    });
    expect(result).toEqual({
      boards: ["main"],
      excludeSt: true,
      source: "version-universe-definition",
    });
  });

  it("C. 两个来源都没有约束 ⇒ source=none 且空 boards（不猜、不默认给 main）", () => {
    expect(pickUniverseConstraint(null, undefined)).toEqual({
      boards: [],
      excludeSt: false,
      source: "none",
    });
    expect(pickUniverseConstraint(null, { universe: "all-a-shares" })).toEqual({
      boards: [],
      excludeSt: false,
      source: "none",
    });
  });

  it("C2. 版本自述形状不符（字符串 / null / 数组）⇒ 一律 none，绝不从字符串里抠板块", () => {
    for (const bad of ["main", null, 123, ["main"], true]) {
      expect(pickUniverseConstraint(null, bad)).toEqual({
        boards: [],
        excludeSt: false,
        source: "none",
      });
    }
  });

  it("D. 非法板块取值 ⇒ 抛 UniverseConstraintError（含 unknown：它不是白名单）", () => {
    expect(() => pickUniverseConstraint({ boards: ["main", "unknown"], excludeSt: false }, null)).toThrow(
      UniverseConstraintError,
    );
    expect(() => pickUniverseConstraint({ boards: ["MAIN"], excludeSt: false }, null)).toThrow(
      UniverseConstraintError,
    );
    expect(() => pickUniverseConstraint(null, { boards: ["creativity"] })).toThrow(
      UniverseConstraintError,
    );
  });

  it("D2. 抛错**不是** RegistryDatasetBridgeError ⇒ 不会被「回落重建」逻辑吞掉", () => {
    try {
      pickUniverseConstraint({ boards: ["nope"], excludeSt: false }, null);
      throw new Error("应当抛错但没有");
    } catch (error) {
      expect(error).toBeInstanceOf(UniverseConstraintError);
      expect((error as UniverseConstraintError).code).toBe("REGISTRY_UNIVERSE_CONSTRAINT_INVALID");
      expect((error as Error).name).not.toBe("RegistryDatasetBridgeError");
    }
  });

  it("E. boards 去重且保持原顺序；excludeSt 只认严格 true", () => {
    expect(pickUniverseConstraint({ boards: ["main", "main", "star", "main"], excludeSt: true }, null)).toEqual({
      boards: ["main", "star"],
      excludeSt: true,
      source: "build-config",
    });
    expect(
      pickUniverseConstraint({ boards: ["main"], excludeSt: "true" as unknown as boolean }, null).excludeSt,
    ).toBe(false);
  });

  it("F. 空 boards + 不排除 ST = 「全板块」声明（must not 被当成约束）", () => {
    expect(pickUniverseConstraint({ boards: [], excludeSt: false }, null)).toEqual({
      boards: [],
      excludeSt: false,
      source: "build-config",
    });
  });
});
