import type { Express, Request, Response } from "express";
import type { LimitUpRecord } from "../drizzle/schema";

export function parseLimitUpDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return null;
  }

  return date;
}

export function buildLimitUpDateResponse(date: string, records: LimitUpRecord[]) {
  return {
    success: true as const,
    date,
    count: records.length,
    data: records,
  };
}

type GetRecordsByDate = (date: string) => Promise<LimitUpRecord[]>;

export function registerLimitUpDateRoute(app: Express, getRecordsByDate: GetRecordsByDate) {
  app.get("/api/limit-up", async (req: Request, res: Response) => {
    const date = parseLimitUpDate(req.query.date);
    if (!date) {
      return res.status(400).json({
        success: false,
        error: "date 参数必填，格式必须为 YYYY-MM-DD，例如 2026-09-29",
      });
    }

    try {
      const records = await getRecordsByDate(date);
      return res.json(buildLimitUpDateResponse(date, records));
    } catch (error) {
      console.error(`[LimitUpAPI] Failed to query ${date}:`, error);
      return res.status(500).json({
        success: false,
        error: "查询涨停数据失败",
      });
    }
  });
}
