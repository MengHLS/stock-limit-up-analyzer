#!/usr/bin/env python3
"""
BaoStock provider bridge — Corporate Action & Adjustment (STEP 7.7).

补充 STEP 7.6 的 baostock_probe.py：新增公司行为 / 复权因子两个端点。
输出为 provider 原始行数组（JSON），由 TypeScript 侧
server/corporateActions/provider.ts 的 parseBaoStockAdjustFactors /
parseBaoStockDividendActions 归一化为 provider-neutral 对象。

Commands:
  adjust_factor <baostock_code> <start> <end> -> {"rows": [[code, dividOperateDate, foreAdjustFactor, backAdjustFactor], ...]}
  dividend_data <baostock_code>              -> {"rows": [[14 字段], ...]}  (全历史，按报告期逐年拉取)

BaoStock 端点与字段（详见 STEP_7.7_COVERAGE_REPORT.md）：
  - query_adjust_factor : code, dividOperateDate, foreAdjustFactor, backAdjustFactor, adjustFactor
  - query_dividend_data : code, dividPreNoticeDate, dividAgmPumDate, dividPlanAnnounceDate,
    dividPlanDate, dividRegistDate, dividOperateDate, dividPayDate, dividStockMarketDate,
    dividCashPsBeforeTax, dividCashPsAfterTax, dividStocksPs, dividCashStock, dividReserveToStockPs

已知缺口（详见 STEP_7.7_COVERAGE_REPORT.md）：
  - dividend_data 不含配股（rights_issue）/拆股（split）/合股（reverse_split）结构化字段，
    仅通过 adjust_factor 反映其价格效应；
  - dividend_data 按 year + yearType="report" 分页，实测会漏掉部分特别/中期分红
    （如 600519 贵州茅台 2022-12-27、2023-12-20 特别分红，adjust_factor 有而 dividend_data 无），
    故「事件分解」应以 adjust_factor 为准绳做完整性校验，不能单独依赖 dividend_data。
"""
import sys
import json

import baostock as bs


def login():
    lg = bs.login()
    if lg.error_code != "0":
        raise RuntimeError(f"baostock login failed: {lg.error_msg}")


def query_adjust_factor(code, start, end):
    rs = bs.query_adjust_factor(code=code, start_date=start, end_date=end)
    rows = []
    while rs.error_code == "0" and rs.next():
        rows.append(rs.get_row_data())
    if rs.error_code != "0":
        raise RuntimeError(f"baostock adjust_factor failed: {rs.error_msg}")
    return rows


def query_dividend_data(code):
    # 逐报告期拉取全历史（BaoStock 按 year + yearType 分页）
    rows = []
    for year in range(1990, 2027):
        rs = bs.query_dividend_data(code=code, year=str(year), yearType="report")
        if rs.error_code != "0":
            raise RuntimeError(f"baostock dividend_data failed @ {year}: {rs.error_msg}")
        while rs.next():
            rows.append(rs.get_row_data())
    return rows


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: <command> [args]"}, ensure_ascii=False))
        return 1
    cmd = sys.argv[1]
    try:
        login()
        if cmd == "adjust_factor":
            code, start, end = sys.argv[2], sys.argv[3], sys.argv[4]
            print(json.dumps({"rows": query_adjust_factor(code, start, end)}, ensure_ascii=False))
        elif cmd == "dividend_data":
            code = sys.argv[2]
            print(json.dumps({"rows": query_dividend_data(code)}, ensure_ascii=False))
        else:
            print(json.dumps({"error": f"unknown command {cmd}"}, ensure_ascii=False))
            return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    finally:
        bs.logout()
    return 0


if __name__ == "__main__":
    sys.exit(main())
