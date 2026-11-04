/**
 * Walk-Forward 验证域页面（FRONTEND-FINAL-001 · P0-1 / §3.4 / P1-6）。
 *
 * ## 审计背景（为什么需要这一页）
 *
 * 审计确认存在**两套并行**的 Walk-Forward：
 *
 * | 口径 | 入口 | 后端 | 是否落库 |
 * |---|---|---|---|
 * | A（技术预览） | `/walk-forward` | `walkForward.*`（`server/walkForwardRouter.ts`） | **否**（返回内存态 `windows`） |
 * | B（正式持久化） | 之前只有 `/parameter-search` 页内第 4 块 | `paramSearch.*WalkForwardRun` | **是**（`walk_forward_run` / `walk_forward_fold`） |
 *
 * 本页把 **B** 提升为正式路由（规格 §3.1 允许使用 `/walk-forward` 形态之外的自有前缀），
 * 形成唯一正式入口；A 保留代码但**从正式导航移除**（见 `WalkForwardAnalysis.tsx` 顶部说明）。
 *
 * | 路由 | 形态 |
 * |---|---|
 * | `/validation/walk-forward` | Run 列表（含创建入口） |
 * | `/validation/walk-forward/:runId` | 指定 Run 的编排详情（窗口契约 / Fold 矩阵 / 聚合） |
 * | `/validation/walk-forward/:runId/folds/:foldIndex` | 直接展开某个 Fold 的详情 |
 *
 * 🔴 本页**只**调用 `paramSearch.list/get/create/start/cancelWalkForwardRun`，
 *    不调用 `walkForward.describe/run/oos/overfit`。
 */

import { Layers } from "lucide-react";
import { useParams } from "wouter";
import WalkForwardPanel from "@/components/walkForward/WalkForwardPanel";
import { PageHeader } from "@/components/common";

export default function WalkForwardValidationPage() {
  const params = useParams<{ runId?: string; foldIndex?: string }>();
  const routeRunId = params.runId === undefined || params.runId === "" ? null : params.runId;
  const parsedFold = params.foldIndex === undefined ? Number.NaN : Number(params.foldIndex);
  const routeFoldIndex = Number.isInteger(parsedFold) && parsedFold >= 0 ? parsedFold : null;

  const breadcrumb = [
    { label: "验证", href: "/validation/walk-forward" },
    { label: "Walk-Forward", href: "/validation/walk-forward" },
    ...(routeRunId === null ? [] : [{ label: routeRunId }]),
    ...(routeFoldIndex === null ? [] : [{ label: `Fold ${String(routeFoldIndex)}` }]),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Layers}
        title="Walk-Forward 验证"
        description="把「搜索 → 冻结候选 → 样本外」按时间滚动重复 N 次：每个 Fold 各自独立搜索、各自独立样本外，最后只做描述性汇总。编排层不新增任何引擎（搜索走 PARAMETER-001、样本外走 OOS-001）。"
        breadcrumb={breadcrumb}
      />
      <WalkForwardPanel
        basePath="/validation/walk-forward"
        pathStyle
        routeRunId={routeRunId}
        routeFoldIndex={routeFoldIndex}
      />
    </div>
  );
}
