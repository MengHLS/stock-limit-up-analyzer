/**
 * 运行模式判定（唯一权威）。
 *
 * 为什么不在 npm 脚本里写 `NODE_ENV=development tsx watch ...`：
 * Windows 下 npm 默认用 cmd.exe 执行脚本，这种「前置赋值」语法在 cmd 中会直接报
 * `'NODE_ENV' 不是内部或外部命令` ⇒ 本地一条 `npm run dev` 都起不来。
 * 所以模式放在运行时判定：
 *   - `NODE_ENV=production` 或启动参数带 `--production`（`npm start` 用的就是它）⇒ 生产；
 *   - 其余（含未声明）⇒ 本地开发，`npm run dev` 无需任何前缀。
 */
export function resolveRuntimeNodeEnv(): "development" | "production" {
  if (process.env.NODE_ENV === "production" || process.argv.includes("--production")) {
    return "production";
  }
  return "development";
}

const runtimeNodeEnv = resolveRuntimeNodeEnv();

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  nodeEnv: runtimeNodeEnv,
  isProduction: runtimeNodeEnv === "production",
  isDevelopment: runtimeNodeEnv === "development",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
