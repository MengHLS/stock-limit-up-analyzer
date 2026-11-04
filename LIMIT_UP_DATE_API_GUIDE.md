# 按日期查询涨停股票接口

## 接口地址

```text
GET /api/limit-up?date=YYYY-MM-DD
```

这是公开 GET 接口，不需要登录。`date` 为必填参数，格式必须是 `YYYY-MM-DD`，例如 `2026-09-29`。

完整地址示例：

```text
https://你的域名/api/limit-up?date=2026-09-29
```

## curl 调用

```bash
curl "https://你的域名/api/limit-up?date=2026-09-29"
```

## Python 调用

```python
import requests

api_url = "https://你的域名/api/limit-up"
response = requests.get(api_url, params={"date": "2026-09-29"}, timeout=30)
response.raise_for_status()
result = response.json()

for stock in result["data"]:
    print(stock["stockCode"], stock["stockName"], stock["limitUpTime"])
```

## 成功响应

```json
{
  "success": true,
  "date": "2026-09-29",
  "count": 58,
  "data": [
    {
      "id": 8620625,
      "stockCode": "000002.SZ",
      "stockName": "万科A",
      "limitUpDate": "2026-09-29",
      "limitUpTime": "09:35:12",
      "boardCount": "1天1板",
      "circulationValue": "123.45",
      "turnover": "8.76",
      "sector": "房地产",
      "keywords": "地产,重组",
      "createdBy": 1,
      "createdAt": "2026-09-29T08:00:00.000Z",
      "updatedAt": "2026-09-29T08:00:00.000Z"
    }
  ]
}
```

`data` 中的每一项对应数据库 `limit_up_records` 表的一条记录，接口返回该记录的全部字段：

| 字段 | 含义 |
|---|---|
| `id` | 记录 ID |
| `stockCode` | 股票代码，通常带交易所后缀，如 `000002.SZ` |
| `stockName` | 股票名称 |
| `limitUpDate` | 涨停日期 |
| `limitUpTime` | 涨停时间，通常为 `HH:MM:SS` |
| `boardCount` | 连板信息 |
| `circulationValue` | 流通市值 |
| `turnover` | 成交额 |
| `sector` | 题材/板块 |
| `keywords` | 涨停关键词 |
| `createdBy` | 创建记录的用户 ID |
| `createdAt` | 创建时间 |
| `updatedAt` | 更新时间 |

板块分类如需在本地脚本中计算，可按股票代码前缀判断：`300` 或 `301` 为创业板，`688` 为科创板，`920` 为北交所，其他为主板。

## 日期无效响应

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "success": false,
  "error": "date 参数必填，格式必须为 YYYY-MM-DD，例如 2026-09-29"
}
```

## 无数据日期

日期有效但没有涨停记录时仍返回 HTTP 200：

```json
{
  "success": true,
  "date": "2026-01-01",
  "count": 0,
  "data": []
}
```
