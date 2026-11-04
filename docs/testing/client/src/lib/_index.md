<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/client/src/lib

- 测试文件 **3** 个 ｜ 用例声明 **20** 个
- 涉及源码目录：`client/src/lib/` · `shared/`

## 怎么跑

```bash
pnpm exec vitest run tests/client/src/lib                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

## 逐文件

### `tests/client/src/lib/datasetPreviewState.test.ts`
- 80 行 ｜ 用例声明 8 ｜ describe 2
- 被测源码：`client/src/lib/datasetPreviewState.ts`
- 单跑：`pnpm exec vitest run tests/client/src/lib/datasetPreviewState.test.ts`
- 用例树：
- **datasetPreviewState · keyset 分页状态机**
  - 初始栈 = 首页（cursor null）
  - NEXT 压入 nextCursor；PREV 弹出
  - 首页 PREV 是 no-op（不越界）
  - RESET 回到第 1 页（版本切换清残留）
  - canGoNext 由 nextCursor 决定（null → 末页禁 next）
  - 重复 nextCursor 不重复压栈（防抖）
- **datasetPreviewState · queryKey 稳定性**
  - 不同 table / versionId / limit / cursor 产生不同 key
  - versionId 变化 → key 变化（杜绝旧版本数据残留）

### `tests/client/src/lib/fullCycleRiskBlocks.test.ts`
- 152 行 ｜ 用例声明 8 ｜ describe 2
- 被测源码：`client/src/lib/fullCycleRiskBlocks.ts`
- 单跑：`pnpm exec vitest run tests/client/src/lib/fullCycleRiskBlocks.test.ts`
- 用例树：
- **summarizeEquityCurveReturns**
  - 1) 最大收益取曲线最高点、当前收益取期末权益（均以初始资金为基准）
  - 2) 并列最高点取最早出现的一次（渲染稳定，不随遍历顺序漂移）
  - 3) 百分数保留两位小数，不做额外四舍五入
  - 4) 剔除非有限值与非正权益点：它们既不参与取峰，也不被当成期末点
  - 5) 初始资金非正或曲线为空时返回全空（不得兜底成 0）
- **buildFullCycleRiskBlocks**
  - 6) 回撤三项原样搬运服务端值，不在此重算
  - 7) 保持传入顺序、回填收益派生值，且不把整条权益曲线带进渲染数据
  - 8) 空输入返回空数组（页面据此不渲染该区块）

### `tests/client/src/lib/statusVocabulary.test.ts`
- 51 行 ｜ 用例声明 4 ｜ describe 1
- 被测源码：`client/src/lib/status.ts` · `shared/researchContracts.ts`
- 单跑：`pnpm exec vitest run tests/client/src/lib/statusVocabulary.test.ts`
- 用例树：
- **策略版本状态词表：客户端镜像 ↔ 后端权威**
  - 1) 客户端顺序常量与 shared 权威值逐字、同序一致
  - 2) 每个选项都能通过 shared 的 zod 枚举（= 后端 setVersionStatus 真会接受）
  - 3) 词表无重复、无空值（重复会让下拉出现两个同值项）
  - 4) 每个状态都有展示语义色（未收录会静默回退 neutral，这里显式钉住）
