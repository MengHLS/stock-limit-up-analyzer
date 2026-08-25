import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { parseRecognitionResult } from "./recognition";
import { isValidLimitUpTime } from "../shared/limitUpTime";
import { syncCandidateDailyPrices } from "./stockPriceSync";

import {
  createLimitUpRecord,
  createLimitUpRecordsBatch,
  getAllLimitUpRecords,
  getLimitUpRecordsByDate,
  searchLimitUpRecords,
  getDailySectorStats,
  getDistinctDates,
  getDailyLimitUpStats,
  getDailySectorDistribution,
  updateLimitUpRecord,
  deleteLimitUpRecord,
  createUploadedImage,
  updateImageStatus,
  getAllUploadedImages,
  addToWatchlist,
  removeFromWatchlist,
  getUserWatchlist,
  isStockWatched,
  updateWatchType,
  upsertMarketData,
  getMarketDataByDate,
  getAllMarketData,
  getRecentMarketData,
  deleteMarketData,
  getLimitUpWithMarketData,
  getSectorHeatmapData,
  getConnectionBoardStats,
  getMaxConnectionBoardTrend,
  getSentimentCycleAnalysis,
  getLeaderCandidates,
  getLeaderCandidateBacktest,
  getAllSentimentAlerts,
  getUnreadAlertCount,
  markAlertAsRead,
  markAllAlertsAsRead,
  checkAndCreateAlert,
  batchCheckAlerts,
  EMOTION_LEVELS,
  getEmotionLevel,
} from "./db";

