/**
 * 执行面板中的事件级证券身份。
 *
 * 同一证券可能有多个首板事件。若只用 `securityId` 作为面板键，多个事件窗口会被合并为
 * 一条长序列，Core 的 `SERIES_START` 锚定只能看到第一个事件。这里在运行面板内部使用
 * `securityId::event:<eventId>` 作为键，使每个事件拥有独立的相对日序列。
 */

const EVENT_SCOPE_SEPARATOR = "::event:";

export function eventScopedSecurityId(securityId: string, eventId: string): string {
  return `${securityId}${EVENT_SCOPE_SEPARATOR}${eventId}`;
}

/** 事件级身份 → canonical `sec_<uuid>`；普通身份原样返回。 */
export function baseSecurityIdOf(securityId: string): string {
  const index = securityId.indexOf(EVENT_SCOPE_SEPARATOR);
  return index < 0 ? securityId : securityId.slice(0, index);
}
