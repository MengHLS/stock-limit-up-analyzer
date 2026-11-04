
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  ClipboardList,
  GitBranch,
  Info,
  Loader2,
  ShieldAlert,
  Tag,
  Wrench,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard, StatusBadge, TechnicalDetails } from "@/components/common";
import { trpc } from "@/lib/trpc";
import type { StrategyLifecycleStatusValue } from "@shared/researchContracts";

const json = (v: unknown) => JSON.stringify(v, null, 2);

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

type LifecycleDescribe = NonNullable<
  ReturnType<typeof trpc.strategyDomain.lifecycle.describe.useQuery>["data"]
>;
type LifecycleTransitionResult = NonNullable<
  ReturnType<typeof trpc.strategyDomain.lifecycle.transition.useMutation>["data"]
>;

/**
 * 账本示例壳（**开发期由后端纯函数生成一次**；前端只透传，不重算任何 hash / fingerprint）。
 *
 * ⚠️ 它的 `strategyId` / `strategyVersion` / `versionRecordFingerprint` / `hash` **属于示例坐标**。
 * 严禁把这里的 `strategyId` 字符串替换成当前策略来「对上」—— 那会造出一份指纹与内容
 * 不一致的记录（＝伪造），本项目铁律禁止。要用它就必须清楚它是一份**示例**。
 */
const EXAMPLE_LIFECYCLE_RECORD = {
  recordKind: "STRATEGY_LIFECYCLE_RECORD",
  recordVersion: 1,
  strategyId: "limit-up-baseline",
  strategyVersion: "1.0.0",
  versionRecordFingerprint:
    "d6d48cc85ef2afc64acb316f3e80e0f2d86e470b7394d0de712772a25dc255ec",
  status: "Draft",
  transitions: [
    {
      seq: 0,
      from: null,
      to: "Draft",
      timestamp: "2026-09-01T01:00:00.000Z",
      reason: "创建基线策略 1.0.0 的生命周期壳",
      experimentId: null,
      evidence: [],
      actor: "researcher-a",
      prevHash: null,
      hash: "af898b78ea6213a44bfa3a1f6508878ce76272d817589e2f127103c5e1a800b6",
    },
  ],
  fingerprint:
    "55ea85612273e227d5f9ef074ac492ba150e7ef1f4c54e0d5a4a328dc6cf4e5d",
} as const;

// ---------------------------------------------------------------------------
// 1 · semver 版本号推进
// ---------------------------------------------------------------------------

