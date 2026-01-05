import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("limitUp.getDailyStats", () => {
  it("should return daily limit up statistics", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.limitUp.getDailyStats();

    expect(Array.isArray(result)).toBe(true);
    
    if (result.length > 0) {
      const firstItem = result[0];
      expect(firstItem).toHaveProperty('date');
      expect(firstItem).toHaveProperty('count');
      expect(typeof firstItem.date).toBe('string');
      expect(typeof firstItem.count).toBe('number');
      
      // 验证日期格式 YYYY-MM-DD
      expect(firstItem.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      
      // 验证数据按日期升序排列
      if (result.length > 1) {
        expect(result[0].date <= result[1].date).toBe(true);
      }
    }
  });
});

describe("limitUp.getSectorDistribution", () => {
  it("should return daily sector distribution statistics", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.limitUp.getSectorDistribution();

    expect(Array.isArray(result)).toBe(true);
    
    if (result.length > 0) {
      const firstDay = result[0];
      expect(firstDay).toHaveProperty('date');
      expect(firstDay).toHaveProperty('sectors');
      expect(typeof firstDay.date).toBe('string');
      expect(Array.isArray(firstDay.sectors)).toBe(true);
      
      // 验证日期格式
      expect(firstDay.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      
      // 验证数据按日期降序排列
      if (result.length > 1) {
        expect(result[0].date >= result[1].date).toBe(true);
      }
      
      // 验证题材数据结构
      if (firstDay.sectors.length > 0) {
        const firstSector = firstDay.sectors[0];
        expect(firstSector).toHaveProperty('sector');
        expect(firstSector).toHaveProperty('count');
        expect(typeof firstSector.sector).toBe('string');
        expect(typeof firstSector.count).toBe('number');
        
        // 验证"其他"题材在最后
        const otherIndex = firstDay.sectors.findIndex(s => s.sector === '其他');
        if (otherIndex !== -1) {
          expect(otherIndex).toBe(firstDay.sectors.length - 1);
        }
        
        // 验证题材按涨停数降序排列（除了"其他"）
        const nonOtherSectors = firstDay.sectors.filter(s => s.sector !== '其他');
        if (nonOtherSectors.length > 1) {
          expect(nonOtherSectors[0].count >= nonOtherSectors[1].count).toBe(true);
        }
      }
    }
  });
});
