/**
 * `FIRSTBOARD-ROLLING-POOL-LOSS-ATTRIBUTION-001` —— **纯** CSV 解析 / 序列化。
 *
 * 🔴 为什么必须有本模块（而不是 `split(",")`）：Run 产物的 `reason` / `note` 字段里
 *    含**全角逗号**与引号，且自由文本可能被引号包裹（RFC4180-ish）。用 `split(",")`
 *    会静默错列 ⇒ 归因表与真实产物错位。
 *
 * 本模块**无 IO**：调用方负责读文件 / 读对象存储。
 */

/** 把一个 CSV 文本解析成**行 × 列**（支持 CRLF、引号包裹、字段内逗号 / 换行 / 双引号转义）。 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let hasField = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      field += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      hasField = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      hasField = true;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      hasField = false;
      continue;
    }
    if (char === "\r") continue;
    field += char;
    hasField = true;
  }
  if (hasField || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * 解析成「表头 → 行对象」。
 *
 * 判据（**响亮**而不是静默）：
 *   - 空行（全字段空）丢弃；
 *   - 列数不等于表头列数的行**抛错**（不猜、不错位补齐）；
 *   - 缺少表头 ⇒ 抛错。
 */
export function parseCsvTable(text: string, source = "<csv>"): Record<string, string>[] {
  const rows = parseCsvRows(text);
  const header = rows[0];
  if (header === undefined || header.length === 0) {
    throw new Error(`${source}：CSV 没有表头行。`);
  }
  const out: Record<string, string>[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] as string[];
    if (row.every((cell) => cell === "")) continue;
    if (row.length !== header.length) {
      throw new Error(
        `${source}：第 ${index + 1} 行列数 ${row.length} ≠ 表头列数 ${header.length}`
        + `（引号 / 换行解析不一致 ⇒ 拒绝静默错位）。`,
      );
    }
    const record: Record<string, string> = {};
    for (let column = 0; column < header.length; column += 1) {
      record[header[column] as string] = row[column] as string;
    }
    out.push(record);
  }
  return out;
}

/** 空串 / 空白 → `null`。 */
export function textOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.trim() === "" ? null : value;
}

/** 空串 → `null`；非数字 → **抛错**（不静默变成 `NaN`）。 */
export function numberOrNull(value: string | undefined, source = "<csv>"): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${source}：期望数字，实际「${value}」。`);
  return parsed;
}

/** 同 `numberOrNull`，但**必填**。 */
export function numberRequired(value: string | undefined, source = "<csv>"): number {
  const parsed = numberOrNull(value, source);
  if (parsed === null) throw new Error(`${source}：缺少必填数字。`);
  return parsed;
}

/** `true` / `false` → 布尔；空串 → `null`；其它 → 抛错。 */
export function booleanOrNull(value: string | undefined, source = "<csv>"): boolean | null {
  if (value === undefined || value.trim() === "") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${source}：期望 true/false，实际「${value}」。`);
}

/**
 * 序列化为 CSV（LF 行尾；字段含 `,` `"` `\n` `\r` 时加引号并转义）。
 *
 * 🔴 **不做**数字格式化（口径不在这里），只做转义 —— 调用方自己决定呈现精度。
 */
export function toCsvText(
  header: readonly string[],
  rows: readonly Readonly<Record<string, string | number | boolean | null>>[],
): string {
  const lines: string[] = [header.join(",")];
  for (const row of rows) {
    lines.push(
      header
        .map((column) => {
          const value = row[column];
          if (value === null || value === undefined) return "";
          const text = typeof value === "string" ? value : String(value);
          return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
