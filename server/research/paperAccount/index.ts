/**
 * STEP 23 / C-23.1 — 模拟账户与持仓（Paper Trading Account）统一出口。
 *
 * 交付内容：
 *   - types.ts      领域类型契约（PaperAccount/PaperAccountPosition/PaperAccountOrder/
 *                   PaperAccountFill/PaperCashLedgerEntry/PaperAccountRun + 记录身份常量）；
 *   - errors.ts     结构化错误（PaperAccountError，稳定 code，FAIL FAST）；
 *   - account.ts    账户状态机纯函数（开仓/加仓/减仓/清仓/T+1 冻结解冻/冻结资金/mark-to-market）；
 *   - constraints.ts 订单→成交约束检查 + 六维能力矩阵（复用 C-14.3 声明 + 诚实 blocker）；
 *   - run.ts        PaperAccountRun 记录装配 + PnL 分解 + C-16.3 适配；
 *   - serialize.ts  canonical + sha256 指纹 + round-trip + 篡改拒绝；
 *   - validate.ts   PaperAccountRun 结构复核。
 *
 * 纯模块：无 DB / 无 Date.now / 无 Math.random / 无 IO；不可变、确定性。
 * 边界：不做信号生成（注入式）、不做闭环编排（C-23.2）。
 * 注意：本目录独立自持 index；research/index.ts 属既有文件未改动，由协调者统一补导出。
 */

export * from "./types";
export * from "./errors";
export * from "./account";
export * from "./constraints";
export * from "./run";
export * from "./serialize";
export * from "./validate";
