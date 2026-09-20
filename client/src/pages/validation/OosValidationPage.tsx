/**
 * OOS 验证域页面（FRONTEND-FINAL-001 · P0-1 / §3.3 / P1-6）。
 *
 * ## 审计背景（为什么需要这一页）
 *
 * 审计确认：OOS-001 的完整 UI **只**作为 `/parameter-search` 的第 3 块存在，
 * 全仓**没有** `/oos` 路由 ⇒ 持久化样本外验证没有属于自己的可达入口。
 * 本页把它提升为正式路由，并支持路径深链：
 *
 * | 路由 | 形态 |
 * |---|---|
 * | `/validation/oos` | 列表（含创建入口） |
 * | `/validation/oos/:runId` | 直接展开指定 Run 的详情（刷新 / 分享可恢复） |
 *
 * 🔴 正式口径 = **持久化** `paramSearch.*OosRun`（落 `oos_validation_run` / `oos_validation_result`）。
 *    本页**不调用** `walkForward.*` 那套内存态技术预览端点。
 */

import { FlaskConical } from "lucide-react";
import { useParams } from "wouter";
import OosValidationPanel from "@/components/oos/OosValidationPanel";
import { PageHeader } from "@/components/common";

export default function OosValidationPage() {
  const params = useParams<{ runId?: string }>();
  const routeRunId = params.runId === undefined || params.runId === "" ? null : params.runId;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FlaskConical}
        title="样本外验证（OOS）"
        description="冻结候选参数 → 在与搜索窗口不重叠的数据上真实重跑 → 样本内（IS）× 样本外（OOS）逐项对照。数值全部来自后端 paramSearch.*OosRun，本页不计算、不伪造。"
        breadcrumb={[
          { label: "验证", href: "/validation/oos" },
          { label: "OOS", href: "/validation/oos" },
          ...(routeRunId === null ? [] : [{ label: routeRunId }]),
        ]}
      />
      <OosValidationPanel basePath="/validation/oos" pathStyle routeRunId={routeRunId} />
    </div>
  );
}
