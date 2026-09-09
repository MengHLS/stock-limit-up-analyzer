/**
 * FE-2 — asOf(T) 历史状态查询器（STEP 12.5 十问渲染）。
 *
 * 纪律（§27 / §31 / §9 Frontend 不是 Quant Engine）：
 * - **只读渲染后端结果**：本页不做任何重建/判定/兜底——`historicalState.asOf` 返回什么就展示什么；
 *   `eligible=false` / `UNKNOWN` / `null` 原样呈现，不因「看起来异常」而改写；
 * - **PIT 显式化**：asOf 留空 = 全知视角（FULL_KNOWLEDGE，仅调试/审计，非研究口径）——页面明示该语义，
 *   研究使用必须显式填 asOf（§4 PIT 铁律）；
 * - **诚实空态**：查询返回 null（DB 不可用 / 标的不存在 / 无数据）→ 明示，不构造「全 UNKNOWN」假状态；
 * - **代码解析仅供参考**：resolveCode 返回候选集（代码可复用），选定后仍是按 securityId 查真实状态。
 */

import { StatusBadge } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { styleForStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Fingerprint,
  Landmark,
  Loader2,
  Search,
  ShieldX,
  XCircle,
} from "lucide-react";
import { useState } from "react";

/** asOf 输出类型（从 appRouter 推断，不复制领域 schema；null 表示未命中）。 */
type AsOfOutput = inferRouterOutputs<AppRouter>["historicalState"]["asOf"];
type State = NonNullable<AsOfOutput>;

/** 页面自解释：本页能回答的十个问题（展示顺序与结果卡片一致）。 */
const TEN_QUESTIONS = [
  { id: "Q1", label: "身份" },
  { id: "Q2", label: "是否上市" },
  { id: "Q3", label: "是否退市" },
  { id: "Q4", label: "行业归属" },
  { id: "Q5", label: "是否可交易" },
  { id: "Q6", label: "流动性" },
  { id: "Q7", label: "当日价格" },
  { id: "Q8", label: "公司行为" },
  { id: "Q9", label: "市场状态" },
  { id: "Q10", label: "可知性审计" },
] as const;

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------

function num(v: number | null | undefined, digits = 2): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

