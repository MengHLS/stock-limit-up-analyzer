/**
 * Strategy 层统一入口。
 *
 * 对外暴露契约、注册中心、首个迁移策略与 legacy 桥接。
 * 不导出 Backtest Core 的实现细节；策略只依赖本层 + domain 类型 +（必要时）quant-stats。
 */
export * from "./contract";
export * from "./registry";
export * from "./strategies";
export * from "./strategies/leaderCandidateBaseline";
export * from "./adapter";
