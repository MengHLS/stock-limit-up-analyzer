/**
 * DatasetCertifyPanel — Research Dataset 认证 + 持久化（STEP DS-V2）。
 *
 * CONFIGURE → VALIDATE → PREVIEW → CERTIFY → CREATE IMMUTABLE VERSION。
 * 认证结果（CERTIFIED / CONDITIONAL / REJECTED）+ 指纹 + datasetId 均来自后端。
 */

import { trpc } from "@/lib/trpc";
import { SectionCard, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  configToBuildInput,
  type DatasetConfigViewModel,
} from "@/adapters/datasetAdapter";

export function DatasetCertifyPanel({ config }: { config: DatasetConfigViewModel }) {
  const certify = trpc.researchDataset.certify.useMutation();
  const list = trpc.researchDataset.list.useQuery();
  const [requiresIndustry, setRequiresIndustry] = useState(false);
  const [requiresLiquidity, setRequiresLiquidity] = useState(false);
  const [requiresCA, setRequiresCA] = useState(false);

  return (
    <SectionCard
      title="认证与正式版本"
      icon={ShieldCheck}
      description="完整构建 + 能力探测 + 认证 + 持久化（幂等）；gate / 认证 / 指纹均来自后端。"
      contentClassName="space-y-3"
    >
      <div className="space-y-1.5 rounded-md border p-3">
        <p className="text-xs font-medium">研究依赖声明（可选域）</p>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="req-industry"
              checked={requiresIndustry}
              onCheckedChange={(v) => setRequiresIndustry(v === true)}
            />
            <Label htmlFor="req-industry" className="text-xs">
              历史行业
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="req-liquidity"
              checked={requiresLiquidity}
              onCheckedChange={(v) => setRequiresLiquidity(v === true)}
            />
            <Label htmlFor="req-liquidity" className="text-xs">
              流动性/市值
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="req-ca"
              checked={requiresCA}
              onCheckedChange={(v) => setRequiresCA(v === true)}
            />
            <Label htmlFor="req-ca" className="text-xs">
              公司行为
            </Label>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          勾选后若对应历史数据 PIT 不完整，认证将降级为 CONDITIONAL（不伪造 CERTIFIED）。
        </p>
      </div>

      <Button
        className="w-full"
        disabled={certify.isPending}
        onClick={() =>
          certify.mutate({
            ...configToBuildInput(config),
            requirements: {
              ...(requiresIndustry ? { industry: true } : {}),
              ...(requiresLiquidity ? { liquidity: true } : {}),
              ...(requiresCA ? { corporateActions: true } : {}),
            },
          })
        }
      >
        {certify.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {certify.isPending ? "认证中…（完整构建，DB 繁忙时较久）" : "创建正式版本（Certify）"}
      </Button>

      {certify.error && (
        <p className="text-xs text-red-600">认证失败：{certify.error.message}</p>
      )}

      {certify.data && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">认证状态</span>
            <StatusBadge status={certify.data.certification.status} />
          </div>
          <div className="space-y-1 font-mono text-[11px]">
            <p>datasetId: {certify.data.datasetId}</p>
            <p>datasetVersion: {certify.data.datasetVersion}</p>
            <p>rowCount: {certify.data.rowCount}</p>
            <p>gate: {certify.data.gate}</p>
            <p>rowsFingerprint: {certify.data.fingerprints.rowsFingerprint}</p>
            <p>policySetFingerprint: {certify.data.fingerprints.policySetFingerprint}</p>
            <p>versionSnapshotFingerprint: {certify.data.fingerprints.versionSnapshotFingerprint}</p>
            {certify.data.replayed && <p className="text-amber-600">（幂等回放：该版本已存在）</p>}
          </div>
          {certify.data.certification.reasons.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-amber-700">
              {certify.data.certification.reasons.map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium">已持久化数据集（最近 {list.data?.length ?? 0} 条）</p>
        {list.isPending && <p className="text-xs text-muted-foreground">加载中…</p>}
        {list.data && list.data.length === 0 && (
          <p className="text-xs text-muted-foreground">暂无。</p>
        )}
        {list.data && list.data.length > 0 && (
          <ul className="space-y-1 font-mono text-[11px]">
            {list.data.map((d) => (
              <li key={d.datasetId} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {d.name} · {d.startDate}~{d.endDate} · {d.rowCount} 行
                </span>
                <span className="shrink-0 text-muted-foreground">{d.gate}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
