/**
 * JsonBlock — 结构化展示任意 JSON（FRONTEND-FINAL-001 · P2-3 / §十四-7）。
 *
 * ## 为什么需要它（审计结论）
 *
 * 审计确认两件事：
 * 1. `common/TechnicalDetails.tsx` **不是** JSON 查看器，只是一个 `Collapsible` 折叠壳
 *    （自身不解析、不格式化传入的 children）；
 * 2. 全站唯一的「JSON 一锅端」点是参数搜索页的 `JSON.stringify(combination.parameters)`
 *    —— 用户拿到一坨字符串，看不清「哪个参数等于多少」。
 *
 * 本组件的规则（**默认形态不是 `<pre>`**）：
 * - `mode="auto"`（默认）：值是「平坦标量对象」（所有 value 都是 string/number/boolean/null）
 *   ⇒ 渲染成**键值表**（一行一个参数，可读、可复制单值）；
 *   否则回落 JSON 原文。
 * - 无论如何都提供「原文」开关 —— `<pre>` 不再是**唯一**形态，而是补充形态（符合规格 §十四-7）。
 * - 原文形态提供一键复制（走 `navigator.clipboard`，失败静默降级，不弹窗打断）。
 */

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface JsonBlockProps {
  readonly value: unknown;
  readonly mode?: "auto" | "raw" | "table";
  /** 值为空（null / undefined / 空对象）时的提示文案。 */
  readonly emptyText?: string;
  readonly keyHeader?: string;
  readonly valueHeader?: string;
  readonly className?: string;
}

function isScalar(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/** 平坦标量对象 ⇒ 可表格化；否则 null。 */
function asScalarRecord(value: unknown): Array<[string, unknown]> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  if (!entries.every(([, v]) => isScalar(v))) return null;
  return entries;
}

/** 标量 → 可读文本（null 显式写作 `null`，不用空串冒充）。 */
export function scalarText(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : String(value);
  return "—";
}

export function JsonBlock({
  value,
  mode = "auto",
  emptyText = "（无内容）",
  keyHeader = "键",
  valueHeader = "值",
  className,
}: JsonBlockProps) {
  const [rawOpen, setRawOpen] = useState(mode === "raw");
  const [copied, setCopied] = useState(false);

  const record = mode === "raw" ? null : asScalarRecord(value);
  const raw = (() => {
    try {
      return JSON.stringify(value, null, 2) ?? "null";
    } catch {
      return "（无法序列化）";
    }
  })();

  const isEmpty =
    value === null
    || value === undefined
    || (typeof value === "object" && Object.keys(value as object).length === 0);

  if (isEmpty && mode !== "raw") {
    return <div className={cn("text-xs text-muted-foreground", className)}>{emptyText}</div>;
  }

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // 剪贴板不可用（权限 / 非安全上下文）时静默降级：用户仍可手动选中复制。
    }
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-end gap-1">
        {mode !== "raw" && record !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setRawOpen((prev) => !prev)}
          >
            {rawOpen ? "收起原文" : "查看原文"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
          {copied ? "已复制" : "复制 JSON"}
        </Button>
      </div>

      {record !== null && (
        <div className="max-h-[280px] overflow-auto rounded-md border">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted/60">
              <tr>
                <th className="border-b px-2 py-1 text-left font-medium">{keyHeader}</th>
                <th className="border-b px-2 py-1 text-left font-medium">{valueHeader}</th>
              </tr>
            </thead>
            <tbody>
              {record.map(([key, entry]) => (
                <tr key={key} className="even:bg-muted/20">
                  <td className="border-b px-2 py-1 font-mono">{key}</td>
                  <td className="border-b px-2 py-1 font-mono">{scalarText(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(mode === "raw" || rawOpen || record === null) && (
        <pre className="max-h-[320px] overflow-auto rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
          {raw}
        </pre>
      )}
    </div>
  );
}
