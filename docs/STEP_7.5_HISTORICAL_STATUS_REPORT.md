# STEP 7.5 — HISTORICAL STATUS REPORT

## 一、结论

**CONDITIONAL PASS（数据覆盖）。** 历史状态**模型、时间线、接口**已完整落地并通过测试；但历史 ST / 退市 / 停牌的真实数据**回填**未执行——原因是（1）code→security_id 解析依赖 STEP 7.4 尚未落库的 resolver；（2）历史 ST 状态需外部数据源（BaoStock `history_daily.isST/tradestatus`）。**不伪造覆盖**。

## 二、ST 历史状态

- 维度 `ST`，取值 `NORMAL` / `ST` / `*ST`，以 `[effectiveFrom, effectiveTo]` 闭区间记录。
- **禁止** `stock_name.includes("ST")` 作为历史判断（名称是「当前快照」，会 look-ahead 泄漏）。
- `NORMAL` 必须是显式区间记录；无记录 = `unknownDimensions` 含 `ST`，**不默认 NORMAL**。
- 测试：`currentOnly = [ST=ST 自 07-01]`，查询 `03-01` 得 `unknown`（不回填当前 ST）；显式 `NORMAL[01-01,06-30] + ST[07-01,]` 时 `03-01→NORMAL`、`08-01→ST`。

## 三、Trading Status

- 维度 `TRADING`，取值 `TRADING` / `SUSPENDED` / `NOT_YET_LISTED` / `DELISTED` / `UNKNOWN`。
- `UNKNOWN` 是**显式值**，`isTradable` 对 `UNKNOWN`（或 TRADING 维度缺失）返回 `false`，**不得默认 TRADING**。
- `isTradable = (TRADING==TRADING) && (LISTING 未解析或==LISTED) && (SUSPENSION 未解析或!=SUSPENDED)`。

## 四、上市 / 退市 / 停牌

- `LISTING`：`NOT_YET_LISTED → LISTED → DELISTED` 生命周期，测试覆盖上市日、退市日边界。
- `DELISTING`：`NONE / AT_RISK / DELISTED` 退市风险（与 LISTING 生命周期正交，不混用）。
- `SUSPENSION`：`SUSPENDED / RESUMED` 停牌窗口；复牌 = 区间结束后（或显式 `RESUMED` 区间）。测试覆盖「停牌区间内 isTradable=false，区间后复牌 isTradable=true」。

## 五、数据来源评估

| 状态 | 来源候选 | 现状 | 覆盖判定 |
| --- | --- | --- | --- |
| 停牌 | 现有 `stock_suspension_windows`（155 行 / 101 只，`tushare-daily-infer` 部分推断） | 已有适配器，待 resolver | PARTIAL（不能假设完整） |
| ST / *ST | BaoStock `history_daily`（`isST`/`tradestatus`/`turn`） | 仅调研（STEP 7.2），未回填 | GAP |
| 上市/退市 | Tushare `stock_basic`（`list_date`/`delist_date`，1次/小时限频）+ BaoStock `stock_basic`（含 1185 退市 outDate） | 仅调研，未回填 | GAP |
| 退市风险 | 无现成结构化来源 | 仅调研 | GAP |

## 六、现有停牌窗口审计

- `stock_suspension_windows`：155 行、101 只股票，`source` 仅 `tushare-daily-infer` 与 `manual`。
- 它是 **partial inference**（由日线缺口反推），**不能假设完整**——本步骤将其视为 `SUSPENSION` 维度的证据输入（`confidence: tushare-daily-infer→medium, manual→high`），不冒充权威停牌全量。
- 转换走 `suspensionWindowsToStatusIntervals`，code→security_id 由注入的 7.4 resolver 完成；无法解析的 code 跳过并上报 `unresolvedStockCodes`，**绝不把 stockCode 当 security_id**。

## 七、完成标准

- [x] ST 时间线（不回填、不靠名称）
- [x] Trading Status（UNKNOWN 不默认 TRADING）
- [x] 停牌/复牌接口
- [~] 历史数据**实际覆盖** → **CONDITIONAL PASS**（待 7.4 resolver + 外部源回填）
