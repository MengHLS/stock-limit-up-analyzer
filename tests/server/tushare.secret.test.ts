import { describe, expect, it } from "vitest";

const TUSHARE_API_URL = "https://api.tushare.pro";

describe("Tushare Token", () => {
  it("可调用 A 股日线 daily 接口", async () => {
    const token = process.env.TUSHARE_TOKEN;
    expect(token).toBeTruthy();

    const response = await fetch(TUSHARE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_name: "daily",
        token,
        params: {
          ts_code: "000001.SZ",
          trade_date: "20240102",
        },
        fields: "ts_code,trade_date,open,close,pre_close",
      }),
    });

    expect(response.ok).toBe(true);
    const payload = await response.json() as {
      code?: number;
      msg?: string;
      data?: { fields?: string[]; items?: unknown[][] };
    };

    expect(payload.code, payload.msg).toBe(0);
    expect(payload.data?.fields).toEqual([
      "ts_code",
      "trade_date",
      "open",
      "close",
      "pre_close",
    ]);
    expect(payload.data?.items?.length).toBeGreaterThan(0);
  }, 20_000);
});
