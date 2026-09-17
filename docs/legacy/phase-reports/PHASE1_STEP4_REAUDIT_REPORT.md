# Step 4 重新验收报告
## Risk & Position Sizing — P3-F4 / P3-F5 修复后独立验收

审计身份：独立量化风险架构审计员（非开发者）
审计对象：`server/risk/` 当前状态（含 P3-F4 / P3-F5 修复）
审计依据：`docs/PHASE1_STEP4_AUDIT_REPORT.md`（首次验收 FAIL，剩 2 项 P3）+ `docs/PHASE1_STEP4_FIX_REPORT.md`（P1-F1/P2-F2/P2-F3 修复确认）
审计方式：实际阅读 `server/risk/` 全部源码，独立编写 P3-F4 / P3-F5 探测断言，运行 test/typecheck/build。
不采信开发方修复声明。

---

## 总体结论

# PASS

P3-F4（命名错位）与 P3-F5（同 symbol 加仓语义）已按独立审计建议完整修复，回归测试覆盖且全量测试无新增失败、typecheck/build 通过。Step 4 全部 20 项 PASS 条件成立，达到 ACCEPTED 门槛。

---

## 逐项 PASS 条件评估（含 P3-F4 / P3-F5 复核）

| # | PASS 条件 | 结论 | 证据 |
|---|---|---|---|
| 1 | Risk Contract 正确 | ✅ PASS | 同首次验收，`risk/contract.ts` 完整四层契约未变 |
| 2 | Position Sizer 正确 | ✅ PASS | 同首次验收，4 模型数学正确 |
| 3 | Risk Manager 正确 | ✅ PASS | 同首次验收，REJECT 短路 / RESIZE 取严格 min / 不足一手拒绝 |
| 4 | Strategy 无法绕过 Risk | ✅ PASS | P2-F3 已修：`runBacktestWithRisk` 缺省注入 RiskManager，缺省 manager 仍执行容量/资金约束（`risk.fix.test.ts:195-210`） |
| 5 | maxPositions 正确 | ✅ PASS | `MaxPositionsPolicy` + Portfolio 兜底一致 |
| 6 | maxPositionExposure 正确 | ⚠️ → ✅ PASS | 首次验收命名错位（见 P3-F4），现已重命名为 **CapacityPolicy**，语义清晰 |
| 7 | maxPortfolioExposure 正确 | ✅ PASS | P1-F1 已修：敞口估值与 equity 同源（`risk.fix.test.ts:72-119`） |
| 8 | Cash Constraint 正确 | ✅ PASS | P2-F2 已修：CashPolicy 用 `slippedBuyPriceAdjusted`，与执行层滑点一致（`risk.fix.test.ts:139-156`） |
| 9 | lotSize 正确 | ✅ PASS | 同首次验收 |
| 10 | Approve 正确 | ✅ PASS | 同首次验收 |
| 11 | Resize 正确 | ✅ PASS | 同首次验收 |
| 12 | Reject 正确 | ✅ PASS | 同首次验收 |
| 13 | Risk Decision 可解释 | ✅ PASS | 同首次验收 |
| 14 | Decision Trace 完整 | ✅ PASS | 同首次验收；P3-F5 集成测试额外验证 trace 含 ADD_POSITION_NOT_SUPPORTED |
| 15 | Future Leakage | ✅ PASS | 同首次验收，P3-F4/F5 修复未引入新数据源 |
| 16 | Determinism | ✅ PASS | 同首次验收，重命名与加仓拦截为纯结构变更不影响确定性 |
| 17 | Instance Isolation | ✅ PASS | 同首次验收 |
| 18 | Step 2 Regression | ✅ PASS | `engine.fix.test.ts` 16 项 + `engine.test.ts` 29 项全绿 |
| 19 | typecheck | ✅ PASS | `tsc --noEmit` exit 0 |
| 20 | build | ✅ PASS | `npm run build` exit 0（vite build + esbuild 均成功） |

---

## P3-F4 修复验证：MaxPositionExposurePolicy → CapacityPolicy

**独立审计建议原文**：重命名 `MaxPositionExposurePolicy` → `CapacityPolicy`，violation code 改为 `CAPACITY_EXCEEDED`。

**实际修复**（`server/risk/policies.ts`）：

