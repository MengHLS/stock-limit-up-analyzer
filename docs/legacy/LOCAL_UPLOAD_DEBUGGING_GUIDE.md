# 本地调用上传接口诊断指南

## 问题描述

在本地调用 `uploadAndRecognize` 接口时，图片上传成功，但识别和保存股票数据的部分没有执行。

## 原因分析

`uploadAndRecognize` 接口的完整流程：

```
1. 接收base64图片数据 ✓（上传成功）
   ↓
2. 上传图片到S3存储 ✓（成功）
   ↓
3. 创建图片记录到数据库 ✓（成功）
   ↓
4. 调用LLM识别图片中的股票数据 ❌（可能失败）
   ↓
5. 保存识别的股票数据到数据库 ❌（没有执行）
```

## 常见问题排查

### 1. 检查API响应内容

运行本地脚本时，检查返回的JSON响应：

```python
# 修改 upload_script_example.py 的第101-105行，添加详细的响应输出
if response.status_code == 200:
    result = response.json()
    print(f"📋 完整响应: {json.dumps(result, indent=2, ensure_ascii=False)}")
    return result
else:
    print(f"❌ 错误响应状态码: {response.status_code}")
    print(f"❌ 错误响应内容: {response.text}")
    raise Exception(f"API返回错误: {response.status_code} - {response.text}")
```

### 2. 检查关键字段

查看响应中是否包含以下字段：

| 字段 | 说明 | 预期值 |
|------|------|--------|
| `success` | 是否成功 | `true` |
| `imageId` | 图片ID | 非空字符串 |
| `count` | 识别的股票数量 | 数字（可能为0） |
| `date` | 识别的日期 | YYYY-MM-DD格式 |
| `stocks` | 识别的股票列表 | 数组（可能为空） |

### 3. 可能的失败原因

#### 原因A：LLM识别失败

**症状**：
- `count` 为 0
- `stocks` 为空数组
- 没有错误提示

**排查方法**：
1. 检查图片质量是否足够清晰
2. 检查图片中是否包含有效的股票数据
3. 查看服务器日志中的 `[uploadAndRecognize] 识别失败` 错误信息

#### 原因B：认证失败

**症状**：
- 返回 401 或 403 错误
- 响应中提示 "Unauthorized" 或 "Forbidden"

**排查方法**：
1. 确认 JWT token 是否有效
2. 确认 token 是否过期
3. 重新从浏览器获取最新的 token

#### 原因C：数据库保存失败

**症状**：
- `success` 为 `true`
- `count` 大于 0
- `stocks` 包含数据
- 但数据库中没有新增记录

**排查方法**：
1. 检查用户权限
2. 查看服务器日志中的数据库错误
3. 确认数据库连接是否正常

#### 原因D：LLM API调用失败

**症状**：
- 返回 500 错误
- 响应中提示 "Internal Server Error"

**排查方法**：
1. 检查 `BUILT_IN_FORGE_API_KEY` 是否配置正确
2. 检查 `BUILT_IN_FORGE_API_URL` 是否可访问
3. 查看服务器日志中的 LLM 调用错误

## 调试步骤

### 步骤1：启用详细日志

修改 `upload_script_example.py`，添加请求和响应的详细日志：

```python
def upload_and_recognize(self, image_path: str, limit_up_date: str) -> dict:
    # ... 前面的代码 ...
    
    print(f"\n📝 请求数据:")
    print(f"   - 文件名: {file_name}")
    print(f"   - MIME类型: {mime_type}")
    print(f"   - 日期: {limit_up_date}")
    print(f"   - Base64长度: {len(base64_data)} 字符")
    
    try:
        response = requests.post(
            endpoint,
            json=payload,
            headers=self.headers,
            timeout=60
        )
        
        print(f"\n📊 响应信息:")
        print(f"   - 状态码: {response.status_code}")
        print(f"   - 响应头: {dict(response.headers)}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"\n✅ 响应内容: {json.dumps(result, indent=2, ensure_ascii=False)}")
            return result
        else:
            print(f"\n❌ 错误响应: {response.text}")
            raise Exception(f"API返回错误: {response.status_code} - {response.text}")
    
    except requests.exceptions.RequestException as e:
        print(f"\n❌ 网络错误: {str(e)}")
        raise
```

### 步骤2：检查服务器日志

在服务器终端查看日志输出，寻找 `[uploadAndRecognize]` 标记的错误信息：

```bash
# 查看最近的日志
tail -f /path/to/server.log | grep uploadAndRecognize
```

### 步骤3：验证数据库

上传完成后，检查数据库中是否有新增的股票记录：

```sql
-- 查看最新上传的图片
SELECT * FROM uploaded_images ORDER BY created_at DESC LIMIT 1;

-- 查看最新识别的股票数据
SELECT * FROM limit_up_records ORDER BY created_at DESC LIMIT 10;
```

## 完整的调试脚本

创建 `debug_upload.py` 脚本，包含完整的调试信息：

