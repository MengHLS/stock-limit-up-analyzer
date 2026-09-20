/**
 * ProvenanceLink — 跨资源溯源链接原语（FRONTEND-FINAL-001 · P1-4 / §九）。
 *
 * ## 为什么要它
 *
 * 审计确认溯源链**基本单向**：`Analysis → Finding`、`Conclusion → Finding`、`Finding → Analysis`
 * 都没有跳转；即便是已经有了 ID 的地方（OOS/WF run 的 `strategyVersionId`、`datasetVersionId`）
 * 也只是纯文本。规格要求形成
 * `Analysis → Finding → Conclusion → Candidate → Strategy Version → Parameter Search → Backtest → OOS → WF`
 * 的完整可点击链路，且明确「不要为了跳转重新查询一套数据，优先使用已有 ID」。
 *
 * 因此本文件只做两件事：
 * 1. **已有 ID 直接拼链接**（`strategyVersionId` = `"<strategyId>@<version>"` 是**已有** canonical 形态）；
 * 2. 数据集版本号 → 链接这一条确实需要 `datasetId`，而 run 视图上**只有** `datasetVersionId`
 *    ⇒ 用 `datasetRegistry.getVersion` 做**一次**解析（react-query 自带缓存与去重，
 *    同一 `datasetVersionId` 全页只请求一次），而不是复制一套数据集查询逻辑。
 */

import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const linkClass = "font-mono underline-offset-2 hover:underline";
const disabledClass = "font-mono text-muted-foreground";

/**
 * 拆分 `"<strategyId>@<version>"`（run 视图上的 canonical 策略坐标形态）。
 * 无 `@` 时返回 `null`（**不猜**：宁可不给链接）。
 */
export function splitStrategyVersionId(
  strategyVersionId: string | null | undefined,
): { strategyId: string; version: string } | null {
  if (strategyVersionId === null || strategyVersionId === undefined) return null;
  const at = strategyVersionId.indexOf("@");
  if (at <= 0 || at === strategyVersionId.length - 1) return null;
  return {
    strategyId: strategyVersionId.slice(0, at),
    version: strategyVersionId.slice(at + 1),
  };
}

/** 由 `strategyId` + `version` 拼策略详情地址（版本作为 query，与 `StrategyDetail` 的坐标一致）。 */
export function strategyVersionHref(strategyId: string, version?: string | null): string {
  const base = `/strategies/${encodeURIComponent(strategyId)}`;
  return version === null || version === undefined || version === ""
    ? base
    : `${base}?version=${encodeURIComponent(version)}`;
}

export interface StrategyVersionIdLinkProps {  /** canonical 形态 `"<strategyId>@<version>"`；无法拆分时降级为纯文本。 */
  readonly strategyVersionId: string | null | undefined;
  readonly className?: string;
  readonly fallbackText?: string;
}

export function StrategyVersionIdLink({
  strategyVersionId,
  className,
  fallbackText = "—",
}: StrategyVersionIdLinkProps) {
  const split = splitStrategyVersionId(strategyVersionId);
  if (strategyVersionId === null || strategyVersionId === undefined || strategyVersionId === "") {
    return <span className={cn(disabledClass, className)}>{fallbackText}</span>;
  }
  if (split === null) {
    return <span className={cn(disabledClass, className)}>{strategyVersionId}</span>;
  }
  return (
    <Link
      href={strategyVersionHref(split.strategyId, split.version)}
      className={cn(linkClass, className)}
      title="打开该策略版本"
    >
      {strategyVersionId}
    </Link>
  );
}

/**
 * `datasetVersionId`（数字）→ 数据集版本详情链接。
 *
 * 需要 `datasetId` 才能拼出 `/datasets/:datasetId/versions/:versionId`，而 run 视图只带
 * `datasetVersionId` ⇒ 这里用 `datasetRegistry.getVersion` 解析一次（缓存共享）。
 * 解析失败 / 在途时**降级为纯文本**（不显示死链）。
 */
export function DatasetVersionLink({
  datasetVersionId,
  label,
  className,
}: {
  readonly datasetVersionId: number | null | undefined;
  readonly label?: string | null;
  readonly className?: string;
}) {
  const enabled = typeof datasetVersionId === "number" && Number.isInteger(datasetVersionId);
  const query = trpc.datasetRegistry.getVersion.useQuery(
    { datasetVersionId: datasetVersionId ?? 0 },
    { enabled, retry: false, refetchOnWindowFocus: false },
  );
  const datasetId = enabled ? (query.data?.datasetId ?? null) : null;
  const text = label !== null && label !== undefined && label !== ""
    ? `${label}（#${String(datasetVersionId)}）`
    : `#${String(datasetVersionId)}`;

  if (datasetId === null || !enabled) {
    return <span className={cn(disabledClass, className)}>{text}</span>;
  }
  return (
    <Link
      href={`/datasets/${encodeURIComponent(String(datasetId))}/versions/${String(datasetVersionId)}`}
      className={cn(linkClass, className)}
      title="打开该数据集版本"
    >
      {text}
    </Link>
  );
}

/** 通用「ID → 路由」链接（用于没有稳定 `<id>@<version>` 形态的坐标，如 Backtest Run）。 */
export function ProvenanceIdLink({
  href,
  text,
  title,
  className,
}: {
  readonly href: string;
  readonly text: string;
  readonly title?: string;
  readonly className?: string;
}) {
  return (
    <Link href={href} className={cn(linkClass, className)} title={title}>
      {text}
    </Link>
  );
}
