/**
 * 「构建新版本」筛选面板 — 纯逻辑层（STEP DATASET-003B）。
 *
 * 为什么单独抽一层：筛选配置是**构建门禁**（未完成配置不得构建），校验规则必须可单测、
 * 且与后端权威口径（shared/datasetRegistryContracts + server/datasetRegistry/filter）同源。
 * 本文件**不含任何 UI / 网络**：只有表单状态 → 校验 → wire 载荷的确定性映射。
 *
 * 纪律：
 *   - 边界的「唯一权威」在后端（`normalizeBuildFilter`）；这里做**同等强度的前置校验**只是为了
 *     尽早给用户反馈，不放松后端校验；
 *   - 默认值取 `DATASET_BUILD_FILTER_DEFAULTS`（与后端默认同源），不在此处硬编码数字。
 */

import {
  DATASET_BOARDS,
  DATASET_BOARD_LABELS,
  DATASET_BUILD_FILTER_DEFAULTS,
  DATASET_BUILD_FILTER_LIMITS,
  DATASET_EVENT_KINDS,
  DATASET_EVENT_KIND_LABELS,
  DATASET_BUILD_CONFIG_LIMITS,
  describeDatasetFilter,
  type DatasetBoard,
  type DatasetBuildFilter,
  type DatasetEventKind,
} from "@shared/datasetRegistryContracts";

/** 事件维度表单行（数字保持字符串，便于受控输入与「未填写」状态表达）。 */
export interface FilterEventRow {
  key: string;
  relativeDay: string;
  kind: DatasetEventKind;
}

/** 筛选面板表单状态。 */
export interface DatasetFilterFormState {
  boards: DatasetBoard[];
  excludeSt: boolean;
  events: FilterEventRow[];
  preWindowDays: string;
  postWindowDays: string;
  outcomeHorizons: string;
  batchSize: string;
}

let rowSeq = 0;

/** 生成稳定的行 key（React list key 用；不参与业务语义）。 */
export function newEventRowKey(): string {
  rowSeq += 1;
  return `ev-${rowSeq}`;
}

/** 相对日选项：T 日（0）→ T-10 日（-10），与后端 limits 同源。 */
export function relativeDayOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let d = 0; d >= DATASET_BUILD_FILTER_LIMITS.relativeDay.min; d -= 1) {
    out.push({ value: String(d), label: d === 0 ? "T 日（事件日）" : `T${d} 日` });
  }
  return out;
}

/** 板块选项（含中文标签）。 */
export function boardOptions(): { value: DatasetBoard; label: string }[] {
  return DATASET_BOARDS.map((b) => ({ value: b, label: DATASET_BOARD_LABELS[b] }));
}

/** 事件类型选项（含中文标签）。 */
export function eventKindOptions(): { value: DatasetEventKind; label: string }[] {
  return DATASET_EVENT_KINDS.map((k) => ({ value: k, label: DATASET_EVENT_KIND_LABELS[k] }));
}

/** 单行事件的可读文案（如「T-1 日 · 首板」）。 */
export function formatEventRow(row: Pick<FilterEventRow, "relativeDay" | "kind">): string {
  const d = Number(row.relativeDay);
  const dayText = Number.isFinite(d) && d === 0 ? "T 日" : `T${Number.isFinite(d) ? d : row.relativeDay} 日`;
  return `${dayText} · ${DATASET_EVENT_KIND_LABELS[row.kind] ?? row.kind}`;
}

/** 默认表单 = 权威默认（事件日首板 / 不筛板块 / 不排除 ST / t-0..t+20）。 */
export function createDefaultFilterForm(): DatasetFilterFormState {
  return {
    boards: [],
    excludeSt: DATASET_BUILD_FILTER_DEFAULTS.excludeSt,
    events: DATASET_BUILD_FILTER_DEFAULTS.events.map((e) => ({
      key: newEventRowKey(),
      relativeDay: String(e.relativeDay),
      kind: e.kind,
    })),
    preWindowDays: String(DATASET_BUILD_FILTER_DEFAULTS.preWindowDays),
    postWindowDays: String(DATASET_BUILD_FILTER_DEFAULTS.postWindowDays),
    outcomeHorizons: DATASET_BUILD_FILTER_DEFAULTS.outcomeHorizons.join(","),
    batchSize: String(DATASET_BUILD_FILTER_DEFAULTS.batchSize),
  };
}

