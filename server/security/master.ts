/**
 * STEP 7.4 — 内存版 Security Master Store（as-of universe / 身份生命周期基础）。
 *
 * 提供不依赖数据库的、可测试的证券身份层操作：
 *   - 注册/更新证券（永久身份）。
 *   - 添加标识符（区间唯一性校验）。
 *   - as-of 解析（code → security_id）。
 *   - as-of universe（survivorship-safe）。
 *   - 代码变更链接（同一 security 换代码）。
 *
 * 生产环境的持久化落库由 research_securities / research_security_identifier_history 承担，
 * 本 store 是业务逻辑的纯内存实现，供回测/研究/测试复用同一套身份契约。
 */

import { addDays, compareDate } from "./dates";
import {
  detectCodeReuse,
  resolveSecurityByCode,
  validateIdentifierHistory,
  type CodeReuseRecord,
} from "./identifierHistory";
import { isValidSecurityId } from "./securityId";
import { getTradableSecurities } from "./universe";
import type { Exchange, Security, SecurityIdentifier } from "./types";

export class SecurityMasterStore {
  private readonly securities = new Map<string, Security>();
  private readonly identifiers: SecurityIdentifier[] = [];

  /** 注册或更新证券主数据。 */
  upsertSecurity(security: Security): void {
    if (!isValidSecurityId(security.securityId)) {
      throw new Error(`非法 security_id：${security.securityId}`);
    }
    this.securities.set(security.securityId, security);
  }

  /**
   * 添加标识符；校验该 (exchange, code, type) 分组内区间不重叠。
   * 同一 code 在不同（不重叠）区间可指向不同 security_id（代码复用）。
   */
  addIdentifier(identifier: SecurityIdentifier): void {
    if (!this.securities.has(identifier.securityId)) {
      throw new Error(`标识符引用了未注册的 security_id：${identifier.securityId}`);
    }
    // 与本组既有区间逐一判重叠（含未写入的新区间）。
    for (const existing of this.identifiers) {
      if (
        existing.exchange === identifier.exchange &&
        existing.code === identifier.code &&
        existing.identifierType === identifier.identifierType
      ) {
        if (
          compareDate(identifier.effectiveFrom, existing.effectiveTo ?? "9999-12-31") <= 0 &&
          compareDate(existing.effectiveFrom, identifier.effectiveTo ?? "9999-12-31") <= 0
        ) {
          throw new Error(
            `标识符区间重叠：${identifier.exchange} ${identifier.code} 在 ` +
              `[${existing.effectiveFrom},${existing.effectiveTo ?? "至今"}] 与 ` +
              `[${identifier.effectiveFrom},${identifier.effectiveTo ?? "至今"}]`,
          );
        }
      }
    }
    this.identifiers.push(identifier);
  }

  getSecurity(securityId: string): Security | null {
    return this.securities.get(securityId) ?? null;
  }

  /** 某 security 的全部标识符（按生效起点排序）。 */
  identifiersOf(securityId: string): SecurityIdentifier[] {
    return this.identifiers
      .filter((identifier) => identifier.securityId === securityId)
      .sort((a, b) => compareDate(a.effectiveFrom, b.effectiveFrom));
  }

  /** as-of 解析：在指定日期，某 (exchange, code) 对应的证券。 */
  resolveByCode(exchange: Exchange, code: string, date: string): Security | null {
    const securityId = resolveSecurityByCode(this.identifiers, exchange, code, date);
    if (!securityId) return null;
    return this.securities.get(securityId) ?? null;
  }

  /** as-of universe（survivorship-safe）。 */
  asOfUniverse(date: string): Security[] {
    return getTradableSecurities(Array.from(this.securities.values()), this.identifiers, date);
  }

  /** 检测代码复用。 */
  codeReuse(): CodeReuseRecord[] {
    return detectCodeReuse(this.identifiers);
  }

  /** 校验整份标识符历史（分组区间互不重叠）。 */
  validate(): void {
    validateIdentifierHistory(this.identifiers);
  }

  /**
   * 代码变更链接：把同一 security 的新代码从 changeDate 起链接到既有 security_id。
   * 自动关闭该 security 在 changeDate 仍开放的 primary 标识符（effectiveTo = changeDate 前一日）。
   */
  linkCodeChange(
    securityId: string,
    exchange: Exchange,
    newCode: string,
    changeDate: string,
    source = "manual",
  ): void {
    const security = this.securities.get(securityId);
    if (!security) throw new Error(`linkCodeChange 引用了未注册的 security_id：${securityId}`);
    if (security.exchange !== exchange) {
      throw new Error(`linkCodeChange 交易所不一致：security=${security.exchange}，参数=${exchange}`);
    }
    const prevDay = addDays(changeDate, -1);
    for (const identifier of this.identifiers) {
      if (
        identifier.securityId === securityId &&
        identifier.exchange === exchange &&
        identifier.identifierType === "primary" &&
        (identifier.effectiveTo === null || compareDate(identifier.effectiveTo, changeDate) >= 0)
      ) {
        identifier.effectiveTo = prevDay;
      }
    }
    this.addIdentifier({
      securityId,
      exchange,
      code: newCode,
      identifierType: "primary",
      effectiveFrom: changeDate,
      effectiveTo: null,
      source,
    });
  }
}