/** 大数字（元）格式化为亿/万；null → —。 */
function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(1)} 万`;
  return v.toLocaleString();
}

function Kv({
  k,
  v,
  mono = true,
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

/** 把某维度 resolved 值渲染成一行（ResolvedStatusValue | null）。 */
function ResolvedRow({
  label,
  value,
}: {
  label: string;
  value:
    | {
        statusType?: string;
        statusValue?: string;
        effectiveFrom?: string;
        effectiveTo?: string | null;
        source?: string;
      }
    | null
    | undefined;
}) {
  if (!value) {
    return (
      <Kv
        k={label}
        v={<span className="text-muted-foreground">无已知数据</span>}
        mono={false}
      />
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Badge variant="secondary" className="font-mono text-[10px]">
          {value.statusValue}
        </Badge>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {value.effectiveFrom} ~ {value.effectiveTo ?? "今"}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {value.source}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 查询表单
// ---------------------------------------------------------------------------

function QueryForm({
  onQuery,
  loading,
  submitted,
}: {
  onQuery: (args: {
    securityId: string;
    tradeDate: string;
    asOf: string | null;
  }) => void;
  loading: boolean;
  /** 已提交并展示在结果区的查询条件；null = 尚未查询。用于「表单已修改」提示。 */
  submitted: {
    securityId: string;
    tradeDate: string;
    asOf: string | null;
  } | null;
}) {
  const [codeQuery, setCodeQuery] = useState("");
  const [securityId, setSecurityId] = useState("");
  const [tradeDate, setTradeDate] = useState("2026-09-04");
  const [asOf, setAsOf] = useState("2026-09-04");

  const resolve = trpc.historicalState.resolveCode.useQuery(
    { query: codeQuery },
    { enabled: false }
  );

  const trimmedCode = codeQuery.trim();
  const asOfEnabled = asOf.trim().length > 0;
  const asOfValue = asOfEnabled ? asOf : null;
  const canQuery =
    securityId.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(tradeDate);

  /** 解析结果是否陈旧：输入代码已修改，但尚未重新点「解析」（防止误点旧候选）。 */
  const resolveStale =
    resolve.data !== undefined && resolve.data.query !== trimmedCode;

  /** 表单是否已偏离结果区所展示的已提交条件（防「所见非所得」）。 */
  const dirty =
    submitted !== null &&
    (securityId.trim() !== submitted.securityId ||
      tradeDate !== submitted.tradeDate ||
      asOfValue !== submitted.asOf);

  /** asOf 早于 tradeDate：日级事实（价格/流动性/指数）按「当日收盘后可知」口径仍展示为已知，与 PIT 截止冲突。 */
  const asOfEarlierThanTradeDate = asOfEnabled && asOf < tradeDate;

  const handleResolve = () => {
    if (trimmedCode.length === 0) return;
    void resolve.refetch();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">查询条件</CardTitle>
        <CardDescription className="text-xs">
          第一步：解析代码选候选；第二步：填 securityId + 交易日。asOf 留空 =
          全知视角（仅调试/审计）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 代码解析 */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="mb-1 block text-xs">① 代码解析（可选）</Label>
            <div className="flex gap-2">
              <Input
                value={codeQuery}
                onChange={e => setCodeQuery(e.target.value)}
                placeholder="600000 或 600000.SH"
                className="font-mono"
                onKeyDown={e => {
                  if (e.key === "Enter") handleResolve();
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleResolve}
                disabled={codeQuery.trim().length === 0 || resolve.isFetching}
                className="shrink-0"
              >
                {resolve.isFetching ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="mr-1 h-3.5 w-3.5" />
                )}
                解析
              </Button>
            </div>
          </div>
          <div className="flex-1">
            <Label className="mb-1 block text-xs">② securityId（sec_…）</Label>
            <Input
              value={securityId}
              onChange={e => setSecurityId(e.target.value)}
              placeholder="sec_…"
              className="font-mono"
            />
          </div>
        </div>

        {/* 解析结果 */}
        {resolve.data && (
          <div className="rounded-md border bg-muted/30 p-2">
            {resolve.data.parseError ? (
              <p className="flex items-start gap-1.5 text-xs text-red-700">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {resolve.data.parseError}
              </p>
            ) : resolve.data.error ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {resolve.data.error}
              </p>
            ) : resolve.data.candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                「{resolve.data.digits}
                {resolve.data.exchange ? `.${resolve.data.exchange}` : ""}
                」在证券主数据中无匹配
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    找到 {resolve.data.candidates.length}{" "}
                    个候选（代码可能跨证券复用）——点击选用：
                  </p>
                  {resolveStale && (
                    <p className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-700">
                      <AlertTriangle className="h-3 w-3" />
                      代码输入已修改，请重新「解析」
                    </p>
                  )}
                </div>
                {resolve.data.candidates.map(c => {
                  const selected = securityId === c.securityId;
                  return (
                    <button
                      key={c.securityId}
                      onClick={() => {
                        setSecurityId(c.securityId);
                      }}
                      disabled={resolveStale}
                      title={
                        resolveStale
                          ? "解析结果已陈旧，请先重新点击「解析」"
                          : selected
                            ? "已选用该证券"
                            : "点击选用该证券"
                      }
                      className={cn(
                        "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded border bg-background px-2.5 py-1.5 text-left text-xs transition-colors",
                        selected
                          ? "border-emerald-300 bg-emerald-50"
                          : "hover:border-orange-400 hover:bg-orange-50",
                        resolveStale ? "cursor-not-allowed opacity-50" : ""
                      )}
                    >
                      <span className="font-mono font-semibold">
                        {c.identifier?.securityCode}.{c.exchange}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {c.securityId}
                      </span>
                      <StatusBadge
                        status={
                          c.status === "listed"
                            ? "LISTED"
                            : c.status === "unknown"
                              ? "UNKNOWN"
                              : "DELISTED"
                        }
                      />
                      <span className="font-mono text-muted-foreground">
                        {c.listedDate ?? "?"} ~ {c.delistedDate ?? "至今"}
                      </span>
                      <span className="text-muted-foreground">
                        {c.securityType} · 标识符区间 ×{c.identifierCount}
                      </span>
                      {selected && (
                        <span className="ml-auto shrink-0 font-medium text-emerald-700">
                          已选用
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* 日期与查询 */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="mb-1 block text-xs">交易日（tradeDate）</Label>
            <Input
              type="date"
              value={tradeDate}
              onChange={e => setTradeDate(e.target.value)}
              className="w-40 font-mono"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs">
              asOf（PIT 截止；留空=全知）{asOfEnabled ? "" : " ⚠"}
            </Label>
            <Input
              type="date"
              value={asOf}
              onChange={e => setAsOf(e.target.value)}
              className={`w-40 font-mono ${asOfEnabled ? "" : "border-amber-400"}`}
            />
          </div>
          <Button
            onClick={() =>
              onQuery({
                securityId: securityId.trim(),
                tradeDate,
                asOf: asOfEnabled ? asOf : null,
              })
            }
            disabled={!canQuery || loading}
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Fingerprint className="mr-1.5 h-4 w-4" />
            )}
            查询 asOf 状态
          </Button>
        </div>

        {!asOfEnabled && (
          <p className="flex items-center gap-1 text-[11px] text-amber-700">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {
              "asOf 留空 = FULL_KNOWLEDGE 全知视角：不排除未来可知信息，仅供调试/审计；研究使用必须显式填 asOf（§4 PIT 铁律）。"
            }
          </p>
        )}

        {asOfEarlierThanTradeDate && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {`asOf（${asOf}）早于 tradeDate（${tradeDate}）：价格 / 流动性 / 市场状态等日级事实按「当日收盘后可知」口径仍会展示为 KNOWN，与「asOf = 信息截止」的 PIT 语义冲突；仅当你确认理解该口径边界时使用。`}
          </p>
        )}

        {dirty && (
          <p className="flex items-start gap-1.5 text-[11px] text-blue-700">
            <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            {
              "表单条件已修改，结果区仍基于上次提交的条件——点击「查询 asOf 状态」以更新结果。"
            }
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 结果渲染（十问）
// ---------------------------------------------------------------------------

function StateView({ state }: { state: State }) {
  const {
    query,
    identity,
    lifecycle,
    tradability,
    industry,
    liquidity,
    price,
    corporateActions,
    marketState,
    knowledge,
  } = state;

  const priceChange =
    price && price.preClose
      ? ((price.close ?? 0) - price.preClose) / price.preClose
      : null;

  return (
    <div className="space-y-3">
      {/* 查询上下文 */}
      <Card>
        <CardContent className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kv k="securityId" v={query.securityId} />
          <Kv k="tradeDate" v={query.tradeDate} />
          <Kv
            k="asOf"
            v={query.asOf ?? "null（全知）"}
            tone={query.asOf ? undefined : "warn"}
          />
          <Kv
            k="开市日"
            v={
              query.isTradingDay === null
                ? "未判定"
                : query.isTradingDay
                  ? "是"
                  : "否"
            }
          />
        </CardContent>
      </Card>

      {/* Q10 可知性审计（先给全局口径） */}
      <Card className="border-slate-200">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldX className="h-4 w-4" />
            Q10 可知性审计（knowledge）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge
              status={knowledge.policy === "PIT" ? "PASS" : "PENDING"}
              label={knowledge.policy}
            />
            <span className="text-muted-foreground">{knowledge.note}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(knowledge.dimensions).map(([dim, status]) => (
              <span
                key={dim}
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px]",
                  styleForStatus(status).badge
                )}
              >
                {status === "KNOWN" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <CircleAlert className="h-3 w-3" />
                )}
                {dim}
                <span className="font-sans opacity-80">
                  {status === "KNOWN" ? "已知" : "未知"}
                </span>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Q1 身份 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Q1 身份</CardTitle>
          </CardHeader>
          <CardContent>
            <Kv
              k="代码（tradeDate 生效）"
              v={identity.code ?? "—（无生效标识符）"}
            />
            <Kv k="6 位代码" v={identity.codeDigits ?? "—"} />
            <Kv k="标识符类型" v={identity.identifierType ?? "—"} />
            <Kv k="交易所" v={identity.exchange} />
            <Kv k="证券类型" v={identity.securityType} />
            <Kv
              k="币种 / 国家"
              v={`${identity.currency} / ${identity.country}`}
            />
            <Kv
              k="标识符区间"
              v={`${identity.identifierEffectiveFrom ?? "?"} ~ ${identity.identifierEffectiveTo ?? "今"}`}
            />
          </CardContent>
        </Card>

        {/* Q2/Q3 生命周期 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              Q2/Q3 生命周期
              <StatusBadge
                label={lifecycle.verdict}
                status={
                  lifecycle.verdict === "LISTED"
                    ? "LISTED"
                    : lifecycle.verdict === "NOT_YET_LISTED"
                      ? "NOT_YET_LISTED"
                      : lifecycle.verdict === "DELISTED"
                        ? "DELISTED"
                        : "UNKNOWN"
                }
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Kv k="master 状态快照" v={lifecycle.masterStatus} tone="muted" />
            <Kv k="上市日（master）" v={lifecycle.listedDate ?? "—"} />
            <Kv k="退市日（master）" v={lifecycle.delistedDate ?? "未退市"} />
            <ResolvedRow label="LISTING 维度" value={lifecycle.listing} />
            <ResolvedRow label="DELISTING 维度" value={lifecycle.delisting} />
          </CardContent>
        </Card>

        {/* Q5 可交易 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              Q5 可交易性
              {tradability.eligible ? (
                <StatusBadge status="PASS" label="可交易" />
              ) : (
                <StatusBadge status="FAIL" label="不可交易" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!tradability.eligible && tradability.reason && (
              <div className="mb-1.5 flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 font-mono text-[11px] text-red-700">
                <XCircle className="h-3 w-3 shrink-0" />
                剔除原因：{tradability.reason}
              </div>
            )}
            <Kv
              k="ST 信息"
              v={tradability.st}
              tone={
                tradability.st === "UNKNOWN"
                  ? "warn"
                  : tradability.st === "NORMAL"
                    ? undefined
                    : "bad"
              }
            />
            <ResolvedRow label="TRADING 维度" value={tradability.trading} />
            <ResolvedRow
              label="SUSPENSION 维度"
              value={tradability.suspension}
            />
            <Kv
              k="未解析维度"
              v={
                (tradability.snapshot.unknownDimensions ?? []).length > 0
                  ? (tradability.snapshot.unknownDimensions ?? []).join(", ")
                  : "无"
              }
              mono={false}
            />
          </CardContent>
        </Card>

        {/* Q4 行业 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">
              Q4 行业（(tradeDate, asOf) 解析）
            </CardTitle>
          </CardHeader>
          <CardContent>
            {industry ? (
              <>
                <Kv k="行业代码" v={industry.industryCode} />
                <Kv k="行业名称" v={industry.industryName} mono={false} />
                <Kv
                  k="归属区间"
                  v={`${industry.effectiveFrom} ~ ${industry.effectiveTo ?? "今"}`}
                />
                <Kv k="来源" v={industry.source} tone="muted" />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                无已解析行业归属（可能未加载或无区间记录）
              </p>
            )}
          </CardContent>
        </Card>

        {/* Q7 价格 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              Q7 价格（未复权，收盘后可知）
              {price ? (
                <StatusBadge
                  status="INFO"
                  label={`${price.symbol ?? ""} · ${price.adjustment ?? "raw"}`}
                />
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {price ? (
              <div className="grid grid-cols-2 gap-x-6">
                <div>
                  <Kv k="开" v={num(price.open, 3)} />
                  <Kv k="高" v={num(price.high, 3)} />
                  <Kv k="低" v={num(price.low, 3)} />
                  <Kv k="收" v={num(price.close, 3)} />
                </div>
                <div>
                  <Kv
                    k="涨跌幅"
                    v={
                      priceChange === null
                        ? "—"
                        : `${(priceChange * 100).toFixed(2)}%`
                    }
                    tone={
                      priceChange === null
                        ? undefined
                        : priceChange > 0
                          ? "bad" // A 股惯例：红涨
                          : priceChange < 0
                            ? "ok" // 绿跌
                            : undefined
                    }
                  />
                  <Kv k="前收" v={num(price.preClose, 3)} />
                  <Kv k="成交量（手）" v={num(price.volume, 0)} />
                  <Kv k="成交额（千元）" v={num(price.amount, 0)} />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                当日无日线 bar（停牌 / 未上市 / 无数据）
              </p>
            )}
          </CardContent>
        </Card>

        {/* Q6 流动性 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">
              Q6 流动性（tradeDate 日级）
            </CardTitle>
          </CardHeader>
          <CardContent>
            {liquidity ? (
              <>
                <Kv
                  k="换手率"
                  v={
                    liquidity.turnoverRate === null
                      ? "—"
                      : `${num(liquidity.turnoverRate, 3)}%`
                  }
                />
                <Kv k="流通市值" v={fmtMoney(liquidity.circulationMarketCap)} />
                <Kv k="总市值" v={fmtMoney(liquidity.totalMarketCap)} />
                <Kv k="成交额（千元）" v={num(liquidity.amount, 0)} />
                <Kv k="来源" v={liquidity.source} tone="muted" />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">当日无流动性行</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Q9 市场状态 */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">
            Q9 市场状态（核心指数 @ tradeDate，{marketState.length} 项）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {marketState.length === 0 ? (
            <p className="text-xs text-muted-foreground">当日无核心指数数据</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">指数</TableHead>
                    <TableHead className="text-right text-xs">开</TableHead>
                    <TableHead className="text-right text-xs">高</TableHead>
                    <TableHead className="text-right text-xs">低</TableHead>
                    <TableHead className="text-right text-xs">收</TableHead>
                    <TableHead className="text-right text-xs">
                      成交额（千元）
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {marketState.map(e => (
                    <TableRow key={e.indexCode}>
                      <TableCell className="font-mono text-xs">
                        {e.indexCode}
                        {e.indexName ? (
                          <span className="ml-1 text-muted-foreground">
                            {e.indexName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {num(e.bar.open)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {num(e.bar.high)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {num(e.bar.low)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {num(e.bar.close)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {num(e.bar.amount, 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Q8 公司行为 */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Landmark className="h-4 w-4" />
            Q8 公司行为
            <StatusBadge
              status={corporateActions.policy === "PIT" ? "PASS" : "PENDING"}
              label={corporateActions.policy}
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Q8a 已生效（effectiveDate ≤ tradeDate，
              {corporateActions.effectiveOnOrBefore.length}）
            </p>
            {corporateActions.effectiveOnOrBefore.length === 0 ? (
              <p className="text-xs text-muted-foreground">无已生效事件</p>
            ) : (
              <ul className="space-y-1">
                {corporateActions.effectiveOnOrBefore.map((a, i) => (
                  <li
                    key={i}
                    className="rounded border bg-muted/30 px-2 py-1 font-mono text-[11px]"
                  >
                    {a.actionType} · {a.effectiveDate}
                    {a.cashAmount !== null && ` · 现金 ${num(a.cashAmount, 4)}`}
                    {a.announcementDate && ` · 公告 ${a.announcementDate}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Q8b + Q10 于 asOf 已知（PIT 口径，
              {corporateActions.knownAtAsOf.length}）
            </p>
            {corporateActions.knownAtAsOf.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                asOf 时点无已公告可知事件
              </p>
            ) : (
              <ul className="space-y-1">
                {corporateActions.knownAtAsOf.map((a, i) => (
                  <li
                    key={i}
                    className="rounded border bg-emerald-50 px-2 py-1 font-mono text-[11px] text-emerald-800"
                  >
                    {a.actionType} · {a.effectiveDate}
                    {a.announcementDate && ` · 公告 ${a.announcementDate}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

export default function HistoricalState() {
  const [queryKey, setQueryKey] = useState<{
    securityId: string;
    tradeDate: string;
    asOf: string | null;
  } | null>(null);

  // 仅在有 queryKey 时启用（enabled），避免空查。
  // placeholderData：切换查询条件时保留上一结果直到新结果到达，避免整页骨架闪烁。
  const asOfQuery = trpc.historicalState.asOf.useQuery(
    {
      securityId: queryKey?.securityId ?? "",
      tradeDate: queryKey?.tradeDate ?? "",
      asOf: queryKey?.asOf ?? null,
    },
    {
      enabled: queryKey !== null,
      retry: false,
      refetchOnWindowFocus: false,
      placeholderData: (prev, prevQuery) => prevQuery?.state.data ?? prev,
    }
  );

  const handleQuery = (args: {
    securityId: string;
    tradeDate: string;
    asOf: string | null;
  }) => {
    const same =
      queryKey !== null &&
      queryKey.securityId === args.securityId &&
      queryKey.tradeDate === args.tradeDate &&
      queryKey.asOf === args.asOf;
    if (same) {
      // 相同条件再次点击 = 强制重新查询（DB 可能刚回填完成）。refetch 闭包条件与当前一致，安全。
      void asOfQuery.refetch();
      return;
    }
    // 参数变化：仅更新 queryKey，由 React Query 按新参数自动查询。
    // 禁止在 setQueryKey 后立刻 refetch——refetch 闭包仍持有旧 queryKey（首查为 null），
    // 会先用空 securityId 打一次请求（触发 zod min(1) 报错闪烁），再叠加一次正确请求。
    setQueryKey(args);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Fingerprint className="h-5 w-5" />
          asOf(T) 历史状态查询器
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          STEP 12.5 十问重建 · 输入 (security, date) →
          渲染身份/上市/退市/行业/可交易/流动性/价格/公司行为/市场状态/可知性；
          结果由后端{" "}
          <code className="mx-1 rounded bg-muted px-1 font-mono">
            historicalState.asOf
          </code>{" "}
          只读重建，页面不改写任何判定。
        </p>
      </div>

      <QueryForm
        onQuery={handleQuery}
        loading={asOfQuery.isFetching}
        submitted={queryKey}
      />

      {queryKey === null && (
        <Card>
          <CardContent className="px-6 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              它能回答什么？——对任意「(证券, 交易日)」，以 asOf(T)
              视角重建当时的市场状态
            </p>
            <div className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-1.5">
              {TEN_QUESTIONS.map(q => (
                <span
                  key={q.id}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {q.id}
                  <span className="font-sans text-foreground/80">
                    {q.label}
                  </span>
                </span>
              ))}
            </div>
            <p className="mx-auto mt-4 max-w-xl text-xs text-muted-foreground">
              填好查询条件后点击「查询 asOf 状态」。查询返回 null（DB 不可用 /
              标的不存在）会在此明示，不会伪造全 UNKNOWN 状态。
            </p>
          </CardContent>
        </Card>
      )}

      {queryKey !== null && asOfQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <div className="grid gap-3 lg:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        </div>
      )}

      {queryKey !== null && asOfQuery.isError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="flex items-start gap-2 py-4 text-sm text-red-700">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">查询失败</p>
              <p className="mt-1 font-mono text-xs">
                {asOfQuery.error?.message ?? "未知错误"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {queryKey !== null &&
        !asOfQuery.isLoading &&
        !asOfQuery.isError &&
        asOfQuery.data === null && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="flex items-start gap-2 py-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">查询返回 null——无结果</p>
                <p className="mt-1 text-xs">
                  可能原因：DB 不可用（回填任务占满 TiDB）、securityId
                  不存在、或查询被拒。 系统不会构造「全
                  UNKNOWN」假状态冒充查询结果。
                </p>
              </div>
            </CardContent>
          </Card>
        )}

      {queryKey !== null &&
        !asOfQuery.isLoading &&
        !asOfQuery.isError &&
        asOfQuery.data && <StateView state={asOfQuery.data} />}
    </div>
  );
}
