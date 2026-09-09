/**
 * STEP 12.5 — Historical State Reconstruction：统一出口。
 *
 * 对任意 (security, date) 提供 asOf(T) 历史状态查询：
 *   - 纯函数核心：resolveSecurityHistoricalState（无 IO，可单测；研究/回测链路推荐使用）；
 *   - DB 加载器：querySecurityHistoricalState（真实 DB 接线；无库返回 null）；
 *   - 行映射：./mappers（DB 行 → 领域对象纯转换）；
 *   - 类型：./types（查询入参/结果/知识维度唯一权威来源）。
 *
 * 使用约定：
 *   研究口径必须显式传 asOf（PIT）；缺省 asOf=null 为全知视角，仅供调试/审计。
 */

export * from "./types";
export * from "./mappers";
export * from "./reconstruct";
export * from "./db";
