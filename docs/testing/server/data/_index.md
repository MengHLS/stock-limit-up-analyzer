<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/server/data

- 测试文件 **1** 个 ｜ 用例声明 **21** 个
- 涉及源码目录：`server/data/`

## 怎么跑

```bash
pnpm exec vitest run tests/server/data                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/server/data/data.test.ts`
- 376 行 ｜ 用例声明 21 ｜ describe 3
- 被测源码：`server/data/index.ts`
- 单跑：`pnpm exec vitest run tests/server/data/data.test.ts`
- 用例树：
- **BoardRules — 板块与涨跌停规则权威**
  - 主板 60/000/001/002/003 → 10%
  - 创业板 300/301 与科创板 688/689 → 20%
  - 北交所 920 → 30%
  - 主板 ST 名称 → 5%；缺名称按非 ST 10%
  - isStStock 严格规则：ST/*ST 前缀与退市关键词命中，普通含 ST/退 子串不误判
  - resolveLimitRules 使用严格 isStStock：STORE 类名称按主板 10% 处理
  - 无法识别 → UNSUPPORTED（null），不假装支持
  - isLimitUpBar / isLimitDownBar：close 达到涨跌停价即判定，无法判定返回 null
  - isLimitUpBar：保留不足 10% 的分价涨停，拒绝高于涨停价的异常值
  - classifyBoard 基本归类
  - isPriceAtLimitUp/Down：按板块权威阈值而非 9.9% 近似判定
- **Adapter — Raw → Canonical Bar**
  - toCanonicalBar 解析 DB/Tushare 行（varchar 与 number 均兼容）
  - 非法数值 → null（不静默填 0）
  - toEngineMarketBar 与 Core MarketBar 字段映射（amount 单位一致：千元）
- **Validation — 数据质量三态**
  - 合法 bar → VALID（缺失 turnoverRate 不报警告，其本身为可空字段）
  - symbol 为空 / timestamp 非法 → INVALID
  - OHLC 非正 → INVALID；字段缺失 → WARNING
  - OHLC 矛盾（high < max / low > min / high < low）→ INVALID
  - volume / amount 为负 → INVALID
  - 收盘涨停 → VALID（达到涨停价即判定触及，不误报）
  - 统一数值解析语义：parsePositivePrice / parseNonNegativeNumber 是唯一权威
