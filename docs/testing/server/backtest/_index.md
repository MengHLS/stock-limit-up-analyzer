<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/backtest

- 测试文件 **8** 个 ｜ 用例声明 **102** 个
- 涉及源码目录：`server/backtest/` · `server/corporateActions/` · `server/data/` · `server/engine/` · `server/research/closedLoop/` · `server/research/framework/` · `server/research/performanceMetrics/` · `server/research/simulator/` · `server/research/strategySchema/` · `server/research/tradeQualityMetrics/` · `server/runWorkbenchAssembly/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/backtest                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/backtest/backtest2.test.ts`
- 545 行 ｜ 用例声明 26 ｜ describe 16
- 被测源码：`server/data/types.ts` · `server/backtest/dataSource.ts` · `server/backtest/engine.ts` · `server/backtest/position.ts` · `server/backtest/portfolio.ts` · `server/backtest/cost.ts` · `server/backtest/execution.ts` · `server/backtest/serialization.ts` · `server/backtest/types.ts` · `server/engine/domain.ts`
- 单跑：`pnpm exec vitest run tests/server/backtest/backtest2.test.ts`
- 用例树：
- **次日成交（next-day execution）**
  - T 日收盘信号在 T+1 开盘成交，不在 T 日成交
- **同日未来函数拒绝（look-ahead prevention）**
  - 信号数据视图只暴露 <= decisionDate 的 bar
  - 结构性保证：成交日严格晚于信号日（同一 close 不能成交）
- **T+1 约束**
  - 当日买入冻结，次日才可卖（PositionBook 三态）
  - Portfolio 卖出冻结份额被 T_PLUS_1 拒绝
- **交易成本（佣金 / 印花税 / 滑点）**
  - 佣金不低于最低佣金
  - 印花税仅卖出收取
  - 过户费双边收取
  - 买入滑点上浮、卖出滑点下浮
- **现金不足**
  - 现金不足全额买入时拒绝（INSUFFICIENT_CASH）
- **停牌（suspended）**
  - 成交日无 bar 视为停牌，拒绝成交
- **涨跌停拒绝接口**
  - 涨停买入被 LIMIT_UP 拒绝
  - 跌停卖出被 LIMIT_DOWN 拒绝
- **部分成交接口**
  - allowPartialFill 开启时现金不足按最大可行数量部分成交
  - allowPartialFill 关闭时同一场景全额拒绝
- **确定性（determinism）**
  - 相同规范两次回测结果 deepEqual
- **序列化（serialization）**
  - serialize → deserialize 语义一致
- **空数据集**
  - 空 store 返回空结果不崩溃
- **单股与多股**
  - 单股回测产生一笔交易
  - 多股回测产生多笔交易
- **多笔交易**
  - 两次完整买卖产生 2 笔已平仓交易
- **持仓会计（quantity / available / frozen）**
  - 期末持仓三态正确
- **已实现 / 未实现盈亏**
  - 买入后未卖：未实现盈亏 = 市值 − 成本基，已实现为 0
  - 买入后卖出：产生已实现盈亏，满足 Net = Gross − Fees − Slippage
- **成本核算**
  - 费用分解合计正确（佣金 + 印花税 + 过户费）
  - 回测成本汇总 = 各成交费用之和

### `tests/server/backtest/backtestCore.test.ts`
- 343 行 ｜ 用例声明 20 ｜ describe 8
- 被测源码：`server/backtest/index.ts` · `server/backtest/types.ts`
- 单跑：`pnpm exec vitest run tests/server/backtest/backtestCore.test.ts`
- 用例树：
- **BacktestContext（§6）**
  - 合法上下文通过校验
  - 非法初始资金 / 起止颠倒 ⇒ 响亮抛错
- **G1 — 执行政策（默认值有意翻转）**
  - 默认政策 = 保守口径（T+1 + 拦涨停买 + 拦跌停卖 + 拒单不顺延 + 允许部分成交 + 零成交量不可成交）
  - 政策 → 既有 ExecutionRuleSet 只映射引擎真认的两项（不新造字段）
  - 关闭拦截时说明文案必须带警告（防「静默宽松」）
