import { describe, expect, it, vi, beforeEach } from "vitest";
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
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

function createPublicContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

describe("limitUp router", () => {
  describe("getAll", () => {
    it("returns an array of records (public access)", async () => {
      const { ctx } = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.limitUp.getAll();

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getDates", () => {
    it("returns an array of date strings (public access)", async () => {
      const { ctx } = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.limitUp.getDates();

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("search", () => {
    it("returns empty array for empty query", async () => {
      const { ctx } = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.limitUp.search({ query: "" });

      expect(result).toEqual([]);
    });

    it("returns array for valid query", async () => {
      const { ctx } = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.limitUp.search({ query: "test" });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getByDate", () => {
    it("returns array of records for a given date", async () => {
      const { ctx } = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.limitUp.getByDate({ date: "2024-12-31" });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getSectorStats", () => {
    it("returns sector statistics for a given date", async () => {
      const { ctx } = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.limitUp.getSectorStats({ date: "2024-12-31" });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("create (protected)", () => {
    it("creates a new limit up record when authenticated", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const input = {
        stockCode: "000001.SZ",
        stockName: "测试股票",
        limitUpDate: "2024-12-31",
        limitUpTime: "10:30:00",
        boardCount: "1板",
        sector: "测试题材",
        keywords: "测试关键词",
      };

      const result = await caller.limitUp.create(input);

      expect(result).toBeDefined();
      if (result) {
        expect(result.stockCode).toBe(input.stockCode);
        expect(result.stockName).toBe(input.stockName);
      }
    });
  });

  describe("delete (protected)", () => {
    it("requires authentication", async () => {
      const { ctx } = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.limitUp.delete({ id: 999 })).rejects.toThrow();
    });
  });
});

describe("image router", () => {
  describe("getAll (protected)", () => {
    it("requires authentication", async () => {
      const { ctx } = createPublicContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.image.getAll()).rejects.toThrow();
    });

    it("returns array when authenticated", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.image.getAll();

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
