<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/strategy

- 测试文件 **5** 个 ｜ 用例声明 **54** 个
- 涉及源码目录：`server/` · `server/data/` · `server/engine/` · `server/features/` · `server/strategy/` · `server/strategy/strategies/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/strategy                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

> ℹ️ 本模块有 **1** 个「源码文本断言」测试（`readFileSync` 源码 + 字符串匹配），
> 改个变量名就可能变红，且不验证行为；详见 `docs/testing/README.md` 的「测试分类」一节。

## 逐文件

### `tests/server/strategy/contract.test.ts`
- 164 行 ｜ 用例声明 10 ｜ describe 5 ｜ 📄 源码文本断言
- 被测源码：`server/strategy/contract.ts`
- 单跑：`pnpm exec vitest run tests/server/strategy/contract.test.ts`
- 用例树：
- **Strategy Contract 契约形态**
  - 策略定义具备 metadata/defaultConfig/normalizeConfig/evaluate，并可被评估
  - BUY 信号：价格上穿阈值产生 BUY
  - SELL 信号：价格跌破负阈值产生 SELL
  - HOLD 信号：价格在阈值区间内产生 HOLD
  - 数据不足：空价格序列返回 insufficientData=true 且无信号
- **Strategy Config 配置规范化**
  - 缺失字段回填默认值
  - 合法字段保留，非法字段回退默认
- **确定性**
  - 相同输入两次评估结果深度相等
- **只读组合上下文**
  - 策略不得修改组合快照
- **架构依赖边界**
  - 契约层不依赖执行/组合可变 API/数据库/网络

### `tests/server/strategy/leaderCandidateBaseline.test.ts`
- 312 行 ｜ 用例声明 18 ｜ describe 3
- 被测源码：`server/engine/index.ts` · `server/leaderCandidates.ts` · `server/strategy/adapter.ts` · `server/strategy/registry.ts` · `server/strategy/strategies/index.ts` · `server/strategy/strategies/leaderCandidateBaseline.ts`
- 单跑：`pnpm exec vitest run tests/server/strategy/leaderCandidateBaseline.test.ts`
- 用例树：
- **龙头候选原始评分策略（baseline）**
  - 产生按评分降序的 BUY 信号（3 只候选）
  - 数据不足：无候选日返回 insufficientData=true 且无信号
  - 确定性：相同输入两次评估结果深度相等
  - minScore 阈值过滤候选
  - maxSignals 限制输出意图数量
  - 实例隔离：A/B/A 三次评估，两次 A 完全一致
  - 未来数据污染：T1-T3 与 T1-T6 在 T3 的信号完全一致
  - Legacy 行为对照：信号顺序与 legacy 候选排序一致
  - P3-1 回归：准入候选超过 20 只时 adapter 视图不受默认 20 只截断
- **Registry + Backtest Core 集成**
  - 策略经 Registry 驱动 Backtest Core 产生成交
  - buildStrategySignalProvider + runBacktestWithRisk 固化 Strategy→Risk→Core 链路
- **G3 P3-T1 退出策略（hold-while-selected）**
  - 持仓不在当日候选池 → 产生 SELL 信号
  - 持仓仍在当日候选池 → 不产生 SELL（继续持有）
  - 无候选日 → 信息不足、不强制清仓（不产生 SELL）
  - exitMode=none → 保持旧 BUY-only 语义（不产生 SELL）
  - 退出判断不受 maxSignals 截断影响（排名未进前 N 但仍入选候选池 → 继续持有）
  - 退出信号确定性：sell 在前、buy 在后，sell 按 symbol 升序
  - 确定性：相同持仓 + 相同候选池两次评估深度相等

### `tests/server/strategy/productionIntegration.test.ts`
- 492 行 ｜ 用例声明 14 ｜ describe 2
- 被测源码：`server/data/index.ts` · `server/strategy/strategyBacktest.ts` · `server/leaderCandidateStrategyBacktest.ts` · `server/leaderCandidates.ts` · `server/strategy/strategies/leaderCandidateBaseline.ts`
- 单跑：`pnpm exec vitest run tests/server/strategy/productionIntegration.test.ts`
- 用例树：
- **RA-001/RA-002 生产入口：runLeaderCandidateStrategyBacktest → Strategy Engine → Feature**
  - TEST 1/2 生产入口真实执行并调用 Feature：仅价格库确认涨停的 A 被纳入并成交（D1 信号 → D2 开盘）
  - TEST 3 生产配置显式 featureMode=limit-up-confirm（不依赖默认值）
  - TEST 4 Feature 真实改变生产 Decision：B 由价格库未确认（10.20）改为涨停（11.00）→ 从排除变为纳入
  - TEST 5 Future Leakage：修改 D2/D3（未来）OHLCV 不改变 D1 Decision / D1 Signal / D2 Order
  - TEST 6 Missing-Feature 安全：价格库无法确认时不会 silent-fallback 到 off（B/C 不因降级被纳入）
  - TEST 7 Determinism：同一 Data/Config/asOf 重复 100 次结果完全一致
  - TEST 8 Risk Regression：maxPositions / lotSize / cash 约束仍然生效（不被生产入口绕过）
  - TEST 9 API Compatibility：生产服务输出保持既有 LeaderCandidateBacktestResult / RealisticBacktestResult 形状
  - TEST 9c P2-2 边界：生产核心不含 research-legacy 研究段；完整分析报表经研究服务单独产出
  - TEST 9b asOf：FeatureSnapshot 与 signalTime 严格一致（decisionDate=D1/decisionPoint=close）
  - Decision-time Regression（decisionPoint=open）：D1 open 决策不可见 D1 OHLCV，极端改写 D1 不改变决策
- **G3 P3-T1 生产引擎退出策略（BUY → SELL 完整生命周期）**
  - 生产配置显式接入 exitMode=hold-while-selected
  - 持仓断板后触发 SELL：A 形成 closed trade（entryTime=D2，exitTime=D3）
  - Determinism：相同输入重复运行退出生命周期结果一致

### `tests/server/strategy/registry.test.ts`
- 80 行 ｜ 用例声明 6 ｜ describe 1
- 被测源码：`server/strategy/contract.ts` · `server/strategy/registry.ts`
- 单跑：`pnpm exec vitest run tests/server/strategy/registry.test.ts`
- 用例树：
- **StrategyRegistry**
  - register 后可按 id get 并列出元数据
  - 重复注册相同 id 抛错
  - 查询未知 id 抛错
  - evaluate 规范化配置后评估，并透传数据充分性
  - list 返回按 id 排序且是元数据副本
  - emptyDecision 工厂返回空决策

### `tests/server/strategy/strategyBacktest.test.ts`
- 237 行 ｜ 用例声明 6 ｜ describe 1
- 被测源码：`server/data/index.ts` · `server/features/index.ts` · `server/strategy/strategyBacktest.ts`
- 单跑：`pnpm exec vitest run tests/server/strategy/strategyBacktest.test.ts`
- 用例树：
- **P1-F1/F2 生产组装点集成：Feature 不再孤儿、真实流入 Strategy 决策**
  - 生产 Provider 全链路真实成交：仅价格库确认涨停的 A 被买入（D1 信号 → D2 开盘成交）
  - Feature 真实改变策略决策：featureMode=off 3 单 vs limit-up-confirm 1 单（同候选池、同行情）
  - 修改 Feature 输入（价格库 B 收盘改为涨停）即改变策略决策：候选记录不变，B 从跳过变为纳入
  - 无未来数据渗漏：X 的 D2（未来）涨停不会改变 D1 的 Strategy Decision
  - 渗漏探针有效性：X 的 D2 bar 在 D2 视角确为涨停（证明上述断言能捕获未来渗漏）
  - 确定性/隔离：相同输入两次运行结果深度相等（无共享可变状态、无随机）
