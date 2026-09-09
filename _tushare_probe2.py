import os, json, sys
import tushare
ts = tushare.pro_api(os.environ.get('TUSHARE_TOKEN', 'cee1f03cab70c0b222a1c1083517814ec3c29551627f79ac6ecdad22'))
try:
    # daily 返回 OHLCV
    df = ts.daily(ts_code='000001.SZ', start_date='20240801', end_date='20240810')
    print(json.dumps(df.to_dict('records'), ensure_ascii=False))
except Exception as e:
    print(f"ERR: {e}")