/**
 * 研究入口 —— 观察类页面 → 独立研究实验。
 *
 * 定位（PD-01 / `docs/product/SPEC-002-PD01-observation-to-experiment.md`）：
 *   ②观察 → ③研究实验之间**唯一**的跳转入口，5 个观察页复用同一个组件。
 *
 * 🔴 两条硬约束（不要把文案改成「已对齐数据版本」）：
 *   1. 观察页是 **dataset-unaware** —— 它们读 legacy 表（`limit_up_records` 等），
 *      **不存在** `datasetVersionId` 这个坐标可携带 ⇒ 本入口**不携带任何数据集参数**；
 *   2. 副文案必须显式说明「需在实验中选择 Dataset 版本」，否则用户会误以为
 *      观察页的水位已经与某个数据集版本对齐。
 *
 * 决策依据：`docs/product/PRODUCT-DECISIONS-001.md` PD-01（含前提修正）。
 */

import { Link } from "wouter";
import { Beaker } from "lucide-react";
import { cn } from "@/lib/utils";

/** 唯一跳转目标：研究实验列表（不带 query string）。 */
const ENTRY_HREF = "/research-experiments";

/** 强制副文案（组件内固定，**不允许**调用方覆盖）。 */
const ENTRY_SUBTEXT = "需在实验中选择 Dataset 版本 —— 观察页与数据集版本不是同一坐标系";

export interface ResearchEntryLinkProps {
  /** `inline` = 头部行内次级入口；`block` = 页面顶部提示条（无统一头部的页面用）。 */
  readonly variant?: "inline" | "block";
  readonly className?: string;
}

export function ResearchEntryLink({ variant = "inline", className }: ResearchEntryLinkProps) {
  if (variant === "block") {
    return (
      <div
        className={cn(
          "mb-3 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground",
          className,
        )}
      >
        <Link
          href={ENTRY_HREF}
          className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-2 hover:underline"
        >
          <Beaker className="h-3.5 w-3.5" />
          以此为起点做实验
        </Link>
        <span className="ml-2">{ENTRY_SUBTEXT}</span>
      </div>
    );
  }

  return (
    <Link
      href={ENTRY_HREF}
      title={ENTRY_SUBTEXT}
      aria-label={`做实验的研究入口。${ENTRY_SUBTEXT}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Beaker className="h-3.5 w-3.5" />
      做实验
      {/* 可见文案之外的完整说明：保证「需在实验中选择 Dataset 版本」始终在 DOM 文本中 */}
      <span className="sr-only">（{ENTRY_SUBTEXT}）</span>
    </Link>
  );
}