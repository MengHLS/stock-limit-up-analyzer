/**
 * `FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001` —— 共享纯库出口。
 *
 * 🔴 本出口**只引纯模块**（无 `server/**`、无 IO、无 DB）：任何调用方（工具 / 测试）
 *    都不能通过它拿到副作用能力。
 */

export * from "./types";
export * from "./csv";
export * from "./funnel";
