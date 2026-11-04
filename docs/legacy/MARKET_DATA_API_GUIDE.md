# 大盘交易数据录入接口使用文档

## 概述

大盘交易数据录入接口用于管理股票市场的日度交易数据，包括成交额、两融余额等关键指标。该接口支持新增、更新、查询和删除操作，为大盘分析提供数据支撑。

---

## 核心接口

### 1. 添加或更新大盘数据 (Upsert)

**端点**: `/api/trpc/market.upsert`

**请求方法**: POST

**认证要求**: ✅ 需要登录（protectedProcedure）

**请求参数**:

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `dataDate` | string | ✅ | 数据日期，格式为 YYYY-MM-DD | `"2026-04-14"` |
| `turnover` | string | ✅ | 成交额，单位为亿元 | `"8500.50"` |
| `marginBalance` | string | ✅ | 两融余额，单位为亿元 | `"9200.75"` |
| `note` | string | ❌ | 备注信息 | `"市场情绪高涨"` |

**请求示例**:

```bash
# cURL
curl -X POST https://your-api-url/api/trpc/market.upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "dataDate": "2026-04-14",
    "turnover": "8500.50",
    "marginBalance": "9200.75",
    "note": "市场成交活跃"
  }'
```

```javascript
// JavaScript/TypeScript
const response = await fetch('/api/trpc/market.upsert', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    dataDate: '2026-04-14',
    turnover: '8500.50',
    marginBalance: '9200.75',
    note: '市场成交活跃'
  })
});
const result = await response.json();
```

```python
# Python
import requests

headers = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {token}'
}

data = {
    'dataDate': '2026-04-14',
    'turnover': '8500.50',
    'marginBalance': '9200.75',
    'note': '市场成交活跃'
}

response = requests.post(
    'https://your-api-url/api/trpc/market.upsert',
    json=data,
    headers=headers
)
result = response.json()
```

**响应示例**:

```json
{
  "id": 42,
  "dataDate": "2026-04-14",
  "turnover": "8500.50",
  "marginBalance": "9200.75",
  "note": "市场成交活跃",
  "createdBy": "user123",
  "createdAt": "2026-04-14T10:30:00Z",
  "updatedAt": "2026-04-14T10:30:00Z"
}
```

**功能说明**:
- 如果指定日期已存在数据，则**更新**该数据
- 如果指定日期不存在数据，则**新增**一条数据
- 自动记录创建者和更新时间

---

### 2. 获取指定日期的大盘数据

**端点**: `/api/trpc/market.getByDate`

**请求方法**: GET / POST

**认证要求**: ❌ 无需登录（publicProcedure）

**请求参数**:

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `date` | string | ✅ | 查询日期，格式为 YYYY-MM-DD | `"2026-04-14"` |

**请求示例**:

```bash
# cURL
curl -X POST https://your-api-url/api/trpc/market.getByDate \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-04-14"}'
```

```javascript
// JavaScript/TypeScript
const response = await fetch('/api/trpc/market.getByDate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ date: '2026-04-14' })
});
const result = await response.json();
```

**响应示例**:

```json
{
  "id": 42,
  "dataDate": "2026-04-14",
  "turnover": "8500.50",
  "marginBalance": "9200.75",
  "note": "市场成交活跃",
  "createdBy": "user123",
  "createdAt": "2026-04-14T10:30:00Z",
  "updatedAt": "2026-04-14T10:30:00Z"
}
```

**异常响应**:

```json
null
```
（当指定日期不存在数据时返回 null）

---

### 3. 获取所有大盘数据

**端点**: `/api/trpc/market.getAll`

**请求方法**: GET / POST

**认证要求**: ❌ 无需登录（publicProcedure）

**请求参数**: 无

**请求示例**:

```bash
# cURL
curl -X POST https://your-api-url/api/trpc/market.getAll \
  -H "Content-Type: application/json"
```

```javascript
// JavaScript/TypeScript
const response = await fetch('/api/trpc/market.getAll', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
const result = await response.json();
```

**响应示例**:

