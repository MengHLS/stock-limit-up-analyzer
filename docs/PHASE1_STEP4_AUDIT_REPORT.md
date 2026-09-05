# Step 4 独立验收报告
## Risk & Position Sizing Audit

审计身份：独立量化风险架构审计员（非开发者）
审计方式：实际阅读 `server/risk/`、`server/engine/`、`server/strategy/` 全部源码，运行测试/typecheck/build，并编写独立探测脚本验证怀疑点。
不采信开发报告 `PHASE1_STEP4_DEVELOPMENT_REPORT.md`。

---

## 总体结论

# FAIL

存在 1 项 P1（核心风险策略未正确生效）与 2 项 P2（局部规则/架构缺口），阻塞 ACCEPT。

---

## 逐项 PASS 条件评估

| # | PASS 条件 | 结论 | 证据 |
|---|---|---|---|
| 1 | Risk Contract 正确 | ✅ PASS | `risk/contract.ts` 定义 OrderIntent/RiskDecision/RiskPolicy/RiskManager/RiskDecisionTrace，语义完整 |
| 2 | Position Sizer 正确 | ✅ PASS | 4 模型数学正确（见「Position Sizing」节），`floorToLot` 向下取整正确 |
| 3 | Risk Manager 正确 | ✅ PASS | `composeRiskManager` REJECT 短路 / RESIZE 取严格 min / 不足一手拒绝，逻辑正确 |
| 4 | Strategy 无法绕过 Risk | ⚠️ 部分 | 策略契约是纯函数无法绕过；但引擎 `risk` 参数可选，存在不经 RiskManager 的执行路径（见 P2-F3） |
| 5 | maxPositions 正确 | ✅ PASS | `MaxPositionsPolicy` + Portfolio 兜底，`engine.fix.test.ts` 实锤 |
| 6 | maxPositionExposure 正确 | ❌ FAIL | 引擎以过期价格喂入敞口上下文（见 P1-F1）；且命名错位（见 P3-F4） |
| 7 | maxPortfolioExposure 正确 | ❌ FAIL | 同上，敞口限制被突破（见 P1-F1） |
| 8 | Cash Constraint 正确 | ⚠️ 部分 | 逻辑正确，但滑点口径与执行层不一致（见 P2-F2） |
| 9 | lotSize 正确 | ✅ PASS | 50/150 拒绝、100/200 成交，两处均有测试 |
| 10 | Approve 正确 | ✅ PASS | `risk.test.ts`「全部 APPROVE」用例 |
| 11 | Resize 正确 | ✅ PASS | RESIZE ≠ REJECT，语义清晰，取严格 min |
| 12 | Reject 正确 | ✅ PASS | REJECT → approvedQuantity=0，非 quantity=0 的静默处理 |
| 13 | Risk Decision 可解释 | ✅ PASS | violations 含 code/message/policy |
| 14 | Decision Trace 完整 | ✅ PASS | 含 requested/proposed/approved/violations |
| 15 | Future Leakage | ✅ PASS | 全层无未来数据；集成测试「T+1 amount 变化不影响决策」通过 |
| 16 | Determinism | ✅ PASS | 全层无 Date.now/Math.random/全局状态 |
| 17 | Instance Isolation | ✅ PASS | Portfolio 每次 new；Policy 无 module-level mutable state |
| 18 | Step 2 Regression | ✅ PASS | 429 全绿，15 失败均为环境类（见「Tests」节） |
| 19 | typecheck | ✅ PASS | `tsc --noEmit` exit 0 |
| 20 | build | ✅ PASS | `npm run build` exit 0 |

---

## 1. Risk Contract

✅ PASS

`server/risk/contract.ts`：
- `OrderIntent` 表达意图（symbol/side/requestedQuantity/signalTime/score/reason）。
- `RiskDecision` 三态 APPROVE/RESIZE/REJECT + approvedQuantity + requestedQuantity + violations[]。
- `RiskViolation` 结构化 code/message/policy，满足可解释性要求。
- `RiskPolicy` 声明为纯函数：`check(intent, context): RiskDecision`。
- `RiskDecisionTrace` 关联 original signal → proposed → approved → violations → final order。

契约无副作用，类型上 `RiskContext.positions` 为 `readonly`。

## 2. Position Sizing

✅ PASS

