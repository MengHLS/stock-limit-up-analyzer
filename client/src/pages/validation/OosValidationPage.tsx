
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
