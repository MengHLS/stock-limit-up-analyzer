import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

// 本地开发模式：跳过 Manus OAuth 登录，直接注入一个本地管理员账号。
// id=1 对应原始数据中的 createdBy=1（原所有者），role=admin 保证拥有全部权限。
const LOCAL_DEV_USER: User = {
  id: 1,
  openId: "local-dev-user",
  name: "本地开发",
  email: null,
  loginMethod: null,
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  if (process.env.NODE_ENV === "development") {
    user = LOCAL_DEV_USER;
  } else {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
