<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/datasetRegistry

- 测试文件 **12** 个 ｜ 用例声明 **201** 个
- 涉及源码目录：`server/` · `server/datasetRegistry/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/datasetRegistry                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/datasetRegistry/builder.test.ts`
- 591 行 ｜ 用例声明 15 ｜ describe 2
- 被测源码：`server/datasetRegistry/builder.ts` · `server/datasetRegistry/detection.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/builder.test.ts`
- 用例树：
- **FirstLimitPullbackDatasetBuilder**
  - 完整构建产出 2 个首板事件 + path/outcome
  - 幂等：Build(v1) 重复执行不产生重复行（§38.7）
  - Resume：从 checkpoint 续跑不重复已完成的 chunk（§38.8）
  - Version 隔离：v1 / v2 数据用 datasetVersionId 隔离（§38.4）
  - 相对交易日用交易日历（周五 D0 → 下周一 D+1，无自然日跳变）
- **筛选口径真实生效（DATASET-003B）**
  - 板块筛选：只收录所选交易所板块的事件
  - 排除 ST：excludeSt=true 剔除 PIT 状态为 ST 的事件，false 则保留
  - 事件维度 = T-1 日首板：事件日 T 当天不涨停也照样收录，且元数据取锚点日口径
  - 事件维度 OR 叠加：T 日首板 ∪ T-1 日连板 = 并集
  - 封板收盘价恰为四舍五入涨停价时不会漏判（真实数据口径回归）
  - t 前窗口：preWindowDays 真实物化负相对日路径行（含真实 OHLC）
  - preWindowDays=0（默认）不产生负相对日行
  - 左边界预热：窗口首日的连板不被误判为首板（回看窗口之前一天）
  - 预热深度由负锚点决定：T-3 锚点可在窗口起点前 3 个交易日取到
  - Universe + Signal 两层叠加：板块过滤与事件维度同时生效

