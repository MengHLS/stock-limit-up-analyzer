/**
 * STEP 7.4 — 确定性 security_id 分配（幂等落库的关键）。
 *
 * security_id 的格式契约（见 ./securityId.ts）为 `sec_<uuid v4 形态>`，
 * 仅作格式约束、不携带业务语义。但落库必须幂等：同一证券重复回填不能产生新 id。
 * `randomUUID()` 每次产生新值，无法满足幂等，因此引入确定性分配：
 *
 *   - 以稳定锚点（ts_code，如 600001.SH）做 SHA-1 摘要，取前 16 字节并置
 *     UUID v4 的 version/variant 位，格式化为 8-4-4-4-12。
 *   - 同一锚点恒定产出同一 id，且通过 isValidSecurityId 的格式校验；
 *     碰撞概率可忽略（128-bit 空间）。
 *
 * 代码复用（退市后代码复用）时，同一代码对应多个不同 security_id：
 * 复用方通过「锚点 + 序号」后缀（如 `600001.SH#2`）获得独立的确定性 id。
 */

import { createHash } from "node:crypto";

/** 由稳定锚点生成确定性 security_id（`sec_<uuid>` 形态）。 */
export function generateDeterministicSecurityId(anchor: string): string {
  const hex = createHash("sha1").update(anchor, "utf8").digest("hex");
  const chars = hex.slice(0, 32).split("");
  chars[12] = "4"; // UUID version 4
  chars[16] = ((parseInt(chars[16]!, 16) & 0x3) | 0x8).toString(16); // variant 10xx
  const s = chars.join("");
  return `sec_${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** 由交易所 + 6 位代码构造 ts_code 锚点（与 Tushare ts_code 一致，如 600001.SH）。 */
export function securityIdAnchorForTsCode(exchange: string, code: string): string {
  return `tushare:${code}.${exchange}`;
}