`server/risk/sizing.ts` 四种模型：
- **FixedQuantity**：原样返回显式数量（不静默取整非整手，交给 LotSizePolicy 拒绝）。正确。
- **FixedCapital**：`capital = equity×ratio`，`quantity = floor(capital/price/lot)×lot`。正确。
- **FixedWeight**：`targetValue = equity×weight`，同上取整。正确。
- **RiskCapped**：`riskBudget = equity×maxRiskRatio`，`perShareRisk = price×stopDistancePct`，`quantity = floor(riskBudget/perShareRisk/lot)×lot`。正确。

capital/weight/quantity/price 换算无错误。测试 6 项全绿。

## 3. Risk Manager

✅ PASS

`composeRiskManager`：
- REJECT 短路（后续 policy 不再执行，测试 spy 验证）。
- RESIZE 取 `min(requested, ...各 RESIZE 上限)`，再向下取整到整手。
- 不足一手 → REJECT（INSUFFICIENT_LOT）。

组合器保证「某一 Policy 通过后另一 Policy 不被绕过」——每个 Policy 独立检查，最终数量取严格最小值。Golden Test 人工验证 min(5000,4000,5000,9900)=4000 通过。

## 4. maxPositions

✅ PASS

`MaxPositionsPolicy(1)`：两个 BUY 时第二个被 REJECT，最终最多一个 open position。测试覆盖 Policy 层 + Portfolio 层（`engine.fix.test.ts` P1-1）。

## 5. maxPositionExposure

❌ FAIL（见 P1-F1 + P3-F4）

两个独立问题：
1. **P1-F1**：敞口上下文喂入过期价格，导致该限制（连同 maxSymbolExposure/maxPortfolioExposure）被低估、可突破。
2. **P3-F4**：`MaxPositionExposurePolicy` 在代码里实现的是「容量约束」（referenceAmount×ratio，对应 Step 2 的 maxPositionAmountRatio），与审计 spec 第九节的「Position Exposure = 单 symbol 市值×比例」语义错位。单 symbol 市值敞口实际由 `MaxSymbolExposurePolicy` 承担。

## 6. maxPortfolioExposure

❌ FAIL（见 P1-F1）

`MaxPortfolioExposurePolicy` 数学实现正确，但引擎派生 RiskContext 时已有持仓的 marketValue 用上一收盘价（而非决策时点开盘价），导致限制被低估。实测期末组合敞口 50.05% > 50% 上限。

## 7. Cash Constraint

⚠️ 部分（见 P2-F2）

`CashPolicy` 逻辑正确（含滑点 + 佣金 + 过户费，向下取整到整手，不足一手 REJECT），Portfolio 兜底保证 cash ≥ 0。但滑点估算口径与执行层不一致。

## 8. lotSize

✅ PASS

50 BUY → REJECT INVALID_LOT_SIZE；150 → REJECT；100/200 → PASS。`engine.fix.test.ts` P2 覆盖。Risk Layer 与 Order Layer 的整手规则一致（非整手都在买入时拒绝）。

## 9. Approve

✅ PASS

全部 Policy APPROVE → approvedQuantity = requestedQuantity，violations 为空。

## 10. Resize

✅ PASS

RESIZE ≠ REJECT：RESIZE 返回缩小的 approvedQuantity + 违规码；REJECT 返回 0。语义清晰。

## 11. Reject

✅ PASS

REJECT → approvedQuantity = 0，含结构化 violations。不是「quantity=0 的静默成交」。

## 12. Decision Trace

✅ PASS

`RiskDecisionTrace` 关联 requestedQuantity（策略原始）→ proposedQuantity（Sizer）→ decision/approvedQuantity → violations。集成测试验证「requested=1000 → RESIZE → approved=400」可完整回溯。

## 13. Future Leakage

✅ PASS

- Risk Layer 只依赖 `../engine/domain`（类型）与 `../engine/execution`（纯费用函数 buyFees/slippedBuyPrice），无 DB/网络/未来数据。
- `referenceAmount` 取信号日（signalTime）成交额，非 T+1 当日全天成交额。
- 集成测试「T+1 成交日 amount 变化不影响风险决策结果」通过。
- 全层无 Date.now/Math.random/new Date/fetch/axios。

## 14. Determinism

✅ PASS

全层无 Date.now/Math.random/模块级 mutable state。`generatedAt` 硬编码 "deterministic"。确定性测试「两次运行深度相等」通过。

## 15. Instance Isolation

✅ PASS

