/**
 * VariableCatalogCard — 当前 Dataset 版本**真实可用**的变量目录。
 *
 * 存在的意义是「先看有什么，再设计分析」：
 *   - 变量由后端按 Dataset 的真实视界推导（`listVariables`），前端不硬编码任何清单；
 *   - 不可用维度**显式列出并给出原因**（如 `regime` 需要接入 RegimeTagProvider），
 *     而不是悄悄从下拉框里消失；
 *   - 只展示「名字 + 中文标签」，不臆造缺失率/覆盖率等统计（这些需要在研究里真算）。
 */

import { Braces, Info } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/common";
import { rpcErrorToDiagnostic, variableLabelOf } from "@/adapters/researchEngineAdapter";

export function VariableCatalogCard({ datasetVersionId }: { datasetVersionId: number }) {
  const variables = trpc.researchEngine.listVariables.useQuery(
    { datasetVersionId },
    { enabled: datasetVersionId > 0 },
  );

  if (variables.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (variables.error) {
    return (
      <ErrorState
        error={rpcErrorToDiagnostic(variables.error.message, { title: "变量目录加载失败" })}
      />
    );
  }

  const data = variables.data;
  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Braces className="h-4 w-4" /> 可用变量目录
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs font-medium">
            特征变量 <span className="text-muted-foreground">（T 日及之前可观测，PIT 安全）</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.features.map((f) => (
              <Badge key={f} variant="outline" className="gap-1 font-normal">
                <span>{variableLabelOf(f)}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{f}</span>
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium">
            结果变量 <span className="text-muted-foreground">（T+1 之后）</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.outcomes.map((o) => (
              <Badge key={o} variant="outline" className="gap-1 font-normal">
                <span>{variableLabelOf(o)}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{o}</span>
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium">分组维度</p>
          <div className="flex flex-wrap gap-1.5">
            {data.dimensions.map((d) => (
              <Badge key={d} variant="outline" className="font-mono font-normal">
                {d}
              </Badge>
            ))}
          </div>
          {(data.unavailableDimensions ?? []).map((u) => (
            <p key={u.key} className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <span className="font-mono">{u.key}</span> 不可用：{u.reason}
              </span>
            </p>
          ))}
        </div>

        {data.datasetVersion && (
          <p className="border-t pt-2 text-[11px] text-muted-foreground">
            Dataset 版本 <span className="font-mono">{data.datasetVersion.versionLabel}</span> ·{" "}
            {data.datasetVersion.startDate ?? "—"} ~ {data.datasetVersion.endDate ?? "—"} ·{" "}
            {data.datasetVersion.totalEvents !== null
              ? `${data.datasetVersion.totalEvents.toLocaleString("en-US")} 个事件`
              : "事件数未知"}{" "}
            ·{" "}
            {data.datasetVersion.pathRelativeDayRange
              ? `路径相对日 ${data.datasetVersion.pathRelativeDayRange.min}~${data.datasetVersion.pathRelativeDayRange.max}`
              : "无路径数据"}{" "}
            · outcome 视界{" "}
            <span className="font-mono">
              {data.datasetVersion.horizons.length > 0 ? data.datasetVersion.horizons.join("/") : "无"}
            </span>
            。变量按 Dataset 的真实视界推导，不会为不存在的视界发明变量。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