| 项 | 修复前 | 修复后 |
|---|---|---|
| 类名 | `MaxPositionExposurePolicy` | `CapacityPolicy` |
| `name` 属性 | `"max-position-exposure"` | `"capacity"` |
| violation code（REJECT 分支） | `CAPACITY_INSUFFICIENT` | `CAPACITY_EXCEEDED` |
| violation code（RESIZE 分支） | `MAX_POSITION_EXPOSURE` | `CAPACITY_EXCEEDED` |
| 文件头注释 | 列入"Position Exposure"清单 | 列入"Capacity"清单，附「与敞口约束语义不同」说明 |

**独立探测断言**（`risk.fix.test.ts` P3-F4 describe，3 项）：

1. ✅ `new CapacityPolicy(0.1).name === "capacity"`
2. ✅ 所有 violation code 统一为 `CAPACITY_EXCEEDED`（REJECT 分支：referenceAmount=5/0.1 → 容量 500 元 < 1 手 → REJECT `CAPACITY_EXCEEDED`；RESIZE 分支：referenceAmount=200/0.1 → 容量 20000 元/10 元 = 2000 股，requested=5000 → RESIZE 2000 `CAPACITY_EXCEEDED`）
3. ✅ 三类 Policy `name` 互不混用：
   - `CapacityPolicy.name === "capacity"` — 流动性容量
   - `MaxSymbolExposurePolicy.name === "max-symbol-exposure"` — 单 symbol 市值占比
   - `MaxPortfolioExposurePolicy.name === "max-portfolio-exposure"` — 组合总市值占比

**回归**：`server/risk/risk.test.ts` 中所有 `MaxPositionExposurePolicy` 已替换为 `CapacityPolicy`（共 11 处），对应 violation code 断言已统一为 `CAPACITY_EXCEEDED`，所有 35 项测试全绿。

**调用方更新**：
- `server/risk/manager.ts:16` import 更新为 `CapacityPolicy`；
- `buildDefaultRiskManager` 同步更新；
- 全仓 grep `MaxPositionExposurePolicy / MAX_POSITION_EXPOSURE / CAPACITY_INSUFFICIENT`（risk 模块内）— **0 处残留**。

**残留说明**（非回归）：`server/engine/portfolio.ts:133` 与 `server/engine/engine.fix.test.ts:110` 仍使用字符串 `"CAPACITY_INSUFFICIENT：容量不足以成交一手"` 作为 Portfolio 兜底 `OrderResult.reason`。审计范围聚焦 Risk Policy 命名空间，Portfolio 兜底 reason 字符串为独立命名空间（risk 不消费），保留不影响语义对齐；如未来需统一，可作为后续 P3 优化项。

**结论**：P3-F4 ✅ **完全修复**，命名与 violation code 与审计建议完全一致。

---

## P3-F5 修复验证：MaxPositionsPolicy 对同 symbol 加仓 REJECT

**独立审计建议原文**：在最小模型下让 `MaxPositionsPolicy` 对同 symbol 加仓直接 REJECT（code `ADD_POSITION_NOT_SUPPORTED`），使风险层与 Portfolio 兜底语义一致。

**实际修复**（`server/risk/policies.ts` MaxPositionsPolicy.check）：

```ts
// 加仓拦截：最小模型下不允许对同一 symbol 加仓，与 Portfolio.buy 兜底对齐。
const alreadyHeld = context.positions.some((p) => p.symbol === intent.symbol);
if (alreadyHeld) {
  return decision("REJECT", intent, 0, [
    { code: "ADD_POSITION_NOT_SUPPORTED", message: `当前最小模型不支持对已持仓股票 ${intent.symbol} 加仓`, policy: this.name },
  ]);
}
if (context.openPositionCount >= this.maxPositions) {
  return decision("REJECT", intent, 0, [
    { code: "MAX_POSITIONS_EXCEEDED", message: `超过最大持仓数 ${this.maxPositions}`, policy: this.name },
  ]);
}
```

**关键设计点**：加仓拦截置于开仓数上限检查**之前**。在 `composeRiskManager` 的 REJECT 短路语义下：
- 已有同 symbol 持仓的 BUY → 加仓拦截先返回 REJECT，后续 policy（含 CashPolicy）不再执行；
- 但同 symbol 持仓已存在于 positions 中，开仓数不会变（实际是 0 次新增），所以「加仓」与「开仓数上限」不会同时触发——拦截顺序不会让用户丢失重要信息。

