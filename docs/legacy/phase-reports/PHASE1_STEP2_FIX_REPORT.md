# Step 2-FIX 完成报告

> 修复范围：仅 Step 2 验收报告第 21 节列出的 4 项 P1/P2 阻塞项（不扩展功能、不碰 P3、不改 Step 1 统计层）。
> 变更文件：`server/engine/domain.ts`、`execution.ts`、`portfolio.ts`、`engine.ts`、新增 `server/engine/engine.fix.test.ts`。

---

## 修复项

### P1 maxPositions — 已修复

**状态**：✅ 完成

**实现**：
- `portfolio.ts`：`Portfolio` 构造函数新增 `options: { maxPositions?, maxPositionAmountRatio? }`，`maxPositions` 默认 `Infinity`（兼容既有 `new Portfolio(capital)` / `new Portfolio(capital, dates)` 调用）。
- `Portfolio.buy()` 在持仓去重之后、成交之前检查：`openPositionCount >= maxPositions` → 拒绝，返回 `MAX_POSITIONS_REACHED`，且不改变任何状态。
- `engine.ts`：构造 `Portfolio` 时传入 `config.maxPositions`。
- 约束落在 Portfolio 层（真实持仓状态的最终权威），而非策略/信号层，天然防止同一回测周期内多个 BUY 信号绕过限制。

**测试**：`engine.fix.test.ts` 2 个用例（engine 层集成 + Portfolio 层单元）。

### P1 maxPositionAmountRatio — 已修复

**状态**：✅ 完成

**实现**：
- 单位确认：`bar.amount` 单位为**千元**（Tushare daily amount），证据见 `marketFactors.ts`「amount（千元）求和换算亿元」、`technicalFactors.ts:121`「amount（千元）×1000」、`realisticBacktest.ts:426` / `paperTrading.ts:440` 的 `amount * 1000 * maxPositionAmountRatio`。
- `domain.ts`：`Fill` 新增可选 `amount?: number | null`（成交日成交额，千元，供容量约束）。
- `execution.ts`：`execute` 产出 Fill 时回填 `amount: bar.amount`。
- `portfolio.ts`：`buy()` 中容量计算链：
  1. `capacityAmount = amount × 1000 × ratio`（千元 → 元）
  2. `capacityShares = floor(capacityAmount / price / lotSize) × lotSize`（向下取整到整手）
  3. `capacityShares < lotSize` → 拒绝 `CAPACITY_INSUFFICIENT`
  4. `quantity = min(quantity, capacityShares)`
- 与资金约束取 min：`quantity = min(requestedQuantity, capacityShares, cashLimitShares)`，最终再对齐整手。
- 严格满足 `actualOrderAmount <= allowedCapacity`。

**测试**：`engine.fix.test.ts` 4 个用例（容量足够不截断 / 容量不足截断 / 不足一手拒绝 / 资金与容量同时取较小值）。

### P1 Future Leakage（amount 未来函数）— 已修复

**状态**：✅ 完成

**原问题**：`execution.ts` 用 `bar.amount`（T+1 当日全天成交额）做滑点分层，而 T+1 全天成交额在开盘成交时点尚不可知 → confirmed lookahead。

**修复**：
- `execution.ts`：`ExecutionModel.execute(order, bar, cost, referenceAmount?)` 新增 `referenceAmount` 参数；滑点分层改用 `referenceAmount`，**不再读取 `bar.amount`**。
- `engine.ts`：调用 `execute` 时传入 `barsByDate.get(signal.signalTime)?.get(signal.symbol)?.amount`（信号日成交额），即成交时点（T+1 开盘）之前已可知的数据。
- 原则落地：决定 T+1 开盘成交价的数据全部在 T+1 open 之前已知；`bar.amount` 仅用于「容量约束」（限制数量，不决定价格），符合任务边界。

**测试**：`engine.fix.test.ts` 2 个用例（execute 层：bar.amount 变化不影响价；engine 层：T+1/T+2 amount 变化不影响 T+1 成交价）。

### P2 lotSize — 已修复

**状态**：✅ 完成

**实现**：
- `portfolio.ts`：`buy()` 在数量校验后检查 `quantity % lotSize !== 0` → 拒绝 `INVALID_LOT_SIZE`（订单合法性校验，非自动修正）。
- 容量/资金截断的「向下取整到整手」与「拒绝非法 lotSize」是两个独立概念，已在代码中分离（前者是容量归一化，后者是请求合法性）。

**测试**：`engine.fix.test.ts` 4 个用例（50 拒 / 150 拒 / 100 成交 / 200 成交）。

---

## 回归测试

**新增**：`server/engine/engine.fix.test.ts` 共 **14 个测试**，全部通过。

覆盖：
- maxPositions（2）
- maxPositionAmountRatio（4）
- Future Leakage（2）
- lotSize（4）
- Portfolio Invariants（2，含 6 条不变量：cash≥0 / quantity≥0 / 整手 / 持仓数≤maxPositions / 金额≤capacity / equity=cash+mv）

**通过**：14 / 14
**失败**：0

---

## 工程验证

- **npm test**：366 通过，15 失败（15 个均为既有环境类失败：缺 DATABASE_URL / TUSHARE_TOKEN / StockPriceSync.tsx / 网络超时，与 Step 1 验收清单完全一致，**无新增失败**）。
- **npm run typecheck**（`tsc --noEmit`）：通过，退出码 0。
- **npm run build**：通过（vite 2846 模块 + esbuild，dist/index.js 408.2kb）。

---

## 第二轮验收

用独立 tsx 审计脚本（已删）复验原 FAIL 项，结果 **6/6 通过**：

| 验收项 | 结果 |
|---|---|
| maxPositions | ✅ PASS（maxPositions=1 只建仓 1 只） |
| maxPositionAmountRatio | ✅ PASS（9000 股请求被容量限制到 100 股） |
| lotSize | ✅ PASS（50 股非整手被拒，0 笔成交） |
| Future Leakage | ✅ PASS（T+1 amount 变化，成交价 10.01 = 10.01） |
| Future data contamination | ✅ PASS（T1-T3 vs T1-T6 trades 一致） |
| Determinism | ✅ PASS（两次运行深度相等） |

Portfolio Invariants（6 条）已由 `engine.fix.test.ts` 的 invariant 用例覆盖并通过。

---

## 最终结论

**STEP 2 READY FOR FINAL ACCEPTANCE**

所有 4 项 P1/P2 阻塞问题均已修复，并通过针对性回归测试 + 全量测试 + typecheck + build + 第二轮独立审计。无剩余 P1/P2。
