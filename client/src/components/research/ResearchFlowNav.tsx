/**
 * 研究闭环六阶段入口带（FLOW-001 §4 备注 · HOME_ENTRY）。
 *
 * 定位：让首页第一屏就回答「这个平台是一条流水线，我现在在哪、下一步去哪」。
 * 分组口径与侧栏 `AppShell#navGroups` **逐条一致**（数据 → 观察 → 研究 → 策略 → 验证 → 前向与复盘），
 * 每步跳到该阶段的**首个入口页**。
 *
 * 🔴 纪律：
 *   - **纯导航**：不取数、不计算、不缓存，也不改变任何下游页面行为；
 *   - 各步的 href 必须与侧栏该组第一项一致（结构锁见
 *     `tests/client/src/pages/pageFlowContracts.test.ts` §20）。
 */

import { Link } from "wouter";
import {
  Beaker,
  ClipboardList,
  Database,
  Flame,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ResearchStageKey =
  | "DATA"
  | "OBSERVE"
  | "RESEARCH"
  | "STRATEGY"
  | "VALIDATION"
  | "FORWARD";

interface StageSpec {
  readonly key: ResearchStageKey;
  readonly label: string;
  readonly href: string;
  readonly hint: string;
  readonly icon: LucideIcon;
}

/** 与 `AppShell#navGroups` 的分组顺序 / 首个入口页**逐条对齐**。 */
export const RESEARCH_STAGES: readonly StageSpec[] = [
  { key: "DATA", label: "① 数据", href: "/data-health", hint: "数据可用性 · 数据集版本", icon: Database },
  { key: "OBSERVE", label: "② 观察", href: "/limit-up", hint: "复盘 · 情绪 · 龙头候选", icon: Flame },
  { key: "RESEARCH", label: "③ 研究", href: "/research-experiments", hint: "实验 → Run → 候选", icon: Beaker },
  { key: "STRATEGY", label: "④ 策略", href: "/strategies", hint: "版本 · 参数搜索 · 回测留档", icon: ClipboardList },
  { key: "VALIDATION", label: "⑤ 验证", href: "/validation", hint: "稳健性 · OOS · Walk-Forward", icon: ShieldCheck },
  { key: "FORWARD", label: "⑥ 前向与复盘", href: "/paper-trading", hint: "纸面交易 · 复盘工作台", icon: TrendingUp },
] as const;

export interface ResearchFlowNavProps {
  /** 高亮当前所处阶段（首页本身属于「② 观察」）。 */
  readonly current?: ResearchStageKey;
  readonly className?: string;
}

export function ResearchFlowNav({ current, className }: ResearchFlowNavProps) {
  return (
    <nav
      aria-label="研究闭环六阶段"
      data-research-flow-nav="true"
      className={cn("rounded-xl border border-border bg-muted/20 p-3", className)}
    >
      <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground">
        研究闭环 · 六阶段
      </p>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {RESEARCH_STAGES.map((stage) => {
          const Icon = stage.icon;
          const isCurrent = stage.key === current;
          return (
            <li key={stage.key}>
              <Link
                href={stage.href}
                aria-current={isCurrent ? "step" : undefined}
                data-research-stage={stage.key}
                className={cn(
                  "flex h-full flex-col gap-1 rounded-lg border bg-background px-2.5 py-2 transition-colors",
                  isCurrent
                    ? "border-orange-300 ring-1 ring-orange-200"
                    : "border-border hover:border-foreground/30 hover:bg-muted/40",
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {stage.label}
                  {isCurrent && <span className="text-[10px] font-normal text-orange-600">当前</span>}
                </span>
                <span className="text-[11px] leading-4 text-muted-foreground">{stage.hint}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      {/* FLOW-001 §3 ⑥→②：阶段不是直线，最后一棒要回到② —— 不写出来「闭环」就只是标题里的一个词 */}
      <p className="mt-2 text-[11px] text-muted-foreground" data-research-flow-loop="true">
        ↻ 闭环：⑥ 前向与复盘的发现 → 回到 ② 观察，形成新的研究问题。
      </p>
    </nav>
  );
}