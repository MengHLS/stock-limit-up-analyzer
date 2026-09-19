<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/runWorkbenchAssembly

- 测试文件 **2** 个 ｜ 用例声明 **26** 个
- 涉及源码目录：`server/datasetRegistry/` · `server/runWorkbenchAssembly/` · `server/security/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/runWorkbenchAssembly                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/runWorkbenchAssembly/universeConstraint.test.ts`
- 109 行 ｜ 用例声明 8 ｜ describe 1
- 被测源码：`server/runWorkbenchAssembly/datasetFromRegistry.ts`
- 单跑：`pnpm exec vitest run tests/server/runWorkbenchAssembly/universeConstraint.test.ts`
- 用例树：
- **pickUniverseConstraint — 回落重建的 universe 约束继承**
  - A. build_config 优先：boards 与 excludeSt 一律取自权威生成参数
  - B. 无 build_config 时兜底读版本自述（实测 390002 就是这个形状）
  - C. 两个来源都没有约束 ⇒ source=none 且空 boards（不猜、不默认给 main）
  - C2. 版本自述形状不符（字符串 / null / 数组）⇒ 一律 none，绝不从字符串里抠板块
  - D. 非法板块取值 ⇒ 抛 UniverseConstraintError（含 unknown：它不是白名单）
  - D2. 抛错**不是** RegistryDatasetBridgeError ⇒ 不会被「回落重建」逻辑吞掉
  - E. boards 去重且保持原顺序；excludeSt 只认严格 true
  - F. 空 boards + 不排除 ST = 「全板块」声明（must not 被当成约束）

### `tests/server/runWorkbenchAssembly/windowProjection.test.ts`
- 460 行 ｜ 用例声明 18 ｜ describe 3
- 被测源码：`server/runWorkbenchAssembly/datasetFromRegistry.ts` · `server/datasetRegistry/types.ts` · `server/security/types.ts`
- 单跑：`pnpm exec vitest run tests/server/runWorkbenchAssembly/windowProjection.test.ts`
- 用例树：
- **resolveObservationWindow — 观察窗口只能来自策略声明**
  - A. 未声明 ⇒ null（调用方据此拒绝直读，**不代猜窗口**）
  - B. 合法声明 ⇒ {start, end}（实库 cand-36000x 就是 {1,3,TRADING_DAY}）
  - C. 非 TRADING_DAY 单位 ⇒ 响亮抛错
  - D. start < 1 / end < start / 非整数 / 超 post 上限 ⇒ 一律抛错（**不夹取**）
  - E. 声明了但不是对象 ⇒ 抛错（不是「当作未声明」）
- **buildWindowRows — 事件窗口 → 逐日面板**
  - A. 面板 = rd 0..4（end+1），序号/日期/OHLCV 一一对应
  - B. 决策日资格 = rd ∈ [start,end]：rd=0 与 rd=end+1(=4) 都**不是**决策日
  - C. preClose 链式：rd=0 用事件前收，rd≥1 用上一相对日收盘
  - D. 观察日行的 turnover / 市值如实为 null（首板日数值不得外推）
  - E. 重叠窗口合并为 (证券, 交易日) 唯一行，且行序按 (tradeDate, securityId) 升序
  - F. 同一根 K 线数值冲突 ⇒ 响亮抛错（不编造取舍）
  - G. 缺中间相对日 ⇒ 该日无行（不补齐、不插值）
  - H. securityId 取自身份映射（canonical），code 才是 event.symbol —— 两字段不可互换
  - I. 事件缺身份 ⇒ 响亮抛错（不退回用代码冒充身份）
- **resolveSecurityIdsByEvent — symbol（代码域）→ canonical sec_<uuid>**
  - A. 事件日落在生效区间内 ⇒ 解析到该 identity；区间外 ⇒ 抛错（PIT，不用「当前」猜）
  - B. code reuse：同一代码在不同区间归属不同证券 ⇒ 各自按事件日解析到各自身份
  - C. 同区间多行指向不同 identity（数据错误）⇒ 歧义即抛错，不静默取第一条
  - D. symbol 无法解析成完整代码 ⇒ 抛错；裸 6 位码按既有前缀推断（不额外加码）
