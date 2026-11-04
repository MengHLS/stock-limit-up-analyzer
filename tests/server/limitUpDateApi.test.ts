import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildLimitUpDateResponse, parseLimitUpDate, registerLimitUpDateRoute } from "../../server/limitUpDateApi";

const record = {
  id: 1,
  stockCode: "000002.SZ",
  stockName: "万科A",
  limitUpDate: "2026-09-29",
  limitUpTime: "09:35:12",
  boardCount: "1天1板",
  circulationValue: "123.45",
  turnover: "8.76",
  sector: "房地产",
  keywords: "地产",
  createdBy: 1,
  createdAt: new Date("2026-09-29T08:00:00.000Z"),
  updatedAt: new Date("2026-09-29T08:00:00.000Z"),
};

let servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  servers = [];
});

async function createTestApi(recordsByDate: Record<string, typeof record[]>) {
  const app = express();
  registerLimitUpDateRoute(app, async (date) => recordsByDate[date] ?? []);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试 HTTP 服务未成功监听");
  return `http://127.0.0.1:${address.port}`;
}

describe("limit-up date REST API", () => {
  it("accepts valid calendar dates and rejects malformed dates", () => {
    expect(parseLimitUpDate("2026-09-29")).toBe("2026-09-29");
    expect(parseLimitUpDate("20260929")).toBeNull();
    expect(parseLimitUpDate("2026-02-30")).toBeNull();
    expect(parseLimitUpDate(undefined)).toBeNull();
  });

  it("returns every database field for a valid date", async () => {
    const baseUrl = await createTestApi({ "2026-09-29": [record] });
    const response = await fetch(`${baseUrl}/api/limit-up?date=2026-09-29`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(JSON.parse(JSON.stringify(buildLimitUpDateResponse("2026-09-29", [record]))));
    expect(body.data[0]).toHaveProperty("stockCode", "000002.SZ");
    expect(body.data[0]).toHaveProperty("keywords", "地产");
  });

  it("returns an empty array for a valid date without records", async () => {
    const baseUrl = await createTestApi({});
    const response = await fetch(`${baseUrl}/api/limit-up?date=2026-01-01`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, date: "2026-01-01", count: 0, data: [] });
  });

  it("returns 400 for an invalid date", async () => {
    const baseUrl = await createTestApi({});
    const response = await fetch(`${baseUrl}/api/limit-up?date=20260929`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("YYYY-MM-DD");
  });
});
