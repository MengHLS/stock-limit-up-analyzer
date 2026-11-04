#!/usr/bin/env python3
"""
BaoStock provider bridge — Corporate Action & Adjustment (STEP 7.7 / STEP 12 WORK D).

补充 STEP 7.6 的 baostock_probe.py：新增公司行为 / 复权因子端点，并支持 STEP 12
「全市场回填」所需的高效批量接口（按交易日拉全市场复权因子、按股票列表批量拉分红）。
输出为 provider 原始行数组（JSON），由 TypeScript 侧 server/corporateActions/provider.ts
的 parseBaoStockAdjustFactors / parseBaoStockDividendActions 归一化为 provider-neutral 对象。

Commands:
  adjust_factor <baostock_code> <start> <end>
      -> {"rows": [[code, dividOperateDate, foreAdjustFactor, backAdjustFactor, adjustFactor], ...]}
  dividend_data <baostock_code> [start_year] [end_year]
      -> {"rows": [[14 字段], ...]}  （按报告期逐年拉取，年份可选，缺省 1990-2026）
  daily_adjust_factor <date>
      -> {"rows": [[code, dividOperateDate, foreAdjustFactor, backAdjustFactor, adjustFactor], ...]}
         （某交易日全市场除权除息股票的复权因子）
  daily_adjust_factor_range <start> <end>
      -> {"rows": [...], "scanned_dates": N}
         （遍历区间内所有交易日，合并全市场复权因子；逐日间隔 >= 0.3s）
  trade_dates <start> <end>
      -> {"dates": ["YYYY-MM-DD", ...]}  （仅交易日）
  dividend_data_batch <plan_file> <start_year> <end_year>
      -> {"rows": [...], "scanned_stocks": N}
         （plan_file 为 JSON 数组 [["sh.600519"], ...]；逐股间隔 >= 0.3s）

BaoStock 端点与字段（详见 STEP_7.7_COVERAGE_REPORT.md）：
  - query_adjust_factor       : code, dividOperateDate, foreAdjustFactor, backAdjustFactor, adjustFactor
  - query_daily_adjust_factor : code, dividOperateDate, foreAdjustFactor, backAdjustFactor, adjustFactor
  - query_dividend_data       : code, dividPreNoticeDate, dividAgmPumDate, dividPlanAnnounceDate,
                                dividPlanDate, dividRegistDate, dividOperateDate, dividPayDate,
                                dividStockMarketDate, dividCashPsBeforeTax, dividCashPsAfterTax,
                                dividStocksPs, dividCashStock, dividReserveToStockPs

已知缺口（详见 STEP_7.7_COVERAGE_REPORT.md）：
  - dividend_data 不含配股（rights_issue）/拆股（split）/合股（reverse_split）结构化字段，
    仅通过 adjust_factor 反映其价格效应；
  - dividend_data 按 year + yearType="report" 分页，实测会漏掉部分特别/中期分红
    （如 600519 贵州茅台 2022-12-27、2023-12-20 特别分红，adjust_factor 有而 dividend_data 无），
    故「事件分解」应以 adjust_factor 为准绳做完整性校验，不能单独依赖 dividend_data。
"""
import contextlib
import io
import json
import sys
import time

import baostock as bs

# 逐日 / 逐股请求间隔（秒），避免打爆 BaoStock 免费接口。
THROTTLE_SECONDS = 0.3

DEFAULT_START_YEAR = 1990
DEFAULT_END_YEAR = 2026


SESSION_EXPIRED_MARKERS = ("未登录", "login", "session", "timeout")


def login():
    lg = bs.login()
    if lg.error_code != "0":
        raise RuntimeError(f"baostock login failed: {lg.error_msg}")


def _is_session_expired(error_msg):
    msg = (error_msg or "").lower()
    return any(m in msg for m in SESSION_EXPIRED_MARKERS)


def drain(rs):
    rows = []
    while rs.error_code == "0" and rs.next():
        rows.append(rs.get_row_data())
    if rs.error_code != "0":
        raise RuntimeError(f"baostock query failed: {rs.error_msg}")
    return rows


def retry_with_relogin(func, *args, **kwargs):
    """BaoStock 长会话会偶发「用户未登录」（session 过期）；检测到后重登并重试。"""
    last = None
    for attempt in range(3):
        try:
            return func(*args, **kwargs)
        except RuntimeError as exc:
            last = exc
            if not _is_session_expired(str(exc)):
                raise
            time.sleep(0.5)
            login()
    raise last


