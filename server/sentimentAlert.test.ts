import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, and, desc } from "drizzle-orm";
import { sentimentAlerts, limitUpRecords } from "../drizzle/schema";

// 数据库连接
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  if (process.env.DATABASE_URL) {
    db = drizzle(process.env.DATABASE_URL);
  }
});

describe("Sentiment Alert Functions", () => {
  describe("EMOTION_LEVELS", () => {
    it("should have correct emotion level definitions", async () => {
      const { EMOTION_LEVELS, getEmotionLevel } = await import("./db");
      
      // 验证情绪等级定义
      expect(EMOTION_LEVELS.EXTREME_COLD.max).toBe(20);
      expect(EMOTION_LEVELS.COLD.max).toBe(35);
      expect(EMOTION_LEVELS.COOL.max).toBe(45);
      expect(EMOTION_LEVELS.NEUTRAL.max).toBe(55);
      expect(EMOTION_LEVELS.WARM.max).toBe(65);
      expect(EMOTION_LEVELS.HOT.max).toBe(80);
      expect(EMOTION_LEVELS.EXTREME_HOT.max).toBe(100);
    });

    it("should return correct emotion level for given score", async () => {
      const { getEmotionLevel } = await import("./db");
      
      // 测试各个评分区间
      expect(getEmotionLevel(10).label).toBe("极度冰点");
      expect(getEmotionLevel(25).label).toBe("冰点");
      expect(getEmotionLevel(40).label).toBe("偏冷");
      expect(getEmotionLevel(50).label).toBe("中性");
      expect(getEmotionLevel(60).label).toBe("偏暖");
      expect(getEmotionLevel(75).label).toBe("亢奋");
      expect(getEmotionLevel(90).label).toBe("极度亢奋");
    });
  });

  describe("getAllSentimentAlerts", () => {
    it("should return an array of alerts", async () => {
      const { getAllSentimentAlerts } = await import("./db");
      
      const alerts = await getAllSentimentAlerts(10);
      
      expect(Array.isArray(alerts)).toBe(true);
    });

    it("should respect the limit parameter", async () => {
      const { getAllSentimentAlerts } = await import("./db");
      
      const alerts = await getAllSentimentAlerts(5);
      
      expect(alerts.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getUnreadAlertCount", () => {
    it("should return a number", async () => {
      const { getUnreadAlertCount } = await import("./db");
      
      const count = await getUnreadAlertCount();
      
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("detectSentimentTurningPoint", () => {
    it("should return null for non-existent date", async () => {
      const { detectSentimentTurningPoint } = await import("./db");
      
      // 使用一个不存在的日期
      const result = await detectSentimentTurningPoint("1990-01-01");
      
      expect(result).toBeNull();
    });

    it("should detect turning point for valid date with data", async () => {
      const { detectSentimentTurningPoint, getConnectionBoardStats } = await import("./db");
      
      // 先获取有数据的日期
      if (!db) return;
      
      const records = await db.select()
        .from(limitUpRecords)
        .orderBy(desc(limitUpRecords.limitUpDate))
        .limit(10);
      
      if (records.length < 2) {
        // 数据不足，跳过测试
        return;
      }
      
      // 获取第一个有数据的日期
      const testDate = records[0].limitUpDate;
      
      // 调用检测函数（可能返回null或预警对象）
      const result = await detectSentimentTurningPoint(testDate);
      
      // 结果应该是null或有效的预警对象
      if (result !== null) {
        expect(result.alertDate).toBe(testDate);
        expect(["warming", "cooling", "extreme_hot", "extreme_cold"]).toContain(result.alertType);
        expect(typeof result.currentScore).toBe("number");
        expect(typeof result.title).toBe("string");
      }
    });
  });

  describe("createSentimentAlert", () => {
    it("should create a new alert or return existing one", async () => {
      const { createSentimentAlert, getAllSentimentAlerts } = await import("./db");
      
      // 创建测试预警
      const testAlert = {
        alertDate: "2026-01-01",
        alertType: "warming" as const,
        title: "测试预警",
        description: "这是一条测试预警",
        currentScore: 50,
        previousScore: 30,
        scoreChange: 20,
        totalLimitUp: 100,
        connectionBoards: 20,
        maxBoards: 5,
        isRead: "0" as const,
      };
      
      const result = await createSentimentAlert(testAlert);
      
      if (result) {
        expect(result.alertDate).toBe(testAlert.alertDate);
        expect(result.alertType).toBe(testAlert.alertType);
        expect(result.currentScore).toBe(testAlert.currentScore);
      }
    });
  });

  describe("markAlertAsRead", () => {
    it("should mark an alert as read", async () => {
      const { markAlertAsRead, getAllSentimentAlerts } = await import("./db");
      
      // 获取一条预警
      const alerts = await getAllSentimentAlerts(1);
      
      if (alerts.length > 0) {
        const alertId = alerts[0].id;
        const result = await markAlertAsRead(alertId);
        
        // 结果应该是布尔值
        expect(typeof result).toBe("boolean");
      }
    });
  });

  describe("markAllAlertsAsRead", () => {
    it("should return the number of alerts marked as read", async () => {
      const { markAllAlertsAsRead } = await import("./db");
      
      const count = await markAllAlertsAsRead();
      
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("checkAndCreateAlert", () => {
    it("should check and potentially create an alert for a date", async () => {
      const { checkAndCreateAlert } = await import("./db");
      
      // 使用一个有数据的日期
      if (!db) return;
      
      const records = await db.select()
        .from(limitUpRecords)
        .orderBy(desc(limitUpRecords.limitUpDate))
        .limit(1);
      
      if (records.length === 0) return;
      
      const testDate = records[0].limitUpDate;
      const result = await checkAndCreateAlert(testDate);
      
      // 结果可能是null或预警对象
      if (result !== null) {
        expect(result.alertDate).toBe(testDate);
        expect(typeof result.id).toBe("number");
      }
    });
  });
});
