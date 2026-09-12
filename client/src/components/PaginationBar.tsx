import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

/** 生成带省略号的页码序列，例如 [1, '...', 4, 5, 6, '...', 20]。 */
export function buildPageList(current: number, total: number): Array<number | "..."> {
  if (total <= 7) return Array.from({ length: total }, (_unused, index) => index + 1);
  const delta = 1;
  const result: Array<number | "..."> = [];
  for (let page = 1; page <= total; page += 1) {
    if (page === 1 || page === total || (page >= current - delta && page <= current + delta)) {
      result.push(page);
    } else if (result[result.length - 1] !== "...") {
      result.push("...");
    }
  }
  return result;
}

type PaginationBarProps = {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  /** 翻页请求进行中：按钮禁用但保留当前页数据（避免整表闪烁）。 */
  disabled?: boolean;
  className?: string;
};

/**
 * 服务端分页控件：页码夹取、首/上/下/末页、每页条数与「第 x / y 页」。
 * 纯展示组件，不做数据获取，页码变更由调用方驱动。
 */
export function PaginationBar({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100, 200],
  disabled = false,
  className = "",
}: PaginationBarProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);
  const atStart = safePage <= 1 || disabled;
  const atEnd = safePage >= safeTotalPages || disabled;

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {onPageSizeChange && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>每页</span>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))} disabled={disabled}>
            <SelectTrigger size="sm" className="h-8 w-[84px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size} 条
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 disabled:opacity-40" disabled={atStart} onClick={() => onPageChange(1)} title="第一页">
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 disabled:opacity-40" disabled={atStart} onClick={() => onPageChange(Math.max(1, safePage - 1))} title="上一页">
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {buildPageList(safePage, safeTotalPages).map((entry, index) =>
          entry === "..." ? (
            <span key={`ellipsis-${index}`} className="px-1 text-xs text-slate-400">
              …
            </span>
          ) : (
            <Button
              key={entry}
              variant={entry === safePage ? "default" : "ghost"}
              size="sm"
              className={entry === safePage ? "h-8 w-8 p-0 text-xs font-semibold" : "h-8 w-8 p-0 text-xs text-slate-600 hover:text-slate-900"}
              onClick={() => onPageChange(entry)}
              disabled={disabled}
              aria-current={entry === safePage ? "page" : undefined}
            >
              {entry}
            </Button>
          ),
        )}

        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 disabled:opacity-40" disabled={atEnd} onClick={() => onPageChange(Math.min(safeTotalPages, safePage + 1))} title="下一页">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 disabled:opacity-40" disabled={atEnd} onClick={() => onPageChange(safeTotalPages)} title="最后一页">
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>

      <span className="whitespace-nowrap text-xs text-slate-500">
        第 {safePage} / {safeTotalPages} 页
      </span>
    </div>
  );
}
