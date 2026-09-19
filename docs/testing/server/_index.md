<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server

- 测试文件 **57** 个 ｜ 用例声明 **522** 个
- 涉及源码目录：`client/src/lib/` · `drizzle/` · `server/` · `server/_core/` · `server/corporateActions/` · `server/data/` · `server/marketData/` · `server/research/` · `server/research/closedLoop/` · `server/research/framework/` · `server/research/performanceMetrics/` · `server/researchCore/` · `server/researchEngine/` · `server/security/` · `server/securityStatus/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/server                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

> ⚠️ 本组是**直接落在 `tests/server/` 直下**的散装测试，vitest 的路径过滤圈不出这一层
> （`tests/server` 会连带 `tests/server/**` 全部子模块）。要只跑本层，用上面的逐文件命令，或直接用 `test:changed`。

> ⚠️ 本模块有 **7** 个环境依赖测试（真库 / 真网络 / 真证据文件），离线**必然失败**；
> 全量跑时它们会稳定出现在失败集合里，属**已知基线**，见 `docs/testing/README.md` 的登记表。

> ℹ️ 本模块有 **9** 个「源码文本断言」测试（`readFileSync` 源码 + 字符串匹配），
> 改个变量名就可能变红，且不验证行为；详见 `docs/testing/README.md` 的「测试分类」一节。

## 逐文件

### `tests/server/auth.logout.test.ts`
- 63 行 ｜ 用例声明 1 ｜ describe 1
- 被测源码：`server/routers.ts` · `shared/const.ts` · `server/_core/context.ts`
- 单跑：`pnpm exec vitest run tests/server/auth.logout.test.ts`
- 用例树：
- **auth.logout**
  - clears the session cookie and reports success

### `tests/server/backfillHighVolume.test.ts`
- 125 行 ｜ 用例声明 7 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：`server/stockPriceSync.ts` · `server/tushare.ts`
- 单跑：`pnpm exec vitest run tests/server/backfillHighVolume.test.ts`
- 用例树：
- **backfill_high_volume 数据边界（Canonical → Validation → Persist）**
  - valid price：合法行正常转换为可写入行（数值以字符串落库，非 null）
  - null price：源数据为 null 时 DB 落 null，绝不产生 "null" 字面量
  - undefined price：源字段缺失时 DB 落 null，绝不产生 "undefined" 字面量
  - NOT NULL 列（open/close/preClose）缺失时不可持久化，绝不静默填 0
  - invalid market bar：OHLC 矛盾的行被拒绝，不进入 upsert
  - 非目标股票代码的行被过滤，不写入
  - 脚本源码不得再使用 String(price.x) 静默降级，必须复用生产校验入口

### `tests/server/backtestPage.test.ts`
- 253 行 ｜ 用例声明 3 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：**无相对/别名 import**（自足纯函数或读文件断言）
- 单跑：`pnpm exec vitest run tests/server/backtestPage.test.ts`
- 用例树：
- **独立组合资金回测页面**
  - 注册独立路由，并从龙头候选页提供入口
  - 独立页保留参数、资金审计和完整订单表
  - 页签归属与模拟订单分页符合 2026-09-18 需求

### `tests/server/boardHeightRiskControl.test.ts`
- 205 行 ｜ 用例声明 10 ｜ describe 2
- 被测源码：`server/downsideRisk.ts` · `server/leaderCandidates.ts` · `shared/boardHeightRisk.ts`
- 单跑：`pnpm exec vitest run tests/server/boardHeightRiskControl.test.ts`
- 用例树：
- **连板高度风险控制**
  - 同题材同封板时间下，5 板 / 6 板的风险分严格高于 4 板
  - 7 板高位标的被硬过滤与质量门控限制参与，并单独计数
  - 5 板 / 6 板未越上限但按固定系数降低仓位，且不删除候选
  - 提高允许参与上限即放宽限制参与，但阶梯扣分与降仓仍然生效
- **历史缺失字段降级**
  - 整日缺题材时不再聚合成一个巨型题材，家数改用同日中性值
  - 整日缺题材时「题材支撑不足」不再作为风险证据（缺失 ≠ 弱题材）
  - 封板时间缺失不再伪造「封板偏晚」风险，但字段可得时仍按原口径扣分
  - 字段完整的交易日保持原有口径：题材家数与风险扣分与旧逻辑一致
  - sector 缺失但 keywords 可得时用首个主题词兜底（局部缺列场景）
  - 回测结果附带字段覆盖报告，且不参与评分

### `tests/server/boardRoster.test.ts`
- 171 行 ｜ 用例声明 14 ｜ describe 3
- 被测源码：`server/boardRoster.ts` · `shared/boardEmotionScore.ts`
- 单跑：`pnpm exec vitest run tests/server/boardRoster.test.ts`
- 用例树：
- **buildBoardRoster**
  - 连板股：只收当日 2 板及以上，且板数按「连续记录交易日」累计
  - 首板不会被计入连板股（空档会断连）
  - 断板股 = 上一记录交易日涨停、当日未涨停；并区分连板中断 / 首板未续
  - 当日已涨停的股票不会同时出现在断板名单里
  - 同一股票同日多条记录只算一只，且保留封板更早的时间
  - 情绪评分与共享公式一致（totalLimitUp / connectionBoards / maxBoards / board3Plus）
  - 板数降序排序（同日再按封板时间升序）
  - 目标日没有涨停记录时整体留空，不把上一记录日误判为断板
  - 连板数顶满窗口时显式告警（不静默给错数）
  - 正常窗口不告警（板数未触顶）
- **computeBoardEmotionScore**
  - 无涨停时为 0（不产生 NaN）
  - 最高板归一封顶在 10 板
- **shiftIsoDate**
  - 按自然日平移（UTC 基准）
  - 非法日期直接抛错

### `tests/server/continuousRange.test.ts`
- 36 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`client/src/lib/continuousRange.ts`
- 单跑：`pnpm exec vitest run tests/server/continuousRange.test.ts`
- 用例树：
- **continuous range helpers**
  - 将像素位置连续换算为数据索引
  - 移动选区时保持窗口宽度并限制在历史范围内
  - 拖动两侧手柄时支持连续范围并在松手后对齐交易日

### `tests/server/customSector.test.ts`
- 13 行 ｜ 用例声明 2 ｜ describe 1
- 被测源码：`client/src/lib/customSector.ts`
- 单跑：`pnpm exec vitest run tests/server/customSector.test.ts`
- 用例树：
- **normalizeCustomSector**
  - trims and collapses whitespace in a custom sector name
  - returns undefined for an empty custom sector

### `tests/server/dataHealth.test.ts`
- 191 行 ｜ 用例声明 13 ｜ describe 4 ｜ 🔌 环境依赖 ｜ 📄 源码文本断言
- ⚠️ 外部依赖：真实证据文件 `docs/researchReadyGate/research_ready_gate.json`
- 被测源码：`server/dataHealth.ts` · `shared/dataHealthContracts.ts` · `server/dataHealthRouter.ts`
- 单跑：`pnpm exec vitest run tests/server/dataHealth.test.ts`
- 用例树：
- **FE-1 认证证据读取（真实文件）**
  - 真实 gate 证据文件存在且通过 schema 校验
  - summary 计数自洽：PASS + PENDING + FAIL === total
  - 分层语义：dataFoundationReady(G0) 与「无 FAIL 且无 PENDING」一致，researchReady(G4) 不再等于数据域 PASS
  - schema 不匹配时返回 parseError 而不伪造 gate
- **FE-1 域派生（规则一致性，基于真实证据）**
  - 派生出 A~G 七域，且 checkIds 与 DOMAIN_SPEC 一致
  - 域状态 = 其 gate 项聚合（含 FAIL→FAIL，含 PENDING→PENDING，全 PASS→PASS）
  - 覆盖率取**最差**来源（保守口径，不取平均/最好）
  - 覆盖率 target 取自 threshold，而非硬编码常量
  - gate 项缺失时域状态保守为 PENDING（口径漂移不冒充 PASS）
  - 派生规则：FAIL 优先于 PENDING 优先于 PASS
- **FE-1 总览与证据清单**
  - 总览透传 researchReady，且携带证据清单与陈旧度
  - 证据清单来自真实文件（含 gate 与 audit 状态）
- **FE-1 router 注册守卫**
  - appRouter 暴露 dataHealth 路由

### `tests/server/downsideRisk.test.ts`
- 354 行 ｜ 用例声明 13 ｜ describe 1
- 被测源码：`server/downsideRisk.ts` · `server/leaderCandidates.ts` · `server/realisticBacktest.ts`
- 单跑：`pnpm exec vitest run tests/server/downsideRisk.test.ts`
- 用例树：
- **buildDownsideRiskResearch**
  - 基于相邻交易日权益曲线计算可复算的夏普、索提诺、卡玛与回撤压力，不读取候选未来价格
  - 权益点不足或波动为零时不制造无限夏普、索提诺或卡玛比率
  - 从既有资金曲线、订单、交易日和日线成交额复算六层评价，不将其反馈到信号评分
  - 默认采用45日训练与14日验证的滚动参数
  - 只以信号日特征计分，并优先用买入后完整实际交易日最低价路径生成下行标签和可比实验
  - 观察期不完整时不生成下行标签，避免用不完整的未来路径比较风险分层
  - 滚动验证窗口始终位于前置训练窗口之后，且只用验证期完整标签生成实验
  - 在每个训练窗口内从固定网格选出更优扣分权重，并只将其用于后续验证窗口
  - 验证期未来价格变化不会影响已在训练期选出的权重，完全平局时选择更小权重
  - 关闭自动寻优时所有验证窗口回退使用手动扣分权重
  - 将全部无重叠验证窗口在同一连续资金账户中拼接，并返回有序且无重复的整体样本外曲线
  - 对五种策略执行同一全周期连续回测，并只在验证段应用训练选出的风险扣分权重
  - 未来价格路径变化不会改变风险因子在信号日的消融覆盖和平均贡献

### `tests/server/downsideRiskDrawdownDurations.test.ts`
- 74 行 ｜ 用例声明 8 ｜ describe 1
- 被测源码：`server/downsideRisk.ts`
- 单跑：`pnpm exec vitest run tests/server/downsideRiskDrawdownDurations.test.ts`
- 用例树：
- **calculateDrawdownDurations**
  - 空序列 ⇒ 两项皆 null
  - 单点序列 ⇒ 两项皆 null
  - 全期无回撤（单调上行 / 持平）⇒ 两项皆 null
  - 锁定的是最深区间，而不是最长区间（旧口径会给出 7 / 4）
  - 两项相加 = 峰值日 → 收复日 的总交易日数
  - 并列最深时取最早那一次
  - 期末仍未收复 ⇒ 收复用时计至期末
  - 最深区间落在期末且尚未收复时同样参与评选

### `tests/server/exportCsv.test.ts`
- 45 行 ｜ 用例声明 2 ｜ describe 1
- 被测源码：`client/src/lib/exportCsv.ts`
- 单跑：`pnpm exec vitest run tests/server/exportCsv.test.ts`
- 用例树：
- **buildLimitUpCsv**
  - exports the selected records with a UTF-8 BOM
  - quotes values containing commas, quotes, or newlines

### `tests/server/factorCombination.test.ts`
- 225 行 ｜ 用例声明 15 ｜ describe 9
- 被测源码：`server/factorCombination.ts` · `server/leaderCandidates.ts`
- 单跑：`pnpm exec vitest run tests/server/factorCombination.test.ts`
- 用例树：
- **pearsonCorrelation**
  - 完全正相关为 1，完全负相关为 -1
  - 缺失样本被跳过
  - 样本不足或变差为零返回 null
- **extractFactorValueMatrix + 相关性矩阵**
  - 提取技术因子与候选因子，并正确计算相关性
- **deduplicateFactors**
  - 高度相关因子按优先级保留，冗余被移除
- **zScore / quantileRank / residualize**
  - z-score 标准化均值 0 标准差 1，缺失保持 null
  - 分位归一化到 0~1 区间
  - residualize 移除线性暴露，残差与暴露不相关
- **buildFactorNeutralizationReport**
  - 输出相关性矩阵、去重建议与中性化因子
- **spearmanCorrelation + Spearman 矩阵**
  - 单调非线性关系 Spearman=1，而 Pearson<1
  - Spearman 相关矩阵与 Pearson 矩阵同形状
- **buildVif**
  - 高度相关因子 VIF 远大于 1，独立因子 VIF≈1
  - 奇异矩阵返回全 null
- **effectiveNumberOfFactors**
  - 完全独立 → EN=因子数；完全相关 → EN=1
- **buildFactorClusters**
  - 同簇内高度相关的因子被标记为冗余

### `tests/server/factorScore.test.ts`
- 139 行 ｜ 用例声明 3 ｜ describe 3
- 被测源码：`server/technicalFactors.ts` · `server/factorCombination.ts` · `server/overfittingGuard.ts` · `server/factorScore.ts` · `server/leaderCandidates.ts`
- 单跑：`pnpm exec vitest run tests/server/factorScore.test.ts`
- 用例树：
- **buildFactorVerdicts**
  - 强预测因子评级非 Invalid，且汇总覆盖全部因子
- **buildStrategyOverfittingRiskScore**
  - 高 DSR/PSR 低风险，低 DSR/PSR 高风险
- **buildFinalVerdict**
  - 汇总因子评级、过拟合风险与策略质量

### `tests/server/firstBoard.test.ts`
- 76 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`client/src/lib/firstBoard.ts`
- 单跑：`pnpm exec vitest run tests/server/firstBoard.test.ts`
- 用例树：
- **firstBoard**
  - calculates the previous recorded trading date rather than the previous calendar date
  - returns null for invalid dates
  - keeps today's limit-up stocks that did not limit up yesterday
  - treats a missing previous-day record set as no previous limit-up
  - excludes consecutive limit-ups when the prior recorded trading day is separated by a weekend or holiday

### `tests/server/highBoardLabels.test.ts`
- 54 行 ｜ 用例声明 4 ｜ describe 1
- 被测源码：`client/src/lib/highBoardLabels.ts`
- 单跑：`pnpm exec vitest run tests/server/highBoardLabels.test.ts`
- 用例树：
- **buildDistinctHighBoardLabels**
  - 同一股票连续达到6板及以上时仅在阶段最高连板日期标注
  - 同一最高连板节点的多只股票合并为一次名称标注
  - 连续阶段出现同板数最高点时选择较晚日期标注
  - 中断后再次达到6板及以上时允许重新标注

### `tests/server/homeData.test.ts`
- 61 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`client/src/lib/homeData.ts`
- 单跑：`pnpm exec vitest run tests/server/homeData.test.ts`
- 用例树：
- **home data helpers**
  - keeps only the selected and previous-date records for first-board checks
  - selects the latest database date regardless of input order
  - summarizes positive daily counts and ignores empty days
  - summarizes sectors from current records and places empty sectors last
  - initializes and updates batch watch statuses without per-stock queries

### `tests/server/image.uploadAndRecognize.test.ts`
- 269 行 ｜ 用例声明 13 ｜ describe 1 ｜ 🔌 环境依赖 ｜ 📄 源码文本断言
- ⚠️ 外部依赖：真实 MySQL + 路由落库
- 被测源码：**无相对/别名 import**（自足纯函数或读文件断言）
- 单跑：`pnpm exec vitest run tests/server/image.uploadAndRecognize.test.ts`
- 用例树：
- **image.uploadAndRecognize**
  - 识别保存成功后必须按识别出的有效日期同步行情，并记录日期刷新结果
  - 应该验证输入参数的类型
  - 应该验证日期格式为YYYY-MM-DD
  - 应该验证base64数据格式
  - 应该支持多种MIME类型
  - 应该生成正确的文件键格式
  - 应该正确处理识别结果中的日期优先级
  - 应该正确处理空的识别结果
  - 应该正确映射识别的股票数据
  - 应该正确处理缺失的字段
  - 应该返回正确的响应格式
  - 应该处理多个识别的股票
  - 应该验证文件名不为空

### `tests/server/indexSync.test.ts`
- 216 行 ｜ 用例声明 23 ｜ describe 5
- 被测源码：`server/marketData/indexSync.ts` · `server/marketData/indexes.ts`
- 单跑：`pnpm exec vitest run tests/server/indexSync.test.ts`
- 用例树：
- **planIndexSync —— 智能增量（省配额的核心）**
  - 本地无数据时按请求区间全量拉取
  - 首尾都在容差内时跳过：0 请求 = 0 配额消耗
  - 仅末端落后时只补 [末日+1, end]，绝不整段重拉
  - 首部缺失时退回全区间（中部/首部缺口无法靠末端补齐）
  - force 时忽略已有覆盖、按整段重取（换源修数用）
  - 给出行情末端参照时，落后 1 个交易日必须判为增量而非齐平（纸面交易空转的现场）
  - 给出参照且末日不早于参照时跳过
  - 参照晚于请求终点时以请求终点为准（自定义历史区间不被未来参照放宽）
  - 端点落在长假/周末时不被误判为落后（容差 30 天）
  - 起始日晚于结束日时抛错（不静默拉空区间）
- **resolveIndexSyncWindow —— 窗口解析**
  - 默认起点固定 2019-01-01、终点对齐行情末端
  - 无行情末端时退回「今天」（now 可注入）
  - 显式区间优先于默认值与行情末端
  - 起点晚于终点时抛错
- **describeIndexSyncProviders —— 按环境暴露可用性与代价**
  - provider 顺序稳定且 sina 恒可用
  - 没有 TUSHARE_TOKEN 时 tushare 判为不可用（避免点下去才报错）
  - tushare 请求间隔为 65 秒（规避 1 次/分钟限频）
  - baostock 未配 MARKETDATA_PYTHON 时不可用且给出原因
- **日期工具**
  - addDays 跨月/跨年/闰年正确
  - diffDays 返回带符号自然日差
  - 非法日期直接抛错
- **常量**
  - 默认同步 4 只核心指数，且每只都在身份参考表内
  - 单次同步时间预算小于 Node 默认 requestTimeout(300s)

### `tests/server/leaderCandidateBacktestSnapshot.test.ts`
- 136 行 ｜ 用例声明 11 ｜ describe 1
- 被测源码：`server/leaderCandidateBacktestSnapshot.ts`
- 单跑：`pnpm exec vitest run tests/server/leaderCandidateBacktestSnapshot.test.ts`
- 用例树：
- **回测结果磁盘快照**
  - 写入后可原样读回（大结果才落盘）
  - 小结果不落盘（收益低于 IO 成本）
  - TTL 过期视为未命中
  - key 不匹配视为未命中（不同参数不得互相复用）
  - 版本不一致视为未命中
  - 损坏 JSON / 缺失文件静默降级，不抛异常
  - payload 非对象视为未命中（防半截写入）
  - 清空删除全部快照文件（写入路径失效语义）
  - 异步清空同样生效，目录不存在时不抛异常
  - 超过上限时淘汰最旧快照
  - 写入不遗留 .tmp 临时文件

### `tests/server/leaderCandidateHistory.test.ts`
- 175 行 ｜ 用例声明 12 ｜ describe 1
- 被测源码：`server/leaderCandidates.ts` · `server/leaderCandidateHistory.ts`
- 单跑：`pnpm exec vitest run tests/server/leaderCandidateHistory.test.ts`
- 用例树：
- **龙头候选明细分页**
  - 默认分页只回传一页，聚合计数反映全量
  - 保持上游顺序切片：分页结果顺序与全量列表逐行一致
  - 分页切片与全量列表零重复零遗漏（任意页长）
  - pageSize 非法值回落、超上限截断
  - 页码越界夹取到最后一页（数据收缩时不出现空白页）
  - 页码非法值回落为 1
  - 空结果不产生 NaN，且 totalPages 至少为 1
  - phase 过滤发生在分页之前（totalRows 反映筛选后全量）
  - onlySuccess 过滤生效，且不修改入参顺序
  - 无过滤参数时返回原数组引用（零拷贝快路径）
  - phase=null / onlySuccess=null 视为不过滤（前端清空筛选）
  - 剥离明细后聚合字段保留，仅暴露行数

### `tests/server/leaderCandidates.test.ts`
- 405 行 ｜ 用例声明 19 ｜ describe 2
- 被测源码：`server/leaderCandidates.ts`
- 单跑：`pnpm exec vitest run tests/server/leaderCandidates.test.ts`
- 用例树：
- **buildLeaderCandidates**
  - 价格映射保留仅有开盘或仅有收盘的日线，丢弃两项都无效的记录
  - 仅从最新交易日的主板涨停中生成可解释候选，并排除非主板股票
  - 以已记录交易日序列判定连板，交易日中断后重新从首板计算
  - 当日全量评分列表包含低分主板涨停股，重点候选按质量门槛筛选且非主板边界保持不变
  - 将信号日风险分、扣分和净评分并列返回，且不读取未来日线行情
  - 全样本历史明细为每条候选保留信号日风险分、扣分和净评分，且不读取后续日线成交额
  - 同一股票同日重复记录时保留较早封板记录，避免重复统计
  - 五板及以上与首板一样进入候选评分与历史回测，覆盖全连板高度
  - 回测仅使用T日及以前数据生成候选，并以T加1涨停延续作为成功口径
  - 仅在满足最低历史样本量时输出校准阈值
  - 支持将第2个后续交易日作为成功口径，且手动阈值会过滤回测样本
  - 按候选信号日的情绪阶段聚合独立样本外漏斗，不从后续验证日读取阶段
  - 仅用信号日收盘与下一已记录交易日价格计算候选池次日开盘和收盘溢价
  - 价格回测以完整日线交易日历定位 T+1/T+2，自动跨过周末和节假日
  - 成功观察日使用完整市场交易日历，不因中间无涨停记录而跳过实际T+1
  - 回测覆盖每个可观察交易日的全部候选，而非每日期20只或近期30条明细
  - 流通市值评分优先考虑容量与弹性均衡区间，并提示缺失或极端市值风险
- **candidate data normalization**
  - 合并题材后的星号统计后缀，不让同一题材被拆成多个分组
  - 历史候选展示采用代码最近的稳定名称，避免 OCR 名称漂移污染回测明细

### `tests/server/leaderCandidatesPage.test.ts`
- 59 行 ｜ 用例声明 5 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：**无相对/别名 import**（自足纯函数或读文件断言）
- 单跑：`pnpm exec vitest run tests/server/leaderCandidatesPage.test.ts`
- 用例树：
- **龙头候选池页面（服务端分页修复）**
  - 页面通过分页端点读取历史明细，不再直接消费全量 historicalRows
  - 明细表只渲染服务端返回的当前页，并提供分页控件
  - 分页控件提供首/上/下/末页与页码夹取
  - 回测端点剥离明细，分页端点注册在同一 router
  - 磁盘快照在数据写入路径上失效（上传后页面不得读到旧结果）

### `tests/server/limitUp.stats.test.ts`
- 106 行 ｜ 用例声明 2 ｜ describe 2
- 被测源码：`server/routers.ts` · `server/_core/context.ts`
- 单跑：`pnpm exec vitest run tests/server/limitUp.stats.test.ts`
- 用例树：
- **limitUp.getDailyStats**
  - should return daily limit up statistics
- **limitUp.getSectorDistribution**
  - should return daily sector distribution statistics

### `tests/server/limitUp.test.ts`
- 206 行 ｜ 用例声明 11 ｜ describe 11 ｜ 🔌 环境依赖
- ⚠️ 外部依赖：真实 MySQL（自选板块落库 + 日统计）
- 被测源码：`server/routers.ts` · `server/_core/context.ts`
- 单跑：`pnpm exec vitest run tests/server/limitUp.test.ts`
- 用例树：
- **limitUp router**
  - **getAll**
    - returns an array of records (public access)
  - **getDates**
    - returns an array of date strings (public access)
  - **search**
    - returns empty array for empty query
    - returns array for valid query
  - **getByDate**
    - returns array of records for a given date
  - **getSectorStats**
    - returns sector statistics for a given date
  - **create (protected)**
    - creates a new limit up record when authenticated
  - **delete (protected)**
    - requires authentication
- **image router**
  - **getAll (protected)**
    - requires authentication
    - returns array when authenticated
- **custom sector data flow**
  - persists a custom sector and exposes it in daily statistics

### `tests/server/limitUp.watch.test.ts`
- 185 行 ｜ 用例声明 6 ｜ describe 1 ｜ 🔌 环境依赖
- ⚠️ 外部依赖：真实 MySQL（`stockWatchlist` 读写）
- 被测源码：`server/routers.ts` · `server/_core/context.ts` · `server/db.ts` · `drizzle/schema.ts`
- 单跑：`pnpm exec vitest run tests/server/limitUp.watch.test.ts`
- 用例树：
- **limitUp.getWatchStatus and updateWatchStatus**
  - should return 'none' for unwatched stock
  - should add stock to normal watch and return 'normal'
  - should upgrade from normal to important watch
  - should remove watch when status is 'none'
  - should handle complete watch cycle: none -> normal -> important -> none
  - should isolate watch status between different users

### `tests/server/limitUpTime.test.ts`
- 32 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`shared/limitUpTime.ts`
- 单跑：`pnpm exec vitest run tests/server/limitUpTime.test.ts`
- 用例树：
- **limit-up time normalization**
  - pads HH:MM to HH:MM:SS
  - pads a single-digit hour and seconds
  - keeps valid HH:MM:SS unchanged
  - accepts empty values as unknown time
  - rejects invalid hours, minutes, seconds and text

### `tests/server/marketData.test.ts`
- 61 行 ｜ 用例声明 5 ｜ describe 1 ｜ 🔌 环境依赖
- ⚠️ 外部依赖：真实 MySQL（`server/db.ts` 的 upsert / 查询）
- 被测源码：`server/db.ts`
- 单跑：`pnpm exec vitest run tests/server/marketData.test.ts`
- 用例树：
- **Market Data Functions**
  - should upsert market data
  - should get market data by date
  - should get all market data
  - should update existing market data
  - should delete market data

### `tests/server/marketFactors.test.ts`
- 59 行 ｜ 用例声明 4 ｜ describe 1
- 被测源码：`server/marketFactors.ts` · `server/tushare.ts`
- 单跑：`pnpm exec vitest run tests/server/marketFactors.test.ts`
- 用例树：
- **marketFactors**
  - 仅汇总沪深证券的Tushare日线amount，并将千元转换为亿元
  - 解析交易所工作簿中的逗号金额，并将元转换为亿元
  - 对缺少目标字段或无效金额的工作簿明确报错
  - 仅将已有market_data中的正数值解析为亿元，拒绝占位或空值

### `tests/server/marketSync.test.ts`
- 83 行 ｜ 用例声明 11 ｜ describe 3
- 被测源码：`server/marketSync.ts`
- 单跑：`pnpm exec vitest run tests/server/marketSync.test.ts`
- 用例树：
- **大盘数据同步：日期算术**
  - shiftDateString 按自然日加减，跨月跨年正确
  - getBeijingDateString 用北京时判定日历日（库中时间戳存 UTC，+8 才是北京时）
- **大盘数据同步：selectMissingTradingDates**
  - 剔除已有数据的日期，结果升序
  - 列出晚于 endDate 之外的全部缺口（不猜数据源可用性：末端未发布日仍列入）
  - 已有数据为空时返回整个日历
  - 日历与已有数据都为空时返回空数组（空态不伪造）
  - 已有数据含日历外日期不影响结果，且不改动入参
  - endDate 早于全部日期时返回空数组
- **大盘数据同步：调度时刻（防回归）**
  - 所有同步时刻都不早于北京时间 08:00
  - 至少包含一个主同步与一个重试时刻
  - 补缺窗口足以覆盖「服务停机数天」

### `tests/server/marketVisualization.test.ts`
- 79 行 ｜ 用例声明 6 ｜ describe 2
- 被测源码：`server/db.ts`
- 单跑：`pnpm exec vitest run tests/server/marketVisualization.test.ts`
- 用例树：
- **Market Data Visualization API**
  - **getLimitUpWithMarketData**
    - should return array of data with date, limitUpCount, turnover, and marginBalance
    - should return data sorted by date in ascending order
    - should respect the days parameter
    - should include market data when available
    - should handle empty results gracefully
    - should parse turnover and marginBalance as numbers correctly

### `tests/server/maxConnectionBoard.test.ts`
- 60 行 ｜ 用例声明 4 ｜ describe 1
- 被测源码：`server/db.ts`
- 单跑：`pnpm exec vitest run tests/server/maxConnectionBoard.test.ts`
- 用例树：
- **buildMaxConnectionBoardTrend**
  - 按日期升序计算最高连板并标注对应股票
  - 同一日期出现多个最高连板股票时全部保留
  - 排除创业板、科创板和北交所股票，同时保留其交易日断档影响
  - 没有记录时返回空数组

### `tests/server/openExpectation.test.ts`
- 96 行 ｜ 用例声明 5 ｜ describe 4
- 被测源码：`server/openExpectation.ts`
- 单跑：`pnpm exec vitest run tests/server/openExpectation.test.ts`
- 用例树：
- **timeToMinutes / bucketOfLimitUpTime**
  - 解析 HH:mm:ss 为分钟并正确归档封板档位
- **classifyOpenExpectation**
  - 按分档期望区间区分超预期/符合预期/不及预期
- **buildOpenExpectationTable**
  - 按样本分位数构建期望中心与上下界
  - 样本不足的档位用全样本分布回退带宽
- **summarizeOpenExpectationTiers**
  - 分档输出候选/放弃/买入/已出清/平均收益/胜率

### `tests/server/operationLog.test.ts`
- 75 行 ｜ 用例声明 4 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：**无相对/别名 import**（自足纯函数或读文件断言）
- 单跑：`pnpm exec vitest run tests/server/operationLog.test.ts`
- 用例树：
- **图片识别与日期刷新操作日志**
  - schema记录识别、刷新、状态、日期、数量和操作者
  - 日志查询按当前用户隔离并支持类型、状态、日期筛选
  - 网页同步、本地异步识别和日期刷新均写入日志
  - 日志页面已注册并提供状态与类型筛选

### `tests/server/orderReturnSort.test.ts`
- 31 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`client/src/lib/orderReturnSort.ts`
- 单跑：`pnpm exec vitest run tests/server/orderReturnSort.test.ts`
- 用例树：
- **订单收益率排序**
  - 按收益率降序排列，且收益待定订单稳定置于末尾
  - 按收益率升序排列，并保持相同空收益订单的原始顺序
  - 在未排序或升序状态点击表头时切换为降序，在降序时切换为升序

### `tests/server/overfittingGuard.test.ts`
- 176 行 ｜ 用例声明 12 ｜ describe 7
- 被测源码：`server/overfittingGuard.ts` · `server/leaderCandidates.ts` · `server/realisticBacktest.ts`
- 单跑：`pnpm exec vitest run tests/server/overfittingGuard.test.ts`
- 用例树：
- **mulberry32**
  - 相同种子可复现，不同种子不同
- **normalCdf / normalQuantile**
  - 标准正态已知值
  - normalQuantile 与 normalCdf 互为逆
- **calculateSharpeMoments**
  - 正收益序列夏普为正，常数序列或样本不足返回 null
- **expectedMaximumSharpe / deflatedSharpeRatio**
  - 试验次数越多，期望最优夏普越大
  - DSR 合理：零夏普远低于 0.5，高夏普接近 1
- **runMonkeyBenchmark**
  - 真实策略显著优于随机时 exceededRandom95 为 true
  - 真实策略不优于随机时 exceededRandom95 为 false
- **probabilisticSharpeRatio**
  - 高夏普 PSR 接近 1，零夏普约 0.5
  - 相对更高基准夏普，PSR 下降
- **runReturnBootstrap**
  - 正收益序列夏普置信区间下界为正、破产概率在 [0,1]
  - 样本不足返回 null 指标

### `tests/server/paperTrading.test.ts`
- 660 行 ｜ 用例声明 40 ｜ describe 9
- 被测源码：`server/leaderCandidates.ts` · `server/paperTrading.ts`
- 单跑：`pnpm exec vitest run tests/server/paperTrading.test.ts`
- 用例树：
- **buildForwardPreparedBuys 准备买入清单**
  - 按策略分排序、排除已持有、受最大持仓数限制
  - 风险扣分策略使用扣分后的净分排序
  - 高风险硬过滤与质量门控均排除被阈值排除的候选
- **advancePaperTradingDay 逐日推进**
  - 完整生命周期：T+1 开盘成交 → T+2 强势续持 → T+3 未满足强势出清
  - 一字涨停封死按规则不追买
  - 开盘低于预期阈值不买入
  - 次日开盘预期三档：尾盘板低开判定不及预期并放弃买入
  - 收盘触发止损出清
  - 推进后生成下一交易日准备清单并排除持仓
- **buildPaperTradingSummary 前向曲线汇总**
  - 统计已出清订单的胜率与收益
- **classifyAdvanceKind 推进三态判定**
  - 有推进日期 ⇒ advanced（日历仍落后也照样是 advanced）
  - 无推进且日历末端 = 行情末端 ⇒ already-latest（合法空转）
  - 无推进且日历早于行情 ⇒ calendar-stale（事故真实形态，不得报成功）
  - 交易日历取不到末端 ⇒ calendar-stale，绝不伪装成「已是最新」
  - 行情末端取不到时不臆测日历落后（只按日历自身判定）
- **paperTradingAdvanceDiagnosis 人话结论**
  - advanced：带推进天数与日期，且不误报日历落后
  - advanced 但日历仍落后：calendarStale=true 且文案要求先同步指数日线
  - calendar-stale：同时给出日历末端与行情末端
  - 取不到日历时给出「无数据」而非「已是最新」
  - already-latest / 三类失败态各有明确文案（都不伪装成成功）
  - message 可覆盖默认文案（调用方定制）
- **PaperTradingCalendarStaleError 建运行前置校验**
  - 带稳定领域码与细节，便于路由把码写进 message
- **advancePaperTradingDay 组合止损与判定时点**
  - 建仓算术基线：成交价/股数/建仓成本/建仓时账户总权益
  - 组合止损在收盘触发：浮亏占建仓总权益 3.3% ⇒ 无条件出清（单票比例止损此时并未触发）
  - 组合止损在开盘触发：开盘 9.68 ⇒ 按开盘价出清（不是等到收盘）
  - 判定时点=收盘 ⇒ 跳空破位不在开盘出清（保住旧语义），收盘缺口仍在收盘出清
  - 判定时点=开盘 ⇒ 跳空破位按开盘价出清（补上 D1 的开盘分支）
  - 判定时点=开盘 ⇒ 收盘不再判硬性止损，但续持类规则仍生效（否则持仓没有收盘退出路径）
  - 判定时点=开盘+收盘 ⇒ 同一日既有开盘判定也有收盘判定（缺省行为）
  - 动态回撤止盈进入开盘判定：峰值 +9.89% 后开盘回撤 4.55% ⇒ 按开盘价止盈
  - 阈值设为 0 ⇒ 关闭组合止损，行为回落到「仅比例止损 + 续持」
  - 一字跌停卖不出时不假装出清，且如实写下原因（不留黑洞）
- **resolvePaperTradingSettings 缺省解析（旧运行零写库即生效）**
  - 完全不传 ⇒ 缺省「开盘+收盘 / 组合止损 3%」
  - 显式 0 表示关闭组合止损（不是「回落成缺省」）
  - 认不出的时点值回落为缺省，不静默变成 undefined
  - 阈值超界被夹取到 [0, 100]
- **evaluateHardExitRules 纯判定（优先级：比例止损 → 组合止损 → 回撤止盈）**
  - 价格无效 / 非正 ⇒ 不判定（不臆测成交价）
  - 单票比例止损优先于组合止损（两者同时成立时给出前者）
  - 旧持仓缺 equityAtEntry 时回落为传入的兜底分母（初始资金）
  - 分组名与阈值都写进原因，便于事后读日志判口径

### `tests/server/realisticBacktest.test.ts`
- 525 行 ｜ 用例声明 28 ｜ describe 1
- 被测源码：`server/leaderCandidates.ts` · `server/realisticBacktest.ts`
- 单跑：`pnpm exec vitest run tests/server/realisticBacktest.test.ts`
- 用例树：
- **simulateRealisticTPlus1ToTPlus2**
  - 按整手、滑点和买卖费用计算净收益，并生成资金曲线
  - 同日超过最大持仓数时按评分优先，其余记录为跳过
  - 同日开盘买入不能使用当日收盘出清所得资金，也不能在原持仓收盘前释放仓位
  - 首笔全仓买入后即使尚有持仓槽位，也不得用不足一手的剩余资金继续买入
  - 支持等权、评分加权和固定比例分仓，并保持资金与仓位约束
  - T+1开盘严格低于预期阈值时跳过买入，等于阈值仍可入场且不占用资金
  - 按保守规则拒绝接近涨停的买入，并记录缺行情原因
  - P1-F4：涨跌停判定统一走板块权威阈值，不再用 9.9% 近似
  - 按实际交易日而非自然日跨周末与节假日出清
  - 对数据末端尚无 T+2 交易日给出精确提示，不归因于周末
  - 限制跌停卖出时在后续实际交易日持续尝试出清，而非停止回测
  - 回测末端仍无法卖出时，以最后实际交易日收盘价估值并保留持仓
  - 非一字跌停即使收盘接近跌停，严格模式下仍按当日收盘价正常出清
  - 一字跌停保守成交概率支持 0%、可复现的中间概率与 100% 三种情景
  - 风险管理策略以最高收盘价回撤动态止盈，而非达到固定收益立即卖出
  - 仅在T+1收盘实际可见后记录高点，并用于后续交易日的回撤判断
  - 未达到动态止盈启动浮盈时，回撤不会触发动态止盈
  - 强势续持在T+2只看当日收盘，随后转弱或达到持有上限时出清
  - 风险管理策略在T+2开盘触发止损时按开盘价立即出清
  - 开盘止损完成后可释放仓位与现金供同日开盘候选使用，但一字跌停仍不强行成交
  - 按成交额分档加成滑点：小盘股滑点更大
  - T+1一字涨停封死时跳过买入
  - 盘中最低价触及止损价时按止损价出清
  - 按成交额比例限制单笔买入规模
  - 检测除权除息跳空并标记样本
  - 次日开盘预期三档：开启后按封板时间分档，不及预期放弃买入
  - 次日开盘预期三档：超预期/符合预期买入并标记档位，逐档汇总正确
  - 次日开盘预期三档默认关闭时保留旧的一刀切阈值文案与行为

### `tests/server/realisticSimulationSemantics.test.ts`
- 177 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`server/data/index.ts` · `server/leaderCandidateStrategyBacktest.ts` · `server/leaderCandidates.ts`
- 单跑：`pnpm exec vitest run tests/server/realisticSimulationSemantics.test.ts`
- 用例树：
- **P2-1 生产 realisticSimulation 语义（无退出信号时的 buy-and-hold 估值）**
  - T 信号 → T+1 开盘成交 → 期末持仓：completedCount = 0 且 openPositionCount > 0
  - completedCount = 0 → winRate = null（不是 0），winningTrades = 0
  - openPositionCount > 0 的未平仓持仓不被计为失败交易
  - totalReturn / maxDrawdown / equityCurve / trades 保持 Engine 语义
  - Determinism：同一 Data/Config/asOf 重复执行语义字段完全一致

### `tests/server/recognition.test.ts`
- 53 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`server/recognition.ts`
- 单跑：`pnpm exec vitest run tests/server/recognition.test.ts`
- 用例树：
- **parseRecognitionResult**
  - uses the API date and normalizes stock exchange suffixes
  - reads text content returned as an array and drops incomplete rows
  - rejects results without a valid date

### `tests/server/researchContracts.test.ts`
- 152 行 ｜ 用例声明 13 ｜ describe 4
- 被测源码：`server/routers.ts` · `shared/researchContracts.ts` · `server/research/index.ts`
- 单跑：`pnpm exec vitest run tests/server/researchContracts.test.ts`
- 用例树：
- **FE-0 · 契约一致性守卫**
  - shared 生命周期状态枚举与后端 STRATEGY_LIFECYCLE_STATUSES 完全一致
- **FE-0 · appRouter 注册（R6 回归锁）**
  - historicalState / researchDataset / research 三个 router 均已暴露
  - research 下含 strategy 与 lifecycle 子路由
  - research.strategy 下含 STEP STRATEGY-002 CRUD 端点（注册守卫）
- **FE-0 · 入参 schema 校验**
  - isoDateSchema 拒绝非 YYYY-MM-DD
  - historicalState.asOf 入参：缺 securityId 或非法日期被拒
  - researchDataset.build 入参：名称/日期校验 + 限流字段为正整数
  - lifecycle.transition 入参：reason 非空（§23 四要素）
- **FE-0 · 纯函数端点（经 tRPC caller）**
  - research.strategy.validate：非法本体返回 valid=false 且不抛异常
  - research.strategy.bump：semver 推进语义正确
  - research.lifecycle.describe：返回后端权威 8 态与迁移表
  - research.lifecycle.transition：合法相邻迁移返回新记录（append-only，不改原记录）
  - research.lifecycle.transition：跳级迁移被拒绝（不静默成功）

### `tests/server/researchEngineRouter.test.ts`
- 927 行 ｜ 用例声明 43 ｜ describe 9
- 被测源码：`server/routers.ts` · `server/researchEngineRouter.ts` · `server/researchCore/index.ts` · `server/researchEngine/errors.ts` · `server/researchEngine/testFixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngineRouter.test.ts`
- 用例树：
- **researchEngineRouter — 注册与权限**
  - appRouter 暴露全部 researchEngine 端点
  - 注册 researchEngine 未破坏既有 router
  - 写端点与执行端点必须管理员：未登录 / 非管理员一律拒绝
  - 维护端点（update / delete）同样必须管理员：未登录一律拒绝
- **researchEngineRouter — 变量目录**
  - listVariables 只暴露 Dataset 真实存在的视界
  - listVariables 对不存在的 Dataset Version → NOT_FOUND
- **researchEngineRouter — 端到端链路**
  - QUANTILE：Experiment → Run → Analysis → Result → Conclusion 全链路可查回
  - 已 COMPLETED 的 Run 不允许重复执行（CONFLICT）
  - 重跑同一 Run 时结果被整批重写而非追加
  - 分析条件替换后旧产物失效：清结果 + 删失效结论 + 回退 PENDING（于是可重跑）
- **researchEngineRouter — 维护端点（更新 / 级联删除）**
  - updateExperiment 改名生效；datasetVersionId 不可改（schema 里没有该键）
  - updateExperiment 空 patch → BAD_REQUEST（拒绝无意义写）
  - deleteExperiment 级联删干净：实验 / Run / 分析 / 结果 / 假设 / 结论全为 0 残留
  - deleteExperiment 未命中 → NOT_FOUND
  - deleteRun 只删归属该 Run 的结论：另一个 Run 的结论必须保留
  - deleteRun 未命中 → NOT_FOUND
  - deleteRun 对 RUNNING 的 Run → CONFLICT（拒绝删除飞行中的写入）
  - deleteAnalysis 删分析 + 子行 + 证据指向它的结论（Run 保留）
  - updateHypothesis / deleteHypothesis 生效（删假设连带删其结论）
  - updateAnalysis 改名称生效，且不影响已落库结果
- **researchEngineRouter — 错误码映射**
  - 未找到 Experiment → NOT_FOUND
  - 未找到 Run → NOT_FOUND
  - Run 不属于该 Experiment → CONFLICT
  - 未知变量 → BAD_REQUEST（引擎在计算前就拒绝）
  - 没有任何分析 → BAD_REQUEST
  - runEngine 失败后 Run 必须落 FAILED + errorCode（可查回）
  - getExperiment / getRun / getAnalysis 未命中 → NOT_FOUND
- **researchEngineRouter — 增量补跑（runIncremental）**
  - 整轮执行后新增分析：走路由补跑 → 有新结果、有批次日志、不生成结论、旧结果不变
  - 从未整轮执行过（无基准快照）→ PRECONDITION_FAILED
  - 已 COMPLETED 的分析不可补跑 → CONFLICT；无待补跑分析 → CONFLICT
- **researchEngineRouter — 批量建分析（createAnalyses）**
  - 一次提交建出一组分析，且 created 的 index 能映射回入参
  - CONDITIONAL 带条件时条件真实落库（组号连续）
  - 预检未通过 → 整批拒绝，**一个都不建**（BAD_REQUEST）
  - CONDITIONAL 缺条件 → 预检拦住（不写出一个跑不了的分析）
  - Run 不存在 → NOT_FOUND
- **researchEngineRouter — 分析模板（跨实验复用）**
  - 创建 → 清单 → 按模板铺到另一个 Run（跨实验复用）
  - 模板里带条件时，展开后条件是**真关系行**（不是 JSON 直通）
  - 模板名重名 → CONFLICT（名字是「一键铺开」的不歧义引用基础）
  - 空模板明细 → BAD_REQUEST（zod min(1)），不写出一个铺不出东西的模板
  - 模板不存在 → NOT_FOUND（apply 与 delete 都如此）
  - 删除模板：明细一并消失，且不影响已铺出的分析
- **researchEngineRouter — 默认实例契约**
  - getConclusionPolicy 返回引擎默认阈值（前端展示用）
  - ResearchEngineError 是 Engine 边界上唯一的领域错误类型

### `tests/server/researchEngineRouterFinding.test.ts`
- 278 行 ｜ 用例声明 9 ｜ describe 3
- 被测源码：`server/researchEngineRouter.ts` · `server/researchCore/index.ts` · `server/researchEngine/testFixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/researchEngineRouterFinding.test.ts`
- 用例树：
- **researchEngineRouter — Finding 端点**
  - runEngine 收口自动检测 Finding；listFindings / getFinding 可查回
  - detectFindings 端点幂等：重跑不翻倍（fingerprint 去重）
  - reviewFinding 状态机：DISCOVERED → REVIEWED → SUPPORTED 合法；跳级被拒
  - getFinding / reviewFinding 对不存在的 id 报 NOT_FOUND
- **researchEngineRouter — Hypothesis 补充端点**
  - getHypothesis 查回；testHypothesis 置 TESTABLE 需三件套
  - testHypothesis 状态机：形式化后可逐级推进；跳级被拒
- **researchEngineRouter — Candidate 从假设转出**
  - 非 SUPPORTED 假设不能转候选（§26 不要自动生成 Strategy）
  - SUPPORTED 假设可转出 DRAFT 候选，并落谱系锚（sourceHypothesisId / sourceFindingIds）
  - 不存在的假设报 NOT_FOUND

### `tests/server/researchFindingIntegration.test.ts`
- 153 行 ｜ 用例声明 2 ｜ describe 1
- 被测源码：`server/researchEngineRouter.ts` · `server/researchCore/index.ts` · `server/researchEngine/testFixtures.ts`
- 单跑：`pnpm exec vitest run tests/server/researchFindingIntegration.test.ts`
- 用例树：
- **RESEARCH-FINDING-001 闭环集成（Analysis → Result → Finding → Hypothesis → Candidate）**
  - 五段闭环逐跳谱系可回溯
  - 非 SUPPORTED 假设在闭环中卡在 Hypothesis 段（§26 不得跳转）

### `tests/server/researchRunRouter.test.ts`
- 334 行 ｜ 用例声明 17 ｜ describe 5
- 被测源码：`server/routers.ts` · `server/research/closedLoop/types.ts` · `server/research/performanceMetrics/evaluate.ts` · `shared/researchContracts.ts`
- 单跑：`pnpm exec vitest run tests/server/researchRunRouter.test.ts`
- 用例树：
- **FE-0 · researchRun appRouter 注册守卫**
  - researchRun.catalog.list / readiness / loopRun 已暴露
- **FE-0 · researchRun.catalog.list**
  - 返回已装配的内置研究策略（leader-candidate-baseline）
  - 全部条目过 output schema（经 caller 自动校验）
- **FE-4 · 闭环阶段 id 传输契约**
  - shared 字面量与后端 canonical 阶段链逐项一致（防双份漂移）
- **FE-0 · researchRun.readiness（真实装配探测）**
  - executorBound 来自覆盖率探测，不再硬编码：14 阶段中 8 装配 / 6 无执行器
  - 认证证据真实可读（只读快照，不重算 gate）
  - 认证快照 researchReady=true → 数据侧放行，主因落到 EXECUTOR_NOT_BOUND
  - 策略目录随 readiness 返回（与 catalog.list 一致）
- **FE-4 · researchRun.loopRun — 真实执行**
  - 零入参全 14 阶段：首阻塞 data（CL_DATA_NOT_INJECTED），无任何执行、无合成产物
  - 只跑 evaluation（seed + 直供权益曲线）：EXECUTED 且数字等于真实评估器独立复算
  - evaluation 无任何入参时如实 BLOCKED（CL_RUNNER_NOT_INJECTED），不产出占位评估
  - evaluationInput 未与 backtestSummarySeed 成对提供 → BAD_REQUEST（拒绝伪绑定）
  - seed 与链内 backtest 阶段冲突 → BAD_REQUEST（不静默丢种子）
  - stageIds 乱序输入归一为拓扑序，且未请求阶段为 SKIPPED
  - 同输入两次运行 → 链指纹逐位一致（可复现）
  - runId 缺省时由 createdAt 派生（同 createdAt → 同 runId）
  - 非法阶段名被 input schema 拒绝（不静默忽略）

### `tests/server/sentimentAlert.test.ts`
- 197 行 ｜ 用例声明 11 ｜ describe 9
- 被测源码：`drizzle/schema.ts` · `server/db.ts`
- 单跑：`pnpm exec vitest run tests/server/sentimentAlert.test.ts`
- 用例树：
- **Sentiment Alert Functions**
  - **EMOTION_LEVELS**
    - should have correct emotion level definitions
    - should return correct emotion level for given score
  - **getAllSentimentAlerts**
    - should return an array of alerts
    - should respect the limit parameter
  - **getUnreadAlertCount**
    - should return a number
  - **detectSentimentTurningPoint**
    - should return null for non-existent date
    - should detect turning point for valid date with data
  - **createSentimentAlert**
    - should create a new alert or return existing one
  - **markAlertAsRead**
    - should mark an alert as read
  - **markAllAlertsAsRead**
    - should return the number of alerts marked as read
  - **checkAndCreateAlert**
    - should check and potentially create an alert for a date

### `tests/server/sentimentCycle.test.ts`
- 187 行 ｜ 用例声明 11 ｜ describe 1
- 被测源码：`server/sentimentCycle.ts`
- 单跑：`pnpm exec vitest run tests/server/sentimentCycle.test.ts`
- 用例树：
- **buildSentimentCycleAnalysis**
  - 以高于五板定义周期龙头，没有六板以上时标记为混沌周期
  - 只将低位混沌期首板起涨、后续成为六板龙头的股票识别为原生龙
  - 在原生龙达到六板前不以未来数据提前确认
  - 汇总所有已确认龙头并以一只股票一行展示其全部类型
  - 原生龙一旦被识别为穿越或补涨龙，列表只保留后续类型和周期龙头身份
  - 非穿越且非补涨的已确认周期龙头默认标注为原生龙
  - 跨越近期事件上限时仍使用全部交易日汇总断板后的各类龙头
  - 以同一连续连板段的首日为原生龙起点，不回溯到数据库中更早的孤立涨停
  - 将连续相同市场周期合并，并保留区间内发生过的情绪阶段
  - 在老龙断板后区分突破老龙的穿越周期龙和突破五板的低位补涨龙
  - 断板日的候选与分类信号不读取未来数据，未来表现只在历史回顾中更新

### `tests/server/step11.pitAdversarial.test.ts`
- 223 行 ｜ 用例声明 15 ｜ describe 7
- 被测源码：`server/data/index.ts` · `server/data/boardRules.ts` · `server/research/framework/leakage.ts` · `server/research/framework/featureProvider.ts` · `server/securityStatus/pointInTime.ts` · `server/securityStatus/types.ts` · `server/security/tradingCalendar.ts` · `server/marketData/industry.ts` · `server/marketData/types.ts` · `server/corporateActions/engine.ts` · `server/corporateActions/integration.ts` · `server/corporateActions/types.ts` · `shared/stockDataNormalization.ts`
- 单跑：`pnpm exec vitest run tests/server/step11.pitAdversarial.test.ts`
- 用例树：
- **GUARD — visibleBars as-of 过滤（未来 bar 必须排除）**
  - close 决策：timestamp > decisionDate 的未来 bar 不可见
  - open 决策：decisionDate 当日的完整 bar 亦不可见
- **GUARD — LeakageGuard（availableAt / requiredDataThrough 晚于 decisionTime 必须 REJECT）**
  - availableAt > decisionTime → LookAheadError
  - requiredDataThrough > decisionTime → LookAheadError
  - 同 decisionTime 的 availability 通过守卫
- **GUARD — isKnowableBy 对 UNKNOWN 且无 retrievedAt 的状态 fail-safe**
  - UNKNOWN + 无 retrievedAt → 任何 asOf 均不可知（不当作 immediately available）
- **PIT 修复 #10 — T_PLUS_1 用交易日而非自然日**
  - 周五生效、T+1 可知日 = 下一交易日（周一），非周六
  - 无交易日历时 T_PLUS_1 fail-safe 返回 null（不退回自然日）
- **PIT 修复 #8/#2 — 行业归属 as-of 过滤（晚于查询日才获取的行业不可见）**
  - 行业 retrievedAt 晚于 asOf → 该时点不可知（返回 null）
  - 行业 retrievedAt 早于或等于 asOf → 可知（返回归属）
- **PIT 修复 #7 — 历史时点用当时名称判 ST（不用最新名称回填）**
  - 历史时点应使用当时名称（非 ST → 10%）
  - ST 判定影响主板涨跌停比例（5% vs 10%）
- **PIT 修复 #4/#5 — 未来公司行为不进入历史决策（announcementDate 可用性）**
  - announcementDate 晚于 decisionTime → 不可知
  - filterActionsKnownAt 排除尚未公告的未来分红
  - 前复权因子天然包含未来事件 → 禁止用于信号/成交（文档化证据）

### `tests/server/stockDailyPriceUnique.test.ts`
- 65 行 ｜ 用例声明 5 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：`server/db.ts` · `drizzle/schema.ts`
- 单跑：`pnpm exec vitest run tests/server/stockDailyPriceUnique.test.ts`
- 用例树：
- **P2-F3 stock_daily_prices (stockCode, tradeDate) 唯一约束**
  - drizzle schema 声明 UNIQUE(stockCode, tradeDate)
  - 既有迁移真实产出 UNIQUE(stockCode, tradeDate) DDL
  - upsert 依赖唯一键幂等覆盖（ON DUPLICATE KEY UPDATE 关键字段齐全）
  - 脏数据清理规划：同 stockCode+tradeDate 只保留最小 id，不同 tradeDate 可共存
  - 重复数据清理规划：稳定、确定、无副作用

### `tests/server/stockPriceSync.test.ts`
- 200 行 ｜ 用例声明 15 ｜ describe 2
- 被测源码：`server/stockPriceSync.ts` · `server/tushare.ts`
- 单跑：`pnpm exec vitest run tests/server/stockPriceSync.test.ts`
- 用例树：
- **股票日线同步**
  - 为每条涨停记录同时建立信号日、T+1 和 T+2 已记录交易日的价格目标
  - 使用完整市场交易日历覆盖信号后十个实际交易日，而不是仅覆盖涨停记录日期
  - 近期上传选择上传日前最近六个候选日，由每个候选日补齐后续T+5交易日
  - 跨信号日合并目标，让前几日涨停股票在当前交易日仍被同步
  - 历史上传只选择本次图片股票，并由该信号日补齐后续T+5交易日
  - 只返回缺失的信号日及后续五个实际交易日，并保留每条股票信号日的审计范围
  - 解析 Tushare daily 的开盘、收盘、最高、最低、成交额、成交量和前收字段
- **P1-F3 生产入库数据质量路径**
  - 正常 OHLCV 行 → 全部 VALID 可写入，数值字段以字符串保留
  - high < max(open, close, low) → INVALID 不进入正常入库
  - low > min(open, close, high) → INVALID 不进入正常入库
  - negative volume / negative amount → INVALID 不进入正常入库
  - missing close / missing preClose → 不可持久化（DB NOT NULL），不写 "undefined"/"null"
  - null / undefined 数值字段 → 可空字段保留 null，绝不产生 "undefined"/"null" 字符串
  - 非法数值（非数字字符串）→ 解析为 null；缺失 open 时不可持久化
  - 未请求的股票不进入结果；无行可写时 savedCount 为 0 语义不变

### `tests/server/stockPriceSyncPage.test.ts`
- 43 行 ｜ 用例声明 4 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：**无相对/别名 import**（自足纯函数或读文件断言）
- 单跑：`pnpm exec vitest run tests/server/stockPriceSyncPage.test.ts`
- 用例树：
- **行情同步检查页面**
  - 注册页面路由与导航入口
  - 展示缺失明细并提供筛选和手动同步操作
  - 提供指数行情同步入口并透出交易日历落后量
  - 指数同步端点在路由层注册，且写入路径要求管理员

### `tests/server/strategyPortfolio.test.ts`
- 191 行 ｜ 用例声明 8 ｜ describe 2
- 被测源码：`server/leaderCandidates.ts` · `server/positionBudget.ts` · `shared/boardHeightRisk.ts`
- 单跑：`pnpm exec vitest run tests/server/strategyPortfolio.test.ts`
- 用例树：
- **五策略持仓与准备买入快照**
  - 只以最新信号日生成下一实际交易日准备买入优先级，不预设未知开盘成交
  - 当前持仓取模拟截止日未出清订单，并且准备买入不重复已有持仓
  - 高风险硬过滤与质量门控的准备清单均不包含被阈值排除的候选
  - 准备买入清单回显计划仓位：等权分仓、比例自洽、原始策略不降仓
  - 非基准策略按高位连板系数降低仓位（5 板 ×0.6），原始基准不降仓
- **单笔计划预算分配（分仓口径唯一权威）**
  - 等权 / 评分加权 / 固定比例三种口径与交易模拟器一致
  - 评分加权合计为 0 时退化为等权；positionScale 只缩放该笔预算
  - 空清单不产生分配（不出现除以 0）

### `tests/server/technicalFactors.test.ts`
- 324 行 ｜ 用例声明 13 ｜ describe 2
- 被测源码：`server/technicalFactors.ts` · `server/leaderCandidates.ts`
- 单跑：`pnpm exec vitest run tests/server/technicalFactors.test.ts`
- 用例树：
- **computeTechnicalFactorValues**
  - 换手率 = 成交额/流通市值（%）；量比 = 信号日成交额/前5日均值
  - 缺少流通市值时换手率为 null，但不影响其它因子
  - 信号日为最早交易日时无量比（无前5日数据）
  - 一字板（high≈low）振幅约 0
- **evaluateFactorEffectiveness**
  - 完全正相关因子：meanIc 接近 1，分位分层单调递增
  - 完全负相关因子：meanIc 接近 -1，分位分层单调递减
  - 因子缺失或收益缺失的样本被跳过，不参与评估
  - 样本不足时不抛出，返回空 bucket 与 null 指标
  - 方向与分级：正相关强 IC 因子 direction=positive、strength=strong、p 值近 0
  - 倒U型关系：中间组收益最高，shape=inverted_u
  - 年度/季度切片：跨年数据产出对应 bucket，且正相关因子 meanIc>0
  - 预测衰减：T+1 正向、T+2 收盘反向，衰减曲线捕获方向反转
  - 情绪阶段稳定性：阶段内输出 meanIc / icIr，多阶段方向一致

### `tests/server/tushare.secret.test.ts`
- 42 行 ｜ 用例声明 1 ｜ describe 1 ｜ 🔌 环境依赖
- ⚠️ 外部依赖：真实 Tushare 网络 + `TUSHARE_TOKEN`
- 被测源码：**无相对/别名 import**（自足纯函数或读文件断言）
- 单跑：`pnpm exec vitest run tests/server/tushare.secret.test.ts`
- 用例树：
- **Tushare Token**
  - 可调用 A 股日线 daily 接口

### `tests/server/tushareTradingCalendar.test.ts`
- 45 行 ｜ 用例声明 3 ｜ describe 1 ｜ 🔌 环境依赖
- ⚠️ 外部依赖：真实 Tushare 网络（交易日历，5s 超时）
- 被测源码：`server/tushare.ts`
- 单跑：`pnpm exec vitest run tests/server/tushareTradingCalendar.test.ts`
- 用例树：
- **Tushare交易日历缓存**
  - 相同日期范围在有效期内只请求一次，并返回独立数组
  - 并发请求相同范围会复用同一个进行中的请求
  - 不同日期范围分别缓存，避免错误复用结果

### `tests/server/uploadRefresh.test.ts`
- 57 行 ｜ 用例声明 2 ｜ describe 1
- 被测源码：`client/src/lib/uploadRefresh.ts`
- 单跑：`pnpm exec vitest run tests/server/uploadRefresh.test.ts`
- 用例树：
- **mapStoredLimitUpRecords**
  - 保留指定日期查询结果的字段和顺序
  - 空结果保持为空，不生成占位股票

### `tests/server/uploadRefreshPage.test.ts`
- 31 行 ｜ 用例声明 2 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：**无相对/别名 import**（自足纯函数或读文件断言）
- 单跑：`pnpm exec vitest run tests/server/uploadRefreshPage.test.ts`
- 用例树：
- **上传识别后的指定日期自动刷新**
  - 在批量识别保存完成后按上传日期重新查询一次
  - 展示成功、空结果、失败和重试反馈

### `tests/server/visibleRange.test.ts`
- 31 行 ｜ 用例声明 3 ｜ describe 1
- 被测源码：`client/src/lib/visibleRange.ts`
- 单跑：`pnpm exec vitest run tests/server/visibleRange.test.ts`
- 用例树：
- **visible range helpers**
  - 默认选择最近90个交易日
  - 交易日不足90天时展示全部数据
  - 将拖动范围限制在有效索引内并保持起止顺序