/** 勾选 / 取消勾选一个板块（保持 DATASET_BOARDS 的规范顺序，便于去重与展示稳定）。 */
export function toggleBoard(boards: readonly DatasetBoard[], board: DatasetBoard): DatasetBoard[] {
  const next = boards.includes(board) ? boards.filter((b) => b !== board) : [...boards, board];
  return DATASET_BOARDS.filter((b) => next.includes(b));
}

/**
 * 追加一条事件维度，自动挑一个「尚未使用」的相对日（避免一加就重复报错）。
 * 例外：若候选日都已用尽，则回落到 T 日（由校验层提示重复）。
 */
export function addEventRow(rows: readonly FilterEventRow[]): FilterEventRow[] {
  const used = new Set(rows.map((r) => `${r.relativeDay}:${r.kind}`));
  const candidates = relativeDayOptions();
  for (const opt of candidates) {
    for (const kind of DATASET_EVENT_KINDS) {
      if (!used.has(`${opt.value}:${kind}`)) {
        return [...rows, { key: newEventRowKey(), relativeDay: opt.value, kind }];
      }
    }
  }
  return [...rows, { key: newEventRowKey(), relativeDay: "0", kind: "firstBoard" }];
}

/** 删除一条事件维度（保持至少 1 条：最后一条不允许删除，由调用方 disable 按钮）。 */
export function removeEventRow(rows: readonly FilterEventRow[], key: string): FilterEventRow[] {
  if (rows.length <= 1) return [...rows];
  return rows.filter((r) => r.key !== key);
}

/** 更新一条事件维度。 */
export function updateEventRow(
  rows: readonly FilterEventRow[],
  key: string,
  patch: Partial<Omit<FilterEventRow, "key">>,
): FilterEventRow[] {
  return rows.map((r) => (r.key === key ? { ...r, ...patch } : r));
}

