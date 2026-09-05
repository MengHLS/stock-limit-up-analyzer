#!/usr/bin/env python3
"""
AkShare SW industry bridge (STEP 7.6).

Commands:
  industries              -> JSON [{industry_code, industry_name}]  (申万一级, 当前快照)
  members <industry_code> -> JSON [{code, name}]                     (当前成分, 非历史)

NOTE: AkShare SW 仅提供「当前」行业与成分快照，不提供历史成分有效期，因此历史行业归属
只能靠本快照 + 有效区间构建（effective_from = 快照日），或标记 CONDITIONAL GAP。
"""
import sys
import json

import akshare as ak


def _col(row, names):
    for name in names:
        if name in row:
            return row[name]
    return ""


def cmd_industries():
    df = ak.sw_index_first_info()
    out = []
    for _, row in df.iterrows():
        out.append(
            {
                "industry_code": str(_col(row, ["行业代码", "index_code"])),
                "industry_name": str(_col(row, ["行业名称", "index_name"])),
            }
        )
    return out


def cmd_members(industry_code):
    df = ak.sw_index_cons(symbol=industry_code)
    out = []
    for _, row in df.iterrows():
        out.append(
            {
                "code": str(_col(row, ["股票代码", "con_code", "证券代码"])),
                "name": str(_col(row, ["股票名称", "con_name", "证券简称"])),
            }
        )
    return out


def main():
    if len(sys.argv) < 2:
        raise RuntimeError("missing command")
    cmd = sys.argv[1]
    if cmd == "industries":
        print(json.dumps(cmd_industries(), ensure_ascii=False))
    elif cmd == "members":
        print(json.dumps(cmd_members(sys.argv[2]), ensure_ascii=False))
    else:
        raise RuntimeError(f"unknown command: {cmd}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        sys.exit(1)
