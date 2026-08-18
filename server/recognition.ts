import { normalizeLimitUpTime } from "../shared/limitUpTime";

export type RecognizedStock = {
  stockCode: string;
  stockName: string;
  limitUpTime: string;
  boardCount: string;
  circulationValue: string;
  turnover: string;
  sector: string;
  keywords: string;
};

export type RecognitionResult = {
  date: string;
  stocks: RecognizedStock[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeStockCode(value: unknown): string {
  const code = textValue(value).toUpperCase().replace(/\s+/g, "");
  if (!code || code.includes(".")) return code;
  if (/^(600|601|603|605|688)/.test(code)) return `${code}.SH`;
  if (/^(000|001|002|003|300|301)/.test(code)) return `${code}.SZ`;
  if (/^(8|92)/.test(code)) return `${code}.BJ`;
  return code;
}

function extractContent(rawContent: unknown): string {
  if (typeof rawContent === "string") return rawContent;
  if (Array.isArray(rawContent)) {
    const textPart = rawContent.find((part) =>
      typeof part === "object" && part !== null && "type" in part && part.type === "text",
    );
    if (textPart && typeof textPart === "object" && "text" in textPart) {
      return textValue(textPart.text);
    }
  }
  throw new Error("无法解析LLM返回内容");
}

export function parseRecognitionResult(rawContent: unknown, fallbackDate: string): RecognitionResult {
  const parsed = JSON.parse(extractContent(rawContent)) as { date?: unknown; stocks?: unknown };
  const modelDate = textValue(parsed.date);
  const date = DATE_PATTERN.test(fallbackDate) ? fallbackDate : modelDate;
  if (!DATE_PATTERN.test(date)) {
    throw new Error("识别结果缺少有效的涨停日期");
  }

  const stocks = Array.isArray(parsed.stocks) ? parsed.stocks : [];
  return {
    date,
    stocks: stocks.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const stock = item as Record<string, unknown>;
      const stockCode = normalizeStockCode(stock.stockCode);
      const stockName = textValue(stock.stockName);
      if (!stockCode || !stockName) return [];
      return [{
        stockCode,
        stockName,
        limitUpTime: normalizeLimitUpTime(textValue(stock.limitUpTime)) ?? "",
        boardCount: textValue(stock.boardCount),
        circulationValue: textValue(stock.circulationValue),
        turnover: textValue(stock.turnover),
        sector: textValue(stock.sector),
        keywords: textValue(stock.keywords),
      }];
    }),
  };
}
