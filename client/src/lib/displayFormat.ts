/**
 * RESEARCH-EXPERIMENT-003 —— 时间 / 计数的**展示格式化**（从已删除的
 * `client/src/adapters/researchEngineAdapter.ts` 逐字迁出）。
 *
 * 为什么需要搬家：旧 Research 引擎（`researchEngine.*`）连同它的前端适配器一起删除，但这三个
 * 函数仍被**生产页面**使用（策略基本信息卡 / 策略版本面板 / 候选详情），因此迁到中立模块。
 */

/** ISO 时间 → 本地 `YYYY-MM-DD HH:mm`；null / 非法 → "—"。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * ISO 日期 `YYYY-MM-DD` → 中文 `YYYY年MM月DD日`；null / undefined → "—"。
 *
 * 抽出来是因为 `MaxConnectionBoardTrendChart`（情绪分析页与**首页**共用）与两个页面都要用同一口径，
 * 原先它是 `SentimentAnalysis.tsx` 里的局部函数，首页一旦复用就会复制出第二份。
 */
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
