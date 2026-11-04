# PLAN-EXIT-POLICY-GENERALIZATION-001

## 执行状态

- `2026-09-27`：子 agent 通道因本地 DeepSeek 代理连续失败，未产生任何子线程改动。
- `2026-09-27`：批次 1 已由主线程按相同文件所有权完成。
- `2026-09-27`：`drizzle/0044_exit_policy_json.sql` 已应用，`strategy_exit_rules.policyJson` 已存在。
- `2026-09-27`：批次 2 已完成通用止损评估器、装配、runner 和 `SL-00~SL-30` 注册表。
- `2026-09-27`：`SL-00` 首轮门禁暴露旧 `v1.14.0` 留档与当前工作区代码不同步。
- `2026-09-27`：新增同一代码快照下的 `1.14.1` fresh legacy 控制组。
- `2026-09-27`：`SL-00@1.27.2` 与 `1.14.1` 已通过逐笔一致性门禁：
  1078 笔成交、差异 0、期末权益均为 `104754.791986`。
- `2026-09-28`：`SL-00~SL-30` 全量扫描完成，共 46 个已注册版本，0 失败。
- `2026-09-28`：当前全区间最优为 `SL-18.1` 峰值回撤 8% 止损：
  累计收益 `+27.96%`、最大回撤 `51.68%`、PF `1.0909`。
- `2026-09-28`：第二优为 `SL-16.0` Chandelier：
  累计收益 `+21.63%`、最大回撤 `50.71%`、PF `1.0474`。
- `2026-09-28`：完整结果见 `docs/research/RESULT-3F-TOPN-STOP-POLICY-STUDY-001.md`。
- 状态：全量探索完成；下一步是 OOS / walk-forward / 稳健性验证，不属于本批次代码通用化范围。

## 目标

把现有止盈、止损、强势续持、runner、分批退出和资本周转能力统一为可配置退出策略，
使 `SL-00~SL-30` 和已有止盈方案都通过配置表达，而不是继续在模拟器中追加一次性分支。

## 不可破坏的约束

- 不回写或覆盖已存在策略版本。
- `v1.14.0`、`v1.22.0`、`1.23.1`、`1.24.1`、`1.25.0`、`1.26.0` 的行为必须可由旧字段继续表达。
- 不修改 Dataset v5 数据。
- 不把止损、止盈、时间退出和组合状态混成一个阈值。
- 所有新增策略定义必须可 JSON 序列化、可校验、可描述、可测试。
- 每批最多两个写代码的子 agent，避免同时修改热文件。

## 通用模型

计划新增：

```text
ExitPolicyDefinition
  stop: StopPolicyDefinition
  takeProfit: TakeProfitPolicyDefinition | null
  timeExit: TimeExitPolicyDefinition | null
  strongHold: StrongHoldPolicyDefinition | null
  capitalRecycle: CapitalRecyclePolicyDefinition | null
```

止损维度：

```text
StopPolicyDefinition
  anchor: FIXED_PERCENT | ATR | STRUCTURE_LOW | RANGE_FRACTION | ATR_PERCENTILE
  confirmation: INTRADAY | ON_CLOSE | TWO_CLOSES | DISASTER_PLUS_CLOSE
  escalation: BREAK_EVEN | LADDER | R_MULTIPLE | CHANDELIER | MA_BAND | PEAK_DRAWDOWN
  schedule: phase[] | null
  reduction: none | partial[] | null
  context: MARKET | SECTOR | LEADER | PORTFOLIO_DRAWDOWN | LOSS_STREAK[]
```

## 方案编号

