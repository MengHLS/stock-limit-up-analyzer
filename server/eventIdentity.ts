/**
 * 执行面板中的事件级证券身份。
 *
 * 同一证券可能有多个首板事件。若只用 `securityId` 作为面板键，多个事件窗口会被合并为
 * 一条长序列，Core 的 `SERIES_START` 锚定只能看到第一个事件。这里在运行面板内部使用
 * `securityId::event:<eventId>` 作为键，使每个事件拥有独立的相对日序列。
 */

const EVENT_SCOPE_SEPARATOR = "::event:";
/** 池化面板身份分隔符（与 runWorkbenchAssembly/poolProjection.ts 的 panelSecurityId 同形）。 */
const POOL_MEMBER_SCOPE_SEPARATOR = "::pool:";

/** 执行面板中的事件级身份；同一证券的多个事件必须隔离。 */
export function eventScopedSecurityId(securityId: string, eventId: string): string {
  return `${securityId}${EVENT_SCOPE_SEPARATOR}${eventId}`;
}

/**
 * 任意面板身份 → canonical `sec_<uuid>`。
 *
 * 当前存在两种面板作用域：
 *   - 事件窗：`sec_<uuid>::event:<eventId>`
 *   - 首板池：`sec_<uuid>::pool:<eventId>`
 * 两者都必须能回到基础身份，否则成交明细的代码/名称与 K 线查询会退化为“无法解析行情代码”。
 */
export function baseSecurityIdOf(securityId: string): string {
  const separators = [EVENT_SCOPE_SEPARATOR, POOL_MEMBER_SCOPE_SEPARATOR];
  const index = separators
    .map(separator => securityId.indexOf(separator))
    .filter(position => position >= 0)
    .sort((left, right) => left - right)[0];
  return index === undefined ? securityId : securityId.slice(0, index);
}