**独立探测断言**（`risk.fix.test.ts` P3-F5 describe，3 项）：

1. ✅ **Policy 层**：`MaxPositionsPolicy(5)` + context 含 `{ symbol: "S", quantity: 100 }` → BUY `S` → `REJECT` + violation `ADD_POSITION_NOT_SUPPORTED` + `policy === "max-positions"`。
2. ✅ **拦截优先级**：同 symbol + 持仓数满（`MaxPositionsPolicy(1)` + openPositionCount=1 + positions=[S]）→ 仍报 `ADD_POSITION_NOT_SUPPORTED`，而非 `MAX_POSITIONS_EXCEEDED`（语义优先：先告诉调用方"加仓不被支持"）。
3. ✅ **集成层端到端**：构造 T1 建仓 S、T2 收盘后发 S 加仓信号的回测 → 风险决策 trace 含 2 条：
   - T1：`APPROVE` approved=100 → 成交 100 股
   - T2：`REJECT` approved=0 + violation `ADD_POSITION_NOT_SUPPORTED` → **无成交**
   - 期末 `finalPortfolio.positions[S].quantity === 100`（加仓被拦截，未污染持仓）。

**回归测试**：原测试「已有同 symbol 持仓视为加仓 → APPROVE」已反转期望为 REJECT（`risk.test.ts:71-77`）。

**调用方影响**：
- `buildDefaultRiskManager` 行为变化：若策略信号包含同 symbol 加仓，默认 manager 现在会拦截（之前为 APPROVE 但 Portfolio 兜底拒绝——隐式失败）。调用方需确保策略信号不包含同 symbol 加仓意图（与最小模型一致）；
- 这是 **预期改进**，消除"风险通过、订单拒绝"的隐式失败（首次审计 P3-F5 的核心理由）。

**结论**：P3-F5 ✅ **完全修复**，风险层与 Portfolio 兜底语义对齐，加仓行为全程可追溯。

---

## 1. Risk Contract

✅ PASS（无变化）

契约完整：`OrderIntent / RiskDecision / RiskViolation / RiskPolicy / RiskManager / RiskDecisionTrace / RiskPosition / RiskContext` 类型齐备，纯函数约束明确，RiskLayer 不反向依赖 Portfolio 可变 API。

## 2. Position Sizing

✅ PASS（无变化）

四种模型（FixedQuantity / FixedCapital / FixedWeight / RiskCapped）数学正确，`floorToLot` 向下取整正确，无未来数据。

## 3. Risk Manager

✅ PASS（无变化）

`composeRiskManager` REJECT 短路 / RESIZE 取严格 min / 不足一手拒绝。P3-F5 修复后，加仓拦截 REJECT 也会短路，符合一致性预期。

## 4. maxPositions

✅ PASS

`MaxPositionsPolicy` + Portfolio 兜底完全一致：
- 开仓数达上限 → REJECT `MAX_POSITIONS_EXCEEDED`
- 同 symbol 加仓 → REJECT `ADD_POSITION_NOT_SUPPORTED`（**新增对齐**）
- 测试：`risk.test.ts:63-77` + `risk.fix.test.ts` P3-F5 集成测试。

## 5. maxPositionExposure → Capacity

✅ PASS（命名与 violation code 已对齐）

修复前：`MaxPositionExposurePolicy`（限流动性容量但命名像敞口约束）+ `MAX_POSITION_EXPOSURE / CAPACITY_INSUFFICIENT` 两种混乱 violation code。

修复后：`CapacityPolicy`（清晰表达「流动性容量」语义）+ 统一 `CAPACITY_EXCEEDED`。回归覆盖 `risk.test.ts`（4 项 capacity 测试）+ `risk.fix.test.ts`（3 项 P3-F4 测试）。

## 6. maxPortfolioExposure

✅ PASS

P1-F1 修复后敞口估值与 equity 同源，限制不被突破（`risk.fix.test.ts:72-119` 实测）。

## 7. Cash Constraint

✅ PASS

