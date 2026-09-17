# Tushare 日线行情接入说明

候选池次日溢价回测使用 Tushare Pro 的 `daily` 日线接口。同步字段包括 `ts_code`、`trade_date`、`open`、`close` 与 `pre_close`，项目将其存入 `stock_daily_prices` 表；价格为接口返回的未复权日线数据。

开盘溢价的计算公式为 `(T+1 开盘价 - T 日收盘价) / T 日收盘价 × 100%`；收盘溢价同理使用 `T+1 收盘价`。候选仅用 T 日及以前的涨停记录生成，T+1 价格只用于事后评价。

官方资料：

- 日线接口与字段：[Tushare A股日线行情](https://tushare.pro/document/2?doc_id=27)
- 接口权限与更新说明：[Tushare 权限说明](https://tushare.pro/document/1?doc_id=108)

首次历史回填以项目中已有涨停记录涉及的交易日为范围；后续盘后同步只补齐近期交易日。若 Tushare 对某个股票—日期组合未返回价格，回测明细将显示为缺失，不以零或模拟价格替代。