/** 解析逗号分隔的正整数列表。 */
export function parseNumberList(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

/**
 * 表单校验（返回错误文案；null = 通过）。
 * 强度与后端 `normalizeBuildFilter` 对齐，覆盖：事件维度非空 / 去重 / 相对日区间、
 * 前后窗口、结果视界、批大小。
 */
export function validateFilterForm(form: DatasetFilterFormState): string | null {
  const { relativeDay, maxEvents } = DATASET_BUILD_FILTER_LIMITS;

  if (form.events.length === 0) return "至少配置一个事件维度（未完成筛选配置不得构建）";
  if (form.events.length > maxEvents) return `事件维度最多 ${maxEvents} 条`;

  const seen = new Set<string>();
  for (let i = 0; i < form.events.length; i += 1) {
    const row = form.events[i]!;
    const d = Number(row.relativeDay);
    if (row.relativeDay.trim() === "" || !Number.isInteger(d)) {
      return `事件维度第 ${i + 1} 条的相对日非法`;
    }
    if (d < relativeDay.min || d > relativeDay.max) {
      return `事件维度第 ${i + 1} 条的相对日须在 ${relativeDay.min}..${relativeDay.max}`;
    }
    if (!(DATASET_EVENT_KINDS as readonly string[]).includes(row.kind)) {
      return `事件维度第 ${i + 1} 条的事件类型非法`;
    }
    const dedupeKey = `${d}:${row.kind}`;
    if (seen.has(dedupeKey)) return `事件维度存在重复项：${formatEventRow(row)}`;
    seen.add(dedupeKey);
  }

  const pre = Number(form.preWindowDays);
  if (form.preWindowDays.trim() === "" || !Number.isInteger(pre)) return "t 日之前的数据天数须为整数";
  if (pre < DATASET_BUILD_FILTER_LIMITS.preWindowDays.min || pre > DATASET_BUILD_FILTER_LIMITS.preWindowDays.max) {
    return `t 日之前的数据天数须在 ${DATASET_BUILD_FILTER_LIMITS.preWindowDays.min}..${DATASET_BUILD_FILTER_LIMITS.preWindowDays.max}`;
  }

  const post = Number(form.postWindowDays);
  if (form.postWindowDays.trim() === "" || !Number.isInteger(post)) return "t 日之后的数据天数须为整数";
  if (post < DATASET_BUILD_FILTER_LIMITS.postWindowDays.min || post > DATASET_BUILD_FILTER_LIMITS.postWindowDays.max) {
    return `t 日之后的数据天数须在 ${DATASET_BUILD_FILTER_LIMITS.postWindowDays.min}..${DATASET_BUILD_FILTER_LIMITS.postWindowDays.max}`;
  }

  const horizons = parseNumberList(form.outcomeHorizons);
  if (horizons.length === 0) return "至少一个结果视界";
  if (horizons.length > DATASET_BUILD_CONFIG_LIMITS.maxHorizons) {
    return `结果视界最多 ${DATASET_BUILD_CONFIG_LIMITS.maxHorizons} 个`;
  }
  for (const h of horizons) {
    if (!Number.isInteger(h) || h < DATASET_BUILD_CONFIG_LIMITS.horizon.min || h > DATASET_BUILD_CONFIG_LIMITS.horizon.max) {
      return `结果视界须为 ${DATASET_BUILD_CONFIG_LIMITS.horizon.min}..${DATASET_BUILD_CONFIG_LIMITS.horizon.max} 的整数`;
    }
  }
  if (new Set(horizons).size !== horizons.length) return "结果视界存在重复项";

  const batch = Number(form.batchSize);
  if (form.batchSize.trim() === "" || !Number.isInteger(batch)) return "批大小须为整数";
  if (batch < DATASET_BUILD_CONFIG_LIMITS.batchSize.min || batch > DATASET_BUILD_CONFIG_LIMITS.batchSize.max) {
    return `批大小须在 ${DATASET_BUILD_CONFIG_LIMITS.batchSize.min}..${DATASET_BUILD_CONFIG_LIMITS.batchSize.max}`;
  }

  return null;
}

/**
 * 表单 → wire 载荷。调用前必须已通过 `validateFilterForm`（此处按契约做确定性整形：
 * 相对日升序、视界去重升序）。
 */
export function buildFilterPayload(form: DatasetFilterFormState): DatasetBuildFilter {
  const events = form.events
    .map((r) => ({ relativeDay: Number(r.relativeDay), kind: r.kind }))
    .sort((a, b) => a.relativeDay - b.relativeDay || a.kind.localeCompare(b.kind));
  const horizons = Array.from(new Set(parseNumberList(form.outcomeHorizons))).sort((a, b) => a - b);
  return {
    boards: [...form.boards],
    excludeSt: form.excludeSt,
    events,
    preWindowDays: Number(form.preWindowDays),
    postWindowDays: Number(form.postWindowDays),
    outcomeHorizons: horizons,
    batchSize: Number(form.batchSize),
  };
}

/** 筛选口径的人类可读摘要（复用 shared 唯一文案来源，禁止自行拼串）。 */
export function describeFilterForm(form: DatasetFilterFormState): string {
  return describeDatasetFilter({
    boards: form.boards,
    excludeSt: form.excludeSt,
    events: form.events.map((r) => ({ relativeDay: Number(r.relativeDay), kind: r.kind })),
    preWindowDays: Number(form.preWindowDays) || 0,
    postWindowDays: Number(form.postWindowDays) || 0,
  });
}