```json
[
  {
    "id": 42,
    "dataDate": "2026-04-14",
    "turnover": "8500.50",
    "marginBalance": "9200.75",
    "note": "市场成交活跃",
    "createdBy": "user123",
    "createdAt": "2026-04-14T10:30:00Z",
    "updatedAt": "2026-04-14T10:30:00Z"
  },
  {
    "id": 41,
    "dataDate": "2026-04-13",
    "turnover": "8200.30",
    "marginBalance": "9100.50",
    "note": null,
    "createdBy": "user123",
    "createdAt": "2026-04-13T10:30:00Z",
    "updatedAt": "2026-04-13T10:30:00Z"
  }
]
```

**排序**: 按 `dataDate` 降序排列（最新数据在前）

---

### 4. 获取最近N天的大盘数据

**端点**: `/api/trpc/market.getRecent`

**请求方法**: GET / POST

**认证要求**: ❌ 无需登录（publicProcedure）

**请求参数**:

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `days` | number | ❌ | 查询天数，默认为 30 | `30` |

**请求示例**:

```bash
# cURL - 获取最近30天的数据（默认）
curl -X POST https://your-api-url/api/trpc/market.getRecent \
  -H "Content-Type: application/json" \
  -d '{}'

# 获取最近7天的数据
curl -X POST https://your-api-url/api/trpc/market.getRecent \
  -H "Content-Type: application/json" \
  -d '{"days": 7}'
```

```javascript
// JavaScript/TypeScript
// 获取最近30天
const response = await fetch('/api/trpc/market.getRecent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
});

// 获取最近7天
const response = await fetch('/api/trpc/market.getRecent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ days: 7 })
});
```

**响应示例**: 同 `getAll`，但只包含最近N天的数据

---

### 5. 删除大盘数据

**端点**: `/api/trpc/market.delete`

**请求方法**: POST

**认证要求**: ✅ 需要登录（protectedProcedure）

**请求参数**:

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `id` | number | ✅ | 数据记录的 ID | `42` |

**请求示例**:

```bash
# cURL
curl -X POST https://your-api-url/api/trpc/market.delete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"id": 42}'
```

```javascript
// JavaScript/TypeScript
const response = await fetch('/api/trpc/market.delete', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ id: 42 })
});
const result = await response.json();
```

**响应示例**:

```json
{
  "success": true,
  "message": "数据删除成功"
}
```

---

### 6. 获取涨停数与大盘数据的关联统计

**端点**: `/api/trpc/market.getLimitUpWithMarketData`

**请求方法**: GET / POST

**认证要求**: ❌ 无需登录（publicProcedure）

**请求参数**:

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `days` | number | ❌ | 统计天数，默认为 30 | `30` |

**请求示例**:

```bash
# cURL
curl -X POST https://your-api-url/api/trpc/market.getLimitUpWithMarketData \
  -H "Content-Type: application/json" \
  -d '{"days": 30}'
```

**响应示例**:

```json
[
  {
    "dataDate": "2026-04-14",
    "turnover": "8500.50",
    "marginBalance": "9200.75",
    "limitUpCount": 55,
    "limitDownCount": 12,
    "continuousBoardCount": 8
  },
  {
    "dataDate": "2026-04-13",
    "turnover": "8200.30",
    "marginBalance": "9100.50",
    "limitUpCount": 48,
    "limitDownCount": 10,
    "continuousBoardCount": 6
  }
]
```

**字段说明**:
- `limitUpCount`: 该日期的涨停股票数量
- `limitDownCount`: 该日期的跌停股票数量
- `continuousBoardCount`: 该日期的连板股票数量

---

## 数据格式规范

### 日期格式

所有日期参数均采用 **ISO 8601** 格式：`YYYY-MM-DD`

**有效示例**:
- `2026-04-14` ✅
- `2026-04-01` ✅
- `2025-12-31` ✅

**无效示例**:
- `2026/04/14` ❌
- `04-14-2026` ❌
- `2026-4-14` ❌

### 数值格式

成交额和两融余额均为**字符串类型**，支持小数点后最多2位。

**有效示例**:
- `"8500.50"` ✅
- `"8500"` ✅
- `"8500.5"` ✅
- `"0.01"` ✅

**无效示例**:
- `8500.50` ❌ (应为字符串)
- `"8500.999"` ❌ (超过2位小数)
- `"abc"` ❌ (非数值)

---

## 错误处理

### 常见错误响应

**400 Bad Request** - 参数验证失败

