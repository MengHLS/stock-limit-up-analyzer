/**
 * MetricCard — 核心指标卡（任务 §16 公共组件，一级信息层）。
 *
 * 用于 Run / Build 结果的业务指标（总收益率、交易次数、rowCount 等）。
 * value 为 ReactNode，可传 number/string/占位「—」；tone 用于涨跌/状态着色。
 */

import { cn } from "@/lib/utils";
import { toneStyle, type StatusTone } from "@/lib/status";

export function MetricCard({
  label,
  value,
  tone,
  hint,
  mono = true,
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: StatusTone;
  hint?: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const textClass = tone ? toneStyle(tone).text : "text-foreground";
  return (
    <div
      className={cn("rounded-xl border bg-card px-4 py-3 shadow-sm", className)}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold leading-tight",
          mono ? "tabular-nums" : "",
          textClass
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
