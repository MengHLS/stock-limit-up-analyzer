/**
 * RESEARCH-001 — Research 核心领域层统一出口。
 *
 * 内容：
 *   - Domain 类型与**集中管理**的枚举（types.ts）；
 *   - 配置 / 执行快照类型（config.ts）；
 *   - 条件研究模型（conditions.ts）；
 *   - 结果层模型与指标码（results.ts）；
 *   - Run 执行批次日志规则（executionLog.ts）；
 *   - 策略候选规则模型（candidates.ts）；
 *   - 序列化原子函数（serialization.ts）；
 *   - Repository 契约 + 内存替身 + 真实 DB 实现（repository/）。
 *
 * ⚠️ **本模块不并入 `server/research/index.ts` barrel**：
 *    那里已导出 STEP 6.x 遗留的 `ResearchExperiment` / `ResearchRun`（同名不同物，见
 *    docs/research/RESEARCH-001-AUDIT.md §4）。合并到同一 barrel 会造成符号冲突。
 *    消费方请显式 `import { ... } from "../researchCore"`。
 *
 * ⚠️ 本模块**不含** Research Engine / 统计计算 / 信号求值 / 回测 / 参数搜索 / 前端。
 *    它只提供「稳定到可以在其上继续开发 Research Engine」的持久化与领域基础。
 */

export * from "./types";
export * from "./config";
export * from "./conditions";
export * from "./results";
export * from "./executionLog";
export * from "./candidates";
export * from "./serialization";
export * from "./repository";
