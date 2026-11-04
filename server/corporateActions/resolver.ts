/**
 * 将公司行为事件整理为回测引擎可同步消费的解析器。
 *
 * DB 事件大多只有 `securityCode`，回测持仓使用 `securityId`；本模块在装配期完成
 * 一次映射，运行期只做 `(securityId, effectiveDate)` 索引查询。
 */

import type { CorporateAction } from "./types";

export interface CorporateActionResolverLike {
  actionsFor(securityId: string, date: string): readonly CorporateAction[];
}

export function createCorporateActionResolver(
  actions: readonly CorporateAction[],
  securityIdByCode: ReadonlyMap<string, string | readonly string[]>,
): CorporateActionResolverLike {
  const bySecurityAndDate = new Map<string, CorporateAction[]>();
  for (const action of actions) {
    const mapped = securityIdByCode.get(action.securityCode);
    const securityIds =
      action.securityId !== null
        ? [action.securityId]
        : typeof mapped === "string"
          ? [mapped]
          : mapped ?? [];
    for (const securityId of securityIds) {
      const key = `${securityId}\u0000${action.effectiveDate}`;
      const group = bySecurityAndDate.get(key);
      const resolved = { ...action, securityId };
      if (group === undefined) bySecurityAndDate.set(key, [resolved]);
      else group.push(resolved);
    }
  }
  return {
    actionsFor(securityId, date) {
      return bySecurityAndDate.get(`${securityId}\u0000${date}`) ?? [];
    },
  };
}