```json
{
  "error": "Invalid date format. Expected YYYY-MM-DD",
  "code": "INVALID_INPUT"
}
```

**401 Unauthorized** - 认证失败

```json
{
  "error": "Authentication required",
  "code": "UNAUTHORIZED"
}
```

**404 Not Found** - 数据不存在

```json
{
  "error": "Market data not found for the specified date",
  "code": "NOT_FOUND"
}
```

**500 Internal Server Error** - 服务器错误

```json
{
  "error": "Database connection failed",
  "code": "SERVER_ERROR"
}
```

### 错误处理最佳实践

```javascript
// JavaScript/TypeScript
try {
  const response = await fetch('/api/trpc/market.upsert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      dataDate: '2026-04-14',
      turnover: '8500.50',
      marginBalance: '9200.75'
    })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('API Error:', error);
    // 处理错误
  } else {
    const data = await response.json();
    console.log('Success:', data);
  }
} catch (error) {
  console.error('Network Error:', error);
}
```

---

## 实际应用场景

### 场景1: 每日收盘后录入大盘数据

```python
import requests
from datetime import datetime

def record_daily_market_data(api_url, token, turnover, margin_balance):
    """在每日收盘后自动录入大盘数据"""
    today = datetime.now().strftime('%Y-%m-%d')
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    
    payload = {
        'dataDate': today,
        'turnover': str(turnover),
        'marginBalance': str(margin_balance),
        'note': f'自动录入于 {datetime.now().strftime("%H:%M:%S")}'
    }
    
    response = requests.post(
        f'{api_url}/api/trpc/market.upsert',
        json=payload,
        headers=headers
    )
    
    if response.status_code == 200:
        print(f'✅ {today} 大盘数据录入成功')
        return response.json()
    else:
        print(f'❌ 数据录入失败: {response.text}')
        return None

# 使用示例
record_daily_market_data(
    api_url='https://your-api-url',
    token='your_jwt_token',
    turnover=8500.50,
    margin_balance=9200.75
)
```

### 场景2: 获取最近30天的市场数据进行分析

```javascript
// JavaScript/TypeScript
async function analyzeRecentMarketTrend() {
  try {
    const response = await fetch('/api/trpc/market.getRecent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 30 })
    });
    
    const marketData = await response.json();
    
    // 计算平均成交额
    const avgTurnover = marketData.reduce((sum, item) => {
      return sum + parseFloat(item.turnover);
    }, 0) / marketData.length;
    
    // 计算平均两融余额
    const avgMarginBalance = marketData.reduce((sum, item) => {
      return sum + parseFloat(item.marginBalance);
    }, 0) / marketData.length;
    
    console.log(`最近30天平均成交额: ${avgTurnover.toFixed(2)}亿元`);
    console.log(`最近30天平均两融余额: ${avgMarginBalance.toFixed(2)}亿元`);
    
    return { avgTurnover, avgMarginBalance };
  } catch (error) {
    console.error('获取数据失败:', error);
  }
}
```

### 场景3: 涨停数与大盘数据的关联分析

```python
import requests

def analyze_limit_up_correlation(api_url):
    """分析涨停数与大盘数据的相关性"""
    response = requests.post(
        f'{api_url}/api/trpc/market.getLimitUpWithMarketData',
        json={'days': 30}
    )
    
    if response.status_code == 200:
        data = response.json()
        
        # 找出涨停数最多的日期
        max_limit_up_day = max(data, key=lambda x: x['limitUpCount'])
        print(f"涨停数最多的日期: {max_limit_up_day['dataDate']}")
        print(f"  涨停数: {max_limit_up_day['limitUpCount']}")
        print(f"  成交额: {max_limit_up_day['turnover']}亿元")
        print(f"  两融余额: {max_limit_up_day['marginBalance']}亿元")
        
        return data
    else:
        print(f'获取数据失败: {response.text}')
        return None
```

---

## 注意事项

1. **日期唯一性**: 每个日期只能有一条大盘数据记录，重复提交会触发更新操作
2. **数据精度**: 成交额和两融余额支持小数点后最多2位，超出部分会被舍入
3. **认证要求**: 新增、更新、删除操作需要有效的JWT令牌
4. **查询权限**: 查询操作无需认证，任何人都可以访问
5. **时区处理**: 所有时间戳均使用 UTC 时区存储
6. **备注字段**: `note` 字段为可选，用于记录特殊情况或备注信息

