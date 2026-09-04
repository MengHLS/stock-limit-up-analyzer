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
import { getMissingStockPriceRequirements, syncMissingStockPrices } from "./stockPriceSync";
import { syncCandidateDailyPrices, syncCandidateDailyPricesForUpload, syncCandidateDailyPricesForDate, syncCandidateDailyPricesForDateRange, checkStockPriceSync, inferStockSuspensionWindows } from "./stockPriceSync";
import { syncMarketDataOnce, getLastMarketSyncResult, getBeijingDateString } from "./marketSync";
import { lookupStockByTencent, normalizeStockCode } from "./stockIdentity";
import { correctLimitUpStockIdentity, getStockSuspensionWindows, upsertSuspensionWindows, deleteSuspensionWindow } from "./db";

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
  saveBacktestRun,
  listBacktestRuns,
  getBacktestRun,
  getAllSentimentAlerts,
  getUnreadAlertCount,
  markAlertAsRead,
  markAllAlertsAsRead,
  checkAndCreateAlert,
  batchCheckAlerts,
  createOperationLog,
  updateOperationLog,
  getOperationLogById,
  getOperationLogs,
  EMOTION_LEVELS,
  getEmotionLevel,
} from "./db";

const limitUpTimeInput = z.string().refine(isValidLimitUpTime, {
  message: "涨停时间应为HH:MM或HH:MM:SS格式",
});

/** 回测参数 schema：计算与保存共用，保证保存的参数能被直接复算。 */
const backtestOptionsSchema = z.object({
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
    positionSizingStrategy: z.enum(["equal", "scoreWeighted", "fixedPercent"]).optional(),
    fixedPositionPercent: z.number().min(1).max(100).optional(),
    trailingProfitActivationPercent: z.number().min(0).max(100).optional(),
    trailingDrawdownPercent: z.number().min(0).max(100).optional(),
    stopLossPercent: z.number().min(0).max(100).optional(),
    strongHoldMinReturn: z.number().min(0).max(100).optional(),
    maxHoldingDays: z.number().int().min(2).max(30).optional(),
    minimumExpectedOpenChangePercent: z.number().min(-50).max(100).optional(),
    blockOneWordLimitUpBuys: z.boolean().optional(),
    enableIntradayStopLoss: z.boolean().optional(),
    detectExRights: z.boolean().optional(),
    maxPositionAmountRatio: z.number().min(0).max(1).optional(),
  }).optional(),
  downsideRisk: z.object({
    observationDays: z.number().int().min(2).max(10).optional(),
    mediumDownsidePercent: z.number().min(1).max(50).optional(),
    highDownsidePercent: z.number().min(1).max(50).optional(),
    penaltyWeight: z.number().min(0).max(1).optional(),
    autoTunePenaltyWeight: z.boolean().optional(),
    hardRiskThreshold: z.number().min(0).max(100).optional(),
    rollingTrainTradingDays: z.number().int().min(30).max(150).optional(),
    rollingValidationTradingDays: z.number().int().min(10).max(60).optional(),
  }).optional(),
});

async function beginOperationLog(log: Parameters<typeof createOperationLog>[0]): Promise<number | null> {
  try {
    return (await createOperationLog(log))?.id ?? null;
  } catch (error) {
    console.warn("[OperationLog] 创建日志失败，不阻断主流程:", error);
    return null;
  }
}

async function finishOperationLog(
  id: number | null,
  changes: Parameters<typeof updateOperationLog>[1],
): Promise<void> {
  if (id === null) return;
  try {
    await updateOperationLog(id, changes);
  } catch (error) {
    console.warn("[OperationLog] 更新日志失败，不阻断主流程:", error);
  }
}

