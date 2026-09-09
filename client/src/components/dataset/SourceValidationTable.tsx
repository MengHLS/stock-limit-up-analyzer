/**
 * SourceValidationTable — 数据源校验（任务 §6.2）。
 *
 * 明确展示每个数据源的：状态 / 加载行数 / 覆盖证券 / 日期覆盖。
 * 强调「source rows ≠ final dataset rows」——此表只展示原始加载事实。
 */

import { SectionCard, StatusBadge, DataTable } from "@/components/common";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Database } from "lucide-react";
import type { SourceDomainViewModel } from "@/adapters/buildResultAdapter";

function fmt(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

export function SourceValidationTable({
  domains,
}: {
  domains: SourceDomainViewModel[];
}) {
  return (
    <SectionCard
      title="Source Validation"
      icon={Database}
      description="各数据源原始加载事实（source rows）；不等于最终 Dataset Rows"
    >
      <DataTable>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">数据源</TableHead>
            <TableHead className="w-24 text-xs">状态</TableHead>
            <TableHead className="text-right text-xs">加载行数</TableHead>
            <TableHead className="text-right text-xs">覆盖证券</TableHead>
            <TableHead className="text-right text-xs">日期覆盖</TableHead>
            <TableHead className="text-xs">说明</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {domains.map(d => (
            <TableRow key={d.domain}>
              <TableCell className="font-mono text-xs">{d.domain}</TableCell>
              <TableCell>
                <StatusBadge status={d.status} />
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {fmt(d.rowsLoaded)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {fmt(d.securitiesCovered)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {fmt(d.datesCovered)} / {fmt(d.datesExpected)}
              </TableCell>
              <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                {d.note}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
    </SectionCard>
  );
}