- **G3 — 执行语义一致性**
  - 文档声明的 T_CLOSE → T+1 OPEN 在支持集内
  - 声明了引擎不支持的语义 ⇒ 不支持（由调用方响亮拒绝，不静默按默认跑）
  - 决策时点不是 close ⇒ 直接不支持
- **G2 — 仓位口径映射（如实登记未消费者）**
  - 声明 EQUAL_WEIGHT ⇒ 与引擎实际口径一致，无被忽略项
  - 声明 FIXED_RATIO + positionRatio ⇒ BACKTEST-002 起**真正生效**（不再是「不消费」）
- **OrderIntent（§7）**
  - 有入场信号 ⇒ OPEN_LONG；有出场意图 ⇒ CLOSE_LONG；方向沿用既有 Side 词表
  - 无信号无意图 ⇒ 空数组（显式空，不是隐式「什么都不做」对象）
- **§13/§20 — 权益曲线指标（Test I 回撤）**
  - 100 → 110 → 105 → 90 → 120 的最大回撤 = −18.18%（90 相对峰值 110）
  - 空曲线 ⇒ 0 回撤 + 年化 NOT_AVAILABLE（不编年化）
- **§20 — 交易指标（Test B/F）**
  - 胜率 / 平均盈亏 / 盈亏比；期末未平仓单独计数且不进胜率
  - 无亏损笔 ⇒ 盈亏比 NOT_AVAILABLE（不编 Infinity）
- **§19/§23 — BacktestResult 与有界载荷**
  - Test A：无交易 ⇒ 期末权益 = 初始资金、交易数 0、胜率 NOT_AVAILABLE
  - Test J：同输入两次 ⇒ 载荷逐字节相同（含两个滚动指纹）
  - §23：300 点曲线被抽样到 20 点且标 truncated；摘要仍含全量规模
  - 指纹对明细敏感（改一笔 ⇒ 指纹变）

### `tests/server/backtest/backtestPersistence.test.ts`
- 244 行 ｜ 用例声明 10 ｜ describe 5
- 被测源码：`shared/researchContracts.ts` · `server/backtest/backtestResult.ts` · `server/backtest/types.ts`
- 单跑：`pnpm exec vitest run tests/server/backtest/backtestPersistence.test.ts`
- 用例树：
- **B-03 Test 1 — BacktestRunResult 能进 resultJson（契约校验通过）**
  - 与 strategyRun 并列、互不覆盖，整包能过 closedLoopRunResultSchema
- **B-03 Test 2/3 — 明细有界 + 指纹存在**
  - 300 点曲线不全量入库：样本 ≤ 上限、truncated=true、摘要仍记全量规模
  - equityDigest / tradeDigest 存在且为 sha256 十六进制（全量指纹，不随抽样变化）
- **B-03 Test 4 — 确定性**
  - 同一输入两次 ⇒ 载荷 JSON 逐字节相同
- **B-04 Test 1/3 — Canonical Metrics 是唯一来源（两条路径逐项一致）**
  - canonicalMetrics() 与 buildBacktestResult().metrics 对同一输入逐项相等
  - 载荷里的 canonicalMetrics 与单独调用 canonicalMetrics() 逐项相同（Parameter Search 的读数面唯一）
  - profitFactor 在无亏损笔时为 NOT_AVAILABLE（不是 Infinity）
  - 空曲线 ⇒ 年化 NOT_AVAILABLE、回撤 0、交易数 0（不伪造）
  - diffCanonicalMetrics 真的能抓出差异（判据有牙齿）
- **B-02 敏感性回归 — 参数变 ⇒ BacktestResult 真的不同**
  - 仓位不同 ⇒ 成交规模不同 ⇒ 期末权益/收益不同（不是只改 metadata）

