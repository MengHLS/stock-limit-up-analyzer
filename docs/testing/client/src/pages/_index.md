<!-- 由 `scripts/genTestDocs.mts` 生成（`pnpm run docs:tests`），禁手改。 -->

# 测试模块：tests/client/src/pages

- 测试文件 **2** 个 ｜ 用例声明 **16** 个
- 涉及源码目录：`client/src/adapters/` · `server/`

## 怎么跑

```bash
pnpm exec vitest run tests/client/src/pages                   # 本模块（vitest 位置过滤 = 路径子串匹配）
pnpm exec vitest run tests/server/xxx.test.ts          # 单个文件（路径见下方「逐文件」）
pnpm run test:changed                                  # 只跑改动相关（日常推荐）
```

> ℹ️ 本模块有 **2** 个「源码文本断言」测试（`readFileSync` 源码 + 字符串匹配），
> 改个变量名就可能变红，且不验证行为；详见 `docs/testing/README.md` 的「测试分类」一节。

## 逐文件

### `tests/client/src/pages/strategyListDetailSplit.test.ts`
- 113 行 ｜ 用例声明 9 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：`server/routers.ts` · `client/src/adapters/strategyCandidateAdapter.ts`
- 单跑：`pnpm exec vitest run tests/client/src/pages/strategyListDetailSplit.test.ts`
- 用例树：
- **策略：列表页 / 详情页分家**
  - 1) 两条独立路由：/strategies（列表）与 /strategies/:strategyId（详情）
  - 2) 旧 /strategy-editor 仍可达（兼容改写），且不再有第二个策略页面组件
  - 3) 侧边导航指向列表页，且不再指向旧路由
  - 4) 策略深链生成器指向详情路由（不再产出旧地址）
  - 5) 详情页不承载「全库浏览」：不调 strategyDomain.strategy.list
  - 6) 列表页走真实只读端点，且该端点确实挂在真实 appRouter 上
  - 7) 两个页面用到的策略端点全部真实存在
  - 8) 新建草稿不复用模板身份（清空 strategyId，避免变成给既有策略加版本）
  - 9) 已移除的运行开关不再出现在**用户可见文案**里（代码注释里的历史说明不算）

### `tests/client/src/pages/strategyRunResultPersist.test.ts`
- 95 行 ｜ 用例声明 7 ｜ describe 1 ｜ 📄 源码文本断言
- 被测源码：`server/routers.ts`
- 单跑：`pnpm exec vitest run tests/client/src/pages/strategyRunResultPersist.test.ts`
- 用例树：
- **运行结果：刷新后可恢复（不再只活在内存里）**
  - 1) 恢复路径真的调了留档端点，且端点真实存在
  - 2) 恢复按「策略 + 最近一次」取，不是全表最后一条
  - 3) 🔴 本次运行结果优先：runResult 的分支必须排在留档恢复之前
  - 4) 恢复复用运行工作台同一套构建 + 面板（零口径漂移）
  - 5) 无留档时的空态不再谎称「还没跑过」，并给出回测历史入口
  - 6) 「有留档但缺完整结果」明说原因，不伪装成「没跑过」
  - 7) 运行成功后让「最近一次留档」立即对齐