def query_adjust_factor(code, start, end):
    return retry_with_relogin(
        lambda: drain(bs.query_adjust_factor(code=code, start_date=start, end_date=end))
    )


def _query_dividend_year(code, year):
    rs = bs.query_dividend_data(code=code, year=str(year), yearType="report")
    if rs.error_code != "0":
        raise RuntimeError(f"baostock dividend_data failed @ {year}: {rs.error_msg}")
    rows = []
    while rs.next():
        rows.append(rs.get_row_data())
    return rows


def query_dividend_data(code, start_year=DEFAULT_START_YEAR, end_year=DEFAULT_END_YEAR):
    # 逐报告期拉取（BaoStock 按 year + yearType 分页；不传 year 只返回最新一年）。
    rows = []
    for year in range(int(start_year), int(end_year) + 1):
        rows.extend(retry_with_relogin(lambda: _query_dividend_year(code, year)))
    return rows


def query_daily_adjust_factor(date):
    return retry_with_relogin(
        lambda: drain(bs.query_daily_adjust_factor(date=date))
    )


def query_trade_dates(start, end):
    rs = retry_with_relogin(
        lambda: bs.query_trade_dates(start_date=start, end_date=end)
    )
    rows = drain(rs)
    # fields: [calendar_date, is_trading_day]
    return [r[0] for r in rows if len(r) > 1 and r[1] == "1"]


def query_daily_adjust_factor_range(start, end):
    dates = query_trade_dates(start, end)
    rows = []
    for idx, date in enumerate(dates):
        for row in query_daily_adjust_factor(date):
            rows.append(row)
        if idx < len(dates) - 1:
            time.sleep(THROTTLE_SECONDS)
    return rows, len(dates)


def query_dividend_data_batch(plan_file, start_year, end_year):
    """逐只拉取；单只失败只记入 failed_codes，不拖垮整批（原实现一只异常整批全废）。"""
    with open(plan_file, "r", encoding="utf-8") as fh:
        plan = json.load(fh)
    codes = [item[0] if isinstance(item, list) else item for item in plan]
    rows = []
    failed_codes = []
    for idx, code in enumerate(codes):
        try:
            for row in query_dividend_data(code, start_year, end_year):
                rows.append(row)
        except RuntimeError as exc:
            failed_codes.append({"code": code, "error": str(exc)})
        if idx < len(codes) - 1:
            time.sleep(THROTTLE_SECONDS)
    return rows, len(codes), failed_codes


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: <command> [args]"}, ensure_ascii=False))
        return 1
    cmd = sys.argv[1]
    # baostock 的 login/logout 会向 stdout 打印 "login success!" / "logout success!"，
    # 污染 JSON 输出；用 redirect_stdout 吞掉，最后再单独打印 JSON。
    buf = io.StringIO()
    result = None
    try:
        with contextlib.redirect_stdout(buf):
            login()
            try:
                if cmd == "adjust_factor":
                    result = {"rows": query_adjust_factor(sys.argv[2], sys.argv[3], sys.argv[4])}
                elif cmd == "dividend_data":
                    code = sys.argv[2]
                    start_year = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_START_YEAR
                    end_year = int(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_END_YEAR
                    result = {"rows": query_dividend_data(code, start_year, end_year)}
                elif cmd == "daily_adjust_factor":
                    result = {"rows": query_daily_adjust_factor(sys.argv[2])}
                elif cmd == "daily_adjust_factor_range":
                    rows, scanned = query_daily_adjust_factor_range(sys.argv[2], sys.argv[3])
                    result = {"rows": rows, "scanned_dates": scanned}
                elif cmd == "trade_dates":
                    result = {"dates": query_trade_dates(sys.argv[2], sys.argv[3])}
                elif cmd == "dividend_data_batch":
                    plan_file = sys.argv[2]
                    start_year = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_START_YEAR
                    end_year = int(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_END_YEAR
                    rows, scanned, failed_codes = query_dividend_data_batch(plan_file, start_year, end_year)
                    result = {"rows": rows, "scanned_stocks": scanned, "failed_codes": failed_codes}
                else:
                    print(json.dumps({"error": f"unknown command {cmd}"}, ensure_ascii=False))
                    return 1
            finally:
                bs.logout()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