```python
#!/usr/bin/env python3
"""
上传接口完整调试脚本
"""

import sys
import os
import base64
import json
import requests
from pathlib import Path
from datetime import datetime

def debug_upload(image_path: str, limit_up_date: str, api_url: str, auth_token: str):
    """完整的调试上传流程"""
    
    print("=" * 60)
    print("📋 上传接口调试工具")
    print("=" * 60)
    
    # 1. 验证参数
    print("\n1️⃣  验证参数...")
    if not os.path.exists(image_path):
        print(f"❌ 图片文件不存在: {image_path}")
        return False
    
    try:
        datetime.strptime(limit_up_date, '%Y-%m-%d')
        print(f"✅ 日期格式正确: {limit_up_date}")
    except ValueError:
        print(f"❌ 日期格式错误: {limit_up_date}")
        return False
    
    # 2. 读取和编码图片
    print("\n2️⃣  读取和编码图片...")
    with open(image_path, 'rb') as f:
        image_data = f.read()
    
    file_size_mb = len(image_data) / (1024 * 1024)
    print(f"✅ 文件大小: {file_size_mb:.2f} MB")
    
    base64_data = base64.b64encode(image_data).decode('utf-8')
    print(f"✅ Base64编码长度: {len(base64_data)} 字符")
    
    # 3. 构建请求
    print("\n3️⃣  构建请求...")
    file_name = Path(image_path).name
    mime_type = 'image/png' if image_path.endswith('.png') else 'image/jpeg'
    
    payload = {
        'base64Data': base64_data,
        'fileName': file_name,
        'mimeType': mime_type,
        'limitUpDate': limit_up_date
    }
    
    print(f"✅ 文件名: {file_name}")
    print(f"✅ MIME类型: {mime_type}")
    
    # 4. 发送请求
    print("\n4️⃣  发送请求...")
    endpoint = f"{api_url.rstrip('/')}/api/trpc/image.uploadAndRecognize"
    print(f"🔗 端点: {endpoint}")
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {auth_token}'
    }
    
    try:
        response = requests.post(
            endpoint,
            json=payload,
            headers=headers,
            timeout=120
        )
        
        print(f"✅ 状态码: {response.status_code}")
        
        # 5. 解析响应
        print("\n5️⃣  解析响应...")
        
        if response.status_code == 200:
            result = response.json()
            
            print(f"✅ 响应格式: JSON")
            print(f"\n📊 响应内容:")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            
            # 6. 验证关键字段
            print("\n6️⃣  验证关键字段...")
            
            checks = [
                ('success', result.get('success') == True, "成功标志"),
                ('imageId', bool(result.get('imageId')), "图片ID"),
                ('count', isinstance(result.get('count'), int), "识别数量"),
                ('date', bool(result.get('date')), "识别日期"),
                ('stocks', isinstance(result.get('stocks'), list), "股票列表"),
            ]
            
            all_passed = True
            for field, passed, desc in checks:
                status = "✅" if passed else "❌"
                print(f"{status} {field}: {desc}")
                if not passed:
                    all_passed = False
            
            if all_passed and result.get('count', 0) > 0:
                print("\n✅ 上传和识别成功！")
                print(f"📈 识别了 {result.get('count')} 只股票")
                return True
            elif all_passed:
                print("\n⚠️  上传成功但未识别到股票数据")
                print("💡 建议: 检查图片质量或内容是否包含有效的股票数据")
                return False
            else:
                print("\n❌ 响应字段不完整")
                return False
        
        else:
            print(f"❌ 错误状态码: {response.status_code}")
            print(f"❌ 错误内容: {response.text}")
            return False
    
    except requests.exceptions.Timeout:
        print("❌ 请求超时（120秒）")
        print("💡 建议: 检查网络连接或服务器响应时间")
        return False
    
    except requests.exceptions.RequestException as e:
        print(f"❌ 网络错误: {str(e)}")
        return False

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("使用方法:")
        print("  python3 debug_upload.py <image_path> <date> <api_url> <auth_token>")
        print("\n示例:")
        print("  python3 debug_upload.py ./screenshot.png 2026-04-07 https://3000-xxx.manus.computer your_token")
        sys.exit(1)
    
    image_path = sys.argv[1]
    limit_up_date = sys.argv[2]
    api_url = sys.argv[3]
    auth_token = sys.argv[4]
    
    success = debug_upload(image_path, limit_up_date, api_url, auth_token)
    sys.exit(0 if success else 1)
```

## 解决方案总结

| 问题 | 解决方案 |
|------|--------|
| 图片上传成功但未识别 | 检查图片质量、内容和LLM API配置 |
| 返回401/403错误 | 重新获取有效的JWT token |
| 返回500错误 | 检查服务器日志和LLM API配置 |
| 识别成功但未保存 | 检查数据库连接和用户权限 |
| 网络超时 | 检查网络连接和服务器响应时间 |

## 获取帮助

如果问题仍未解决，请收集以下信息：

1. 完整的API响应JSON
2. 服务器日志中的错误信息
3. 上传的图片文件
4. 使用的API URL和日期参数

然后联系技术支持。
