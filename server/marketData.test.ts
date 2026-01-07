import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { upsertMarketData, getMarketDataByDate, getAllMarketData, deleteMarketData } from "./db";

describe("Market Data Functions", () => {
  const testDate = "2026-01-10";
  const testData = {
    dataDate: testDate,
    turnover: "15000",
    marginBalance: "8500",
    note: "Test market data",
    createdBy: 1,
  };

  it("should upsert market data", async () => {
    const result = await upsertMarketData(testData);
    expect(result).toBeDefined();
    expect(result?.dataDate).toBe(testDate);
    expect(result?.turnover).toBe("15000");
    expect(result?.marginBalance).toBe("8500");
  });

  it("should get market data by date", async () => {
    const result = await getMarketDataByDate(testDate);
    expect(result).toBeDefined();
    expect(result?.dataDate).toBe(testDate);
    expect(result?.turnover).toBe("15000");
  });

  it("should get all market data", async () => {
    const results = await getAllMarketData();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should update existing market data", async () => {
    const updatedData = {
      dataDate: testDate,
      turnover: "16000",
      marginBalance: "9000",
      note: "Updated test data",
      createdBy: 1,
    };
    const result = await upsertMarketData(updatedData);
    expect(result?.turnover).toBe("16000");
    expect(result?.marginBalance).toBe("9000");
  });

  it("should delete market data", async () => {
    // First get the data to get its ID
    const data = await getMarketDataByDate(testDate);
    if (data && data.id) {
      const deleted = await deleteMarketData(data.id);
      expect(deleted).toBe(true);

      // Verify it's deleted
      const result = await getMarketDataByDate(testDate);
      expect(result).toBeNull();
    }
  });
});
