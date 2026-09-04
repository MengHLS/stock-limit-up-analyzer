import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTushareTradingDateCache, fetchTushareTradingDates } from "./tushare";

describe("Tushare交易日历缓存", () => {
  afterEach(() => {
    clearTushareTradingDateCache();
    vi.restoreAllMocks();
    delete process.env.TUSHARE_TOKEN;
  });

  it("相同日期范围在有效期内只请求一次，并返回独立数组", async () => {
    process.env.TUSHARE_TOKEN = "test-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { fields: ["cal_date", "is_open"], items: [["20260901", 1], ["20260902", 0], ["20260903", 1]] } }), { status: 200 }));
    const first = await fetchTushareTradingDates("2026-09-01", "2026-09-03");
    first.push("2099-01-01");
    const second = await fetchTushareTradingDates("2026-09-01", "2026-09-03");
    expect(second).toEqual(["2026-09-01", "2026-09-03"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("并发请求相同范围会复用同一个进行中的请求", async () => {
    process.env.TUSHARE_TOKEN = "test-token";
    let resolveResponse!: (response: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(responsePromise);
    const first = fetchTushareTradingDates("2026-09-01", "2026-09-03");
    const second = fetchTushareTradingDates("2026-09-01", "2026-09-03");
    resolveResponse(new Response(JSON.stringify({ code: 0, data: { fields: ["cal_date", "is_open"], items: [["20260901", 1]] } }), { status: 200 }));
    await expect(Promise.all([first, second])).resolves.toEqual([["2026-09-01"], ["2026-09-01"]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("不同日期范围分别缓存，避免错误复用结果", async () => {
    process.env.TUSHARE_TOKEN = "test-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const date = body.params.start_date;
      return new Response(JSON.stringify({ code: 0, data: { fields: ["cal_date", "is_open"], items: [[date, 1]] } }), { status: 200 });
    });
    await expect(fetchTushareTradingDates("2026-09-01", "2026-09-01")).resolves.toEqual(["2026-09-01"]);
    await expect(fetchTushareTradingDates("2026-09-02", "2026-09-02")).resolves.toEqual(["2026-09-02"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
