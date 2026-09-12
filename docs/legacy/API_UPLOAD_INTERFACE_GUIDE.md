# 股票涨停分析工具 - 上传接口完整指南

## 📋 目录

1. [接口概述](#接口概述)
2. [API 端点](#api-端点)
3. [请求参数](#请求参数)
4. [响应格式](#响应格式)
5. [LLM 识别指令](#llm-识别指令)
6. [使用示例](#使用示例)
7. [错误处理](#错误处理)
8. [本地脚本使用](#本地脚本使用)

---

## 接口概述

**uploadAndRecognize** 是一个受保护的 API 接口，用于上传股票涨停复盘图片并自动识别其中的股票数据。该接口会：

1. 接收 base64 编码的图片数据
2. 将图片上传到云存储（S3）
3. 调用 LLM 进行视觉识别
4. 解析 LLM 返回的 JSON 数据
5. 将识别结果批量保存到数据库
6. 返回识别结果摘要

**特点**：
- ✅ 自动识别涨停日期和股票信息
- ✅ 支持自定义涨停日期（覆盖 LLM 识别结果）
- ✅ 支持多种图片格式（PNG、JPG、GIF、WebP）
- ✅ 自动处理图片存储和数据库保存
- ✅ 完整的错误处理和状态跟踪

---

## API 端点

```
POST /api/trpc/image.uploadAndRecognize
```

**认证方式**：JWT Bearer Token（通过 Cookie 自动传递）

**Content-Type**：`application/json`

---

## 请求参数

### 参数说明

| 参数名 | 类型 | 必需 | 说明 | 示例 |
|--------|------|------|------|------|
| `base64Data` | string | ✅ | 图片的 base64 编码数据 | `iVBORw0KGgo...` |
| `fileName` | string | ✅ | 原始文件名 | `screenshot.png` |
| `mimeType` | string | ✅ | 图片 MIME 类型 | `image/png` |
| `limitUpDate` | string | ✅ | 涨停日期，格式 YYYY-MM-DD | `2026-03-04` |

### 请求示例

```json
{
  "base64Data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "fileName": "limit_up_2026_03_04.png",
  "mimeType": "image/png",
  "limitUpDate": "2026-03-04"
}
```

---

## 响应格式

### 成功响应（200 OK）

```json
{
  "success": true,
  "imageId": 42,
  "count": 3,
  "date": "2026-03-04",
  "stocks": [
    {
      "stockCode": "002361.SZ",
      "stockName": "神剑股份",
      "limitUpTime": "14:56:30",
      "boardCount": "10天9板",
      "circulationValue": "116",
      "turnover": "51",
      "sector": "商业航天",
      "keywords": "商业航天+军工+碳纤维"
    },
    {
      "stockCode": "600000.SH",
      "stockName": "浦发银行",
      "limitUpTime": "09:30:00",
      "boardCount": "1天1板",
      "circulationValue": "2500",
      "turnover": "120",
      "sector": "金融",
      "keywords": "金融+银行"
    }
  ]
}
```

### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 是否成功识别 |
| `imageId` | number | 保存的图片记录 ID |
| `count` | number | 识别的股票总数 |
| `date` | string | 涨停日期（YYYY-MM-DD） |
| `stocks` | array | 识别的股票列表 |
| `stocks[].stockCode` | string | 股票代码（如 002361.SZ） |
| `stocks[].stockName` | string | 股票名称 |
| `stocks[].limitUpTime` | string | 涨停时间（HH:MM:SS） |
| `stocks[].boardCount` | string | 连板数（如 10天9板） |
| `stocks[].circulationValue` | string | 流通市值（亿元） |
| `stocks[].turnover` | string | 成交额（亿元） |
| `stocks[].sector` | string | 所属题材/板块 |
| `stocks[].keywords` | string | 涨停关键词 |

### 错误响应

```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "创建图片记录失败"
  }
}
```

---

## LLM 识别指令

### 系统指令（System Prompt）

```
你是一个专业的股票数据识别助手。请分析用户提供的股票涨停复盘图片，提取其中的股票信息。

请严格按照以下JSON格式返回数据：
{
  "date": "图片中的涨停日期，格式为YYYY-MM-DD",
  "stocks": [
    {
      "stockCode": "股票代码，如002361.SZ",
      "stockName": "股票名称",
      "limitUpTime": "涨停时间，如14:56:30",
      "boardCount": "板数，如10天9板",
      "circulationValue": "流通市值（亿元）",
      "turnover": "成交额（亿元）",
      "sector": "所属题材分类",
      "keywords": "涨停关键词"
    }
  ]
}
```

### 用户指令（User Prompt）

```
请识别这张涨停复盘图片中的日期和所有股票数据。
```

### 识别规则

#### 1. 股票代码识别

- **深圳主板**：以 000 开头，后缀 `.SZ`（如 `000858.SZ`）
- **深圳创业板**：以 300 或 301 开头，后缀 `.SZ`（如 `300750.SZ`）
- **深圳科创板**：以 688 开头，后缀 `.SZ`（如 `688111.SZ`）
- **北交所**：以 920 开头，后缀 `.BJ`（如 `920000.BJ`）
- **上海主板**：以 600 或 601 开头，后缀 `.SH`（如 `600000.SH`）
- **上海科创板**：以 688 开头，后缀 `.SH`（如 `688001.SH`）

#### 2. 涨停时间识别

- 格式：`HH:MM:SS`（24小时制）
- 范围：09:30:00 ~ 15:00:00（A股交易时间）
- 示例：`14:56:30`、`09:30:00`

#### 3. 连板数识别

- 格式：`N天M板`（N为连续交易天数，M为涨停板数）
- 示例：`10天9板`、`5天4板`、`1天1板`
- 特殊情况：如果只有涨停板数，使用 `1天1板` 格式

#### 4. 流通市值识别

- 单位：亿元（CNY）
- 格式：纯数字或小数
- 示例：`116`、`2500.5`、`50`

#### 5. 成交额识别

- 单位：亿元（CNY）
- 格式：纯数字或小数
- 示例：`51`、`120.3`、`200`

#### 6. 题材分类

常见题材分类：
- **商业航天**：火箭、卫星、航天器相关
- **芯片**：半导体、芯片设计、制造
- **新能源**：电池、光伏、风电、新能源汽车
- **医药**：生物制药、医疗器械、中医药
- **金融**：银行、保险、证券、期货
- **房产**：房地产开发、物业管理
- **消费**：食品饮料、日用消费品
- **科技**：软件、互联网、人工智能
- **其他**：不属于上述分类的行业

#### 7. 涨停关键词

- 多个关键词用 `+` 连接
- 示例：`商业航天+军工+碳纤维`、`芯片+国产替代`、`新能源+电池`

### 数据质量要求

| 字段 | 要求 | 处理方式 |
|------|------|---------|
| `stockCode` | 必填，格式正确 | 严格验证，错误时标记为可疑 |
| `stockName` | 必填，中文名称 | 从图片中准确提取 |
| `limitUpTime` | 可选，格式 HH:MM:SS | 无法识别时设为 null |
| `boardCount` | 可选，格式 N天M板 | 无法识别时设为 null |
| `circulationValue` | 可选，数字（亿元） | 无法识别时设为 null |
| `turnover` | 可选，数字（亿元） | 无法识别时设为 null |
| `sector` | 必填，题材分类 | 无法分类时使用 "其他" |
| `keywords` | 可选，关键词集合 | 无法识别时设为 null |

---

## 使用示例

### 示例 1：使用 Python 脚本上传

```bash
# 基本用法
python3 upload_script_example.py ./screenshot.png 2026-03-04

# 指定 API 地址和认证令牌
python3 upload_script_example.py ./screenshot.png 2026-03-04 \
  https://3000-xxx.manus.computer \
  your_jwt_token_here
```

### 示例 2：使用 cURL 上传

```bash
# 1. 将图片转换为 base64
base64 -i screenshot.png -o screenshot.b64

# 2. 读取 base64 内容
BASE64_DATA=$(cat screenshot.b64)

# 3. 发送请求
curl -X POST \
  https://3000-xxx.manus.computer/api/trpc/image.uploadAndRecognize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d "{
    \"base64Data\": \"$BASE64_DATA\",
    \"fileName\": \"screenshot.png\",
    \"mimeType\": \"image/png\",
    \"limitUpDate\": \"2026-03-04\"
  }"
```

### 示例 3：使用 JavaScript/Node.js

```javascript
const fs = require('fs');
const path = require('path');

async function uploadImage(imagePath, limitUpDate, apiUrl, token) {
  // 读取图片文件
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Data = imageBuffer.toString('base64');
  
  // 获取文件名和 MIME 类型
  const fileName = path.basename(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  const mimeType = mimeTypes[ext] || 'image/jpeg';
  
  // 发送请求
  const response = await fetch(`${apiUrl}/api/trpc/image.uploadAndRecognize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      base64Data,
      fileName,
      mimeType,
      limitUpDate
    })
  });
  
  const result = await response.json();
  return result;
}

// 使用示例
uploadImage(
  './screenshot.png',
  '2026-03-04',
  'https://3000-xxx.manus.computer',
  'your_jwt_token_here'
).then(result => {
  console.log('识别结果:', result);
  console.log(`识别了 ${result.count} 只股票`);
}).catch(error => {
  console.error('上传失败:', error);
});
```

---

## 错误处理

### 常见错误

| 错误代码 | HTTP 状态 | 说明 | 解决方案 |
|---------|---------|------|---------|
| `UNAUTHORIZED` | 401 | 未认证或 Token 过期 | 重新登录获取 Token |
| `FORBIDDEN` | 403 | 无权限访问 | 确保已登录 |
| `BAD_REQUEST` | 400 | 请求参数错误 | 检查参数格式 |
| `INTERNAL_SERVER_ERROR` | 500 | 服务器错误 | 查看服务器日志 |

### 错误响应示例

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "日期格式错误: 2026/03/04，应为YYYY-MM-DD"
  }
}
```

### 重试策略

建议在客户端实现以下重试策略：

```python
import time
import requests

def upload_with_retry(image_path, date, api_url, token, max_retries=3):
    """带重试的上传函数"""
    for attempt in range(max_retries):
        try:
            # 上传逻辑
            response = requests.post(...)
            if response.status_code == 200:
                return response.json()
            elif response.status_code in [500, 502, 503]:
                # 服务器错误，等待后重试
                wait_time = 2 ** attempt  # 指数退避
                print(f"服务器错误，{wait_time}秒后重试...")
                time.sleep(wait_time)
            else:
                # 客户端错误，直接返回
                return response.json()
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"请求失败: {e}，重试...")
                time.sleep(2 ** attempt)
            else:
                raise
    
    raise Exception("上传失败，已达最大重试次数")
```

---

## 本地脚本使用

### 前置要求

- Python 3.6+
- requests 库：`pip install requests`
- 有效的 JWT 认证令牌

### 获取认证令牌

#### 方法 1：从浏览器 Cookie 获取

1. 打开浏览器开发者工具（F12）
2. 进入 "应用程序" 或 "Application" 标签
3. 在左侧找到 "Cookies" 并展开
4. 选择您的网站域名
5. 查找名为 `manus_session` 或类似的 cookie
6. 复制其值作为 `auth_token`

#### 方法 2：从浏览器控制台获取

在浏览器控制台中运行：

```javascript
document.cookie.split('; ').find(c => c.startsWith('manus_session=')).split('=')[1]
```

### 脚本使用步骤

1. **下载脚本**

```bash
# 将 upload_script_example.py 保存到本地
wget https://your-domain/upload_script_example.py
```

2. **准备图片**

将涨停复盘图片保存为 PNG、JPG 等格式

3. **运行脚本**

```bash
# 交互式模式（会提示输入 API 地址和 Token）
python3 upload_script_example.py ./screenshot.png 2026-03-04

# 完整参数模式
python3 upload_script_example.py ./screenshot.png 2026-03-04 \
  https://3000-xxx.manus.computer \
  your_jwt_token_here
```

4. **查看结果**

脚本会输出识别结果，包括识别的股票列表、成交额等信息

### 批量上传脚本示例

```python
#!/usr/bin/env python3
"""批量上传涨停复盘图片"""

import os
import sys
from pathlib import Path
from upload_script_example import StockUploadClient

def batch_upload(image_dir, date, api_url, token):
    """批量上传目录中的所有图片"""
    client = StockUploadClient(api_url, token)
    
    image_files = list(Path(image_dir).glob('*.png')) + \
                  list(Path(image_dir).glob('*.jpg')) + \
                  list(Path(image_dir).glob('*.jpeg'))
    
    total_stocks = 0
    
    for i, image_path in enumerate(image_files, 1):
        print(f"\n[{i}/{len(image_files)}] 上传 {image_path.name}...")
        try:
            result = client.upload_and_recognize(str(image_path), date)
            total_stocks += result.get('count', 0)
            print(f"✅ 成功识别 {result.get('count')} 只股票")
        except Exception as e:
            print(f"❌ 失败: {str(e)}")
    
    print(f"\n📊 批量上传完成，共识别 {total_stocks} 只股票")

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("用法: python3 batch_upload.py <image_dir> <date> <api_url> <token>")
        sys.exit(1)
    
    batch_upload(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
```

---

## 常见问题

### Q1：如何处理识别错误的数据？

**A**：可以通过前端界面编辑涨停记录，或者调用数据编辑 API 进行修正。

### Q2：支持哪些图片格式？

**A**：支持 PNG、JPG、JPEG、GIF、WebP 等常见格式。建议使用 PNG 或 JPG 以获得最佳识别效果。

### Q3：图片大小有限制吗？

**A**：建议图片大小不超过 10MB。过大的图片会导致上传变慢。

### Q4：识别失败怎么办？

**A**：检查以下几点：
- 图片清晰度是否足够
- 是否包含完整的股票数据
- 日期格式是否正确（YYYY-MM-DD）
- 网络连接是否正常

### Q5：如何批量上传多张图片？

**A**：使用提供的批量上传脚本示例，或者在循环中多次调用接口。

---

## 技术支持

如有问题，请：

1. 查看项目文档：`/home/ubuntu/stock-limit-up-analyzer/`
2. 查看 Python 脚本示例：`upload_script_example.py`
3. 查看单元测试：`server/image.uploadAndRecognize.test.ts`
4. 检查服务器日志

---

**文档版本**：1.0  
**最后更新**：2026-03-26  
**维护者**：Stock Limit-Up Analyzer Team