- Portfolio 每次 `runBacktest` 都 `new`。
- RiskPolicy 无实例状态（构造后 immutable，check 无副作用）。
- 测试「实例隔离：Policy 无 module-level mutable state」通过。

## 16. Step 2 Regression

✅ PASS

`engine.fix.test.ts`（16 项，含 P1-1/P1-2/P1-3/P2/Portfolio Invariants）全绿；`engine.test.ts`（29 项）全绿。

## 17. Tests

全量：**429 passed / 15 failed**。15 失败经逐一核对均为既有环境类失败，与 Step 4 无关：
- `stockPriceSyncPage.test.ts`（2）— ENOENT 缺页面源文件
- `tushare.secret.test.ts`（1）— 缺 TUSHARE_TOKEN 环境变量
- `tushareTradingCalendar.test.ts`（3）— 网络超时
- 其余为 client 源码快照类测试的环境差异

Step 4 新增测试（`risk.test.ts` 35 项）全部通过，**无新增失败**。

## 18. Typecheck

✅ PASS

`npx tsc --noEmit` → exit 0。

## 19. Build

✅ PASS

`npm run build` → exit 0（vite build + esbuild 均成功）。

---

## 问题清单

### P0

无。

### P1

**P1-F1：风险上下文敞口估值价格口径不一致，导致 maxPositionExposure / maxSymbolExposure / maxPortfolioExposure 低估已有持仓、可被突破。**

- 文件：`server/engine/engine.ts`（第 90–104 行）；`server/risk/context.ts`（第 28–44 行）；`server/engine/portfolio.ts`（`snapshotPositions` 第 81–95 行）
- 位置：`runBacktest` 处理 pending BUY 信号时派生 `buildRiskContext` 的入参
- 问题：
  - `equity` 用 `portfolio.equityAt(openPrices)`（**决策时点 T+1 开盘价**）估值；
  - 但 `positions[].marketValue` 用 `portfolio.snapshotPositions()`，其 `marketValue = (marketPrice ?? entryPrice) × quantity`，`marketPrice` 只在当日收盘 `markToMarket` 才更新，因此决策时点用的是**上一交易日收盘价（或建仓价）**；
  - 两者口径不一致：`portfolioExposure = Σ(旧价×qty) / equity(新价)`。
- 影响：已有持仓上涨时，其真实敞口被低估，导致 maxPortfolioExposure / maxSymbolExposure 放行过多新买入，期末敞口可突破上限。独立探测实测：S 持仓在 T3 开盘已涨至 30，敞口仍按 T2 收盘 20 计，X 被批准 2400 股，期末组合敞口 50.05% > 50% 上限。
- 修复方式：派生 `positions` 时复用 `openPrices`（与 equity 同源），对已有持仓按决策时点开盘价重算 marketValue；即不要用 `snapshotPositions()` 的旧价，改为 `marketValue = openPrice × quantity`。
- 验证方式：重跑探测脚本（S entry 10 → T2 收盘 20 → T3 开盘 30），断言 X 被 RESIZE 到 2350 股（按 30 估值）而非 2400，且期末敞口 ≤ 50%。

### P2

**P2-F2：CashPolicy 滑点口径与执行层不一致。**

- 文件：`server/risk/policies.ts`（CashPolicy，第 180 行）；`server/engine/execution.ts`（`amountAdjustedSlippageBps`）
- 位置：CashPolicy 用 `slippedBuyPrice(price, cost)`（仅 base 滑点）；执行层 `NextOpenExecutionModel` 用 `amountAdjustedSlippageBps(base, referenceAmount)`（流动性分层，<1 亿加 20bp 等）
- 问题：资金充足性用 base 滑点估算，实际成交用 amount-adjusted 滑点（更高），边界场景下 RiskDecisionTrace 记录的 approvedQuantity 可能高于 Portfolio 实际成交数量（Portfolio 会计兜底再次截断）。
- 影响：「为什么这笔交易最终只有 N 股」的追溯可能与实际成交不一致；风险决策与最终成交之间出现未记录的第二重截断。
- 修复方式：CashPolicy 计算 `executionPrice` 时传入 referenceAmount，复用 `amountAdjustedSlippageBps` 得到与执行层一致的滑点。
- 验证方式：构造边界现金，断言 risk.approvedQuantity === 最终 fill.quantity（不再有静默二次截断）。

