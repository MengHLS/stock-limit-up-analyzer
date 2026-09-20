/**
 * RESEARCH-EXPERIMENT-004 — Run id 生成（与仓库既有 `generateXxxRunId` 同风格）。
 *
 * 先例：`server/paramSearchRouter.ts` 的
 * `${ROBUSTNESS_RUN_ID_PREFIX}-${date}-${randomBytes(4).toString("hex").toUpperCase()}`。
 *
 * 形态：`RUN-YYYYMMDD-XXXXXXXX`（8 位大写十六进制）。
 *
 * 🔴 为什么带日期段：Run id 会被**直接拼进 Object Key**（规格 §9）。日期段让
 *    「按时间浏览对象存储」在不查库的情况下也可读，同时 id 仍然全局唯一。
 * 🔴 为什么随机段用大写 hex：只含 `[0-9A-F]` ⇒ 天然满足 Object Key 的段字符集
 *    （不会出现需要 URL 转义的字符）；且**不含** `.` / `/` / `..`（key 注入哨兵）。
 */

import { randomBytes } from "node:crypto";

/** Run id 前缀（便于日志与对象存储里一眼认出是哪一类 Run）。 */
export const EXPERIMENT_RUN_ID_PREFIX = "RUN";

/** 生成一个 Run id。`randomBytes` 可注入以便测试得到确定值。 */
export function generateExperimentRunId(
  now: Date = new Date(),
  random: (size: number) => Buffer = randomBytes,
): string {
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const suffix = random(4).toString("hex").toUpperCase();
  return `${EXPERIMENT_RUN_ID_PREFIX}-${y}${m}${d}-${suffix}`;
}
