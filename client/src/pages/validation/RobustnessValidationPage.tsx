/**
 * 稳健性验证域页面（FRONTEND-FINAL-001 · P0-1 / §十二）。
 *
 * 与 OOS / Walk-Forward 的语义关系（**必须分清，否则会误判结果**）：
 *
 * | 面板 | 做什么 | 是否重跑回测 |
 * |---|---|---|
 * | 稳健性（本页） | 在**已冻结**的搜索快照上做邻域稳定性 / 单参数敏感性 / 二维矩阵 | **零重跑** |
 * | OOS `/validation/oos` | 在与搜索窗口**不重叠**的数据上真实重跑并重算 canonical 指标 | 真重跑 |
 * | Walk-Forward `/validation/walk-forward` | 把「搜索 → 冻结 → 样本外」按时间滚动重复 N 次 | 每 Fold 真重跑 |
 *
 * | 路由 | 形态 |
 * |---|---|
 * | `/validation/robustness` | Run 列表（含创建入口） |
 * | `/validation/robustness/:runId` | 指定 Run 的参数分析 / 稳定性矩阵详情 |
 */

import { ShieldCheck } from "lucide-react";
import { useParams } from "wouter";
import SearchRobustnessPanel from "@/components/robustness/SearchRobustnessPanel";
import { PageHeader } from "@/components/common";

export default function RobustnessValidationPage() {
  const params = useParams<{ runId?: string }>();
  const routeRunId = params.runId === undefined || params.runId === "" ? null : params.runId;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ShieldCheck}
        title="稳健性分析"
        description="消费已完成的参数搜索：邻域稳定性（零重跑）、单参数敏感性、二维稳定性矩阵。数值全部来自后端 paramSearch.*RobustnessRun，本页不计算、不伪造。"
        breadcrumb={[
          { label: "验证", href: "/validation/robustness" },
          { label: "稳健性", href: "/validation/robustness" },
          ...(routeRunId === null ? [] : [{ label: routeRunId }]),
        ]}
      />
      <SearchRobustnessPanel basePath="/validation/robustness" pathStyle routeRunId={routeRunId} />
    </div>
  );
}
