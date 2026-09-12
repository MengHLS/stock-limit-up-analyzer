
启动（开发）

pnpm install     # 首次或依赖变更后
pnpm run dev     # 跨平台：Windows Git Bash / cmd / PowerShell / macOS / Linux 均可

启动后访问 http://localhost:3000/ 。端口取自 .env 的 PORT（默认 3000）。
注意：别再往 npm 脚本里写 `NODE_ENV=development tsx ...` 这种前置赋值——Windows 下 npm 用 cmd.exe
执行脚本会直接报 `'NODE_ENV' 不是内部或外部命令`。运行模式改由 server/_core/env.ts#resolveRuntimeNodeEnv
在运行时判定：未显式声明 production 时一律按本地开发处理。

生产构建与启动

pnpm run build
pnpm run start   # 等价于 node dist/index.js --production

手动启动（不经过 npm 脚本）

pnpm exec tsx watch server/_core/index.ts
