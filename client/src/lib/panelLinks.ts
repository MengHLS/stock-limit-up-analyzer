
/** 面板可选的深链配置（不传即完全保持改造前的行为）。 */
export interface PanelLinkOptions {
  /**
   * 深链**基路径**（不含 runId）。
   *
   * - 缺省 = 面板改造前的硬编码值（`/parameter-search`）；
   * - 独立路由宿主传自己的路由前缀（如 `/validation/oos`）。
   */
  readonly basePath?: string;
  /**
   * 是否使用 **path 形式**深链（`${basePath}/<runId>`）。
   *
   * - `false`（缺省）= query 形式（`${basePath}?<queryKey>=<runId>`），页内嵌入的历史行为；
   * - `true` = path 形式，独立路由使用。
   */
  readonly pathStyle?: boolean;
  /** query 形式下使用的 key（各面板不同：`oosRunId` / `robRunId` / `searchRunId` …）。 */
  readonly queryKey: string;
}

/** 面板宿主路由额外注入的选中坐标（优先级高于 query）。 */
export interface PanelRouteSelection {
  /** 由路由段（`/validation/oos/:runId`）给出的 run id。 */
  readonly routeRunId?: string | null;
  /** 由路由段（`/validation/walk-forward/:runId/folds/:foldIndex`）给出的 fold 序号。 */
  readonly routeFoldIndex?: number | null;
}

export const DEFAULT_PANEL_BASE_PATH = "/parameter-search";

/**
 * 拼「选中某个 run」的地址（纯函数）。
 *
 * `runId === null` ⇒ 返回 `basePath` 本身（=「取消选中 / 回到列表」）。
 */
export function buildPanelLocation(
  options: PanelLinkOptions,
  runId: string | null,
  foldIndex: number | null = null,
): string {
  const basePath = options.basePath ?? DEFAULT_PANEL_BASE_PATH;
  if (runId === null || runId === "") return basePath;
  const encodedRunId = encodeURIComponent(runId);
  if (options.pathStyle === true) {
    return foldIndex === null
      ? `${basePath}/${encodedRunId}`
      : `${basePath}/${encodedRunId}/folds/${String(foldIndex)}`;
  }
  const query = new URLSearchParams({ [options.queryKey]: runId });
  if (foldIndex !== null) query.set("foldIndex", String(foldIndex));
  return `${basePath}?${query.toString()}`;
}

/**
 * 把 URL query 里的 fold 序号解析成合法值（非法 ⇒ `null`，不猜）。
 *
 * 与 `WalkForwardPanel` 改造前的解析口径**逐字一致**（只有非负整数才算合法）。
 */
export function parseFoldIndex(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
