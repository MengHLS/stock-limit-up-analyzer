/**
 * RESEARCH-001 — 序列化原子函数（JSON 列 ⇄ 领域值）。
 *
 * 规则：
 *   - JSON 列一律 longtext，null 表示「未设置」，**空字符串不是合法 JSON**；
 *   - 反序列化失败**必须抛错**（不静默返回 undefined）—— 静默会掩盖数据损坏；
 *   - 时间统一 ISO 8601 字符串（与项目 `datasetRegistry` 的 `toIso` 同口径）。
 */

export class ResearchSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchSerializationError";
  }
}

/** 领域值 → JSON 文本；`undefined` / `null` → null（列写 NULL）。 */
export function encodeJson(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (err) {
    throw new ResearchSerializationError(`字段 ${field} 无法序列化为 JSON：${(err as Error).message}`);
  }
  // JSON.stringify(undefined) === undefined（非字符串）
  if (typeof text !== "string") return null;
  return text;
}

/** JSON 文本 → 领域值；null → undefined。解析失败抛错。 */
export function decodeJson<T = unknown>(text: string | null | undefined, field: string): T | undefined {
  if (text === null || text === undefined) return undefined;
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new ResearchSerializationError(`字段 ${field} 的 JSON 文本为空（应为 NULL 或合法 JSON）`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ResearchSerializationError(`字段 ${field} 的 JSON 解析失败：${(err as Error).message}`);
  }
}

/** Date / ISO 字符串 → ISO 字符串；空 → null。 */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** ISO 字符串 → Date（Repository 写库用）；空 → null。 */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 校验条件值是否为合法 `valueJson` 载荷（数组 / 标量 / null 均可，禁止 undefined 与函数）。 */
export function assertJsonEncodable(value: unknown, field: string): void {
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new ResearchSerializationError(`字段 ${field} 含不可 JSON 化的值（${typeof value}）`);
  }
}