| 编号 | 能力 | 输入字段 |
|---|---|---|
| `SL-00` | 6% 盘中止损对照 | `FIXED_PERCENT + INTRADAY` |
| `SL-01` | 固定百分比 | `FIXED_PERCENT` |
| `SL-02` | ATR 固定风险距离 | `ATR + fixedAtEntry` |
| `SL-03` | 观测窗结构低点 | `STRUCTURE_LOW` |
| `SL-04` | 首板结构价 | `STRUCTURE_LOW + eventDay` |
| `SL-05` | N 日低点 | `STRUCTURE_LOW + rollingWindow` |
| `SL-06` | 首板区间比例 | `RANGE_FRACTION` |
| `SL-07` | ATR 分位 | `ATR_PERCENTILE` |
| `SL-08` | 盘中确认 | `confirmation=INTRADAY` |
| `SL-09` | 收盘确认 | `confirmation=ON_CLOSE` |
| `SL-10` | 两收盘确认 | `confirmation=TWO_CLOSES` |
| `SL-11` | 灾难止损 + 收盘止损 | `confirmation=DISASTER_PLUS_CLOSE` |
| `SL-12` | 跌停开板确认 | `confirmation=LIMIT_DOWN_RECONFIRM` |
| `SL-13` | 保本止损 | `escalation=BREAK_EVEN` |
| `SL-14` | 分级利润锁 | `escalation=LADDER` |
| `SL-15` | R 倍止损 | `escalation=R_MULTIPLE` |
| `SL-16` | Chandelier 止损 | `escalation=CHANDELIER` |
| `SL-17` | MA10 ATR 带 | `escalation=MA_BAND` |
| `SL-18` | 高点回撤止损 | `escalation=PEAK_DRAWDOWN` |
| `SL-19` | 前两日宽止损 | `schedule` |
| `SL-20` | 时间递减止损 | `schedule` |
| `SL-21` | 时间递减 + 保本 | `schedule + escalation` |
| `SL-22` | 首日宽止损 | `schedule` |
| `SL-23` | 两阶段减仓止损 | `reduction=partial` |
| `SL-24` | 结构失效减仓 | `reduction + STRUCTURE_LOW` |
| `SL-25` | ATR 预警减仓 | `reduction + ATR` |
| `SL-26` | 市场状态止损 | `context=MARKET` |
| `SL-27` | 板块状态止损 | `context=SECTOR` |
| `SL-28` | 龙头状态止损 | `context=LEADER` |
| `SL-29` | 组合回撤闸门 | `context=PORTFOLIO_DRAWDOWN` |
| `SL-30` | 连续亏损冷却 | `context=LOSS_STREAK` |

## 代码所有权与批次

### 批次 1

最多两个子 agent：

1. `exit-policy-domain`
   - 新增 `server/research/exitPolicyCommon.ts`
   - 新增 `server/research/stopPolicy.ts`
   - 必要调整 `server/research/trailingPolicy.ts`
   - 新增类型与纯校验测试
2. `strategy-persistence`
   - 修改 `server/research/strategySchema/definition.ts`
   - 修改 `server/research/strategySchema/definitionValidation.ts`
   - 修改 `server/research/strategySchema/projection.ts`
   - 修改 `drizzle/schema.ts`
   - 新增 `drizzle/0044_exit_policy_json.sql`
   - 修改 `server/research/strategyPersistence/db.ts`

### 批次 2

最多两个子 agent：

1. `simulator-exit-engine`
   - 新增 `server/research/simulator/advancedStop.ts`
   - 修改 `server/research/simulator/types.ts`
   - 修改 `server/research/simulator/validate.ts`
   - 修改 `server/research/simulator/engine.ts`
   - 修改 `server/research/simulator/plan.ts`
   - 修改 `server/runWorkbenchAssembly/exitPolicy.ts`
2. `experiment-registry`
   - 修改 `server/research/patternLibrary/threeFactorTopNStrategy.ts`
   - 修改 `scripts/run3FTopNTrailingPolicyStudy.mts`
   - 新增 `scripts/run3FTopNStopPolicyStudy.mts`
   - 维护 `SL-00~SL-30` 配置注册表

### 批次 3

最多两个子 agent：

1. `verification`
   - 只读审计代码路径与版本兼容性
   - 运行聚焦测试
   - 输出失败项与修复建议，不直接改热文件
2. `research-runbook`
   - 只写研究文档与运行手册
   - 登记版本号、参数矩阵、评价指标和执行顺序

## 验收门

批次 1：

- `npx tsc --noEmit`
- 新策略定义校验测试
- canonical definition 到 projection 的 round-trip

批次 2：

- 所有旧固定止损 / 固定回撤测试继续通过
- `SL-00` 与 `v1.14.0` 同输入逐笔一致
- 每个新策略族至少一个纯函数触发测试
- 部分退出、runner 槽位、替换现金测试通过

批次 3：

- 明确列出所有失败项及其是否属于本次改动
- 仅在验收通过后运行 `SL-00` 真实闭环

## 真实回测顺序

1. `SL-00`
2. `SL-01.0~SL-01.3`
3. `SL-02.0~SL-02.2`
4. `SL-03.0~SL-03.2`
5. `SL-09.0`
6. `SL-11.0`
7. `SL-14.0`

每轮最多并行两个重回测进程，不启动第三路。
