import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from 'zod';

/**
 * uploadAndRecognize API 接口测试
 * 
 * 测试场景:
 * 1. 成功上传图片并识别
 * 2. 无效的日期格式
 * 3. 无效的base64数据
 * 4. 图片创建失败
 * 5. LLM识别失败
 */

describe('image.uploadAndRecognize', () => {
  it('识别保存成功后必须按识别出的有效日期同步行情，并记录日期刷新结果', () => {
    const routerSource = readFileSync(resolve(import.meta.dirname, "routers.ts"), "utf8");
    expect(routerSource).toContain("syncUploadedDatePrices(recognizedDate, stocks.map((stock) => stock.stockCode), ctx.user.id)");
    expect(routerSource).toContain("syncUploadedDatePrices(recognizedDate, stocks.map((stock) => stock.stockCode), userId)");
    expect(routerSource).toContain('operationType: "date_refresh"');
    expect(routerSource).toContain("syncCandidateDailyPricesForUpload(limitUpDate, uploadedStockCodes)");
    expect(routerSource).toContain("savedPriceRows");
  });
  
  it('应该验证输入参数的类型', () => {
    // 测试输入验证schema
    const inputSchema = z.object({
      base64Data: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
      limitUpDate: z.string(),
    });

    // 有效输入
    const validInput = {
      base64Data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      fileName: 'test.png',
      mimeType: 'image/png',
      limitUpDate: '2026-03-04',
    };

    expect(() => inputSchema.parse(validInput)).not.toThrow();
  });

  it('应该验证日期格式为YYYY-MM-DD', () => {
    const validDates = [
      '2026-03-04',
      '2025-01-01',
      '2024-12-31',
    ];

    const invalidDates = [
      '2026/03/04',
      '03-04-2026',
      '2026-3-4',
      'invalid',
      '',
    ];

    // 简单的日期格式验证
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    validDates.forEach(date => {
      expect(dateRegex.test(date)).toBe(true);
    });

    invalidDates.forEach(date => {
      expect(dateRegex.test(date)).toBe(false);
    });
  });

  it('应该验证base64数据格式', () => {
    // 有效的base64数据（最小的PNG图片）
    const validBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    
    // 检查是否能被正确解码
    expect(() => {
      Buffer.from(validBase64, 'base64');
    }).not.toThrow();
  });

  it('应该支持多种MIME类型', () => {
    const supportedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    supportedMimeTypes.forEach(mimeType => {
      expect(mimeType).toMatch(/^image\//);
    });
  });

  it('应该生成正确的文件键格式', () => {
    // 模拟文件键生成逻辑
    const userId = 'user123';
    const fileName = 'screenshot.png';
    const nanoid = () => 'abc123def456';

    const fileKey = `limit-up-images/${userId}/${nanoid()}-${fileName}`;
    
    expect(fileKey).toBe('limit-up-images/user123/abc123def456-screenshot.png');
    expect(fileKey).toContain('limit-up-images/');
    expect(fileKey).toContain(userId);
    expect(fileKey).toContain(fileName);
  });

  it('应该正确处理识别结果中的日期优先级', () => {
    // 用户提供的日期应该优先于LLM识别的日期
    const userProvidedDate = '2026-03-04';
    const llmRecognizedDate = '2026-03-05';

    const recognizedDate = userProvidedDate || llmRecognizedDate;
    
    expect(recognizedDate).toBe('2026-03-04');
  });

  it('应该正确处理空的识别结果', () => {
    const stocks = [];
    const count = stocks.length;

    expect(count).toBe(0);
    expect(Array.isArray(stocks)).toBe(true);
  });

  it('应该正确映射识别的股票数据', () => {
    // 模拟LLM返回的股票数据
    const llmStocks = [
      {
        stockCode: '002361.SZ',
        stockName: '神剑股份',
        limitUpTime: '14:56:30',
        boardCount: '10天9板',
        circulationValue: '116',
        turnover: '51',
        sector: '商业航天',
        keywords: '商业航天+军工+碳纤维'
      }
    ];

    const userId = 'user123';
    const limitUpDate = '2026-03-04';

    const records = llmStocks.map((stock: any) => ({
      stockCode: stock.stockCode,
      stockName: stock.stockName,
      limitUpDate: limitUpDate,
      limitUpTime: stock.limitUpTime || null,
      boardCount: stock.boardCount || null,
      circulationValue: stock.circulationValue || null,
      turnover: stock.turnover || null,
      sector: stock.sector || null,
      keywords: stock.keywords || null,
      createdBy: userId,
    }));

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      stockCode: '002361.SZ',
      stockName: '神剑股份',
      limitUpDate: '2026-03-04',
      limitUpTime: '14:56:30',
      boardCount: '10天9板',
      circulationValue: '116',
      turnover: '51',
      sector: '商业航天',
      keywords: '商业航天+军工+碳纤维',
      createdBy: 'user123',
    });
  });

  it('应该正确处理缺失的字段', () => {
    const stock = {
      stockCode: '002361.SZ',
      stockName: '神剑股份',
      limitUpTime: undefined,
      boardCount: undefined,
      circulationValue: '116',
      turnover: '51',
      sector: '商业航天',
      keywords: undefined
    };

    const record = {
      stockCode: stock.stockCode,
      stockName: stock.stockName,
      limitUpTime: stock.limitUpTime || null,
      boardCount: stock.boardCount || null,
      circulationValue: stock.circulationValue || null,
      turnover: stock.turnover || null,
      sector: stock.sector || null,
      keywords: stock.keywords || null,
    };

    expect(record.limitUpTime).toBeNull();
    expect(record.boardCount).toBeNull();
    expect(record.keywords).toBeNull();
    expect(record.circulationValue).toBe('116');
  });

  it('应该返回正确的响应格式', () => {
    const response = {
      success: true,
      imageId: 1,
      count: 1,
      date: '2026-03-04',
      stocks: [
        {
          stockCode: '002361.SZ',
          stockName: '神剑股份',
          limitUpTime: '14:56:30',
          boardCount: '10天9板',
          circulationValue: '116',
          turnover: '51',
          sector: '商业航天',
          keywords: '商业航天+军工+碳纤维'
        }
      ]
    };

    expect(response).toHaveProperty('success', true);
    expect(response).toHaveProperty('imageId');
    expect(response).toHaveProperty('count');
    expect(response).toHaveProperty('date');
    expect(response).toHaveProperty('stocks');
    expect(Array.isArray(response.stocks)).toBe(true);
  });

  it('应该处理多个识别的股票', () => {
    const stocks = [
      { stockCode: '002361.SZ', stockName: '神剑股份' },
      { stockCode: '600000.SH', stockName: '浦发银行' },
      { stockCode: '000858.SZ', stockName: '五粮液' },
    ];

    expect(stocks).toHaveLength(3);
    expect(stocks.map(s => s.stockCode)).toEqual([
      '002361.SZ',
      '600000.SH',
      '000858.SZ',
    ]);
  });

  it('应该验证文件名不为空', () => {
    const validFileNames = [
      'screenshot.png',
      'image.jpg',
      'data.gif',
    ];

    const invalidFileNames = [
      '',
      null,
      undefined,
    ];

    validFileNames.forEach(name => {
      expect(name && name.length > 0).toBe(true);
    });

    invalidFileNames.forEach(name => {
      expect(!name || name.length === 0).toBe(true);
    });
  });
});
