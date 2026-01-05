import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import {
  createLimitUpRecord,
  createLimitUpRecordsBatch,
  getAllLimitUpRecords,
  getLimitUpRecordsByDate,
  searchLimitUpRecords,
  getDailySectorStats,
  getDistinctDates,
  updateLimitUpRecord,
  deleteLimitUpRecord,
  createUploadedImage,
  updateImageStatus,
  getAllUploadedImages,
} from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // 涨停记录相关API
  limitUp: router({
    // 获取所有涨停记录
    getAll: publicProcedure.query(async () => {
      return await getAllLimitUpRecords();
    }),

    // 按日期获取涨停记录
    getByDate: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => {
        return await getLimitUpRecordsByDate(input.date);
      }),

    // 搜索股票
    search: publicProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        if (!input.query.trim()) return [];
        return await searchLimitUpRecords(input.query);
      }),

    // 获取每日题材统计
    getSectorStats: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => {
        return await getDailySectorStats(input.date);
      }),

    // 获取所有日期列表
    getDates: publicProcedure.query(async () => {
      return await getDistinctDates();
    }),

    // 创建涨停记录
    create: protectedProcedure
      .input(z.object({
        stockCode: z.string(),
        stockName: z.string(),
        limitUpDate: z.string(),
        limitUpTime: z.string().optional(),
        boardCount: z.string().optional(),
        circulationValue: z.string().optional(),
        turnover: z.string().optional(),
        sector: z.string().optional(),
        keywords: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 直接使用字符串格式日期，避免时区转换
        return await createLimitUpRecord({
          ...input,
          limitUpDate: input.limitUpDate,
          createdBy: ctx.user.id,
        });
      }),

    // 更新涨停记录
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        stockCode: z.string().optional(),
        stockName: z.string().optional(),
        limitUpDate: z.string().optional(),
        limitUpTime: z.string().optional(),
        boardCount: z.string().optional(),
        circulationValue: z.string().optional(),
        turnover: z.string().optional(),
        sector: z.string().optional(),
        keywords: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const updateData: Record<string, unknown> = { ...data };
        if (data.limitUpDate) {
          updateData.limitUpDate = new Date(data.limitUpDate);
        }
        return await updateLimitUpRecord(id, updateData);
      }),

    // 删除涨停记录
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await deleteLimitUpRecord(input.id);
      }),
  }),

  // 图片上传和识别
  image: router({
    // 上传图片
    upload: protectedProcedure
      .input(z.object({
        base64Data: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { base64Data, fileName, mimeType } = input;
        
        // 解码base64数据
        const buffer = Buffer.from(base64Data, 'base64');
        
        // 生成唯一文件名
        const fileKey = `limit-up-images/${ctx.user.id}/${nanoid()}-${fileName}`;
        
        // 上传到S3
        const { url } = await storagePut(fileKey, buffer, mimeType);
        
        // 创建图片记录
        const image = await createUploadedImage({
          fileKey,
          fileUrl: url,
          originalName: fileName,
          createdBy: ctx.user.id,
        });
        
        return image;
      }),

    // 识别图片中的涨停数据
    recognize: protectedProcedure
      .input(z.object({
        imageUrl: z.string(),
        imageId: z.number().optional(),
        limitUpDate: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { imageUrl, imageId, limitUpDate } = input;
        
        if (imageId) {
          await updateImageStatus(imageId, 'processing');
        }
        
        try {
          // 使用LLM视觉能力识别图片
          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `你是一个专业的股票数据识别助手。请分析用户提供的股票涨停复盘图片，提取其中的股票信息和日期。

请严格按照以下JSON格式返回数据：
{
  "date": "图片中的涨停日期，格式为YYYY-MM-DD，如图片标题显示12.31则返回2024-12-31",
  "stocks": [
    {
      "stockCode": "股票代码，如002361.SZ",
      "stockName": "股票名称，如神剑股份",
      "limitUpTime": "涨停时间，如14:56:30",
      "boardCount": "板数，如10天9板",
      "circulationValue": "流通市值（亿元），如116",
      "turnover": "成交额（亿元），如51",
      "sector": "所属题材分类，如商业航天",
      "keywords": "涨停关键词，如商业航天+军工+碳纤维"
    }
  ]
}

注意事项：
1. 首先识别图片标题中的日期（通常在标题中显示如"12.31"或"2024.12.31"），转换为YYYY-MM-DD格式
2. 仔细识别图片中的每一行股票数据
3. 股票代码需要包含交易所后缀（.SZ或.SH）
4. 题材分类是图片中的大标题分类
5. 关键词是每行股票最后一列的详细描述
6. 如果某个字段无法识别，请留空字符串
7. 确保返回有效的JSON格式`
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `请识别这张涨停复盘图片中的日期和所有股票数据。请从图片标题中提取日期。`
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: imageUrl,
                      detail: "high"
                    }
                  }
                ]
              }
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "stock_limit_up_data",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    date: { type: "string", description: "涨停日期，格式YYYY-MM-DD" },
                    stocks: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          stockCode: { type: "string", description: "股票代码" },
                          stockName: { type: "string", description: "股票名称" },
                          limitUpTime: { type: "string", description: "涨停时间" },
                          boardCount: { type: "string", description: "板数" },
                          circulationValue: { type: "string", description: "流通市值" },
                          turnover: { type: "string", description: "成交额" },
                          sector: { type: "string", description: "题材分类" },
                          keywords: { type: "string", description: "涨停关键词" }
                        },
                        required: ["stockCode", "stockName", "limitUpTime", "boardCount", "circulationValue", "turnover", "sector", "keywords"],
                        additionalProperties: false
                      }
                    }
                  },
                  required: ["date", "stocks"],
                  additionalProperties: false
                }
              }
            }
          });

          const rawContent = response.choices[0]?.message?.content;
          if (!rawContent) {
            throw new Error("LLM返回内容为空");
          }

          // 处理content可能是字符串或数组的情况
          let content: string;
          if (typeof rawContent === 'string') {
            content = rawContent;
          } else if (Array.isArray(rawContent)) {
            const textPart = rawContent.find(p => p.type === 'text');
            content = textPart && 'text' in textPart ? textPart.text : '';
          } else {
            throw new Error("无法解析LLM返回内容");
          }

          const data = JSON.parse(content);
          const recognizedDate = data.date || limitUpDate; // 使用识别的日期，如果没有则回退到用户输入的日期
          const stocks = data.stocks || [];

          // 批量保存到数据库
          if (stocks.length > 0) {
            const records = stocks.map((stock: {
              stockCode: string;
              stockName: string;
              limitUpTime?: string;
              boardCount?: string;
              circulationValue?: string;
              turnover?: string;
              sector?: string;
              keywords?: string;
            }) => {
              // 使用从图片中识别的日期
              return {
              stockCode: stock.stockCode,
              stockName: stock.stockName,
              limitUpDate: recognizedDate,
              limitUpTime: stock.limitUpTime || null,
              boardCount: stock.boardCount || null,
              circulationValue: stock.circulationValue || null,
              turnover: stock.turnover || null,
              sector: stock.sector || null,
              keywords: stock.keywords || null,
              createdBy: ctx.user.id,
            };
            });

            await createLimitUpRecordsBatch(records);
          }

          if (imageId) {
            await updateImageStatus(imageId, 'completed');
          }

          return {
            success: true,
            count: stocks.length,
            date: recognizedDate,
            stocks,
          };
        } catch (error) {
          if (imageId) {
            await updateImageStatus(imageId, 'failed');
          }
          throw error;
        }
      }),

    // 获取所有上传的图片
    getAll: protectedProcedure.query(async () => {
      return await getAllUploadedImages();
    }),
  }),
});

export type AppRouter = typeof appRouter;