function SemverBumpCard({ currentVersion }: { currentVersion: string }) {
  const bump = trpc.strategyDomain.strategy.bump.useMutation();
  const [version, setVersion] = useState(currentVersion);
  const [bumped, setBumped] = useState<string | null>(null);

  // 换了一个策略 / 版本后，输入框回到「当前草稿版本」——不保留上一个策略的残留值。
  useEffect(() => {
    setVersion(currentVersion);
    setBumped(null);
  }, [currentVersion]);

  function doBump(kind: "major" | "minor" | "patch") {
    bump.mutate(
      { version, bump: kind },
      { onSuccess: r => setBumped(r.version) }
    );
  }

  return (
    <SectionCard
      title="semver 版本号推进"
      icon={Tag}
      description="major（结构变化）/ minor（文本·参数默认值）/ patch —— 纯函数、确定性，不写库。"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="adv-version">当前版本</Label>
          <Input
            id="adv-version"
            value={version}
            onChange={e => setVersion(e.target.value)}
            className="w-40 font-mono"
          />
        </div>
        {(["major", "minor", "patch"] as const).map(kind => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            onClick={() => doBump(kind)}
            disabled={bump.isPending}
          >
            {kind}
          </Button>
        ))}
        {bumped && (
          <span className="flex items-center gap-1.5 text-sm">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
              {bumped}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setVersion(bumped);
                toast.success("已填入上方版本号", {
                  description: "还要点页头「保存」或「另存为新版本」才会落库。",
                });
              }}
            >
              采用
            </Button>
          </span>
        )}
      </div>
      {bump.error && (
        <p className="mt-2 font-mono text-xs text-red-600">{bump.error.message}</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        只算版本号；真正落库走「另存为新版本」。
      </p>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 2 · §23 生命周期账本（审计工具）
// ---------------------------------------------------------------------------

function LifecycleLedgerCard() {
  const describe = trpc.strategyDomain.lifecycle.describe.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const transition = trpc.strategyDomain.lifecycle.transition.useMutation();

  const [recordText, setRecordText] = useState(json(EXAMPLE_LIFECYCLE_RECORD));
  const [to, setTo] = useState("Research");
  const [reason, setReason] = useState("研究启动：文献与特征假设");
  const [timestamp, setTimestamp] = useState(() => new Date().toISOString());
  const [experimentId, setExperimentId] = useState("");
  const [actor, setActor] = useState("researcher-a");
  const [evidenceText, setEvidenceText] = useState("[]");

  const [result, setResult] = useState<LifecycleTransitionResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const parsedRecord = useMemo(() => parseJson(recordText), [recordText]);
  const currentStatus =
    parsedRecord.ok && isRecord(parsedRecord.value)
      ? (parsedRecord.value as Record<string, unknown>).status
      : null;

  const allowedTargets: string[] = describe.data
    ? [
        ...((describe.data.transitions as Record<string, readonly string[]>)[
          String(currentStatus)
        ] ?? [...describe.data.statuses]),
      ]
    : [];

  function doTransition() {
    const rec = parseJson(recordText);
    if (!rec.ok) return setFormError(`record JSON 解析失败：${rec.error}`);
    const ev = parseJson(evidenceText);
    if (!ev.ok) return setFormError(`evidence JSON 解析失败：${ev.error}`);
    if (!Array.isArray(ev.value)) return setFormError("evidence 必须是数组");
    setFormError(null);
    transition.mutate(
      {
        record: rec.value as Record<string, unknown>,
        input: {
          to: to as StrategyLifecycleStatusValue,
          timestamp,
          reason,
          ...(experimentId.trim() ? { experimentId: experimentId.trim() } : {}),
          actor: actor.trim() || null,
          evidence: ev.value as Record<string, unknown>[],
        },
      },
      { onSuccess: r => setResult(r) }
    );
  }

  return (
    <TechnicalDetails
      title="§23 生命周期账本（审计工具 · 后端不持久化）"
      className="bg-muted/20"
    >
      <div className="space-y-3">
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            审计校验工具：后端 <code className="font-mono">transition</code> 是纯函数，
            记录不写库。要看 / 改真实状态，请用上面的「版本状态」。
          </span>
        </p>

        <Alert className="py-2">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-[11px] leading-relaxed">
            下面是示例壳（坐标非当前策略）；timestamp / actor 为注入式字段。
          </AlertDescription>
        </Alert>

        {/* 状态机（后端常量，唯一事实来源） */}
        {describe.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : describe.error ? (
          <p className="font-mono text-xs text-red-600">{describe.error.message}</p>
        ) : describe.data ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {describe.data.statuses.map(s => (
                <span key={s} className="flex items-center gap-1">
                  <StatusBadge status={s} />
                  {s !==
                    describe.data!.statuses[describe.data!.statuses.length - 1] && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  )}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto rounded-md border bg-background">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="w-36 px-3 py-2 font-medium">当前状态</th>
                    <th className="px-3 py-2 font-medium">可迁移至</th>
                  </tr>
                </thead>
                <tbody>
                  {describe.data.statuses.map(s => {
                    const tos =
                      (
                        describe.data!.transitions as Record<
                          string,
                          readonly string[]
                        >
                      )[s] ?? [];
                    return (
                      <tr key={s} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-mono">{s}</td>
                        <td className="px-3 py-2">
                          {tos.length === 0 ? (
                            <span className="text-muted-foreground">
                              终态（不可迁移）
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {tos.map(t => (
                                <StatusBadge
                                  key={t}
                                  status={t}
                                  label={t}
                                  className="text-[10px]"
                                />
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRecordText(json(EXAMPLE_LIFECYCLE_RECORD))}
          >
            <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> 载入示例壳
          </Button>
          {currentStatus ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              壳内当前状态
              <StatusBadge status={String(currentStatus)} />
            </span>
          ) : null}
        </div>

        <Textarea
          value={recordText}
          onChange={e => setRecordText(e.target.value)}
          spellCheck={false}
          className="min-h-[220px] font-mono text-[11px] leading-5"
        />

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="adv-to">迁移至（to）</Label>
            <select
              id="adv-to"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              {allowedTargets.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-ts">timestamp（ISO-8601 UTC）</Label>
            <Input
              id="adv-ts"
              value={timestamp}
              onChange={e => setTimestamp(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-reason">reason（必填非空）</Label>
            <Input
              id="adv-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-exp">experimentId（可空）</Label>
            <Input
              id="adv-exp"
              value={experimentId}
              onChange={e => setExperimentId(e.target.value)}
              placeholder="如 EXP-2026-09-01-…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-actor">actor（可空）</Label>
            <Input
              id="adv-actor"
              value={actor}
              onChange={e => setActor(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adv-ev">evidence（JSON 数组，可空）</Label>
            <Input
              id="adv-ev"
              value={evidenceText}
              onChange={e => setEvidenceText(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          证据门槛示例：Candidate 需 searchRun；Validated / Production 需 datasetGate
          PASS；Approved 需 approval。
        </p>

        <Button size="sm" onClick={doTransition} disabled={transition.isPending}>
          {transition.isPending && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          )}
          应用这次迁移
        </Button>

        {formError && <p className="font-mono text-xs text-red-600">{formError}</p>}
        {transition.error && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>迁移被拒绝</AlertTitle>
            <AlertDescription className="font-mono text-xs">
              {transition.error.message}
            </AlertDescription>
          </Alert>
        )}

        {result && (
          <div className="space-y-2 rounded-md border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                迁移后的新记录
              </span>
              <StatusBadge status={result.status} />
              <span className="font-mono text-[10px] text-muted-foreground">
                {result.strategyId}@{result.strategyVersion}
              </span>
            </div>
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              fingerprint: {result.fingerprint}
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 font-medium">序号</th>
                    <th className="px-3 py-2 font-medium">状态迁移</th>
                    <th className="px-3 py-2 font-medium">原因</th>
                    <th className="px-3 py-2 font-medium">证据</th>
                    <th className="px-3 py-2 font-medium">哈希</th>
                  </tr>
                </thead>
                <tbody>
                  {result.transitions.map(t => (
                    <tr key={t.seq} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-mono text-[11px]">{t.seq}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {t.from ?? "∅"} → {t.to}
                      </td>
                      <td className="px-3 py-2">{t.reason}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {t.evidence.length === 0 ? "—" : `${t.evidence.length} 项`}
                      </td>
                      <td
                        className="max-w-[140px] truncate px-3 py-2 font-mono text-[10px] text-muted-foreground"
                        title={t.hash}
                      >
                        {t.hash.slice(0, 12)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </TechnicalDetails>
  );
}

// ---------------------------------------------------------------------------

export function StrategyAdvancedTools({
  currentVersion,
}: {
  /** 当前草稿版本号（用于初始化 semver 输入框）。 */
  currentVersion: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          这一页是**工程与审计工具**，日常做策略用不到。默认折叠、不占一级信息的位置。
        </span>
      </div>

      <SemverBumpCard currentVersion={currentVersion} />

      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        生命周期账本
      </div>
      <LifecycleLedgerCard />
    </div>
  );
}
