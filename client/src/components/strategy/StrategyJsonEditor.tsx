/**
 * StrategyJsonEditor — JSON 高级模式（任务 §3.7）。
 *
 * 保留原 JSON 编辑能力，服务开发者 / 高级用户 / Debug / Audit。
 * 展示：StrategyDocument JSON + recordVersion + fingerprint + validation + 原始透传。
 * 校验仍走后端 `research.strategy.validate`（权威），前端不重算 fingerprint。
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard, TechnicalDetails } from "@/components/common";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2,
  Loader2,
  ScrollText,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

function parseJson(
  text: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function StrategyJsonEditor({
  text,
  onTextChange,
  onResult,
}: {
  text: string;
  onTextChange: (t: string) => void;
  /** 把校验结果冒泡给页面（用于 Header 状态提示）。 */
  onResult?: (valid: boolean | null) => void;
}) {
  const validate = trpc.research.strategy.validate.useMutation();

  const parsed = useMemo(() => parseJson(text), [text]);
  const doc = parsed.ok && isRecord(parsed.value) ? parsed.value : null;
  const recordVersion = doc?.recordVersion;
  const fingerprint =
    typeof doc?.fingerprint === "string" ? doc.fingerprint : null;

  function run() {
    if (!parsed.ok) {
      onResult?.(null);
      return;
    }
    validate.mutate(
      { document: parsed.value as Record<string, unknown> },
      { onSuccess: r => onResult?.(r.valid) }
    );
  }

  return (
    <SectionCard
      title="JSON 高级模式"
      description="透传完整 StrategyDocument；fingerprint 为占位，真实指纹由后端序列化重算"
      icon={ScrollText}
      right={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onTextChange("")}>
            清空
          </Button>
          <Button size="sm" onClick={run} disabled={validate.isPending}>
            {validate.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            校验文档
          </Button>
        </div>
      }
    >
      <Textarea
        value={text}
        onChange={e => onTextChange(e.target.value)}
        spellCheck={false}
        className="min-h-[420px] font-mono text-[11px] leading-5"
        placeholder="粘贴 StrategyDocument JSON…"
      />

      {parsed.ok === false && text.trim().length > 0 && (
        <Alert variant="destructive" className="mt-3">
          <XCircle className="h-4 w-4" />
          <AlertTitle>JSON 解析失败</AlertTitle>
          <AlertDescription className="font-mono text-xs">
            {parsed.error}
          </AlertDescription>
        </Alert>
      )}

      {validate.error && (
        <Alert variant="destructive" className="mt-3">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>校验请求失败</AlertTitle>
          <AlertDescription className="font-mono text-xs">
            {validate.error.message}
          </AlertDescription>
        </Alert>
      )}

      {validate.data && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            {validate.data.valid ? (
              <Badge
                variant="outline"
                className="border-emerald-300 bg-emerald-100 font-mono text-emerald-700"
              >
                VALID · 通过
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-red-300 bg-red-100 font-mono text-red-700"
              >
                INVALID · {validate.data.issues.length} 项问题
              </Badge>
            )}
            {validate.data.valid && (
              <span className="flex items-center gap-1 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> 结构 + 语义校验通过
              </span>
            )}
          </div>

          {!validate.data.valid && (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-56 text-xs">code</TableHead>
                    <TableHead className="w-56 text-xs">path</TableHead>
                    <TableHead className="text-xs">message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validate.data.issues.map((issue, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-[11px] text-red-700">
                        {issue.code}
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {issue.path}
                      </TableCell>
                      <TableCell className="text-xs">{issue.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {doc && (
        <TechnicalDetails
          className="mt-3"
          title="技术详情（recordVersion / fingerprint / 原始透传）"
        >
          <div className="space-y-1 font-mono text-[11px]">
            <p>
              <span className="text-muted-foreground">recordKind:</span>{" "}
              {String(doc.recordKind ?? "—")}
            </p>
            <p>
              <span className="text-muted-foreground">recordVersion:</span>{" "}
              {String(recordVersion ?? "—")}
            </p>
            <p className="break-all">
              <span className="text-muted-foreground">
                fingerprint（占位）:
              </span>{" "}
              {fingerprint ?? "—"}
            </p>
          </div>
        </TechnicalDetails>
      )}
    </SectionCard>
  );
}
