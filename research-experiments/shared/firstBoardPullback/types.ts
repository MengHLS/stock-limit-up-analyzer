export const FIRST_BOARD_PULLBACK_DATASET_CODE = "first_limit_pullback";
export const FIRST_BOARD_PULLBACK_CORE_DATASET_VERSION_LABEL = "v5";
export const FIRST_BOARD_PULLBACK_MAX_RELATIVE_DAY = 20;
export const FIRST_BOARD_PULLBACK_EPSILON = 1e-9;

export const FIRST_BOARD_ENTRY_MODES = [
  "FIXED_T1_OPEN",
  "FIXED_T2_OPEN",
  "FIXED_T3_OPEN",
  "FIXED_T4_OPEN",
  "FIXED_T5_OPEN",
  "FIXED_T6_OPEN",
  "DYNAMIC_PULLBACK_V1",
] as const;
export type FirstBoardEntryMode = (typeof FIRST_BOARD_ENTRY_MODES)[number];

export const FOUNDATION_SAMPLE_SETS = ["FULL", "COMMON"] as const;
export type FoundationSampleSet = (typeof FOUNDATION_SAMPLE_SETS)[number];

export const FOUNDATION_ANCHOR_HOLDING_DAYS = [1, 2, 3, 5, 10, 15, 20] as const;
export const FOUNDATION_BOOTSTRAP_ITERATIONS = 1_000;
export const FOUNDATION_BOOTSTRAP_BLOCK_DAYS = 20;
export const FOUNDATION_BOOTSTRAP_SEED = 20_260_922;

export interface FoundationCostConfig {
  /** 单边佣金。 */
  commissionBpsPerSide: number;
  /** 单边滑点。 */
  slippageBpsPerSide: number;
  /** 单边冲击成本。 */
  impactBpsPerSide: number;
  /** A 股卖出印花税。 */
  stampDutyBps: number;
}

export const DEFAULT_FOUNDATION_COST: FoundationCostConfig = Object.freeze({
  commissionBpsPerSide: 2.5,
  slippageBpsPerSide: 2.5,
  impactBpsPerSide: 2.5,
  stampDutyBps: 5,
});

export interface NormalizedFoundationBar {
  relativeDay: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  preClose: number | null;
  limitUpPrice: number | null;
  limitDownPrice: number | null;
  barPresent: boolean;
  suspended: boolean;
  canBuyAtOpen: boolean | null;
  canSellAtClose: boolean | null;
  structurallyValid: boolean;
}

export interface NormalizedFoundationEvent {
  eventId: string;
  symbol: string;
  eventDate: string;
  year: number;
  market: string;
  boardType: string;
  turnover: number | null;
  floatMarketCap: number | null;
  previousLimitDate: string | null;
  daysSincePreviousLimit: number | null;
  historicalLimitCount: number | null;
  previousClose: number;
  limitUpPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bodyHeightClose: number;
  bodyHeightPreviousClose: number;
  oneWordLimitUp: boolean;
  barsByRelativeDay: ReadonlyMap<number, NormalizedFoundationBar>;
}

export interface FoundationGroup {
  code: string;
  label: string;
}

export type FoundationGroupAssigner = (
  event: NormalizedFoundationEvent
) => readonly FoundationGroup[];

export type FoundationPanelExitReason =
  | "TARGET_CLOSE"
  | "NEXT_SELLABLE_OPEN"
  | "NEXT_SELLABLE_CLOSE"
  | "RIGHT_CENSORED";

export interface FoundationPanelRow {
  event_id: string;
  event_date: string;
  year: number;
  symbol: string;
  entry_mode: FirstBoardEntryMode;
  entry_day: number;
  exit_day: number;
  holding_day: number;
  gross_return: number | null;
  net_return: number | null;
  ideal_gross_return: number | null;
  ideal_net_return: number | null;
  can_buy: boolean;
  can_sell: boolean;
  exit_reason: FoundationPanelExitReason;
  execution_delay_days: number | null;
  right_censored: boolean;
  common_sample_flag: boolean;
  missing_bar: boolean;
  suspended: boolean;
  mfe: number | null;
  mae: number | null;
  peak_holding_day: number | null;
  trough_holding_day: number | null;
  first_plus_2_holding_day: number | null;
  first_minus_2_holding_day: number | null;
  first_plus_5_holding_day: number | null;
  first_minus_5_holding_day: number | null;
  path_class_v1: string | null;
}

export interface FoundationCurveRow {
  [key: string]: string | number | boolean | null;
  group_code: string;
  group_label: string;
  entry_mode: FirstBoardEntryMode;
  sample_set: FoundationSampleSet;
  holding_day: number;
  relative_day: number;
  sample_count: number;
  event_date_count: number;
  mean_net_return: number | null;
  mean_ideal_net_return: number | null;
  mean_execution_shortfall: number | null;
  trimmed_mean_net_return: number | null;
  median_net_return: number | null;
  win_rate_net: number | null;
  p5_net_return: number | null;
  p25_net_return: number | null;
  p75_net_return: number | null;
  p95_net_return: number | null;
  mean_mfe: number | null;
  median_mfe: number | null;
  mean_mae: number | null;
  median_mae: number | null;
  median_peak_holding_day: number | null;
  median_trough_holding_day: number | null;
  reach_plus_2_rate: number | null;
  reach_minus_2_rate: number | null;
  reach_plus_5_rate: number | null;
  reach_minus_5_rate: number | null;
}

export interface FoundationBootstrapRow {
  [key: string]: string | number | null;
  group_code: string;
  group_label: string;
  entry_mode: FirstBoardEntryMode;
  sample_set: FoundationSampleSet;
  holding_day: number;
  mean_net_return: number | null;
  bootstrap_ci95_low: number | null;
  bootstrap_ci95_high: number | null;
  bootstrap_cluster_count: number;
}

export interface FoundationAccountingRow {
  [key: string]: string | number;
  entry_mode: FirstBoardEntryMode;
  eligible_event_count: number;
  full_sample_event_count: number;
  common_sample_event_count: number;
  right_censored_event_count: number;
  missing_path_event_count: number;
  suspended_event_count: number;
  entry_unavailable_event_count: number;
  unfillable_exit_event_count: number;
}

export interface FoundationLineageRow {
  [key: string]: string | number | null;
  dataset_code: string;
  dataset_version_id: number;
  dataset_version_label: string;
  experiment_id: string;
  experiment_version: string;
  code_digest: string;
  research_phase: string;
  protocol_fingerprint: string | null;
  sample_scope_note: string;
}

export interface FoundationBuildOutput {
  accounting: readonly FoundationAccountingRow[];
  curveRows: readonly FoundationCurveRow[];
  bootstrapRows: readonly FoundationBootstrapRow[];
  lineage: FoundationLineageRow;
  artifactNames: readonly string[];
  tables: readonly import("@shared/researchExperimentsContracts").ExperimentResultTable[];
  charts: readonly import("@shared/researchExperimentsContracts").ExperimentResultChart[];
}
