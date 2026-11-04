/**
 * 验证「是否重跑回测」徽章（PD-04 / `docs/product/FE-PLAN-001-PD04-validation-input-source.md` D5）。
 *
 * 🔴 三块验证的语义差异**必须视觉可见**，否则用户会把「零重跑」的邻域分析
 *    与「真重跑」的样本外验证当成同一强度的证据。
 *    决策依据：`docs/product/SPEC-001-PD04-validation-input-source.md` 规则 4 / 5。
 */

import { cn } from "@/lib/utils";

export type RerunKind = "NO_RERUN" | "RERUN" | "PER_FOLD_RERUN";

const SPEC: Record<RerunKind, { readonly label: string; readonly className: string; readonly title: string }> = {
  NO_RERUN: {
    label: "零重跑",
    className: "border-slate-300 bg-slate-50 text-slate-600",
    title: "在已冻结的搜索快照上做邻域 / 敏感性分析，不重新执行回测。",
  },
  RERUN: {
    label: "真重跑",
    className: "border-amber-300 bg-amber-50 text-amber-700",
    title: "在样本外窗口上真实重跑并重算 canonical 指标。",
  },
  PER_FOLD_RERUN: {
    label: "每 Fold 真重跑",
    className: "border-amber-400 bg-amber-100 text-amber-800",
    title: "每个 Fold 独立搜索 → 冻结 → 在其紧邻样本外窗口真重跑。",
  },
};

export interface RerunBadgeProps {
  readonly kind: RerunKind;
  readonly className?: string;
}

export function RerunBadge({ kind, className }: RerunBadgeProps) {
  const spec = SPEC[kind];
  return (
    <span
      data-rerun-kind={kind}
      title={spec.title}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        spec.className,
        className,
      )}
    >
      {spec.label}
    </span>
  );
}