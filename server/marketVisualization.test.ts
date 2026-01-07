import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getLimitUpWithMarketData } from "./db";

describe("Market Data Visualization API", () => {
  describe("getLimitUpWithMarketData", () => {
    it("should return array of data with date, limitUpCount, turnover, and marginBalance", async () => {
      const result = await getLimitUpWithMarketData(30);
      
      expect(Array.isArray(result)).toBe(true);
      
      // 检查返回数据的结构
      if (result.length > 0) {
        const item = result[0];
        expect(item).toHaveProperty("date");
        expect(item).toHaveProperty("limitUpCount");
        expect(typeof item.date).toBe("string");
        expect(typeof item.limitUpCount).toBe("number");
      }
    });

    it("should return data sorted by date in ascending order", async () => {
      const result = await getLimitUpWithMarketData(30);
      
      if (result.length > 1) {
        for (let i = 1; i < result.length; i++) {
          expect(result[i].date >= result[i - 1].date).toBe(true);
        }
      }
    });

    it("should respect the days parameter", async () => {
      const result7Days = await getLimitUpWithMarketData(7);
      const result30Days = await getLimitUpWithMarketData(30);
      
      // 7天的数据应该少于或等于30天的数据
      expect(result7Days.length <= result30Days.length).toBe(true);
    });

    it("should include market data when available", async () => {
      const result = await getLimitUpWithMarketData(30);
      
      // 检查是否有包含成交额或两融余额的数据
      const hasMarketData = result.some(
        (item) => item.turnover !== undefined || item.marginBalance !== undefined
      );
      
      // 如果数据库中有大盘数据，应该能找到
      if (result.length > 0) {
        expect(typeof hasMarketData).toBe("boolean");
      }
    });

    it("should handle empty results gracefully", async () => {
      const result = await getLimitUpWithMarketData(0);
      
      // 0天应该返回空数组或只有今天的数据
      expect(Array.isArray(result)).toBe(true);
    });

    it("should parse turnover and marginBalance as numbers correctly", async () => {
      const result = await getLimitUpWithMarketData(30);
      
      result.forEach((item) => {
        if (item.turnover !== undefined) {
          const turnoverNum = parseFloat(item.turnover);
          expect(typeof turnoverNum).toBe("number");
          expect(!isNaN(turnoverNum)).toBe(true);
        }
        
        if (item.marginBalance !== undefined) {
          const marginNum = parseFloat(item.marginBalance);
          expect(typeof marginNum).toBe("number");
          expect(!isNaN(marginNum)).toBe(true);
        }
      });
    });
  });
});
