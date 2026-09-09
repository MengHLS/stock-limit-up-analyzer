/**
 * DatasetPreviewPanel — Research Dataset 预览（STEP DS-V2）。
 *
 * 配置后先预览再构建：元数据 + 内存 universe 决议的诚实摘要。
 * 状态/计数均来自后端 `researchDataset.preview`，前端不重算。
 */

import { trpc } from "@/lib/trpc";
import { SectionCard, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Eye, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  configToPreviewInput,
  type DatasetConfigViewModel,
} from "@/adapters/datasetAdapter";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

export function DatasetPreviewPanel({ config }: { config: DatasetConfigViewModel }) {
  const preview = trpc.researchDataset.preview.useMutation();
  const [triggered, setTriggered] = useState(false);

  const data = preview.data;

  return (
    <SectionCard
      title="预览（配置后、构建前）"
      icon={Eye}
      description="元数据 + 内存决议，不构建全量、不回传 rows；窗口超限时诚实标记 truncated。"
      right={
        <Button
          size="sm"
          variant="outline"
          disabled={preview.isPending}
          onClick={() => {
            setTriggered(true);
            preview.mutate(configToPreviewInput(config));
          }}
        >
          {preview.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          预览
        </Button>
      }
    >
      {!triggered && !preview.isPending && (
        <p className="text-xs text-muted-foreground">点击「预览」查看窗口 / universe / 覆盖摘要。</p>
      )}
      {preview.isPending && (
        <p className="text-xs text-muted-foreground">正在决议 universe（内存内，不扫 OHLCV 明细）…</p>
      )}
      {preview.error && (
        <p className="text-xs text-red-600">预览失败：{preview.error.message}</p>
      )}
      {data && (
        <div className="space-y-3">
          <div className="rounded-md bg-muted/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">verdict</span>
              <StatusBadge status={data.verdict} />
            </div>
            <div className="space-y-1">
              <Field label="窗口" value={`${data.dateRange.startDate} ~ ${data.dateRange.endDate}`} />
              <Field label="交易日" value={`${data.tradingDays}${data.truncated ? `（截断，共 ${data.totalTradingDays}）` : ""}`} />
              <Field
                label="证券 / 退市"
                value={`${data.universe.totalSecurities} / ${data.universe.delistedSecurities}`}
              />
              <Field label="日均成员" value={data.universe.avgMembersPerDay.toFixed(0)} />
              <Field label="预估行数" value={data.universe.estimatedBarCount.toLocaleString()} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {data.universeFilter.note}
          </p>
          <div className="space-y-1.5">
            <Field label="PIT" value={data.pit.safe ? "逐日 PIT（安全）" : "固定快照（NON_RESEARCH_SAFE）"} />
            <Field label="Survivorship" value={data.survivorship.safe ? "安全" : "不安全"} />
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">行业</span>
              <StatusBadge status={data.industry.status} label={data.industry.status} />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">流动性</span>
              <StatusBadge status={data.liquidity.status} label={data.liquidity.status} />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">公司行为</span>
              <StatusBadge status={data.corporateAction.status} label={data.corporateAction.status} />
            </div>
          </div>
          {data.verdictNotes.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-amber-700">
              {data.verdictNotes.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}
