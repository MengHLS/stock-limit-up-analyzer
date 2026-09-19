<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/shared

- 测试文件 **6** 个 ｜ 用例声明 **132** 个
- 涉及源码目录：`shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/shared                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/shared/boardHeightRisk.test.ts`
- 77 行 ｜ 用例声明 6 ｜ describe 2
- 被测源码：`shared/boardHeightRisk.ts`
- 单跑：`pnpm exec vitest run tests/shared/boardHeightRisk.test.ts`
- 用例树：
- **高位连板风险梯度**
  - 2 板及以下不扣分，3 板起单调递增，5/6 板显著重于 4 板
  - 暴露给前端的梯度表按板数升序，且与判定函数自洽
  - 非法连板高度按 1 板兜底，不产生 NaN 风险分
- **高位连板参与上限与仓位缩放**
  - 默认上限 6 板：6 板允许参与，7 板起限制参与
  - 未越上限的高位标的按下调系数降低仓位，越上限返回 0
  - 高位连板判定从 4 板开始，且与说明文案一致

### `tests/shared/datasetRegistryContracts.test.ts`
- 248 行 ｜ 用例声明 21 ｜ describe 7
- 被测源码：`shared/datasetRegistryContracts.ts`
- 单跑：`pnpm exec vitest run tests/shared/datasetRegistryContracts.test.ts`
- 用例树：
- **DATASET-002.2 · 枚举字面量契约**
  - Definition/Version/Job 枚举字面量与后端领域类型一致
- **DATASET-002.2 · safeIntId（bigint 安全边界）**
  - 接受 1 ~ MAX_SAFE_INTEGER 的整数
  - 拒绝 0 / 负数 / 浮点 / 超出安全整数
- **DATASET-002.2 · 分页入参 schema**
  - eventPageInput：合法入参通过
  - eventPageInput：非法 datasetVersionId / 非法日期 / limit 越界被拒
  - pathPageInput：eventId / 日期过滤合法；非法 eventId 被拒
  - outcomePageInput：horizon 过滤合法；非法 horizon 被拒
- **DATASET-002.2 · update / archive schema**
  - updateDefinitionInput：name/description 可选，definitionId 必填
  - archiveDefinitionInput / getDefinitionInput：definitionId 必填且为正整数
- **DATASET-002.4A · Build Lifecycle mutation schema**
  - createBuildJobInput：datasetVersionId 必填且为正整数
  - start/cancel/retry：jobId 必填、长度 ≤64
- **DATASET-002.4B · 版本标签正则 / 构建参数默认值 / createDatasetVersion schema**
  - DATASET_VERSION_LABEL_PATTERN：接受 v1 / 2024-full / v1.2_a；拒绝空格 / 首字符符号 / 超长
  - 构建参数默认值与边界常量自洽（默认落在边界内）
  - createDatasetVersionInput：合法筛选入参通过（缺省子项自动补权威默认）
  - createDatasetVersionInput：必填缺失 / 空 version / 日期倒置被拒
  - createDatasetVersionInput：筛选参数越界被拒
- **DATASET-003A · 多数据集与删除入参契约**
  - createDatasetDefinitionInput：合法 datasetCode 通过
  - createDatasetDefinitionInput：非法 datasetCode 被拒（格式 / 版本后缀 / 序号结尾 / 大写 / 空）
  - createDatasetDefinitionInput：name / datasetType 必填且有边界
  - deleteDatasetVersionInput：datasetVersionId 必填且为正整数
  - deleteDatasetDefinitionInput：必须回传 confirmDatasetCode（防误删）

### `tests/shared/fieldAvailability.test.ts`
- 122 行 ｜ 用例声明 10 ｜ describe 3
- 被测源码：`shared/fieldAvailability.ts`
- 单跑：`pnpm exec vitest run tests/shared/fieldAvailability.test.ts`
- 用例树：
- **字段可用性识别**
  - 空值与纯空白视为缺失
  - 整日缺失（历史未采集）时该字段判定为不可用
  - 字段完整时判定为可用，覆盖率 1
  - 覆盖率阈值边界：达到阈值算可用，低于阈值算整段缺失
  - 逐日覆盖表按信号日分组，互不串扰
- **字段覆盖报告**
  - 按月聚合降级月份，并给出降级说明
  - 字段完整时不产生降级月份与说明
- **题材降级解析**
  - 优先使用 sector
  - sector 缺失时用 keywords 的首个主题词兜底，并去除 OCR 计数后缀
  - sector 与 keywords 都缺失时返回 missing，绝不伪造题材名

### `tests/shared/ladderHeight.test.ts`
- 48 行 ｜ 用例声明 5 ｜ describe 1
- 被测源码：`shared/ladderHeight.ts`
- 单跑：`pnpm exec vitest run tests/shared/ladderHeight.test.ts`
- 用例树：
- **连板梯队高度（若本日涨停会达到的连板数）**
  - 本日仍涨停（连板股 / 首板股）：高度 = 本日连板数，不 +1
  - 连板中断：高度 = 上一记录交易日连板数 + 1
  - 首板未续：同样 +1 ⇒ 落到 2 板行（用户裁定，2026-09-19）
  - 口径唯一：任何断板股都比其已实现板数高一级、任何当日涨停股都不变
  - 2026-09-18 对拍：五只断板股上行一位，四只涨停股原地不动