### `tests/server/backtest/canonicalMetricsParity.test.ts`
- 272 行 ｜ 用例声明 9 ｜ describe 3
- 被测源码：`server/backtest/types.ts` · `server/backtest/backtestResult.ts` · `server/research/closedLoop/adapters.ts` · `server/research/performanceMetrics/evaluate.ts` · `server/research/tradeQualityMetrics/evaluate.ts`
- 单跑：`pnpm exec vitest run tests/server/backtest/canonicalMetricsParity.test.ts`
- 用例树：
- **B-04 — 年化基数唯一（规格 §2A/§2B/§2C）**
  - 常量是 252，且口径可序列化自述（不是散落的魔法数字）
  - 🔴 canonical CAGR 与闭环 evaluation 的 cagrPct 在同一曲线上逐位相等（收口前两者不一致）
  - 年化口径随指标一起输出（消费方无需知道 252 从哪来）
  - 退化曲线 ⇒ 年化 NOT_AVAILABLE（不编 0）
- **B-04 — 闭环 evaluationRef 的重叠标量取自 canonical（规格 §3）**
  - 🔴 评估器看 A 曲线、canonical 看 B 曲线 ⇒ 投影必须是 B 的值（证明没有第二条路径）
  - 评估器的**非重叠**指标仍由其自身供给（Sharpe 等未被抹掉）
  - 未给 canonical ⇒ 如实降级为 evaluators（历史留档 / 直供路径向后兼容）
  - 🔴 canonical 为 NOT_AVAILABLE ⇒ 投影为 null，**不被评估器的数值顶替**（不掩盖不可算）
- **B-04 — 同一曲线与台账，任何路径都得不到第二个数字**
  - canonicalMetrics / buildBacktestResult / 载荷 三条路径的 8 项指标逐项相等

### `tests/server/backtest/corporateActionIntegration.test.ts`
- 201 行 ｜ 用例声明 6 ｜ describe 3
- 被测源码：`server/backtest/dataSource.ts` · `server/backtest/engine.ts` · `server/backtest/position.ts` · `server/backtest/portfolio.ts` · `server/backtest/types.ts` · `server/engine/domain.ts` · `server/data/types.ts` · `server/corporateActions/types.ts`
- 单跑：`pnpm exec vitest run tests/server/backtest/corporateActionIntegration.test.ts`
- 用例树：
- **PositionBook.applyCorporateAction — 份额/成本基变换**
  - 拆股 1→2：股数×2、均价÷2、成本基不变
  - 现金分红：cashDelta = D×q，股数不变，成本基不变
  - 送股：股数×(1+b)，成本基不变 → 均价摊薄
- **Portfolio.applyCorporateAction — 现金与生命周期**
  - 现金分红计入现金，股数不变
  - 拆股后清仓：已实现盈亏与未拆基准经济等价
- **引擎主循环 — ex-date 应用公司行为**
  - 拆股在生效日应用，持仓与 open trade 同步缩放

### `tests/server/backtest/dbBarStore.test.ts`
- 62 行 ｜ 用例声明 4 ｜ describe 1
- 被测源码：`server/backtest/dbBarStore.ts`
- 单跑：`pnpm exec vitest run tests/server/backtest/dbBarStore.test.ts`
- 用例树：
- **stockDailyPriceRowToBar — varchar 行 → canonical bar**
  - 正常行：各字段解析为 number，adjustment 恒为 raw
  - 可空列（high/low/volume/amount）缺失 → null，不静默填零
  - 空串/非法数值 → null，禁止 NaN/0 伪造
  - turnoverRate 恒为 null（stock_daily_prices 不提供换手率）

### `tests/server/backtest/positionSizingExecution.test.ts`
- 203 行 ｜ 用例声明 15 ｜ describe 6
- 被测源码：`server/research/simulator/plan.ts` · `server/research/framework/contract.ts` · `server/engine/domain.ts` · `server/backtest/context.ts`
- 单跑：`pnpm exec vitest run tests/server/backtest/positionSizingExecution.test.ts`
- 用例树：
- **B-02 — Test A：未声明仓位口径 = 等权现金预算（既有行为逐字不变）**
  - 10 万现金 / 10 元 / 一手 100 股 ⇒ 下单 9900~10000 股（等权全仓，含费估算）
  - 显式声明 EQUAL_WEIGHT ⇒ 与未声明逐字段相同
