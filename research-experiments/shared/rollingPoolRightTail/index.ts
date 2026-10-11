/**
 * `FIRSTBOARD-ROLLING-POOL-RIGHTTAIL-MVP-001` —— 共享纯库出口。
 *
 * 🔴 本出口**只引纯模块**（无 `server/**`、无 IO）。
 *    `page.tsx` 只允许 `import type` 本出口的类型；
 *    `experiment.ts` 走 `@experiments/strategyCoreBridge` 调 Core 权威 `maxAmp5`。
 */

export * from "./types";
export * from "./projection";
export * from "./labels";
export * from "./stats";
