import { gzipSync } from "node:zlib";
import type { ExperimentRunContext } from "@shared/researchExperimentsContracts";
import type { FoundationPanelRow } from "./types";

const PANEL_COLUMNS: readonly (keyof FoundationPanelRow)[] = [
  "event_id",
  "event_date",
  "year",
  "symbol",
  "entry_mode",
  "entry_day",
  "exit_day",
  "holding_day",
  "gross_return",
  "net_return",
  "ideal_gross_return",
  "ideal_net_return",
  "can_buy",
  "can_sell",
  "exit_reason",
  "execution_delay_days",
  "right_censored",
  "common_sample_flag",
  "missing_bar",
  "suspended",
  "mfe",
  "mae",
  "peak_holding_day",
  "trough_holding_day",
  "first_plus_2_holding_day",
  "first_minus_2_holding_day",
  "first_plus_5_holding_day",
  "first_minus_5_holding_day",
  "path_class_v1",
];

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function panelCsvLine(row: FoundationPanelRow): string {
  return PANEL_COLUMNS.map(column => csvCell(row[column])).join(",") + "\n";
}

export class FoundationPanelCsvWriter {
  private readonly buffers = new Map<string, Buffer[]>();
  private readonly artifactNames: string[] = [];

  addRows(rows: readonly FoundationPanelRow[]): void {
    for (const row of rows) {
      const key = `${row.entry_mode}-${row.year}`;
      let chunks = this.buffers.get(key);
      if (chunks === undefined) {
        chunks = [
          Buffer.from(PANEL_COLUMNS.join(",") + "\n", "utf8"),
        ];
        this.buffers.set(key, chunks);
      }
      chunks.push(Buffer.from(panelCsvLine(row), "utf8"));
    }
  }

  flush(context: ExperimentRunContext): readonly string[] {
    for (const [key, chunks] of this.buffers) {
      const bytes = gzipSync(Buffer.concat(chunks), { level: 6 });
      const name = `foundation/panel-${key}.csv.gz`;
      context.artifact({
        name,
        role: "table",
        body: new Uint8Array(bytes),
        contentType: "application/gzip",
        label: `entryDay × exitDay 面板 ${key}`,
        description:
          "公共收益面板，列为 event_id/entry_day/exit_day/holding_day/ideal/executable/commonSample。",
      });
      this.artifactNames.push(name);
    }
    return this.artifactNames;
  }
}