- **B-02 — Test B：FIXED_FRACTION 50% ⇒ 成交金额约为基准的一半**
  - fraction=0.5 ⇒ 目标资金 5 万 ⇒ 下单约 5000 股（基准的一半）
  - fraction=1.0 ⇒ 与基准一致（100% 不产生额外约束）
- **B-02 — Test C：FIXED_AMOUNT 真正受金额限制**
  - fixedAmount=30000 ⇒ 目标 3 万 ⇒ 下单约 3000 股（而非 10000 股）
  - fixedAmount 小于一手 ⇒ 不建仓，并给出可辨的 skip 原因
  - fixedAmount 超过可分配现金 ⇒ 只收窄不放大（仍受现金约束）
- **§29 — Parameter Sensitivity：0.3 → 0.6 必须改变真实下单数量**
  - 同一决策日、同一候选，仅改 fraction ⇒ 下单股数不同（这是参数搜索可信度的前提）
  - 改造前的缺陷形态（改参数结果不变）不再复现：多档 fraction 得到单调递增的股数
  - fraction 缺失 / 非法 ⇒ 响亮抛错（不静默回落等权）
  - RISK_BASED ⇒ 未实现即拒绝（不静默按等权）
- **确定性 — 同输入两次 ⇒ 逐字节相同**
  - 同仓位口径重复调用 ⇒ 计划完全相同
- **B-01 / B-05 — 执行政策版本与零成交量政策**
  - 政策版本常量存在且为 v1；默认政策含零成交量 REJECT
  - 政策说明文案必须同时含「涨停不可买」「跌停不可卖」「成交量为 0」「版本号」
  - 把零成交量政策改成 IGNORE 时文案必须带警告（防静默宽松）

### `tests/server/backtest/positionSizingFixedAmountSchema.test.ts`
- 307 行 ｜ 用例声明 12 ｜ describe 4
- 被测源码：`server/engine/domain.ts` · `server/research/framework/contract.ts` · `server/research/simulator/plan.ts` · `server/research/strategySchema/index.ts` · `server/research/strategySchema/goldenSample.ts` · `server/runWorkbenchAssembly/assemble.ts`
- 单跑：`pnpm exec vitest run tests/server/backtest/positionSizingFixedAmountSchema.test.ts`
- 用例树：
- **R-02 — ① schema 可声明 / ② validation 可验证**
  - fixed-amount 声明通过文档校验（kind 已进白名单）
  - rich 文档路径：`definition.position.sizingMethod=FIXED_AMOUNT` ⇒ 派生出 fixed-amount 且校验通过
  - ④ fixedAmount <= 0 ⇒ 拒绝（0 / 负数 / NaN 逐项）
  - ⑤ 缺失 fixedAmount ⇒ 拒绝（不是「默认 0」也不是「退化成等权」）
  - 未登记 kind 仍被拒（白名单没有放宽）
- **R-02 — ⑥ legacy FIXED_AMOUNT 投影为 fixed-amount（不再被静默改写为 fixed-fraction）**
  - sizingMethod=FIXED_AMOUNT + fixedAmount ⇒ 派生出 fixed-amount 声明
  - sizingMethod=FIXED_AMOUNT 但缺金额 ⇒ **响亮抛错**（不退化成等权 / 固定比例）
- **R-02 — ③ 文档声明 → 执行层口径（mapDeclaredPositionSizing 是唯一实现）**
  - 四种已登记 kind 逐一机械映射
  - fixed-amount 缺金额 / 金额非法 ⇒ 响亮抛错；未知 kind ⇒ 响亮抛错
- **R-02 — ⑦ 真实执行：fixed-amount 声明真正限制下单金额，且改金额结果就变**
  - fixedAmount=30000 ⇒ 约 3000 股（而非等权全仓约 10000 股）
  - ✅ 参数敏感性：fixedAmount 30000 → 60000 ⇒ 下单股数约翻倍（参数搜索前置条件）
  - 金额不足一手 ⇒ 不建仓，并给出可辨 skip 原因（不是静默按一手强买）
