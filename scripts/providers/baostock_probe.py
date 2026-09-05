#!/usr/bin/env python3
"""
BaoStock provider bridge (STEP 7.6).

Commands:
  index_daily <baostock_code> <start> <end>  -> JSON [{date,open,high,low,close,volume,amount}]
  stock_daily <baostock_code> <start> <end>  -> JSON [{date,open,high,low,close,volume,amount,turn,tradestatus}]
  stock_basic                                -> JSON [{code,name,ipoDate,outDate,type,status}]

Units (BaoStock): volume=股, amount=元, turn=%. Output is raw provider values; the TS adapter
performs canonical unit normalization (股→手, 元→千元).
"""
import sys
import json
import io
import contextlib

import baostock as bs


def login():
    lg = bs.login()
    if lg.error_code != "0":
        raise RuntimeError(f"baostock login failed: {lg.error_msg}")


def query_k(code, start, end, fields):
    rs = bs.query_history_k_data_plus(
        code, fields, start_date=start, end_date=end, frequency="d", adjustflag="3"
    )
    if rs.error_code != "0":
        raise RuntimeError(f"baostock query failed: {rs.error_msg}")
    rows = []
    while (rs.error_code == "0") and rs.next():
        rows.append(rs.get_row_data())
    return rows


def cmd_index_daily(code, start, end):
    rows = query_k(code, start, end, "date,open,high,low,close,volume,amount")
    return [
        {
            "date": r[0],
            "open": r[1],
            "high": r[2],
            "low": r[3],
            "close": r[4],
            "volume": r[5],
            "amount": r[6],
        }
        for r in rows
    ]


def cmd_stock_daily(code, start, end):
    rows = query_k(code, start, end, "date,open,high,low,close,volume,amount,turn,tradestatus")
    return [
        {
            "date": r[0],
            "open": r[1],
            "high": r[2],
            "low": r[3],
            "close": r[4],
            "volume": r[5],
            "amount": r[6],
            "turn": r[7],
            "tradestatus": r[8],
        }
        for r in rows
    ]


def cmd_stock_basic():
    rs = bs.query_stock_basic()
    if rs.error_code != "0":
        raise RuntimeError(f"baostock query_stock_basic failed: {rs.error_msg}")
    rows = []
    while (rs.error_code == "0") and rs.next():
        rows.append(rs.get_row_data())
    return [
        {
            "code": r[0],
            "name": r[1],
            "ipoDate": r[2],
            "outDate": r[3],
            "type": r[4],
            "status": r[5],
        }
        for r in rows
    ]


def main():
    if len(sys.argv) < 2:
        raise RuntimeError("missing command")
    cmd = sys.argv[1]
    # baostock 的 login/logout 会向 stdout 打印 "login success!" / "logout success!"，
    # 会污染 bridge 的 JSON 输出；用 redirect_stdout 吞掉，最后再单独打印 JSON。
    buf = io.StringIO()
    result = None
    with contextlib.redirect_stdout(buf):
        login()
        try:
            if cmd == "index_daily":
                result = cmd_index_daily(sys.argv[2], sys.argv[3], sys.argv[4])
            elif cmd == "stock_daily":
                result = cmd_stock_daily(sys.argv[2], sys.argv[3], sys.argv[4])
            elif cmd == "stock_basic":
                result = cmd_stock_basic()
            else:
                raise RuntimeError(f"unknown command: {cmd}")
        finally:
            bs.logout()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        sys.exit(1)
