/**
 * STEP 22 / C-22.1 — Market Regime 体系（STEP 22 市场状态）统一出口。
 *
 * 导出分层：
 *   - types        七维类型契约 / 标签 / unassessed 语义 / Run 记录
 *   - errors       错误类型与非有限数守卫
 *   - dates        日期纯函数（儒略日 / 字符串切片，无 Date 对象）
 *   - config       七维阈值默认值（文档化依据）+ 解析
 *   - facts        日级市场事实构建（复用 boardRules / C-13.1 PIT 断言 / quant-stats）
 *   - dimensions   七维标签计算器（回看窗 PIT）
 *   - composite    复合状态 + 逐日标签装配
 *   - attribution  同 regime 下的表现归因（表现数据注入，本模块不跑回测）
 *   - adapters     C-16.3 / C-13.3 unassessed 占位填充适配
 *   - serialize    canonical 指纹 / round-trip / 校验
 *   - run          运行编排（Run 记录产出）
 *
 * 状态：CODE_READY（§7；VALIDATED / RESEARCH_READY 依赖数据链就绪后认证，禁止越级）。
 */

export * from "./types";
export * from "./errors";
export * from "./dates";
export * from "./config";
export * from "./facts";
export * from "./dimensions";
export * from "./composite";
export * from "./attribution";
export * from "./adapters";
export * from "./serialize";
export * from "./run";