const limitUpTimeInput = z.string().refine(isValidLimitUpTime, {
  message: "涨停时间应为HH:MM或HH:MM:SS格式",
});

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

    // 获取每日涨停数量统计
    getDailyStats: publicProcedure.query(async () => {
      return await getDailyLimitUpStats();
    }),

    // 获取每日题材分布统计
    getSectorDistribution: publicProcedure.query(async () => {
      return await getDailySectorDistribution();
    }),

    // 创建涨停记录
    create: protectedProcedure
      .input(z.object({
        stockCode: z.string(),
        stockName: z.string(),
        limitUpDate: z.string(),
        limitUpTime: limitUpTimeInput.optional(),
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
        limitUpTime: limitUpTimeInput.optional(),
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

    // 获取股票关注状态
    getWatchStatus: protectedProcedure
      .input(z.object({ stockCode: z.string() }))
      .query(async ({ ctx, input }) => {
        const watched = await isStockWatched(ctx.user.id, input.stockCode);
        if (!watched) return "none";
        return watched.watchType;
      }),

    // 更新股票关注状态
    updateWatchStatus: protectedProcedure
      .input(z.object({
        stockCode: z.string(),
        stockName: z.string(),
        watchStatus: z.enum(['none', 'normal', 'important']),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.watchStatus === "none") {
          return await removeFromWatchlist(ctx.user.id, input.stockCode);
        } else {
          const existing = await isStockWatched(ctx.user.id, input.stockCode);
          if (existing) {
            return await updateWatchType(ctx.user.id, input.stockCode, input.watchStatus);
          } else {
            return await addToWatchlist(
              ctx.user.id,
              input.stockCode,
              input.stockName,
              input.watchStatus
            );
          }
        }
      }),

    // 获取连板梯队统计
    getConnectionBoardStats: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => {
        return await getConnectionBoardStats(input.date);
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
                content: `你是一个专业的中文股票涨停复盘图片识别助手。请逐行读取图片中的涨停股票表格，并只返回符合JSON Schema的数据。

请严格按照以下JSON格式返回数据：
{
  "date": "图片中的涨停日期，格式为YYYY-MM-DD；若图片没有日期则使用用户提供的日期",
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
1. 优先使用用户提供的日期；没有用户日期时才从图片标题识别日期
2. 仔细识别表格中的每一行股票，不要合并或遗漏行
3. 股票代码保留数字，并补充正确交易所后缀：深市.SZ、沪市.SH、北交所.BJ
4. 涨停时间统一为HH:MM:SS（例如14:56:30）；如果图片只有HH:MM则补秒为:00，无法确认时返回空字符串
5. 板数、流通市值和成交额保留图片中的原始文字或数字，不要猜测
6. 题材分类和关键词按图片原文提取；无法识别的字段返回空字符串
7. 只返回JSON，不添加Markdown代码块或解释文字`
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
          const { date: recognizedDate, stocks } = parseRecognitionResult(rawContent, limitUpDate);

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
              // 使用用户选择的日期（优先级更高）
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

    // 上传图片并自动识别（支持本地脚本调用）
    uploadAndRecognize: protectedProcedure
      .input(z.object({
        base64Data: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
        limitUpDate: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { base64Data, fileName, mimeType, limitUpDate } = input;
        
        const buffer = Buffer.from(base64Data, 'base64');
        const fileKey = `limit-up-images/${ctx.user.id}/${nanoid()}-${fileName}`;
        const { url } = await storagePut(fileKey, buffer, mimeType);
        
        const image = await createUploadedImage({
          fileKey,
          fileUrl: url,
          originalName: fileName,
          createdBy: ctx.user.id,
        });
        
        if (!image) {
          throw new Error("创建图片记录失败");
        }
        
        // 立即返回成功，后台异步识别
        await updateImageStatus(image.id, 'processing');
        
        // 保存上下文信息供异步函数使用
        const userId = ctx.user.id;
        const imageId = image.id;
        const imageUrl = url;
        
        // 在后台异步执行识别，不阻塞返回
        // 使用 Promise 确保异步任务正常执行
        void (async () => {
          try {
            console.log(`[uploadAndRecognize] 开始识别图片 ${imageId}...`);
            console.log(`[uploadAndRecognize] 调用LLM识别图片 ${imageId}...`);
            const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `你是一个专业的中文股票涨停复盘图片识别助手。请逐行提取图片中的全部涨停股票信息，并严格输出JSON。

识别指南：
1. 日期优先使用接口传入的日期；只有没有传入日期时才从图片标题识别YYYY-MM-DD。
2. 股票代码只保留数字和交易所后缀，按市场补充.SZ、.SH或.BJ。常见代码格式：
   - 深业主板: 000xxx.SZ
   - 创业板: 300xxx.SZ
   - 科创板: 688xxx.SH
   - 北交所: 8xxxxx.BJ
   - 上海主板: 600xxx.SH
3. 股票名称：一定要是中文名称。
4. 涨停时间：统一提取为HH:MM:SS（例如14:56:30）；只有HH:MM时补秒为:00，无法确认时返回空字符串。
5. 板数、流通市值和成交额：保留图片中的原始值，不要猜测或改单位。
6. 题材和关键词：按图片原文提取，无法确认时返回空字符串。

如果图片中不清楚或没有某个字段：日期使用提供的日期参数，其他字段使用空字符串；不要编造股票代码、名称或数值。

严格按照以下JSON格式返回数据，不要添加额外字段：
{
  "date": "涨停日期，格式为YYYY-MM-DD",
  "stocks": [
    {
      "stockCode": "股票代码，如002361.SZ",
      "stockName": "股票名称",
      "limitUpTime": "涨停时间，如14:56:30",
      "boardCount": "板数，如10",
      "circulationValue": "流通市值（亿元）",
      "turnover": "成交额（亿元）",
      "sector": "所属题材分类",
      "keywords": "涨停关键词"
    }
  ]
}`
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `请识别这张涨停复盘图片中的日期和所有股票数据。

重要提示：
1. 一定要提取图片中的所有股票，不要遗漏任何一个
2. 如果某个字段不清楚或缺失，仍然要尽量提取其他可见的字段
3. 股票代码、名称、题材和关键词必须是中文格式
4. 返回的JSON中stocks数组不能为空（除非图片中确实没有任何股票信息）
5. 如果图片中有表格，请逐行提取每一只股票
6. 如果股票名称后面有代码，代码格式应该是 XXX.SZ 或 XXX.SH 这样的格式`
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: url,
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
                    date: { type: "string" },
                    stocks: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          stockCode: { type: "string" },
                          stockName: { type: "string" },
                          limitUpTime: { type: "string" },
                          boardCount: { type: "string" },
                          circulationValue: { type: "string" },
                          turnover: { type: "string" },
                          sector: { type: "string" },
                          keywords: { type: "string" }
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
          const { date: recognizedDate, stocks } = parseRecognitionResult(rawContent, limitUpDate);

          if (stocks.length > 0) {
            const records = stocks.map((stock: any) => ({
              stockCode: stock.stockCode,
              stockName: stock.stockName,
              limitUpDate: recognizedDate,
              limitUpTime: stock.limitUpTime || null,
              boardCount: stock.boardCount || null,
              circulationValue: stock.circulationValue || null,
              turnover: stock.turnover || null,
              sector: stock.sector || null,
              keywords: stock.keywords || null,
              createdBy: userId,
            }));

            console.log(`[uploadAndRecognize] 保存 ${records.length} 条股票记录到数据库...`);
            await createLimitUpRecordsBatch(records);
            console.log(`[uploadAndRecognize] 股票记录保存成功`);
          }

          await updateImageStatus(imageId, 'completed');
          console.log(`[uploadAndRecognize] 图片 ${imageId} 识别完成，识别出 ${stocks.length} 只股票`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('[uploadAndRecognize] 识别失败:', errorMessage, error instanceof Error ? error.stack : '');
          try {
            await updateImageStatus(imageId, 'failed');
          } catch (updateError) {
            console.error('[uploadAndRecognize] 更新图片状态失败:', updateError);
          }
        }
      })();
        
        // 立即返回成功，不等待识别完成
        return {
          success: true,
          imageId: image.id,
          message: '图片上传成功，正在后台识别中...',
        }
      }),
  }),

  // 股票关注相关API
  watchlist: router({
    // 添加关注
    add: protectedProcedure
      .input(z.object({
        stockCode: z.string(),
        stockName: z.string(),
        watchType: z.enum(['normal', 'important']).default('normal'),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return await addToWatchlist(
          ctx.user.id,
          input.stockCode,
          input.stockName,
          input.watchType,
          input.note
        );
      }),

    // 移除关注
    remove: protectedProcedure
      .input(z.object({ stockCode: z.string() }))
      .mutation(async ({ ctx, input }) => {
        return await removeFromWatchlist(ctx.user.id, input.stockCode);
      }),

    // 获取关注列表
    getAll: protectedProcedure
      .input(z.object({ watchType: z.enum(['normal', 'important']).optional() }).optional())
      .query(async ({ ctx, input }) => {
        return await getUserWatchlist(ctx.user.id, input?.watchType);
      }),

    // 检查是否关注
    check: protectedProcedure
      .input(z.object({ stockCode: z.string() }))
      .query(async ({ ctx, input }) => {
        return await isStockWatched(ctx.user.id, input.stockCode);
      }),

    // 更新关注类型
    updateType: protectedProcedure
      .input(z.object({
        stockCode: z.string(),
        watchType: z.enum(['normal', 'important']),
      }))
      .mutation(async ({ ctx, input }) => {
        return await updateWatchType(ctx.user.id, input.stockCode, input.watchType);
      }),
  }),

  // 大盘数据相关API
  market: router({
    // 添加或更新大盘数据
    upsert: protectedProcedure
      .input(z.object({
        dataDate: z.string(),
        turnover: z.string(),
        marginBalance: z.string(),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return await upsertMarketData({
          dataDate: input.dataDate,
          turnover: input.turnover,
          marginBalance: input.marginBalance,
          note: input.note,
          createdBy: ctx.user.id,
        });
      }),

    // 获取指定日期的大盘数据
    getByDate: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => {
        return await getMarketDataByDate(input.date);
      }),

    // 获取所有大盘数据
    getAll: publicProcedure.query(async () => {
      return await getAllMarketData();
    }),

    // 获取最近N天的大盘数据
    getRecent: publicProcedure
      .input(z.object({ days: z.number().optional() }))
      .query(async ({ input }) => {
        return await getRecentMarketData(input.days || 30);
      }),

    // 删除大盘数据
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await deleteMarketData(input.id);
      }),
    // 获取涨停数与大盘数据的关联统计（最近N天）
    getLimitUpWithMarketData: publicProcedure
      .input(z.object({ days: z.number().optional() }))
      .query(async ({ input }) => {
        return await getLimitUpWithMarketData(input.days || 30);
      }),
  }),

  // 题材分布相关API
  sector: router({
    // 获取近N天的题材热度统计
    getHeatmapData: publicProcedure
      .input(z.object({ days: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return await getSectorHeatmapData(input?.days || 30);
      }),
  }),

  // 情绪预警相关API
  sentiment: router({
    // 获取可解释的主板龙头候选池（收盘后复盘排序，不构成交易建议）
    getLeaderCandidates: publicProcedure.query(async () => {
      return await getLeaderCandidates();
    }),

    // 按历史候选池计算下一已记录交易日的连板延续结果
    getLeaderCandidateBacktest: publicProcedure
      .input(z.object({
        observationDays: z.union([z.literal(1), z.literal(2)]).default(1),
        minScore: z.number().int().min(0).max(100).optional(),
        realistic: z.object({
          initialCapital: z.number().positive().max(100000000).optional(),
          maxPositions: z.number().int().min(1).max(100).optional(),
          commissionRate: z.number().min(0).max(0.01).optional(),
          stampDutyRate: z.number().min(0).max(0.01).optional(),
          transferFeeRate: z.number().min(0).max(0.01).optional(),
          slippageBps: z.number().min(0).max(1000).optional(),
          lotSize: z.number().int().min(1).max(10000).optional(),
          blockLimitUpBuys: z.boolean().optional(),
          blockLimitDownSells: z.boolean().optional(),
          enableOneWordLimitDownProbability: z.boolean().optional(),
          oneWordLimitDownSellProbability: z.number().min(0).max(100).optional(),
        }).optional(),
      }).optional())
      .query(async ({ input }) => {
        return await getLeaderCandidateBacktest(input);
      }),

    // 管理员手动触发首轮历史回填或最近交易日补齐，外部行情密钥仅保留在服务端。
    syncCandidateDailyPrices: protectedProcedure
      .input(z.object({ mode: z.enum(["full", "recent"]).default("recent") }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可同步外部日线行情" });
        }
        return syncCandidateDailyPrices(input.mode);
      }),

    // 获取每日最高连板趋势及对应股票名称
    getMaxConnectionBoardTrend: publicProcedure.query(async () => {
      return await getMaxConnectionBoardTrend();
    }),

    // 基于最高连板趋势划分情绪阶段，并在原龙头断板日分析新周期候选
    getSentimentCycleAnalysis: publicProcedure.query(async () => {
      return await getSentimentCycleAnalysis();
    }),

    // 获取所有预警记录
    getAlerts: publicProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return await getAllSentimentAlerts(input?.limit || 50);
      }),

    // 获取未读预警数量
    getUnreadCount: publicProcedure.query(async () => {
      return await getUnreadAlertCount();
    }),

    // 标记单个预警为已读
    markAsRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await markAlertAsRead(input.id);
      }),

    // 标记所有预警为已读
    markAllAsRead: protectedProcedure.mutation(async () => {
      return await markAllAlertsAsRead();
    }),

    // 检测指定日期的情绪拐点并生成预警
    checkAlert: protectedProcedure
      .input(z.object({ date: z.string() }))
      .mutation(async ({ input }) => {
        return await checkAndCreateAlert(input.date);
      }),

    // 批量检测最近N天的情绪拐点
    batchCheck: protectedProcedure
      .input(z.object({ days: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        return await batchCheckAlerts(input?.days || 30);
      }),

    // 获取情绪等级定义
    getEmotionLevels: publicProcedure.query(() => {
      return EMOTION_LEVELS;
    }),

    // 获取指定评分的情绪等级
    getEmotionLevel: publicProcedure
      .input(z.object({ score: z.number() }))
      .query(({ input }) => {
        return getEmotionLevel(input.score);
      }),
  }),
});

export type AppRouter = typeof appRouter;
