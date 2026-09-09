/**
 * DatasetDetailViews — 三级详情（任务 §13 三级信息层）。
 *
 * 数据快照 / 9 类口径 / 成员决议的防御性只读渲染。这些字段在 shared 契约为
 * `unknown`（RPC 透传，无第二份口径），故用「防御性取值」渲染，字段缺失即显「—」，
 * 不猜结构、不补全。
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, ShieldAlert } from "lucide-react";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickStr(r: Record<string, unknown>, k: string): string | null {
  const v = r[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickNum(r: Record<string, unknown>, k: string): number | null {
  const v = r[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function Kv({
  k,
  v,
  mono,
  tone,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  tone?: "ok" | "warn" | "bad" | "muted";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-red-700"
          : tone === "muted"
            ? "text-muted-foreground"
            : "";
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-muted-foreground">{k}</span>
      <span
        className={`text-right text-xs font-medium ${toneClass} ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}

/** 机器可读 policy value → 只读 chips。 */
function PolicyValueView({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  if (typeof value === "string" || typeof value === "number") {
    return <span className="font-mono text-[11px]">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return value ? (
      <span className="font-mono text-[11px] text-emerald-700">true</span>
    ) : (
      <span className="font-mono text-[11px] text-red-700">false</span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <Badge key={i} variant="secondary" className="font-mono text-[10px]">
            {String(v)}
          </Badge>
        ))}
      </div>
    );
  }
  if (isRecord(value)) {
    return (
      <div className="flex max-w-[520px] flex-wrap gap-x-3 gap-y-0.5">
        {Object.entries(value).map(([k, v]) => {
          const vs =
            typeof v === "boolean"
              ? v
                ? "✓"
                : "✗"
              : typeof v === "object" && v !== null
                ? JSON.stringify(v)
                : String(v ?? "—");
          return (
            <span key={k} className="text-[11px] leading-5">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono text-foreground">: {vs}</span>
            </span>
          );
        })}
      </div>
    );
  }
  return <span className="font-mono text-[11px]">{JSON.stringify(value)}</span>;
}

