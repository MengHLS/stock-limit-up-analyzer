/**
 * BuildDiagnostics — 构建诊断（任务 §8 / §11）。
 *
 * 把 INCONCLUSIVE / FAILED 状态产品化：状态码 + 用户解释 + 建议 + 技术详情，
 * 并提供「诊断明细」——每个失败/告警步骤的输入/输出/说明/相关配置。
 */

import {
  ErrorState,
  SectionCard,
  StatusBadge,
  type DiagnosticError,
} from "@/components/common";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Stethoscope } from "lucide-react";
import type { BuildResultViewModel } from "@/adapters/buildResultAdapter";

const REASON_META: Record<
  string,
  { title: string; explanation: string; suggestions: string[] }
> = {
  NO_ROWS_BUILT: {
    title: "Dataset 未生成",
    explanation:
      "当前时间范围内没有生成最终 Dataset Rows。原始数据源加载正常，但经过 Universe / PIT / Calendar / 其他约束后没有产生最终研究数据。",
    suggestions: [
      "检查时间范围（是否落在交易日历之外）",
      "检查 Universe（Master / Status 是否覆盖该窗口）",
      "检查 PIT 口径（逐日 PIT vs 固定 asOf）",
      "检查 DATA_READY（dataReady=false 仅冒烟口径）",
      "查看 Build Pipeline 定位失败步骤",
    ],
  },
  DB_UNAVAILABLE: {
    title: "数据库不可用",
    explanation:
      "后端无法访问数据库或无交易日历（index_daily 为空），无法构建数据集。",
    suggestions: [
      "确认数据库连接可用",
      "确认交易日历（index_daily）已回填",
      "重跑 certify 脚本后重试",
    ],
  },
  DATA_NOT_READY: {
    title: "数据链未就绪",
    explanation:
      "构建以 dataReady=false 冒烟口径运行，gate 至多 INCONCLUSIVE（后端诚实拒绝越级）。",
    suggestions: [
      "在 A~H 全 DATA_READY 后再声明数据链已就绪",
      "勾选「数据链已就绪」后重新构建（若确有覆盖缺口将判 FAIL）",
    ],
  },
  COVERAGE_GAPS: {
    title: "存在覆盖缺口",
    explanation: "部分数据源在窗口内存在日期/证券覆盖缺口。",
    suggestions: [
      "查看 Source Validation 的日期覆盖列",
      "查看覆盖缺口明细",
      "补齐对应域数据后重试",
    ],
  },
};

export function BuildDiagnostics({ vm }: { vm: BuildResultViewModel }) {
  // 仅在有诊断意义时展示（FAIL / INCONCLUSIVE 且有原因）
  if (vm.gate === "PASS") return null;

  const meta = REASON_META[vm.reason ?? ""];
  const error: DiagnosticError = meta
    ? {
        code: vm.reason ?? "INCONCLUSIVE",
        title: meta.title,
        explanation: meta.explanation,
        suggestions: meta.suggestions,
        technical: `gate=${vm.gate} · rowCount=${vm.rowCount} · coverageGaps=[${vm.coverageGaps.join(", ") || "—"}]`,
      }
    : {
        code: "INCONCLUSIVE",
        title: "构建未通过",
        explanation: "构建未通过 gate 判定。",
        technical: `gate=${vm.gate} · rowCount=${vm.rowCount}`,
      };

  // 诊断明细：失败的 pipeline 节点 + 告警的域
  const problemNodes = vm.pipeline.filter(
    n => n.status === "FAILED" || n.status === "WARNING"
  );
  const warningDomains = vm.domains.filter(
    d => d.status === "FAILED" || d.status === "WARNING"
  );

  return (
    <SectionCard
      title="Diagnostics"
      icon={Stethoscope}
      description="失败原因 + 相关配置 + 逐步骤诊断"
    >
      <ErrorState error={error} />

      {problemNodes.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            诊断明细（失败 / 告警步骤）
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 font-medium">步骤</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">输入</th>
                  <th className="px-3 py-2 font-medium">输出</th>
                  <th className="px-3 py-2 font-medium">说明</th>
                </tr>
              </thead>
              <TableBody>
                {problemNodes.map(n => (
                  <TableRow key={n.id}>
                    <TableCell className="font-medium">{n.label}</TableCell>
                    <TableCell>
                      <StatusBadge status={n.status} />
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {n.inputRows === null
                        ? "—"
                        : n.inputRows.toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {n.outputRows === null
                        ? "—"
                        : n.outputRows.toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[300px] text-muted-foreground">
                      {n.detail}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </div>
      )}

      {warningDomains.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            相关数据源
          </p>
          <div className="flex flex-wrap gap-2">
            {warningDomains.map(d => (
              <span
                key={d.domain}
                className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
              >
                <span className="font-mono">{d.domain}</span>
                <StatusBadge status={d.status} className="text-[10px]" />
              </span>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