async function syncUploadedDatePrices(limitUpDate: string, uploadedStockCodes: string[], userId: number): Promise<Awaited<ReturnType<typeof syncCandidateDailyPricesForUpload>>> {
  const operationLogId = await beginOperationLog({
    operationType: "date_refresh",
    status: "processing",
    requestedDate: limitUpDate,
    createdBy: userId,
    message: `识别保存完成，开始按上传日期智能补全 ${limitUpDate} 的T+5行情`,
  });
  try {
    const result = await syncCandidateDailyPricesForUpload(limitUpDate, uploadedStockCodes);
    const allFailed = result.targetTradingDates > 0 && result.failedDates.length === result.targetTradingDates && result.savedPriceRows === 0;
    const status = allFailed ? "failed" : result.savedPriceRows > 0 ? "success" : "empty";
    await finishOperationLog(operationLogId, {
      status,
      effectiveDate: limitUpDate,
      refreshedCount: result.savedPriceRows,
      message: allFailed
        ? `行情同步失败：${result.failedDates.join(", ")}`
        : `${result.mode === "recent" ? "近期上传：补齐此前候选" : "历史上传：补齐本次图片股票"}；覆盖 ${result.signalDates.length} 个信号日及其T+5交易日，保存 ${result.savedPriceRows} 条，缺失 ${result.missingPricePairs} 条`,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishOperationLog(operationLogId, { status: "failed", effectiveDate: limitUpDate, message: `行情同步失败：${message}` });
    throw error;
  }
}

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
        fileName: z.string().optional(),
        limitUpDate: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { imageUrl, imageId, fileName, limitUpDate } = input;
        const operationLogId = await beginOperationLog({
          operationType: "image_recognition",
          status: "processing",
          imageId: imageId ?? null,
          fileName: fileName ?? null,
          imageUrl,
          requestedDate: limitUpDate,
          createdBy: ctx.user.id,
        });
        
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
          await finishOperationLog(operationLogId, {
            status: stocks.length > 0 ? "success" : "empty",
            effectiveDate: recognizedDate,
            recognizedCount: stocks.length,
            message: stocks.length > 0 ? `识别并保存 ${stocks.length} 条股票记录` : "图片中未识别到可保存的股票记录",
          });

          const marketSync = stocks.length > 0 ? await syncUploadedDatePrices(recognizedDate, stocks.map((stock) => stock.stockCode), ctx.user.id) : null;
          return {
            success: true,
            count: stocks.length,
            date: recognizedDate,
            stocks,
            marketSync,
          };
        } catch (error) {
          if (imageId) {
            await updateImageStatus(imageId, 'failed');
          }
          await finishOperationLog(operationLogId, {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
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
        const operationLogId = await beginOperationLog({
          operationType: "image_recognition",
          status: "processing",
          imageId: image.id,
          fileName,
          imageUrl: url,
          requestedDate: limitUpDate,
          createdBy: ctx.user.id,
        });
        
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
          await finishOperationLog(operationLogId, {
            status: stocks.length > 0 ? "success" : "empty",
            effectiveDate: recognizedDate,
            recognizedCount: stocks.length,
            message: stocks.length > 0 ? `识别并保存 ${stocks.length} 条股票记录` : "图片中未识别到可保存的股票记录",
          });
          if (stocks.length > 0) {
            try {
              const marketSync = await syncUploadedDatePrices(recognizedDate, stocks.map((stock) => stock.stockCode), userId);
              console.log(`[uploadAndRecognize] 图片 ${imageId} 行情同步完成，保存 ${marketSync.savedPriceRows} 条价格记录`);
            } catch (syncError) {
              console.error(`[uploadAndRecognize] 图片 ${imageId} 行情同步失败：`, syncError);
            }
          }
          console.log(`[uploadAndRecognize] 图片 ${imageId} 识别完成，识别出 ${stocks.length} 只股票`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('[uploadAndRecognize] 识别失败:', errorMessage, error instanceof Error ? error.stack : '');
          await finishOperationLog(operationLogId, {
            status: "failed",
            message: errorMessage,
          });
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

  // 图片识别与日期数据刷新操作日志
  operationLog: router({
    getRecent: protectedProcedure
      .input(z.object({
        operationType: z.enum(["image_recognition", "date_refresh"]).optional(),
        status: z.enum(["processing", "success", "empty", "failed"]).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        return await getOperationLogs(ctx.user.id, input);
      }),

    recordRefresh: protectedProcedure
      .input(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        status: z.enum(["success", "empty", "failed"]),
        refreshedCount: z.number().int().min(0).optional(),
        message: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const log = await createOperationLog({
          operationType: "date_refresh",
          status: input.status,
          requestedDate: input.date,
          effectiveDate: input.date,
          refreshedCount: input.refreshedCount ?? null,
          message: input.message ?? null,
          createdBy: ctx.user.id,
        });
        if (!log) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "操作日志保存失败" });
        }
        return log;
      }),

    retry: protectedProcedure
      .input(z.object({ logId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const sourceLog = await getOperationLogById(input.logId, ctx.user.id);
        if (!sourceLog) {
          throw new TRPCError({ code: "NOT_FOUND", message: "操作日志不存在或无权访问" });
        }
        if (sourceLog.status !== "failed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "只有失败状态的操作可以重试" });
        }
        if (!sourceLog.requestedDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该日志缺少原始日期，无法重试" });
        }

        if (sourceLog.operationType === "image_recognition") {
          if (!sourceLog.imageUrl) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "该失败日志缺少原始图片，无法重试" });
          }

          return {
            operationType: sourceLog.operationType,
            sourceLogId: sourceLog.id,
            retryLogId: null,
            status: "ready" as const,
            retryInput: {
              imageUrl: sourceLog.imageUrl,
              imageId: sourceLog.imageId ?? undefined,
              fileName: sourceLog.fileName ?? undefined,
              limitUpDate: sourceLog.requestedDate,
            },
            message: "已校验原始图片和日期，正在重新执行识别",
          };
        }

        try {
          const records = await getLimitUpRecordsByDate(sourceLog.requestedDate);
          const status = records.length > 0 ? "success" : "empty";
          const retryLog = await createOperationLog({
            operationType: "date_refresh",
            status,
            requestedDate: sourceLog.requestedDate,
            effectiveDate: sourceLog.requestedDate,
            refreshedCount: records.length,
            message: status === "success" ? `重试刷新到 ${records.length} 条记录` : "重试刷新成功但没有记录",
            createdBy: ctx.user.id,
          });
          if (!retryLog) {
            throw new Error("重试日志保存失败");
          }
          return {
            operationType: sourceLog.operationType,
            sourceLogId: sourceLog.id,
            retryLogId: retryLog.id,
            status,
            count: records.length,
            message: retryLog.message,
          };
        } catch (error) {
          const retryLog = await createOperationLog({
            operationType: "date_refresh",
            status: "failed",
            requestedDate: sourceLog.requestedDate,
            effectiveDate: sourceLog.requestedDate,
            refreshedCount: 0,
            message: error instanceof Error ? `重试失败：${error.message}` : "重试失败",
            createdBy: ctx.user.id,
          });
          if (!retryLog) {
            throw error;
          }
          return {
            operationType: sourceLog.operationType,
            sourceLogId: sourceLog.id,
            retryLogId: retryLog.id,
            status: "failed" as const,
            count: 0,
            message: retryLog.message,
          };
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

    // 手动触发当天大盘数据同步（管理员）
    syncNow: protectedProcedure
      .mutation(async ({ ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可同步大盘数据" });
        }
        return await syncMarketDataOnce();
      }),

    // 查询大盘数据最近一次同步状态与今日是否已有数据
    getSyncStatus: publicProcedure
      .query(async () => {
        const today = getBeijingDateString();
        const todayData = await getMarketDataByDate(today);
        return {
          today,
          hasTodayData: !!todayData,
          todayData,
          lastSync: getLastMarketSyncResult(),
        };
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
      .input(backtestOptionsSchema.optional())
      .query(async ({ input }) => {
        return await getLeaderCandidateBacktest(input);
      }),

    // 保存一次回测（参数 + 完整结果），供历史回顾与多组对比
    saveBacktestRun: protectedProcedure
      .input(backtestOptionsSchema)
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可保存回测结果" });
        }
        const result = await getLeaderCandidateBacktest(input);
        const id = await saveBacktestRun(input, result);
        return { id };
      }),

    // 列出已保存回测（摘要级）
    listBacktestRuns: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
      .query(async ({ input }) => {
        return await listBacktestRuns(input?.limit ?? 50);
      }),

    // 读取单条已保存回测的完整结果
    getBacktestRun: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        return await getBacktestRun(input.id);
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

    // 检查候选股票信号日及T+1至T+5行情的缺失情况。
    getMissingStockPrices: protectedProcedure
      .input(z.object({ stockCode: z.string().optional(), signalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
      .query(async ({ input }) => getMissingStockPriceRequirements(input)),

    // 手动补齐缺失行情；只允许管理员使用外部行情接口。
    syncMissingStockPrices: protectedProcedure
      .input(z.object({ stockCode: z.string().optional(), signalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可手动同步外部日线行情" });
        const result = await syncMissingStockPrices(input);
        const operationLogId = await beginOperationLog({ operationType: "date_refresh", status: result.failedDates.length > 0 && result.savedPriceRows === 0 ? "failed" : result.savedPriceRows > 0 ? "success" : "empty", requestedDate: input?.signalDate ?? null, createdBy: ctx.user.id, refreshedCount: result.savedPriceRows, message: `手动同步：覆盖 ${result.targetTradingDates} 个交易日，保存 ${result.savedPriceRows} 条，缺失 ${result.missingPricePairs} 条${result.failedDates.length > 0 ? `，失败日期 ${result.failedDates.join(", ")}` : ""}` });
        return { ...result, operationLogId };
      }),

    // 检查各涨停记录的信号日及后续交易日行情是否已同步
    getStockSyncStatus: publicProcedure.query(async () => {
      return await checkStockPriceSync();
    }),

    // 手动同步指定涨停日期（及可选股票代码）的日线行情
    syncStockPriceForDate: protectedProcedure
      .input(z.object({
        date: z.string(),
        stockCodes: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可同步外部日线行情" });
        }
        return await syncCandidateDailyPricesForDate(input.date, 10, input.stockCodes);
      }),

    // 按日期范围（单日或区间）同步日线行情，返回每个交易日的成功/失败明细
    syncStockPricesByDateRange: protectedProcedure
      .input(z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可同步外部日线行情" });
        }
        if (input.startDate > input.endDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "起始日期不能晚于结束日期" });
        }
        const result = await syncCandidateDailyPricesForDateRange(input.startDate, input.endDate);
        const allFailed = result.targetTradingDates > 0 && result.savedPriceRows === 0 && result.failedDates.length === result.targetTradingDates;
        const status = allFailed ? "failed" : result.savedPriceRows > 0 ? "success" : "empty";
        const operationLogId = await beginOperationLog({
          operationType: "date_refresh",
          status,
          requestedDate: input.startDate,
          createdBy: ctx.user.id,
          refreshedCount: result.savedPriceRows,
          message: `按日期范围同步：${input.startDate} ~ ${input.endDate}，覆盖 ${result.targetTradingDates} 个交易日，保存 ${result.savedPriceRows} 条，缺失 ${result.missingPricePairs} 条${result.failedDates.length > 0 ? `，失败日期 ${result.failedDates.join(", ")}` : ""}`,
        });
        return { ...result, operationLogId };
      }),

    // 用腾讯行情按代码反查真实名称，供人工校正前验证代码是否正确
    lookupStockInfo: publicProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ input }) => {
        const tsCode = normalizeStockCode(input.code);
        const info = await lookupStockByTencent(tsCode);
        return info ?? null;
      }),

    // 批量校正涨停记录的股票名称/代码（按旧代码+旧名称精确匹配，自动补全交易所后缀）
    correctStockIdentity: protectedProcedure
      .input(z.object({
        fromCode: z.string(),
        fromName: z.string(),
        toCode: z.string(),
        toName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可校正股票名称与代码" });
        }
        const result = await correctLimitUpStockIdentity(input);
        if (!result.ok) {
          const details = result.conflicts
            .map((conflict) => `${conflict.limitUpDate}（已有 ${conflict.existingNames.join("、")}）`)
            .join("；");
          throw new TRPCError({
            code: "CONFLICT",
            message: `校正会与以下涨停日期已有记录冲突，请先处理重复记录再重试：${details}`,
          });
        }
        return { updatedRows: result.updatedRows, dates: result.dates };
      }),

    // 读取已记录的停牌窗口（供页面展示与人工撤销）
    listSuspensionWindows: publicProcedure.query(async () => {
      return await getStockSuspensionWindows();
    }),

    // 用 Tushare 个股日线反推停牌窗口并落库（管理员）
    inferStockSuspension: protectedProcedure
      .input(z.object({
        stockCodes: z.array(z.string()).min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可反推停牌窗口" });
        }
        return await inferStockSuspensionWindows(input.stockCodes, input.startDate, input.endDate);
      }),

    // 人工标记停牌区间（管理员，兜底推断不可靠的情况）
    markStockSuspension: protectedProcedure
      .input(z.object({
        stockCode: z.string(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可标记停牌区间" });
        }
        if (input.startDate > input.endDate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "停牌起始日期不能晚于结束日期" });
        }
        const stockCode = normalizeStockCode(input.stockCode);
        await upsertSuspensionWindows([{
          stockCode,
          startDate: input.startDate,
          endDate: input.endDate,
          source: "manual",
          note: input.note ?? null,
        }]);
        return await getStockSuspensionWindows([stockCode]);
      }),

    // 删除停牌窗口（管理员，撤销误标或已复牌的窗口）
    deleteStockSuspension: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可删除停牌窗口" });
        }
        return { deleted: await deleteSuspensionWindow(input.id) };
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