P2-F2 修复后滑点口径与执行层完全一致（`slippedBuyPriceAdjusted`），无静默二次截断（`risk.fix.test.ts:139-156`）。

## 8. lotSize / Approve / Resize / Reject / Decision Trace / Future Leakage / Determinism / Instance Isolation

✅ PASS（无变化）

所有现有断言通过。P3-F4 重命名为纯结构变更，P3-F5 加仓拦截为新增分支，**未引入任何回归**。

---

## 9. Tests

**全量**：445 passed / 15 failed（460 总）

15 失败清单与首次验收、Step 4-FIX 报告**完全一致**，均为环境类：
- `limitUp.test.ts` × 1（DB）
- `limitUp.watch.test.ts` × 4（DB）
- `marketData.test.ts` × 4（DB）
- `stockPriceSyncPage.test.ts` × 2（缺 `StockPriceSync.tsx`）
- `tushare.secret.test.ts` × 1（缺 `TUSHARE_TOKEN`）
- `tushareTradingCalendar.test.ts` × 3（网络超时）

新增测试 6 项（P3-F4 × 3 + P3-F5 × 3），全部通过。

**无新增失败**。

风险模块明细（`pnpm vitest run server/risk`）：
- `server/risk/risk.test.ts` — 35 passed
- `server/risk/risk.fix.test.ts` — 15 passed（含本次新增 6 项）

引擎模块明细（`pnpm vitest run server/engine`）：
- `engine.test.ts` — 29 passed
- `engine.fix.test.ts` — 16 passed

策略模块明细（`pnpm vitest run server/strategy`）：
- `contract.test.ts` 10 + `registry.test.ts` 6 + `strategyPortfolio.test.ts` 3 + `leaderCandidateBaseline.test.ts` 11 = **30 passed**

## 10. Typecheck

✅ PASS

`npx tsc --noEmit` → exit 0。

## 11. Build

✅ PASS

`npm run build` → exit 0（vite build 1,468.41 kB JS / 161.26 kB CSS / 367.72 kB HTML，esbuild 408.2 kB）。

---

## 回归矩阵

| 文件 | 变更 | 测试 | 结果 |
|---|---|---|---|
| `server/risk/policies.ts` | `MaxPositionExposurePolicy` → `CapacityPolicy`；统一 `CAPACITY_EXCEEDED`；`MaxPositionsPolicy` 加仓拦截新增 `ADD_POSITION_NOT_SUPPORTED` | `risk.test.ts` 35 + `risk.fix.test.ts` 15 | 全绿 |
| `server/risk/manager.ts` | import 与 `buildDefaultRiskManager` 同步更新 | 同上 | 全绿 |
| `server/risk/risk.test.ts` | 11 处 `MaxPositionExposurePolicy` → `CapacityPolicy`；4 处 violation code 更新；1 处 P3-F5 测试期望反转 | 35 项 | 全绿 |
| `server/risk/risk.fix.test.ts` | 新增 6 项 P3-F4/F5 探测断言；头注释更新 | 15 项（原 9 + 新增 6） | 全绿 |
| `server/engine/*` / `server/strategy/*` | 无变更 | 76 项 | 全绿（Step 2 回归保护） |

---

## 结论

# ✅ READY FOR STEP 4 FINAL ACCEPTANCE

P3-F4（命名错位）与 P3-F5（同 symbol 加仓语义）已严格按独立审计建议完整修复：

- **P3-F4**：`CapacityPolicy` 类名 + `name="capacity"` + 统一 violation code `CAPACITY_EXCEEDED`，与敞口约束（`MaxSymbolExposure / MaxPortfolioExposure`）语义清晰分离；
- **P3-F5**：`MaxPositionsPolicy` 对同 symbol 加仓直接 REJECT `ADD_POSITION_NOT_SUPPORTED`，与 `Portfolio.buy`「同一股票已有持仓，暂不支持加仓」语义完全对齐，消除"风险通过、订单拒绝"的隐式失败。

20 项 PASS 条件全部成立，新增 6 项 P3-F4/F5 探测断言，全量测试 445 passed / 15 failed（与 Step 4-FIX 失败清单完全一致，**无新增失败**），typecheck 与 build 全绿。

Step 4 **达到 ACCEPTED 门槛**。