### `tests/shared/quant-stats.test.ts`
- 353 行 ｜ 用例声明 86 ｜ describe 13
- 被测源码：`shared/quant-stats.ts`
- 单跑：`pnpm exec vitest run tests/shared/quant-stats.test.ts`
- 用例树：
- **mean**
  - 空数组返回 null
  - 单元素返回该值
  - 两元素返回算术平均
  - 负值与正值混合
  - 过滤 NaN/Infinity
  - 不修改输入数组
- **median**
  - 空数组返回 null
  - 奇数个取中位
  - 偶数个取中间均值
  - 单元素返回该值
  - 过滤 NaN/Infinity
  - 不修改输入数组
- **variance / standardDeviation（population vs sample）**
  - 总体方差除以 n
  - 样本方差除以 n-1
  - 单元素总体方差为 0
  - 单元素样本方差为 null
  - 空数组两者均为 null
  - 标准差为方差的平方根
  - 常数序列样本标准差为 0
  - 样本数不足样本标准差为 null
- **skewness / excessKurtosis（sample-adjusted Fisher-Pearson）**
  - 样本数不足返回 null
  - 常数序列返回 null
  - 对称序列偏度为 0
  - 明显右偏序列偏度为正（已知解析值）
  - 均匀分布超额峰度约为 -1.2（已知解析值）
  - 偏度方向正确：右偏为正、左偏为负
- **quantile / percentile**
  - 空数组返回 null
  - q 越界返回 null
  - q=0 与 q=1 取极值
  - q=NaN 返回 null
  - 包含 NaN 的输入先过滤后计算
  - 中位数等价 median
  - 线性插值（R type 7）
  - percentile 与 quantile 换算一致
  - 不修改输入数组顺序
- **pearsonCorrelation**
  - 完美正相关为 1
  - 完美负相关为 -1
  - 零相关接近 0
  - 常数向量返回 null
  - 样本不足返回 null
  - 长度不一致抛错
  - 过滤 null 与 NaN
- **spearman / spearmanCorrelation**
  - 完全单调递增为 1（非线性但单调）
  - 完全单调递减为 -1
  - 并列值使用平均秩，单调关系仍成立
  - 样本不足返回 null
  - 可空向量版过滤 null
  - 长度不一致抛错
  - pairwise 缺失值过滤（与 pearson/rankIC 语义一致）
  - pairwise 过滤 Infinity（与 NaN 语义一致）
  - spearman() 与 spearmanCorrelation() 缺失值语义一致
  - spearman 不修改输入数组
- **rankIC**
  - 等于 Spearman 相关
  - rankIC === spearmanCorrelation（含缺失值）
  - 非完美单调数据下 rankIC === spearmanCorrelation
- **annualizedReturnFromEquityCurve（CAGR）**
  - 零收益 CAGR 为 0
  - 正收益 CAGR 为正
  - 起点/终点非正返回 null
  - 样本数不足返回 null
- **sharpeRatio（标准算术年化）**
  - 正收益为正（已知解析值）
  - 负收益为负（已知解析值）
  - 零波动返回 null
  - 单观测返回 null
  - 空数组返回 null
  - 常数收益返回 null
  - 自定义年化因子
  - 人工构造序列逐项验证 mean / sampleStd / Sharpe
  - 过滤 NaN/Infinity 后计算（与纯净序列一致）
  - 过滤后有效样本不足（< 2）返回 null
- **neweyWestMeanTStat（回归测试）**
  - 固定输入 HAC t 统计量与旧实现一致（误差 ≤ 1e-10）
  - 样本不足返回 null
  - 常数序列返回 null
  - 显式 lag=0 合法（不返回 null）
  - 合法最大 lag = n - 2
  - 非法负 lag 返回 null
  - 非整数 lag 返回 null
  - 超过最大 lag（n-1、n）返回 null
- **正态分布基础**
  - normalCdf 标准值
  - normalCdf 边界：±Infinity 与 NaN
  - normalQuantile 与 normalCdf 互逆
  - normalQuantile 边界：0/1/NaN
  - normalTwoSidedPValue 双尾 p 值
  - normalTwoSidedPValue 边界：NaN / ±Infinity
- **isFiniteNumber**
  - 有限数值返回 true
  - NaN / ±Infinity 返回 false
  - 非 number 类型返回 false

### `tests/shared/sectorHeatOrder.test.ts`
- 75 行 ｜ 用例声明 4 ｜ describe 1
- 被测源码：`shared/sectorHeatOrder.ts`
- 单跑：`pnpm exec vitest run tests/shared/sectorHeatOrder.test.ts`
- 用例树：
- **当日题材热力排序**
  - 按当日涨停家数降序；当日 0 家仍排在「从未出现」之前
  - 缺该日数据（空表）⇒ 全 -1，顺序交给 tieBreak，且不丢项
  - 同热度内按 tieBreak（梯队用封板时间、热力图用合计）
  - 比较器不改动入参数组（返回新数组）