export function SnapshotView({ snap }: { snap: unknown }) {
  if (!isRecord(snap)) {
    return (
      <p className="text-xs text-muted-foreground">
        dataSnapshot 结构未知或缺失。
      </p>
    );
  }
  const request = isRecord(snap.request) ? snap.request : null;
  const calendarName = pickStr(snap, "calendarName");
  const calendarFirstDate = pickStr(snap, "calendarFirstDate");
  const calendarLastDate = pickStr(snap, "calendarLastDate");
  const tradingDays = pickNum(snap, "tradingDays");
  const capturedAt = pickStr(snap, "capturedAt");
  const domains = Array.isArray(snap.domains)
    ? (snap.domains as unknown[])
    : [];
  const coverageGaps = Array.isArray(snap.coverageGaps)
    ? (snap.coverageGaps as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          请求（后端规范化后回显）
        </p>
        <Kv
          k="窗口"
          v={`${pickStr(request ?? {}, "startDate") ?? "—"} → ${pickStr(request ?? {}, "endDate") ?? "—"}`}
          mono
        />
        <Kv
          k="PIT 口径"
          v={
            request && pickStr(request, "asOfPerTradeDate") !== null
              ? request.asOfPerTradeDate === true
                ? "逐日 PIT（asOf = tradeDate）"
                : `固定快照 asOf = ${pickStr(request, "asOf") ?? "—"}`
              : "—"
          }
        />
        <Kv
          k="日历"
          v={`${calendarName ?? "—"} · ${calendarFirstDate ?? "—"} ~ ${calendarLastDate ?? "—"}`}
          mono
        />
        <Kv k="窗口交易日" v={tradingDays ?? "—"} mono />
        <Kv
          k="快照时刻"
          v={capturedAt ? new Date(capturedAt).toLocaleString("zh-CN") : "—"}
          mono
        />
      </div>

      {coverageGaps.length > 0 ? (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>覆盖缺口 {coverageGaps.length} 项</AlertTitle>
          <AlertDescription className="space-y-1">
            {coverageGaps.map((g, i) => (
              <p key={i} className="font-mono text-xs">
                {g}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> 无覆盖缺口
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">域</TableHead>
              <TableHead className="text-right text-xs">加载行数</TableHead>
              <TableHead className="text-right text-xs">覆盖证券</TableHead>
              <TableHead className="text-right text-xs">
                交易日（覆盖/期望）
              </TableHead>
              <TableHead className="text-xs">说明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-xs text-muted-foreground"
                >
                  无域快照数据。
                </TableCell>
              </TableRow>
            )}
            {domains.map((d, i) => {
              const r = isRecord(d) ? d : null;
              const note = pickStr(r ?? {}, "note") ?? "—";
              const partial =
                note.includes("部分覆盖") ||
                note.includes("PENDING") ||
                note.includes("未加载") ||
                note.includes("回填中");
              return (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">
                    {pickStr(r ?? {}, "domain") ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {pickNum(r ?? {}, "rowsLoaded") ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {pickNum(r ?? {}, "securitiesCovered") ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {pickNum(r ?? {}, "datesCovered") ?? "—"} /{" "}
                    {pickNum(r ?? {}, "datesExpected") ?? "—"}
                  </TableCell>
                  <TableCell
                    className={`max-w-[300px] text-xs ${partial ? "text-amber-700" : "text-muted-foreground"}`}
                  >
                    {note}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function PolicySetView({ set }: { set: unknown }) {
  if (!Array.isArray(set)) {
    return (
      <p className="text-xs text-muted-foreground">policySet 缺失或非数组。</p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44 text-xs">policyId</TableHead>
            <TableHead className="w-56 text-xs">名称</TableHead>
            <TableHead className="text-xs">声明值（机器可读）</TableHead>
            <TableHead className="w-52 text-xs">证据路径</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {set.map((p, i) => {
            const r = isRecord(p) ? p : null;
            const evidence = Array.isArray(r?.evidence)
              ? (r!.evidence as unknown[]).filter(
                  (x): x is string => typeof x === "string"
                )
              : [];
            return (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">
                  {pickStr(r ?? {}, "policyId") ?? "—"}
                </TableCell>
                <TableCell className="text-xs">
                  <p className="font-medium">
                    {pickStr(r ?? {}, "name") ?? "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {pickStr(r ?? {}, "description") ?? ""}
                  </p>
                </TableCell>
                <TableCell>
                  <PolicyValueView value={r?.value} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {evidence.length === 0 && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    {evidence.map((e, j) => (
                      <Badge
                        key={j}
                        variant="outline"
                        className="font-mono text-[10px] text-muted-foreground"
                      >
                        {e}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function UniverseView({ uni }: { uni: unknown }) {
  if (!isRecord(uni)) {
    return (
      <p className="text-xs text-muted-foreground">
        universeDefinition 缺失或非对象。
      </p>
    );
  }
  const days = Array.isArray(uni.days) ? (uni.days as unknown[]) : [];
  let totalMembers = 0;
  for (const d of days) {
    const r = isRecord(d) ? d : null;
    if (Array.isArray(r?.members))
      totalMembers += (r!.members as unknown[]).length;
  }
  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3">
        <Kv k="规则" v={pickStr(uni, "rule") ?? "—"} />
        <Kv k="PIT 口径" v={pickStr(uni, "asOfDescription") ?? "—"} />
        <Kv k="覆盖交易日" v={days.length} mono />
        <Kv k="成员总数（累计）" v={totalMembers} mono />
      </div>
      <p className="text-[11px] text-muted-foreground">
        members 为 securityId
        列表（用于研究链路消费），此处只展示每日成员数汇总，不逐条回展。
      </p>
      {days.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">交易日</TableHead>
                <TableHead className="text-right text-xs">交易日历</TableHead>
                <TableHead className="text-right text-xs">成员数</TableHead>
                <TableHead className="text-xs">
                  排除统计（reason → 数）
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((d, i) => {
                const r = isRecord(d) ? d : null;
                const isTradingDay = r?.isTradingDay === true;
                const members = Array.isArray(r?.members)
                  ? (r!.members as unknown[]).length
                  : 0;
                const excl = isRecord(r?.excludedByReason)
                  ? (r!.excludedByReason as Record<string, unknown>)
                  : {};
                return (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">
                      {pickStr(r ?? {}, "tradeDate") ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {isTradingDay ? (
                        <span className="text-emerald-700">交易日</span>
                      ) : (
                        <span className="text-muted-foreground">非交易日</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {members}
                    </TableCell>
                    <TableCell>
                      {Object.entries(excl).length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(excl).map(([reason, n]) => (
                            <Badge
                              key={reason}
                              variant="secondary"
                              className="font-mono text-[10px]"
                            >
                              {reason}: {String(n)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
