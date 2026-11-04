
import { AlertTriangle, Info, Workflow } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** `sourceTraceJson.derivation` 的最小结构面（未知字段一律忽略）。 */
interface DerivedRuleView {
  fieldName?: unknown;
  operator?: unknown;
  value?: unknown;
  sourceFindingId?: unknown;
  sourceAnalysisId?: unknown;
  sourceFindingTitle?: unknown;
  sourceFindingType?: unknown;
  researchVariable?: unknown;
  researchCondition?: unknown;
  semanticId?: unknown;
  sourcePatternId?: unknown;
  comparison?: unknown;
  thresholdParam?: unknown;
  directionMismatch?: unknown;
  directionNote?: unknown;
  noteAboutResearchDifference?: unknown;
  effectExcessReturn?: unknown;
  effectSampleCount?: unknown;
}

interface SkippedView {
  reason?: unknown;
  researchVariable?: unknown;
  detail?: unknown;
  sourceFindingId?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function idOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * 从候选的 `sourceTraceJson` 取出 derivation 段；不存在即 null（**不兜底**）。
 *
 * 导出是**刻意的**：本仓前端测试一律是**纯逻辑**测试（无 jsdom / @testing-library），
 * 所以这个「读 + 判空」的判据必须可被直接测试 —— 它是「该卡渲染与否」的唯一决定点。
 */
export function readDerivation(raw: unknown): {
  explain: string | null;
  fingerprint: string | null;
  derivationVersion: string | null;
  patternIds: string[];
  rules: DerivedRuleView[];
  skipped: SkippedView[];
  findingIds: number[];
} | null {
  const trace = asRecord(asRecord(raw)?.sourceTraceJson);
  const derivation = asRecord(trace?.derivation);
  if (derivation === null) return null;
  const rules = Array.isArray(derivation.derivedRules)
    ? (derivation.derivedRules.filter((r) => asRecord(r) !== null) as DerivedRuleView[])
    : [];
  const skipped = Array.isArray(derivation.skipped)
    ? (derivation.skipped.filter((r) => asRecord(r) !== null) as SkippedView[])
    : [];
  const evidence = asRecord(derivation.evidence);
  const findingIds = Array.isArray(evidence?.findingIds)
    ? (evidence.findingIds.map(idOf).filter((x): x is number => x !== null) as number[])
    : [];
  return {
    explain: text(derivation.explain),
    fingerprint: text(derivation.fingerprint),
    derivationVersion: text(derivation.derivationVersion),
    patternIds: Array.isArray(derivation.patternIds)
      ? (derivation.patternIds.map(text).filter((x): x is string => x !== null) as string[])
      : [],
    rules,
    skipped,
    findingIds,
  };
}

export function RuleDerivationCard({ raw }: { raw: unknown }) {
  const derivation = readDerivation(raw);
  // 老候选（本阶段之前登记）与显式关闭派生的候选没有该段 ⇒ 整卡不渲染，不编造。
  if (derivation === null) return null;

  const mismatchCount = derivation.rules.filter((r) => r.directionMismatch === true).length;

  return (
    <Card data-slot="card" data-testid="rule-derivation-card">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="h-4 w-4" />
          规则派生链（研究证据 → 策略条件）
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          由 Pattern 语义声明做唯一翻译：研究侧条件 ⇒ 策略侧字段引用。方向与阈值以声明为准，
          研究侧原文原样保留供核对。
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {derivation.explain !== null && (
          <p
            data-testid="derivation-explain"
            className="flex items-start gap-1.5 rounded-md border px-3 py-2 text-[11px]"
          >
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{derivation.explain}</span>
          </p>
        )}

        {mismatchCount > 0 && (
          <p
            data-testid="derivation-mismatch-warning"
            className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              有 <span className="font-mono">{mismatchCount}</span> 条规则的研究侧方向与执行侧声明**相反**：
              两者可能表达不同层面（研究侧「存在性筛选」vs 执行侧「阈值门槛」）—— 请人工确认后再转正。
            </span>
          </p>
        )}

        {derivation.rules.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" data-testid="derivation-rules">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">研究侧条件</th>
                  <th className="py-1 pr-3 font-normal">→ 策略侧条件</th>
                  <th className="py-1 pr-3 font-normal">来源 Finding</th>
                  <th className="py-1 font-normal">超额收益 / 样本</th>
                </tr>
              </thead>
              <tbody>
                {derivation.rules.map((rule, index) => {
                  const mismatch = rule.directionMismatch === true;
                  const excess = num(rule.effectExcessReturn);
                  const sample = num(rule.effectSampleCount);
                  return (
                    <tr key={`${text(rule.fieldName) ?? "rule"}-${index}`} className="border-t align-top">
                      <td className="py-1.5 pr-3">
                        <span className="font-mono">{text(rule.researchVariable) ?? "—"}</span>
                        <div className="text-muted-foreground">{text(rule.researchCondition) ?? "—"}</div>
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="font-mono">
                          {text(rule.fieldName) ?? "—"} {text(rule.operator) ?? ""}{" "}
                          {text(rule.value) ?? "—"}
                        </span>
                        {mismatch && (
                          <div className="mt-0.5">
                            <Badge variant="outline" className="text-[10px]">
                              方向待确认
                            </Badge>
                          </div>
                        )}
                        {text(rule.noteAboutResearchDifference) !== null && (
                          <div className="text-muted-foreground">
                            {text(rule.noteAboutResearchDifference)}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="font-mono">#{idOf(rule.sourceFindingId) ?? "—"}</span>
                        <div className="text-muted-foreground">
                          {text(rule.sourceFindingTitle) ?? "—"}
                        </div>
                        <div className="text-muted-foreground">
                          analysis <span className="font-mono">#{idOf(rule.sourceAnalysisId) ?? "—"}</span>
                          {text(rule.sourceFindingType) !== null && ` · ${text(rule.sourceFindingType)}`}
                        </div>
                      </td>
                      <td className="py-1.5">
                        {excess === null ? (
                          <span className="text-muted-foreground">未记录</span>
                        ) : (
                          <span className="font-mono">{(excess * 100).toFixed(2)}%</span>
                        )}
                        <div className="text-muted-foreground">
                          {sample === null ? "样本未记录" : `样本 ${sample}`}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground" data-testid="derivation-no-rules">
            本次未派生出任何策略侧条件 —— 草图需人工填写。
          </p>
        )}

        {derivation.skipped.length > 0 && (
          <details className="rounded-md border px-3 py-2 text-[11px]">
            <summary className="cursor-pointer text-muted-foreground">
              未翻译的研究侧条件（{derivation.skipped.length} 条，如实登记）
            </summary>
            <ul className="mt-2 space-y-1.5" data-testid="derivation-skipped">
              {derivation.skipped.map((item, index) => (
                <li key={`skip-${index}`} className="border-t pt-1.5 first:border-t-0 first:pt-0">
                  <div>
                    <span className="font-mono">{text(item.reason) ?? "—"}</span>
                    {idOf(item.sourceFindingId) !== null && (
                      <span className="ml-2 text-muted-foreground">
                        Finding <span className="font-mono">#{idOf(item.sourceFindingId)}</span>
                      </span>
                    )}
                    {text(item.researchVariable) !== null && (
                      <span className="ml-2 font-mono text-muted-foreground">
                        {text(item.researchVariable)}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">{text(item.detail) ?? "—"}</div>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {derivation.derivationVersion !== null && (
            <span>
              派生器版本 <span className="font-mono">{derivation.derivationVersion}</span>
            </span>
          )}
          {derivation.fingerprint !== null && (
            <span data-testid="derivation-fingerprint">
              指纹 <span className="font-mono">{derivation.fingerprint.slice(0, 16)}…</span>
            </span>
          )}
          {derivation.patternIds.length > 0 && (
            <span>
              Pattern <span className="font-mono">{derivation.patternIds.join(" / ")}</span>
            </span>
          )}
          {derivation.findingIds.length > 0 && (
            <span>
              证据 Finding <span className="font-mono">{derivation.findingIds.join(", ")}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