---

## 完整示例脚本

### Python 完整示例

```python
#!/usr/bin/env python3
"""
大盘交易数据管理脚本
支持录入、查询、删除大盘数据
"""

import requests
import json
from datetime import datetime, timedelta

class MarketDataManager:
    def __init__(self, api_url: str, token: str = None):
        self.api_url = api_url.rstrip('/')
        self.token = token
        self.headers = {
            'Content-Type': 'application/json',
        }
        if token:
            self.headers['Authorization'] = f'Bearer {token}'
    
    def upsert(self, data_date: str, turnover: str, margin_balance: str, note: str = None):
        """新增或更新大盘数据"""
        payload = {
            'dataDate': data_date,
            'turnover': turnover,
            'marginBalance': margin_balance,
        }
        if note:
            payload['note'] = note
        
        response = requests.post(
            f'{self.api_url}/api/trpc/market.upsert',
            json=payload,
            headers=self.headers
        )
        return response.json()
    
    def get_by_date(self, date: str):
        """获取指定日期的大盘数据"""
        response = requests.post(
            f'{self.api_url}/api/trpc/market.getByDate',
            json={'date': date},
            headers=self.headers
        )
        return response.json()
    
    def get_all(self):
        """获取所有大盘数据"""
        response = requests.post(
            f'{self.api_url}/api/trpc/market.getAll',
            headers=self.headers
        )
        return response.json()
    
    def get_recent(self, days: int = 30):
        """获取最近N天的大盘数据"""
        response = requests.post(
            f'{self.api_url}/api/trpc/market.getRecent',
            json={'days': days},
            headers=self.headers
        )
        return response.json()
    
    def delete(self, record_id: int):
        """删除指定ID的大盘数据"""
        response = requests.post(
            f'{self.api_url}/api/trpc/market.delete',
            json={'id': record_id},
            headers=self.headers
        )
        return response.json()
    
    def get_limit_up_correlation(self, days: int = 30):
        """获取涨停数与大盘数据的关联统计"""
        response = requests.post(
            f'{self.api_url}/api/trpc/market.getLimitUpWithMarketData',
            json={'days': days},
            headers=self.headers
        )
        return response.json()

# 使用示例
if __name__ == '__main__':
    manager = MarketDataManager(
        api_url='https://your-api-url',
        token='your_jwt_token'
    )
    
    # 1. 录入今天的大盘数据
    today = datetime.now().strftime('%Y-%m-%d')
    result = manager.upsert(
        data_date=today,
        turnover='8500.50',
        margin_balance='9200.75',
        note='今日市场成交活跃'
    )
    print('录入结果:', json.dumps(result, indent=2, ensure_ascii=False))
    
    # 2. 查询今天的数据
    data = manager.get_by_date(today)
    print('今日数据:', json.dumps(data, indent=2, ensure_ascii=False))
    
    # 3. 获取最近7天的数据
    recent = manager.get_recent(days=7)
    print('最近7天数据:', json.dumps(recent, indent=2, ensure_ascii=False))
    
    # 4. 获取涨停数关联统计
    correlation = manager.get_limit_up_correlation(days=30)
    print('涨停数关联统计:', json.dumps(correlation, indent=2, ensure_ascii=False))
```

---

## 常见问题 (FAQ)

**Q: 如何获取 JWT 令牌？**

A: 在浏览器中登录应用后，打开开发者工具 (F12)，在 Application → Cookies 中找到 `session` 或 `token` 字段，复制其值即可。

**Q: 是否可以批量录入多天的数据？**

A: 当前接口不支持批量操作，需要逐条调用 `upsert` 接口。可以使用脚本循环调用以提高效率。

**Q: 删除的数据可以恢复吗？**

A: 删除操作是永久性的，无法恢复。建议在删除前备份重要数据。

**Q: 数据更新后多久能在前端看到？**

A: 通常在1-2秒内自动更新。如果没有更新，可以尝试刷新页面。

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-04-14 | 初版发布，包含6个核心接口 |

---

## 技术支持

如有问题或建议，请联系技术团队或提交 Issue。
