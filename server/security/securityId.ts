/**
 * STEP 7.4 — 永久身份契约（security_id）。
 *
 * security_id 是系统分配的稳定身份，与任何市场代码（stock_code）解耦：
 *   - 代码变化（借壳/换代码/迁移板块）→ security_id 不变。
 *   - 代码复用（退市后新上市沿用同一数字代码）→ 分配新的 security_id。
 *
 * 采用 `sec_` + UUID v4 形式，碰撞概率可忽略；格式仅作契约约束，
 * 不携带任何业务语义（禁止从 security_id 反推代码/交易所）。
 */

import { randomUUID } from "node:crypto";

const SECURITY_ID_PATTERN = /^sec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 生成一个新的永久身份。 */
export function generateSecurityId(): string {
  return `sec_${randomUUID()}`;
}

/** 校验是否为合法 security_id。 */
export function isValidSecurityId(id: string): boolean {
  return SECURITY_ID_PATTERN.test(id);
}
