
import { FlaskConical, Layers, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { PageHeader, SectionCard } from "@/components/common";
import { Button } from "@/components/ui/button";

const ENTRIES = [
  {
    href: "/validation/robustness",
    icon: ShieldCheck,
    title: "稳健性分析",
    description: "在已冻结的搜索快照上做邻域稳定性、单参数敏感性、二维稳定性矩阵。**零重跑**。",
  },
  {
    href: "/validation/oos",
    icon: FlaskConical,
    title: "样本外验证（OOS）",
    description: "冻结候选参数 → 在与搜索窗口不重叠的数据上**真实重跑** → 样本内（IS）× 样本外（OOS）逐项对照。",
  },
  {
    href: "/validation/walk-forward",
    icon: Layers,
    title: "Walk-Forward 验证",
    description: "把「搜索 → 冻结候选 → 样本外」按时间滚动重复 N 次；每个 Fold 独立搜索、独立样本外，最后只做描述性汇总。",
  },
] as const;

export default function ValidationIndexPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        icon={ShieldCheck}
        title="验证"
        description="策略在进入模拟交易之前的三道验证关口。三块能力全部走持久化端点（paramSearch.*），每次运行都留档、可深链、可追溯。"
        breadcrumb={[{ label: "验证" }]}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        {ENTRIES.map((entry) => (
          <SectionCard
            key={entry.href}
            title={entry.title}
            icon={entry.icon}
            right={
              <Button asChild size="sm" variant="outline">
                <Link href={entry.href}>进入</Link>
              </Button>
            }
          >
            <p className="text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
          </SectionCard>
        ))}
      </div>

      <SectionCard title="口径提示（重要）">
        <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
          <li>
            本域**不使用**内存态技术预览端点（`walkForward.describe/run/oos/overfit`）。
            正式口径一律是 `paramSearch.*` 的持久化 Run。
          </li>
          <li>
            样本内（IS）数据参与参数选择，样本外（OOS）数据**不参与** —— 页面上会用独立标签与配色区分，
            避免把 OOS 误读成「又一次样本内回测」。
          </li>
          <li>所有指标均来自后端 canonical 读数，前端不重算、不修补、不编造。</li>
        </ul>
      </SectionCard>
    </div>
  );
}
