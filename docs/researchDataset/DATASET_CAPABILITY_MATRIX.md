# DATASET_CAPABILITY_MATRIX — Research Dataset 能力矩阵

> 版本：v1.0 | 日期：2026-09-09 | 依据：真实代码 + 真实 DB（非假设）
> 状态模型：`READY`（真实数据 + PIT 安全 + 已验证）/ `CONDITIONAL`（部分/无历史数据）/ `UNAVAILABLE`（无能力）
> 本矩阵是 `DATASET_CURRENT_STATE_AUDIT.md` 的可机读切片，也是后续 FE-3 维度开关的权威来源。

---

## 1. 主矩阵（Capability × 六维）

| Capability | UI | Backend | Historical Data | PIT Safe | Tested | Validated | Status | Evidence |
|------------|-----|---------|-----------------|----------|--------|-----------|--------|----------|
| **Date Range** | YES | YES | YES | YES | YES | YES | **READY** | index_daily 1863 日历；validate.ts |
| **Frequency (Daily)** | — | YES | YES | YES | YES | YES | **READY** | 仅日线；builder 默认 |
| **Frequency (Minute/Tick)** | NO | NO | NO | — | — | — | **UNAVAILABLE** | 无分钟数据 |
| **PIT 模式（逐日/固定 asOf）** | YES | YES | YES | YES | YES | YES | **READY** | policy.pit；validate.ts |
| **Universe（全 A 股 PIT 成员）** | YES(隐式) | YES | YES | YES | YES | YES | **READY** | universe.ts + STEP11 |
| **Universe（SH/SZ/BJ 市场过滤）** | NO | PARTIAL | YES | YES | NO | NO | **CONDITIONAL** | 数据有，无独立筛选项 |
| **Universe（主板/创业/科创/北交板块）** | NO | PARTIAL | YES | PARTIAL | NO | NO | **CONDITIONAL** | board 维度未显式入 dataset |
| **Universe（指数成分）** | NO | NO | PARTIAL | NO | NO | NO | **CONDITIONAL** | 无历史成分序列 |
| **Universe（自定义证券）** | NO | NO | — | — | NO | NO | **UNAVAILABLE** | 未实现 |
| **Universe Mode（Historical/Current/Custom）** | NO | PARTIAL | YES | YES | PARTIAL | NO | **CONDITIONAL** | 仅 Historical（默认），无 UI 选择 |
| **ST / *ST 排除** | NO | YES(经 universe) | YES | YES | YES | PARTIAL | **READY** | Status ST 734；经 universe 决议 |
| **Suspended 排除** | NO | YES(经 universe) | YES | YES | YES | PARTIAL | **READY** | Status SUSPENDED 1830 |
| **Delisted 排除** | NO | YES(经 universe) | YES | YES | YES | PARTIAL | **READY** | 337 退市全含，PIT 决议 |
| **IPO / Listing Age 过滤** | NO | PARTIAL | YES | YES | NO | NO | **CONDITIONAL** | listedDate 有，无 age 过滤 |
| **Risk Warning 过滤** | NO | PARTIAL | YES | YES | NO | NO | **CONDITIONAL** | ST/*ST 有，其它风险警示无 |
| **Industry（历史 PIT）** | NO | YES(接口) | **NO** | **NO** | PARTIAL | NO | **CONDITIONAL** | effectiveFrom 单点 2026-08-31 |
| **Liquidity（换手/市值/额/量）** | NO | YES | YES | YES | YES | PARTIAL | **CONDITIONAL→READY** | liquidity 9.01M，无筛选 UI |
| **Market Cap 筛选（含窗口 5/10/20/60D）** | NO | PARTIAL | YES | YES | NO | NO | **CONDITIONAL** | 数据有，窗口聚合未实现 |
| **Price：Raw** | YES(隐式) | YES | YES | YES | YES | YES | **READY** | adjustment policy=raw |
| **Price：Adjusted** | NO | NO(禁止) | PARTIAL | NO | NO | NO | **UNAVAILABLE** | Derived Layer 未 PIT 物化 |
| **Corporate Action（分红/送转/配股/拆合）** | NO | YES(计数/可知) | YES | YES | YES | PARTIAL | **CONDITIONAL→READY** | 事件计数有，组合变换在 backtest |
| **Data Quality（重复/缺失/停牌/异常）** | NO | PARTIAL | YES | YES | PARTIAL | NO | **CONDITIONAL** | coverageGaps 有，无分级策略 UI |
| **Execution / Cost / Slippage** | NO | NO(dataset 层) | — | — | NO | NO | **OUT OF SCOPE** | 属 Strategy/Backtest 层（§10） |
| **Market Context / Regime** | NO | PARTIAL | PARTIAL | PARTIAL | NO | NO | **CONDITIONAL** | marketRegime 模块，未接入 dataset |
| **Survivorship Safe** | NO(隐式) | YES | YES | YES | YES | YES | **READY** | policy.survivorship 三真值 |
| **Lookahead Protection** | NO(隐式) | YES | YES | YES | YES | YES | **READY** | bindResearchDataset asOf 断言 |
| **Dataset Version** | YES(只读) | YES | — | — | YES | YES | **READY(指纹)** | version.ts |
| **语义版本 V1/V2/V3** | NO | NO | — | — | NO | NO | **GAP** | 仅 content-addressed |
| **Dataset Fingerprint** | YES(只读) | YES | — | — | YES | YES | **READY** | SHA-256 |
| **Lineage（源表/源版本/迁移/作者/代码版本）** | NO | PARTIAL | — | — | NO | NO | **GAP** | versionSnapshot 有版本，无源表 lineage |
| **Validation（PASS/WARN/FAIL）** | PARTIAL | PARTIAL | — | — | PARTIAL | NO | **GAP** | 现为 FAIL/PASS/INCONCLUSIVE |
| **Certification（CERTIFIED/CONDITIONAL/REJECTED）** | NO | NO | — | — | NO | NO | **GAP** | 未实现 |
| **Research Run 强绑定 datasetVersion** | NO | PARTIAL | — | — | NO | NO | **GAP** | legacy Run 未强制 |

---

## 2. 能力分档汇总

| 分档 | 数量 | 能力 |
|------|------|------|
| **READY** | 13 | Date Range / Frequency(Daily) / PIT 模式 / Universe(全A) / ST / Suspended / Delisted / Price Raw / Survivorship / Lookahead / Dataset Version(指纹) / Fingerprint / Liquidity(数据层) |
| **CONDITIONAL** | 14 | Universe 子集(市场/板块/指数/自定义) / Universe Mode / IPO/Listing Age / Risk Warning / Industry(历史) / Market Cap 窗口 / Corporate Action / Data Quality / Market Context / Liquidity 筛选 UI 等 |
| **UNAVAILABLE** | 3 | Minute/Tick / Adjusted Price / 自定义证券 |
| **GAP** | 5 | 语义版本 V1/V2/V3 / Lineage / Validation PASS-WARN-FAIL / Certification / Research Run 强绑定 |
| **OUT OF SCOPE** | 1 | Execution/Cost/Slippage（属 Strategy/Backtest 层） |

---

## 3. 铁律（能力开放前提，任务 §15/§19）

1. **UI 只能展示/选择/调用 API/显示状态**，PIT 规则、universe 规则、涨跌停、复权、手续费、历史状态推断、Research Ready 判断全部由后端 Domain Contract 决定。
2. **Industry 历史 PIT = CONDITIONAL**，在真实历史行业数据具备前，不得标 READY；若 Dataset 用 Industry，必须产 `RESEARCH_SAFE=false`，除非显式声明 Industry 不参与研究。
3. **Adjusted / Minute / 自定义证券** 一律 UNAVAILABLE，UI 不开放选项。
4. **正式研究 Dataset 默认**：STRICT PIT + SURVIVORSHIP SAFE + LOOKAHEAD PROTECTION ENABLED；用户主动选危险模式必须标 `NON_RESEARCH_SAFE`，不能进 Research Ready。
5. **不做 Mock / Fake PASS**：数据不存在即 CONDITIONAL/UNAVAILABLE，不用当前快照冒充历史。
