# 图片识别并保存涨停数据 API

## 1. 接口用途

该接口用于从本地脚本上传涨停复盘图片。服务器会把图片保存到对象存储，异步调用视觉模型识别图片中的涨停日期和股票信息，识别完成后写入 `limit_up_records`，并按识别出的日期触发行情数据补全和操作日志记录。

处理链路为：

```text
上传图片 → 保存图片 → 后台视觉识别 → 识别日期和股票 → 保存涨停记录 → 补齐行情 → 写入操作日志
```

接口采用异步处理，上传成功只代表图片已接收并开始后台识别，不代表识别已经完成。

## 2. 请求地址和认证

```http
POST /api/trpc/image.uploadAndRecognize
Content-Type: application/json
Authorization: Bearer YOUR_SESSION_TOKEN
```

也可以使用已登录浏览器的会话 Cookie。该接口是受保护接口，必须使用有权限的登录会话。

## 3. 请求体

标准 tRPC 请求体如下：

```json
{
  "json": {
    "base64Data": "iVBORw0KGgoAAAANSUhEUg...",
    "fileName": "limit_up_2026-11-04.png",
    "mimeType": "image/png",
    "limitUpDate": "2026-11-04"
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `base64Data` | string | 是 | 图片二进制内容的 Base64 字符串，不要带 `data:image/png;base64,` 前缀 |
| `fileName` | string | 是 | 原始文件名 |
| `mimeType` | string | 是 | 图片 MIME 类型，如 `image/png`、`image/jpeg` |
| `limitUpDate` | string | 否 | 图片无法识别日期时使用的回退日期，格式为 `YYYY-MM-DD` |

### 日期规则

日期优先级如下：

1. 优先使用图片标题或图片内容中识别出的有效日期；
2. 图片没有识别出有效日期时，使用请求中的 `limitUpDate`；
3. 图片和请求都没有有效日期时，识别失败，不会保存股票记录。

因此，批量上传时应尽量让图片自身包含清晰的交易日期。`limitUpDate` 不应覆盖图片中的日期，只作为兜底值。

## 4. cURL 示例

```bash
IMAGE_BASE64=$(base64 -w 0 ./limit_up_2026-11-04.png)

curl -X POST \
  "https://你的域名/api/trpc/image.uploadAndRecognize" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d "$(python3 - <<'PY'
import json
import os

print(json.dumps({
    'json': {
        'base64Data': os.environ['IMAGE_BASE64'],
        'fileName': 'limit_up_2026-11-04.png',
        'mimeType': 'image/png',
        'limitUpDate': '2026-11-04',
    }
}))
PY
)"
```

如果不需要回退日期，可以省略 `limitUpDate`：

```json
{
  "json": {
    "base64Data": "...",
    "fileName": "limit_up.png",
    "mimeType": "image/png"
  }
}
```

## 5. Python 调用示例

```python
import base64
import json
import mimetypes
import os
import sys
import requests

api_url = "https://你的域名"
token = os.environ["STOCK_API_TOKEN"]
image_path = sys.argv[1]

with open(image_path, "rb") as image_file:
    base64_data = base64.b64encode(image_file.read()).decode("ascii")

file_name = os.path.basename(image_path)
mime_type = mimetypes.guess_type(file_name)[0] or "image/jpeg"

payload = {
    "json": {
        "base64Data": base64_data,
        "fileName": file_name,
        "mimeType": mime_type,
        # 可选回退日期；图片日期优先
        "limitUpDate": "2026-11-04",
    }
}

response = requests.post(
    f"{api_url}/api/trpc/image.uploadAndRecognize",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    },
    json=payload,
    timeout=60,
)
response.raise_for_status()
print(json.dumps(response.json(), ensure_ascii=False, indent=2))
```

项目中也提供了脚本示例：[upload_script_example.py](./upload_script_example.py)。可以不提供日期，直接执行：

```bash
python3 upload_script_example.py ./limit_up.png
```

如果图片没有日期，再提供回退日期：

```bash
python3 upload_script_example.py ./limit_up.png 2026-11-04
```

## 6. 立即响应

接口上传成功后立即返回，不等待视觉识别：

```json
{
  "result": {
    "data": {
      "json": {
        "success": true,
        "imageId": 2190001,
        "message": "图片上传成功，正在后台识别中..."
      }
    }
  }
}
```

部分客户端或网关会直接展开 tRPC 响应中的 `result.data.json`，因此读取时兼容以下两种位置：

```python
body = response.json()
result = body.get("result", {}).get("data", {}).get("json", body)
image_id = result["imageId"]
```

## 7. 后台保存结果

后台识别成功后：

- 图片状态更新为 `completed`；
- 识别出的每只股票写入 `limit_up_records`；
- `limitUpDate` 使用图片识别出的日期；
- 记录股票代码、名称、涨停时间、连板数、流通市值、成交额、题材和关键词；
- 按识别日期和识别股票触发 T+5 行情补全；
- 在操作日志中记录识别状态、最终日期、识别数量和行情刷新结果。

识别失败时：

- 图片状态更新为 `failed`；
- 不写入不完整的股票记录；
- 操作日志记录失败原因；
- 上传接口本身已经返回成功的情况下，不要重复上传同一图片，优先根据 `imageId` 查看日志或使用网页中的失败重试功能。

## 8. 成功、空结果和错误

上传接收成功：

```json
{
  "success": true,
  "imageId": 2190001,
  "message": "图片上传成功，正在后台识别中..."
}
```

识别完成后的股票明细不在上传响应中返回，因为识别是后台异步任务。应在网页中查看，或调用按日期查询接口：

```http
GET /api/limit-up?date=2026-11-04
```

非法请求一般返回 tRPC 错误，例如缺少图片内容、未认证或请求体格式错误。常见问题包括：

| 问题 | 处理方式 |
|---|---|
| 401/UNAUTHORIZED | 检查登录会话或 Bearer Token |
| 413/请求体过大 | 压缩图片或降低分辨率 |
| 图片状态 failed | 查看操作日志中的失败原因后重试 |
| 识别为空 | 检查图片是否清晰、是否包含股票表格和日期 |
| 没有有效日期 | 在请求中补充 `limitUpDate` 作为回退日期 |

## 9. 注意事项

- 推荐使用清晰的 PNG 或 JPG 图片。
- 图片中的日期应清晰可见，系统会优先采用图片日期。
- 不要把 Base64 的 `data:` 前缀一起传入 `base64Data`。
- 上传接口会异步识别，客户端不要因为响应没有股票列表就重复提交。
- 同一图片重复上传可能产生重复识别记录；如需幂等批处理，应由本地脚本保存 `imageId` 并避免重复提交。
