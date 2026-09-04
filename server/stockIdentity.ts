/**
 * 股票「代码/名称」身份工具：
 * - normalizeStockCode：按代码前缀补全/纠正交易所后缀（6→SH、0/3→SZ、4/8/92→BJ）
 * - lookupStockByTencent：用腾讯行情接口（qt.gtimg.cn）反查某代码的真实名称，用于人工校正前验证
 */

const TENCT_QUOTE_URL = "https://qt.gtimg.cn/q=";

/** 根据 6 位数字代码推断交易所后缀，规则与 Tushare/A股一致。 */
export function inferStockExchangeSuffix(digits: string): string {
  if (digits.startsWith("6")) return "SH"; // 60/601/603/605 主板 + 688 科创板
  if (digits.startsWith("0") || digits.startsWith("3")) return "SZ"; // 000/001/002/003 + 300/301
  if (digits.startsWith("92") || digits.startsWith("4") || digits.startsWith("8")) return "BJ"; // 北交所 920/43/83/87/88
  throw new Error(`无法识别的股票代码前缀：${digits}`);
}

/** 将任意输入（可带/可不带后缀，大小写均可）规范化为 6位数字.交易所 形式；格式非法时抛错。 */
export function normalizeStockCode(input: string): string {
  const match = input.trim().match(/(\d{6})(?:\.(SH|SZ|BJ))?$/i);
  if (!match) {
    throw new Error(`无效股票代码：${input}，请输入 6 位数字代码（如 600272 或 600272.SH）`);
  }
  const digits = match[1];
  return `${digits}.${inferStockExchangeSuffix(digits)}`;
}

export type TencentStockInfo = {
  tsCode: string; // 规范代码，如 600272.SH
  name: string; // 交易所当前名称（可能含 ST 前缀）
};

/**
 * 用腾讯行情接口按 6 位代码反查真实名称。
 * 同一位数最多只有一家交易所上市，因此同时查询 sh/sz/bj 三个前缀，取有行情返回的那个。
 * 返回 null 表示代码不存在或网络失败。
 */
export async function lookupStockByTencent(input: string): Promise<TencentStockInfo | null> {
  const digits = input.trim().match(/(\d{6})/)?.[1];
  if (!digits) return null;

  const symbols = ["sh", "sz", "bj"].map((market) => `${market}${digits}`).join(",");
  try {
    const response = await fetch(`${TENCT_QUOTE_URL}${symbols}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Referer: "https://gu.qq.com/" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buffer);
    for (const line of text.split(";")) {
      const match = line.match(/v_(sh|sz|bj)(\d{6})="([^"]*)"/);
      if (!match) continue;
      const market = match[1];
      const codeDigits = match[2];
      const fields = match[3].split("~");
      const name = fields[1]?.trim();
      if (!name) continue; // 该市场无此代码
      return { tsCode: `${codeDigits}.${market.toUpperCase()}`, name };
    }
    return null;
  } catch (error) {
    console.warn("[StockIdentity] 腾讯行情查询失败：", error);
    return null;
  }
}
