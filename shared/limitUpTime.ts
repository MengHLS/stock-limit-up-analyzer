export const LIMIT_UP_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
const FLEXIBLE_LIMIT_UP_TIME_PATTERN = /^(?:[0-9]|[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/;

/**
 * 将涨停时间统一为 HH:MM:SS。
 * 空值表示未知时间，返回 null；HH:MM 自动补为 :00。
 */
export function normalizeLimitUpTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (!FLEXIBLE_LIMIT_UP_TIME_PATTERN.test(trimmed)) return null;

  const [rawHours, minutes, seconds = "00"] = trimmed.split(":");
  return `${rawHours.padStart(2, "0")}:${minutes}:${seconds}`;
}

export function isValidLimitUpTime(value: string | null | undefined): boolean {
  return !value?.trim() || normalizeLimitUpTime(value) !== null;
}
