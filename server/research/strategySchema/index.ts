/**
 * STEP 15 / C-15.1 — Strategy Schema + Versioning 统一出口。
 *
 * 交付内容（C-15.1）：
 *   - types.ts     §16 策略本体类型（StrategyDocument）+ §17 版本追溯记录（StrategyVersionRecord）
 *                  + 声明式规则 / position sizing / universe / execution assumptions / recipe 类型；
 *   - version.ts   语义版本（major.minor.patch）解析 / 比较 / bump（patch|minor|major）；
 *   - validate.ts  策略本体与版本追溯记录的结构化校验（缺项 / 非法版本 / 非法日期 / 参数与
 *                  schema 不符 → 结构化 issue）；assert* 非法抛 ResearchValidationError；
 *   - serialize.ts canonical 序列化 + sha256 fingerprint + round-trip 复核；
 *   - compare.ts   strategiesDeepEqual / compareStrategyDocuments（字段级 diff）+ 版本变化级别分类；
 *   - map.ts       createStrategyDocument / cloneStrategyDocument（bump 语义闸门）/
 *                  createStrategyVersionRecord（§17 九项追溯）/ strategy13ToRecipeRef（C-13.2 兼容映射）。
 *
 * 纯模块：无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、可序列化、确定性。
 * 范围克制：不实现执行引擎 / lifecycle 状态机（C-21.1）/ 优化（C-17）/ DB 持久化。
 * 注意：本目录独立自持 index；research/index.ts 属既有文件未改动，如需并入统一出口由协调者决定。
 */

export * from "./definition";
export * from "./definitionValidation";
export * from "./legacyViews";
export * from "./projection";
export * from "./types";
export * from "./version";
export * from "./validate";
export * from "./serialize";
export * from "./compare";
export * from "./map";