### `tests/server/datasetRegistry/detection.test.ts`
- 119 行 ｜ 用例声明 12 ｜ describe 4
- 被测源码：`server/datasetRegistry/detection.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/detection.test.ts`
- 用例树：
- **detection: 涨停比例（复用 boardRules 口径，不硬编码 +10%）**
  - 主板非 ST 10%、ST/*ST 5%
  - 创业板/科创板 20%、北交所 30%
  - unknown 板块不可判 → null
- **detection: 涨停判定（交易所口径，四舍五入到分）**
  - close ≥ 涨停价 = 涨停；1 分钱之差不算
  - 回归：封板收盘价恰为「四舍五入到分」的涨停价时必须判为涨停（浮点误差不得漏判）
  - 回归：低于涨停价 1 分仍判否（修正不得放松判定口径）
  - 回归：超出涨停价（异常/除权失真数据）仍判为涨停（用 ≥ 而非 =）
- **detection: 首板判定（首板 = 今日涨停且昨日未涨停）**
  - 窗口首日涨停 → 首板（T-1 无数据视作非连板）
  - 连板：昨日涨停 + 今日涨停 → 非首板
  - 隔日再涨停 → 首板，且 daysSincePreviousLimit 正确
  - eventId 确定性且唯一于 (symbol, tradeDate)
- **detection: Future Leakage（§38.9）**
  - 首板判定只依赖 close/preClose/截至 T 日的滚动状态，不读取未来

### `tests/server/datasetRegistry/filter.test.ts`
- 169 行 ｜ 用例声明 20 ｜ describe 7
- 被测源码：`server/datasetRegistry/filter.ts` · `shared/datasetRegistryContracts.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/filter.test.ts`
- 用例树：
- **matchesEventKind（事件类型真值表）**
  - limitUp：只看锚点日是否涨停
  - firstBoard：锚点日涨停且锚点前一日不涨停
  - consecutiveBoard：锚点日与前一日都涨停
  - firstBoard 与 consecutiveBoard 互斥且覆盖「今日涨停」全集
- **matchesEventSpec / matchesAnyEventSpec（OR 语义）**
  - 单条规格透传 kind 判定
  - 任一规格命中即收录（T日首板 OR T-1日涨停）
  - 空规格列表恒不命中（调用方有契约层保证至少 1 条，此处防御）
- **eventSpecKey（去重键）**
  - 同相对日同类型 → 同键；任一不同 → 不同键
- **isBoardAllowed（Universe 层板块，空数组 = 不过滤）**
  - 空数组放行一切（含 unknown）
  - 显式选择时按集合放行
  - 显式选择时 unknown（null/undefined/未知板块）不入选
- **isStExcluded（PIT ST 维度）**
  - excludeSt=false 恒放行
  - excludeSt=true 只剔除 ST/*ST
- **maxLookbackDays（负锚点回看深度 / warm-up 预算）**
  - 全为 T 日（0）→ 0（但 builder 仍至少预热 1 日用于首板判定）
  - 取负锚点绝对值的最大值
  - 非有限值按 0 处理，不放大回看预算
  - 空列表 → 0
- **默认值与边界常量（双端同源约束）**
  - server BUILD_FILTER_DEFAULTS 与 shared DATASET_BUILD_FILTER_DEFAULTS 完全一致
  - 缺省口径 = 全板块 / 含 ST / T 日首板 / t-0..t+20（历史可比性）
  - 相对日上限 0（反未来泄漏：契约层与纯函数层双层禁止正锚点）

### `tests/server/datasetRegistry/lifecycle.test.ts`
- 120 行 ｜ 用例声明 13 ｜ describe 3
- 被测源码：`server/datasetRegistry/lifecycle.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/lifecycle.test.ts`
- 用例树：
- **DATASET-002.4A · Version 状态机**
  - 合法转换：DRAFT→BUILDING→READY；BUILDING→FAILED
  - 重试/重建：FAILED→BUILDING、READY→BUILDING
  - 非法转换被拒绝（含 schema 未定义的 CANCELLED/ACTIVE/ARCHIVED）
  - assertVersionTransition 抛稳定错误码
  - isVersionBuildable：DRAFT/FAILED/READY 可构建，BUILDING 不可
- **DATASET-002.4A · Build Job 状态机**
  - 合法转换：PENDING→RUNNING→COMPLETED/FAILED/CANCELLED；PENDING→CANCELLED
  - terminal 状态无出边（COMPLETED/FAILED/CANCELLED）
  - 非法转换：重复 start / 重复 cancel / 重复 complete / 重复 fail
  - assertJobTransition 抛稳定错误码
- **DATASET-002.4A · Build Progress**
  - COMPLETED → 100（无论 chunk 字段）
  - 0% / 中间 / 100%
  - 信息不足 → null（不臆造百分比）
  - 百分比夹取到 0..100（completed 越界）

### `tests/server/datasetRegistry/naming.test.ts`
- 73 行 ｜ 用例声明 6 ｜ describe 1
- 被测源码：`server/datasetRegistry/naming.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/naming.test.ts`
- 用例树：
- **naming: ds_{dataset_code}_{role}**
  - 合法 datasetCode 通过校验
  - 非法 datasetCode 被拒绝（version/日期/环境/uuid/大写/非法字符）
  - 物理表名 = ds_{dataset_code}_{role}
  - 定义表名派生完整覆盖 event/prefix/post/path/outcome/feature
  - 解析表名可还原 datasetCode 与 role
  - validateDatasetCode 返回确定性错误列表

### `tests/server/datasetRegistry/path.test.ts`
- 175 行 ｜ 用例声明 15 ｜ describe 4
- 被测源码：`server/datasetRegistry/path.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/path.test.ts`
- 用例树：
- **eventReferenceFrom: 事件参考价单源（C1/C2）**
  - 从 relativeDay = 0 行提取 close / high / volume
  - 无 relativeDay = 0 行 → null（不产出任何窗口行）
  - D0 行情缺失时参考价可为 null（禁止 ?? 0 兜底）
- **原始行情窗口：prefix / post 同构切分（I1/I10）**
  - buildRawBars 只含原始列，不含任何衍生列
  - partitionRawBars：relativeDay ≤ 0 → prefix，≥ 1 → post
- **path: relative_day 衍生量与回撤**
  - D+1 上涨：high/low/close 相对事件收盘
  - D+2 回踩：lowFromEventClose 为负（跌破事件收盘），pullbackFromEventHigh 相对事件最高价
  - 量比 = volume / eventVolume；缺失/除零 → null
  - 参考价缺失 → 全部衍生量为 null（诚实 null，不伪造）
  - 突破前高：high > eventHigh → isBreakout，daysToBreakout = 首个突破日；只产出 rd ≥ 1 行
  - eventHigh 为 null → 突破判定短路为 null / false（不做假设性比较）
- **outcome: 未来结果（研究结果，不进 Signal）**
  - horizon 5 的最大收益 / 最小收益 / 最大回撤
  - 多 horizon 产出确定性与唯一 (eventId, horizon)
  - 窗口数据缺失 → null（不伪造）
  - 参考价缺失 → 全部结果为 null（不产生 0 假值）

### `tests/server/datasetRegistry/physicalTables.test.ts`
- 118 行 ｜ 用例声明 9 ｜ describe 3
- 被测源码：`server/datasetRegistry/physicalTables.ts` · `server/datasetRegistry/plugins.ts` · `server/datasetRegistry/testHelpers.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/physicalTables.test.ts`
- 用例树：
- **assertSafeTableName（表名白名单，防注入）**
  - 合法派生表名通过
  - 拒绝：与 datasetCode 不匹配的表名
  - 拒绝：role 不匹配
  - 拒绝：注入尝试（反引号 / 分号 / DROP / 空格）
- **resolveDefinitionTables**
  - 按 definition 落库表名校验并返回
  - 落库表名为 null 的角色被跳过（如无 feature）
  - 落库表名被篡改 → 抛错（拒绝执行 DDL/DML）
- **InMemoryDatasetPhysicalStore（编排语义）**
  - ensureTables → purgeVersionRows（保留表结构）→ dropTables（删表）
  - 表不存在时删除数据 → deleted=0 且 tableMissing=true（诚实 0，不报错）

### `tests/server/datasetRegistry/plugins.test.ts`
- 144 行 ｜ 用例声明 8 ｜ describe 3
- 被测源码：`server/datasetRegistry/plugins.ts` · `server/datasetRegistry/naming.ts` · `server/datasetRegistry/testHelpers.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/plugins.test.ts`
- 用例树：
- **DatasetPluginRegistry**
  - register / get / has / list（按 datasetCode 升序）
  - 同一 datasetCode 重复注册被拒（不静默覆盖）
  - 未声明物理表的插件被拒（数据结构必须先声明）
  - unregister（仅验证脚本清理用）
- **resolvePluginTables**
  - 按 datasetCode 派生物理表名（ds_{code}_{role}）
- **内置插件：first_limit_pullback**
  - createDefaultPluginRegistry 注册了 first_limit_pullback
  - 声明 event / prefix / post / path / outcome 五张物理表，DDL 自包含（不依赖模板表）
  - DDL 列与索引与迁移一致（关键列存在性 + PIT 结构防线）

### `tests/server/datasetRegistry/query.test.ts`
- 252 行 ｜ 用例声明 13 ｜ describe 3
- 被测源码：`server/datasetRegistry/query.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/query.test.ts`
- 用例树：
- **DATASET-002.2 · cursor 编解码**
  - event cursor round-trip
  - path cursor round-trip
  - outcome cursor round-trip
  - 非法 cursor 返回 null（不抛异常）
- **DATASET-002.2 · 排序键比较器**
  - event：先日期后 eventId
  - path：先 eventId 后 relativeDay
  - outcome：先 eventId 后 horizon
- **DATASET-002.2 · InMemory keyset 分页**
  - event：分页 walk 不重不漏不乱序，且版本隔离
  - event：limit 上限生效（items.length <= limit）
  - event：日期范围过滤
  - path：分页 walk 不重不漏 + eventId 过滤
  - outcome：分页 walk 不重不漏 + horizon 过滤
  - getVersionCounts：统计与 horizon 聚合正确

### `tests/server/datasetRegistry/registry.test.ts`
- 749 行 ｜ 用例声明 47 ｜ describe 6
- 被测源码：`server/datasetRegistry/registry.ts` · `server/datasetRegistry/plugins.ts` · `server/datasetRegistry/physicalTables.ts` · `server/datasetRegistry/lifecycle.ts` · `server/datasetRegistry/testHelpers.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/registry.test.ts`
- 用例树：
- **Dataset Registry**
  - datasetCode 唯一（重复创建被拒绝）
  - 创建定义时物理表名显式落库（§8 不运行时猜名）
  - 非法 datasetCode 拒绝创建
  - (datasetId, version) 唯一（§38.3）
  - Version 隔离：v1 / v2 物理同表、逻辑隔离（dataset_version_id）
  - 作业生命周期：create → start → progress → complete
- **DATASET-002.4A · Build Job Lifecycle（service 层）**
  - createJob：PENDING；无效版本被拒（VERSION_NOT_FOUND）
  - createJob：BUILDING 版本不可创建（VERSION_NOT_BUILDABLE）
  - startJob：PENDING→RUNNING；非法 job 被拒
  - 重复 start 被拒（INVALID_JOB_TRANSITION）
  - cancelJob：PENDING 可取消、RUNNING 可取消
  - 重复 cancel 被拒（INVALID_JOB_TRANSITION）
  - COMPLETED/FAILED 不可取消
  - completeJob/failJob：仅 RUNNING 可转换，重复被拒
  - retryJob：FAILED/CANCELLED → 新 PENDING；历史 Job 保留
  - retryJob：非 FAILED/CANCELLED 被拒
  - 并发保护：两个 Job 同一版本，第二个 start 被拒（JOB_ALREADY_RUNNING）
  - Version 状态机：非法 markReady/markFailed 被拒
- **DATASET-002.4B / 003B · createVersionWithBuildConfig（构建入口）**
  - 创建 DRAFT 版本并固化筛选配置（filterDefinition 镜像 + dataset_build_config 行）
  - 缺省筛选参数：回退权威默认（事件日首板 / 无前置 / t+20 / [5,10,20] / 1000）
  - 未完成筛选配置（events 为空）→ INVALID_BUILD_FILTER（构建门禁）
  - 筛选边界越界 → INVALID_BUILD_FILTER（不静默夹取）
  - 重复版本 → VERSION_ALREADY_EXISTS
  - 定义不存在 → DEFINITION_NOT_FOUND
  - 定义已归档 → DEFINITION_ARCHIVED
  - 非法版本标签 → INVALID_VERSION_LABEL（含空格 / 首字符为符号）
- **DATASET-003A · 多数据集与删除**
  - 插件已注册：createDefinition 同时建立物理表（每个数据集独立表名）
  - 未注册插件：可登记定义（不建表），但创建构建作业被拒（BUILDER_NOT_REGISTERED）
  - isBuildable：已注册插件为 true
  - deleteVersion：删数据（保留表结构）+ 删作业 + 删版本记录
  - deleteVersion：RUNNING 作业存在 → 拒绝（VERSION_HAS_RUNNING_JOB）
  - deleteVersion：版本不存在 → VERSION_NOT_FOUND
  - deleteDefinition：级联删版本 + DROP 物理表 + 删定义（可同 code 重建）
  - deleteDefinition：存在 RUNNING 作业 → 拒绝（DEFINITION_HAS_RUNNING_JOB）
  - deleteDefinition：不存在 → DEFINITION_NOT_FOUND
  - 多数据集隔离：删 A 不影响 B 的定义 / 版本 / 物理表
  - deleteVersion / deleteDefinition：无物理表存储时明确报错（不静默跳过）
- **DATASET-LIFECYCLE-001 · 取消即回滚（取消 ≠ 暂停）**
  - RUNNING 取消 → 作业 CANCELLED + 版本 FAILED + 该版本数据行清空（表结构保留、其它版本不受影响）
  - 幂等：对已 CANCELLED 的作业再次取消不抛错，只补做回滚（并修回版本态）
  - COMPLETED 作业不可取消（不冒充可回滚）
  - 取消 PENDING 作业同样清空该版本残留数据（版本态保持可构建）
  - 🔴 版本仍是 READY（本轮构建尚未接管）→ 取消**不得清空数据**，原数据集保持有效
  - 无物理表存储时 cancelJobAndRollback 明确报错（不静默跳过）
- **DATASET-LIFECYCLE-001 · 孤儿作业回收**
  - 停更超过阈值 → 回收：作业 CANCELLED + 版本 FAILED + 数据清空（表结构保留、死锁解除）
  - 仍在刷新进度（updatedAt 新）→ 视为存活，不回收
  - staleMinutes <= 0 → 整体跳过（关闭自动回收）
  - 🔴 版本仍是 READY（本轮未接管）→ 回收作业但**不清空**该版本有效数据

### `tests/server/datasetRegistry/router.test.ts`
- 585 行 ｜ 用例声明 31 ｜ describe 8
- 被测源码：`server/routers.ts` · `server/datasetRegistry/query.ts` · `server/datasetRegistry/testHelpers.ts` · `server/datasetRegistry/types.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/router.test.ts`
- 用例树：
- **DATASET-002.2 · router 注册守卫**
  - appRouter.datasetRegistry 已注册，且不破坏旧 researchDataset
- **DATASET-002.2 · 入参校验（经 tRPC caller）**
  - listEvents：非法 datasetVersionId / limit 越界 / 非法 cursor / 日期区间倒置 均被拒
  - listPaths / listOutcomes：非法入参被拒
- **DATASET-002.2 · Definition / Version / Job 端点**
  - listDefinitions / getDefinition
  - getDefinition：未命中返回 NOT_FOUND
  - listVersions / getVersion / listJobs / getJob
  - getStatistics：声明 vs 实测统计正确
- **DATASET-002.2 · Event / Path / Outcome keyset 端点**
  - listEvents：第一页 + 第二页不重不漏
  - listPaths / listOutcomes：返回分页结构
- **DATASET-002.2 · update / archive admin 端点**
  - updateDefinition / archiveDefinition 需要 admin 权限
- **DATASET-002.4A · Build Lifecycle mutation 端点**
  - createBuildJob → startBuildJob → cancelBuildJob 全链路（PENDING→RUNNING→CANCELLED）
  - cancelBuildJob：取消即回滚（返回真实清理结果），重复取消幂等不报错
  - retryBuildJob：CANCELLED → 新 PENDING（历史保留）
  - 非法输入被 schema 拒绝（datasetVersionId=0 / 空 jobId）
  - 稳定错误码：不存在的版本 → NOT_FOUND；重复 start → CONFLICT
  - 非 admin 调用被拒（FORBIDDEN）
- **DATASET-002.4B · createDatasetVersion（构建新版本入口）**
  - 创建版本（DRAFT）+ 固化筛选配置
  - 非法输入被 schema 拒绝（无日期 / 区间倒置 / 空 version / 视界越界）
  - 未完成筛选配置（filter 缺失 / events 为空）→ schema 拒绝（构建门禁）
  - 非法版本标签 → BAD_REQUEST（不走 service 也应被 schema 拦截）
  - 重复版本 → CONFLICT；不存在定义 → NOT_FOUND
  - 非 admin 调用被拒（FORBIDDEN）
- **DATASET-003A · 多数据集管理与删除端点**
  - listDatasetPlugins：返回已注册插件与其物理表
  - createDatasetDefinition：未注册插件的 code → buildable=false（不建表）
  - createDatasetDefinition：已注册的 code → buildable=true 且建表
  - createDatasetDefinition：非法 code / 重复 code / 非 admin 被拒
  - deleteDatasetVersion：删数据（表结构保留）+ 删作业；RUNNING 时 CONFLICT
  - deleteDatasetVersion：不存在 → NOT_FOUND
  - deleteDatasetDefinition：confirmDatasetCode 不匹配 → BAD_REQUEST（防误删）
  - deleteDatasetDefinition：级联删版本 + DROP 表 + 删定义
  - deleteDatasetDefinition：RUNNING 作业 → CONFLICT；不存在 → NOT_FOUND

### `tests/server/datasetRegistry/runner.test.ts`
- 227 行 ｜ 用例声明 12 ｜ describe 1
- 被测源码：`server/datasetRegistry/plugins.ts` · `server/datasetRegistry/runner.ts` · `server/datasetRegistry/lifecycle.ts` · `server/datasetRegistry/testHelpers.ts`
- 单跑：`pnpm exec vitest run tests/server/datasetRegistry/runner.test.ts`
- 用例树：
- **DefaultDatasetBuildRunner**
  - 成功：RUNNING 作业被真实执行 → COMPLETED + 版本 READY + 进度 100
  - 幂等 start：同作业同进程只执行一个实例
  - 非法 start：PENDING 作业 → INVALID_JOB_TRANSITION，且不置 RUNNING
  - 非法 start：不存在的作业 → JOB_NOT_FOUND
  - 失败：builder 抛错 → job FAILED + version FAILED（错误落 errorMessage）
  - 无插件：runner 侧插件缺失 → BUILDER_NOT_REGISTERED，作业 FAILED（不冒充成功）
  - 协作式取消：build 中途 cancel → 作业保持 CANCELLED（runner 不覆盖终态）
  - 重建 = 从零：构建开始前清空该版本遗留数据行（upsert 空更新不会清理旧行）
  - 取消即回滚：waitForStop 等到执行体真正退出后，该版本已落库数据被清空
  - waitForStop：本进程无在途执行体 → 立即 true（孤儿作业可安全回滚）
  - start 会联动版本 → BUILDING（构建期间）
  - DatasetLifecycleError 是稳定错误类型（可被上层映射）
