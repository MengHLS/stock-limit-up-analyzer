
/** ISO 时间 → 本地 `YYYY-MM-DD HH:mm`；null / 非法 → "—"。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatChineseDate(date: string | null | undefined): string {
  if (!date) return "—";
  return date.replace(/^(\d{4})-/, "$1年").replace(/-(\d{2})$/, "月$1日");
}

/** 千分位整数；null / undefined → "—"。 */
export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

/** 毫秒 → 人类可读（`1,234 ms` / `1.2 s` / `1 m 05 s`）。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} m ${String(total % 60).padStart(2, "0")} s`;
}