**P2-F3：风险层为可选，未形成强制统一管道；Strategy 层尚未接入引擎。**

- 文件：`server/engine/engine.ts`（`RunBacktestInput.risk?` 可选，第 38–43 行；第 88 行 `if (riskManager && signal.side === "buy")`）
- 位置：`runBacktest` 的 risk 接入点
- 问题：`risk` 为可选参数。不传时，信号直接经 `execution.execute` + `portfolio.buy`（仅会计兜底），**绕过 RiskManager**。同时 Strategy Contract 层（`leaderCandidateBaseline.evaluate`）尚未接入 `runBacktest`（需手动 `toCoreSignals` + 手动传 risk），「Strategy → Signal → PositionSizer → RiskManager」未形成系统级强制链路。
- 影响：审计核心问题「交易意图是否真正经过统一、正确、可解释的风险控制」在单元层成立，但系统层存在不经 RiskManager 的执行路径；不同调用方可能配置不同的 Policy 集合，风险控制不统一。
- 修复方式：提供一个统一入口（如 `runBacktestWithRisk` 或默认注入一套与 BacktestConfig 对齐的 RiskManager），使风险层在「使用新回测引擎」的路径上为必填/默认启用；并将 Strategy → `toCoreSignals` → engine 的桥接固化。
- 验证方式：断言引擎在不显式传 risk 时，仍有一致且可追溯的风险裁决（而非静默走会计兜底）。

### P3

**P3-F4：命名错位 —— `MaxPositionExposurePolicy` 实为容量约束。**

- 文件：`server/risk/policies.ts`（第 70–95 行）
- 问题：`MaxPositionExposurePolicy` 实现的是「单笔金额 ≤ referenceAmount × ratio」的**流动性容量约束**（对应 Step 2 的 maxPositionAmountRatio），violation code 却是 `MAX_POSITION_EXPOSURE`；而审计 spec 第九节的「Position Exposure（单 symbol 市值占比）」实际由 `MaxSymbolExposurePolicy` 承担。命名与语义严重错位，易误导后续开发与审计。
- 影响：无功能错误，但会持续造成「capacity 约束」与「市值敞口约束」的混淆。
- 修复方式：重命名 `MaxPositionExposurePolicy` → `CapacityPolicy`（或 `MaxPositionAmountRatioPolicy`），violation code 改为 `CAPACITY_EXCEEDED`；`MaxSymbolExposurePolicy` 保留 `MAX_SYMBOL_EXPOSURE`。
- 验证方式：全局重命名后全量测试 + typecheck 仍绿。

**P3-F5：MaxPositionsPolicy 与 Portfolio 对「同 symbol 加仓」语义矛盾。**

- 文件：`server/risk/policies.ts`（第 49–63 行）；`server/engine/portfolio.ts`（第 112 行）
- 问题：`MaxPositionsPolicy` 对已有同 symbol 持仓的 BUY 返回 APPROVE（视为加仓），但 Portfolio.buy 直接拒绝「同一股票已有持仓，暂不支持加仓」。风险层「通过」、订单层「拒绝」，两层规则矛盾（当前最小模型不支持加仓，属分层防御，但语义不一致）。
- 影响：风险决策显示 APPROVE，最终却无成交，追溯链上出现「approved 但未成交」的隐式失败。
- 修复方式：在最小模型下让 `MaxPositionsPolicy` 对同 symbol 加仓直接 REJECT（code `ADD_POSITION_NOT_SUPPORTED`），或同步实现加仓能力，使两层语义一致。
- 验证方式：同 symbol 二次 BUY 时，风险决策 REJECT 且 Portfolio 一致拒绝。

---

## 结论

风险层四件套（Contract / Sizer / Manager / 6 个 Policy）在**单元层实现正确**，三态语义、可解释性、Trace、未来函数、确定性、状态隔离均达标，Step 2 回归、typecheck、build 全绿。

但存在 **1 项 P1**（敞口估值价格口径不一致，导致 maxPortfolioExposure / maxSymbolExposure 被突破）与 **2 项 P2**（CashPolicy 滑点口径不一致；风险层可选、Strategy 未接入引擎），不满足 PASS 条件第 6、7 项（及第 4、8 项的严格口径）。

# 结论：FAIL

未达到 STEP 4 ACCEPTED 标准。需先修复 P1-F1（阻塞项），建议一并修复 P2-F2、P2-F3 后重新验收。
