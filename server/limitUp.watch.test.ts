import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { stockWatchlist } from "../drizzle/schema";
import { eq } from "drizzle-orm";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `test${userId}@example.com`,
    name: `Test User ${userId}`,
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
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return ctx;
}

describe("limitUp.getWatchStatus and updateWatchStatus", () => {
  const testStockCode = "TEST001.SZ";
  const testStockName = "测试股票";
  const testUserId = 999;

  // 清理测试数据
  beforeEach(async () => {
    const db = await getDb();
    if (db) {
      await db.delete(stockWatchlist).where(eq(stockWatchlist.userId, testUserId));
    }
  });

  it("should return 'none' for unwatched stock", async () => {
    const ctx = createAuthContext(testUserId);
    const caller = appRouter.createCaller(ctx);

    const status = await caller.limitUp.getWatchStatus({ stockCode: testStockCode });

    expect(status).toBe("none");
  });

  it("should add stock to normal watch and return 'normal'", async () => {
    const ctx = createAuthContext(testUserId);
    const caller = appRouter.createCaller(ctx);

    // 添加普通关注
    await caller.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "normal",
    });

    // 验证状态
    const status = await caller.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status).toBe("normal");
  });

  it("should upgrade from normal to important watch", async () => {
    const ctx = createAuthContext(testUserId);
    const caller = appRouter.createCaller(ctx);

    // 先添加普通关注
    await caller.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "normal",
    });

    // 升级为重点关注
    await caller.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "important",
    });

    // 验证状态
    const status = await caller.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status).toBe("important");
  });

  it("should remove watch when status is 'none'", async () => {
    const ctx = createAuthContext(testUserId);
    const caller = appRouter.createCaller(ctx);

    // 先添加关注
    await caller.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "important",
    });

    // 取消关注
    await caller.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "none",
    });

    // 验证状态
    const status = await caller.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status).toBe("none");
  });

  it("should handle complete watch cycle: none -> normal -> important -> none", async () => {
    const ctx = createAuthContext(testUserId);
    const caller = appRouter.createCaller(ctx);

    // 初始状态：未关注
    let status = await caller.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status).toBe("none");

    // 添加普通关注
    await caller.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "normal",
    });
    status = await caller.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status).toBe("normal");

    // 升级为重点关注
    await caller.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "important",
    });
    status = await caller.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status).toBe("important");

    // 取消关注
    await caller.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "none",
    });
    status = await caller.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status).toBe("none");
  });

  it("should isolate watch status between different users", async () => {
    const user1Ctx = createAuthContext(testUserId);
    const user2Ctx = createAuthContext(testUserId + 1);
    const caller1 = appRouter.createCaller(user1Ctx);
    const caller2 = appRouter.createCaller(user2Ctx);

    // 用户1添加关注
    await caller1.limitUp.updateWatchStatus({
      stockCode: testStockCode,
      stockName: testStockName,
      watchStatus: "important",
    });

    // 验证用户1的状态
    const status1 = await caller1.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status1).toBe("important");

    // 验证用户2的状态（应该是未关注）
    const status2 = await caller2.limitUp.getWatchStatus({ stockCode: testStockCode });
    expect(status2).toBe("none");

    // 清理用户2的测试数据
    const db = await getDb();
    if (db) {
      await db.delete(stockWatchlist).where(eq(stockWatchlist.userId, testUserId + 1));
    }
  });
});
