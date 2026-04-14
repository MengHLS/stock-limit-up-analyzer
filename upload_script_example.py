#!/usr/bin/env python3
"""
股票涨停分析工具 - 本地图片上传脚本

使用方法:
    python3 upload_script_example.py <image_path> <date> [api_url] [auth_token]

参数说明:
    image_path: 图片文件路径（必需）
    date: 涨停日期，格式为YYYY-MM-DD（必需）
    api_url: API服务器地址，默认为 https://3000-xxx.manus.computer
    auth_token: 认证令牌（JWT），可从浏览器cookie中获取

示例:
    python3 upload_script_example.py ./screenshot.png 2026-03-04
    python3 upload_script_example.py ./screenshot.png 2026-03-04 https://3000-xxx.manus.computer your_token_here
"""

import sys
import os
import base64
import json
import requests
from pathlib import Path
from datetime import datetime


class StockUploadClient:
    """股票数据上传客户端"""
    
    def __init__(self, api_url: str, auth_token: str):
        """
        初始化客户端
        
        Args:
            api_url: API服务器地址，如 https://3000-xxx.manus.computer
            auth_token: 认证令牌（从浏览器cookie中获取）
        """
        self.api_url = api_url.rstrip('/')
        self.auth_token = auth_token
        self.headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {auth_token}'
        }
    
    def upload_and_recognize(self, image_path: str, limit_up_date: str) -> dict:
        """
        上传图片并自动识别涨停数据
        
        Args:
            image_path: 图片文件路径
            limit_up_date: 涨停日期，格式为YYYY-MM-DD
            
        Returns:
            API返回的结果字典
        """
        # 验证文件存在
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"图片文件不存在: {image_path}")
        
        # 验证日期格式
        try:
            datetime.strptime(limit_up_date, '%Y-%m-%d')
        except ValueError:
            raise ValueError(f"日期格式错误: {limit_up_date}，应为YYYY-MM-DD")
        
        # 读取图片文件
        with open(image_path, 'rb') as f:
            image_data = f.read()
        
        # 转换为base64
        base64_data = base64.b64encode(image_data).decode('utf-8')
        
        # 获取文件名和MIME类型
        file_name = Path(image_path).name
        mime_type = self._get_mime_type(image_path)
        
        # 构建请求数据
        payload = {
            'base64Data': base64_data,
            'fileName': file_name,
            'mimeType': mime_type,
            'limitUpDate': limit_up_date
        }
        
        # 发送请求
        endpoint = f"{self.api_url}/api/trpc/image.uploadAndRecognize"
        
        print(f"📤 正在上传图片: {file_name}")
        print(f"📅 涨停日期: {limit_up_date}")
        print(f"🔗 API端点: {endpoint}")
        print(f"💡 提示: 图片上传后将在后台异步识别，无需等待识别完成")
        
        try:
            response = requests.post(
                endpoint,
                json=payload,
                headers=self.headers,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                return result
            else:
                raise Exception(f"API返回错误: {response.status_code} - {response.text}")
        
        except requests.exceptions.RequestException as e:
            raise Exception(f"请求失败: {str(e)}")
    
    @staticmethod
    def _get_mime_type(file_path: str) -> str:
        """根据文件扩展名获取MIME类型"""
        ext = Path(file_path).suffix.lower()
        mime_types = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }
        return mime_types.get(ext, 'image/jpeg')


def get_auth_token_from_browser():
    """
    从浏览器获取认证令牌的说明
    
    Returns:
        str: 说明文本
    """
    return """
获取认证令牌步骤:
1. 打开浏览器开发者工具 (F12 或 右键 -> 检查)
2. 进入 "应用程序" 或 "Application" 标签
3. 在左侧找到 "Cookies" 并展开
4. 选择您的网站域名
5. 查找名为 "manus_session" 或类似的cookie
6. 复制其值作为 auth_token

或者，您可以在浏览器控制台中运行:
    document.cookie.split('; ').find(c => c.startsWith('manus_session=')).split('=')[1]
"""


def main():
    """主函数"""
    
    # 检查参数
    if len(sys.argv) < 3:
        print("❌ 参数不足")
        print(__doc__)
        print(get_auth_token_from_browser())
        sys.exit(1)
    
    image_path = sys.argv[1]
    limit_up_date = sys.argv[2]
    
    # 获取API URL和Token
    api_url = sys.argv[3] if len(sys.argv) > 3 else input("请输入API服务器地址 (如 https://3000-xxx.manus.computer): ").strip()
    auth_token = sys.argv[4] if len(sys.argv) > 4 else input("请输入认证令牌 (从浏览器cookie中获取): ").strip()
    
    if not api_url or not auth_token:
        print("❌ API地址或认证令牌不能为空")
        sys.exit(1)
    
    try:
        # 创建客户端并上传
        client = StockUploadClient(api_url, auth_token)
        result = client.upload_and_recognize(image_path, limit_up_date)
        
        # 显示结果
        print("\n✅ 上传成功！")
        print(f"📊 识别结果:")
        print(f"   - 图片ID: {result.get('imageId')}")
        print(f"   - 识别日期: {result.get('date')}")
        print(f"   - 识别股票数: {result.get('count')}")
        
        if result.get('stocks'):
            print(f"\n📈 识别的股票列表:")
            for i, stock in enumerate(result['stocks'], 1):
                print(f"   {i}. {stock.get('stockName')} ({stock.get('stockCode')})")
                print(f"      涨停时间: {stock.get('limitUpTime')}")
                print(f"      板数: {stock.get('boardCount')}")
                print(f"      成交额: {stock.get('turnover')}亿")
                print(f"      题材: {stock.get('sector')}")
        
        return 0
    
    except Exception as e:
        print(f"\n❌ 错误: {str(e)}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
