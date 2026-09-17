# STEP 7.5 — IMPLEMENTATION REPORT

## 一、目标与结论

建立「历史状态系统」：`security_id + effective_date + status`，回答「某股票在历史某一天的真实状态」，覆盖 ST / *ST / 退市风险 / 停牌 / 复牌 / 上市 / 退市 / 交易状态，并做到 as-of 查询 + point-in-time 语义 + 无未来泄漏。

**最终判定：PASS（核心契约） / CONDITIONAL PASS（历史 ST 数据覆盖）**

- 历史状态契约、ST 时间线、Trading Status、停牌接口、as-of 查询、point-in-time 语义、测试、迁移状态、报告 → 全部落地。
- 历史 ST / 退市 / 停牌的真实数据**回填**属 CONDITIONAL：依赖 STEP 7.4 的 identity resolver（code→security_id）落地 + 外部历史数据源（BaoStock `history_daily` 的 `isST`/`tradestatus`），本步骤只交付接口与转换适配器，**不伪造覆盖**。

## 二、身份契约依赖（STEP 7.4）

本步骤**依赖而非重实现** STEP 7.4 Security Identity Contract（`server/security/`）：

| 依赖项 | 来源 | 用途 |
| --- | --- | --- |
| `security_id = sec_<uuid>` | `server/security/securityId.ts` | `research_security_status_history.securityId` 的取值契约 |
| `isValidSecurityId` | 同上 | 区间校验 |
| `compareDate` / `addDays` / `isValidIsoDate` | `server/security/dates.ts` | 时间比较 / 加减日 |
| `intervalContains` | `server/security/identifierHistory.ts` | 闭区间生效判定 |
| `SecurityIdResolver`（注入式） | 本步骤声明，7.4 提供实现 | 停牌窗口 code→security_id |

**不实现**：身份解析、security_id 生成规则、代码生命周期/复用规则、上市退市规则、primary security/security-type 规则——全部留给 STEP 7.4。若 identity resolver 未落地，停牌/ST 数据无法入库（Dependency GAP），但契约与接口已就绪。

## 三、产出文件

新增（本步骤自有，未触碰 `server/security/` 等其它 Worker 文件）：

```
server/securityStatus/
  types.ts              状态维度分类法 + 类型（SecurityStatusInterval / Snapshot）
  validation.ts         状态区间校验（纯函数，只报告不修复）
  pointInTime.ts        effective/retrieved 分离 + availability + knowledge date
  timeline.ts           resolveSecurityStatus + isTradable（纯函数内核）
  suspensionAdapter.ts  停牌窗口 → SUSPENSION 区间（注入 7.4 resolver）
  persistence.ts        DB 落库 + getSecurityStatus / isTradable 统一接口
  index.ts              统一出口
  pointInTime.test.ts   11 测试
  timeline.test.ts      18 测试（覆盖 §九 10 项必需用例）

drizzle/schema.ts       + research_security_status_history 表（1 张）
drizzle/0017_security_status_history.sql  手动迁移 DDL
docs/STEP_7.5_*.md      本报告 + 3 份专项报告
```

## 四、状态分类法（5 维，禁止语义混淆）

`status_type`（维度）与各维 `status_value`：

| status_type | 取值 | 语义 |
| --- | --- | --- |
| `LISTING` | `LISTED` / `NOT_YET_LISTED` / `DELISTED` | 上市生命周期 |
| `TRADING` | `TRADING` / `SUSPENDED` / `NOT_YET_LISTED` / `DELISTED` / `UNKNOWN` | 可交易状态（复合） |
| `ST` | `NORMAL` / `ST` / `*ST` | 特别处理（历史状态） |
| `DELISTING` | `NONE` / `AT_RISK` / `DELISTED` | 退市风险 |
| `SUSPENSION` | `SUSPENDED` / `RESUMED` | 停牌/复牌窗口 |

关键原则：
- **不把不同语义混成一个 status**：5 个维度正交，各自独立区间。
- **ST 是历史状态**：绝不 `stock_name.includes("ST")` 作为最终判断；`NORMAL` 也必须是显式记录（无记录 ≠ NORMAL）。
- **UNKNOWN 不默认 TRADING**：`isTradable` 仅当 TRADING 明确解析为 `TRADING` 且未被停牌/未退市时返回 true。

## 五、统一接口

```ts
// 纯函数内核（可测试）
resolveSecurityStatus(intervals, securityId, date, { asOf? }) → SecurityStatusSnapshot
isTradableFromIntervals(intervals, securityId, date, { asOf? }) → boolean
isTradableFromSnapshot(snapshot) → boolean

// DB 统一接口（server/securityStatus/persistence.ts）
getSecurityStatus(securityId, date, { asOf? }) → Promise<SecurityStatusSnapshot>
isTradable(securityId, date, { asOf? }) → Promise<boolean>

// 停牌适配器（注入 7.4 resolver）
suspensionWindowsToStatusIntervals(windows, resolveSecurityId) → { intervals, unresolvedStockCodes }
```

## 六、关键决策

1. **不加 FK**：`securityId` 为 `varchar(48)` 软引用 `research_securities.securityId`，待 7.4 迁移落地后再按需补 FK（避免并发阶段耦合其尚未定稿的 schema）。
2. **不设唯一约束**：允许同一 `(securityId, statusType, effectiveFrom)` 多行（不同 `retrievedAt`/`source` 版本），as-of 取最新/最可信由应用层确定性排序完成。
3. **statusValue 用 varchar**：跨维度取值集合不同（含 `*ST`），枚举校验在应用层（`validation.ts`），与「不伪造」原则一致。
4. **`securityId` 用 varchar(48)**（对齐 7.4 的 `sec_<uuid>`），而非其它并行表误用的 `varchar(20)`。
5. **迁移手动编写**：不跑 `drizzle-kit generate`（避免把并行 Worker 的表一并打包/竞争 journal），不 push、不 reset。

## 七、验证结果

| 项 | 结果 |
| --- | --- |
| `vitest run server/securityStatus` | **29 passed**（timeline 18 + pointInTime 11） |
| `tsc --noEmit`（本步骤文件） | **0 错误**（13 个错误全部来自并行 `server/backtest/`、`server/backfill/` 的进行中文件） |
| `vitest run`（全量） | **1020 passed / 31 failed**；31 失败全在并行 backtest/backfill 文件，本步骤 0 失败、0 新增回归 |
| `npm run build` | **成功**（vite + esbuild） |

## 八、完成标准

- [x] historical status contract
- [x] ST timeline（NORMAL/ST/*ST，历史区间，不回填）
- [x] trading status（TRADING/SUSPENDED/DELISTED/NOT_YET_LISTED/UNKNOWN）
- [x] suspension interface（+ resume，含 155 行窗口适配器）
- [x] as-of query（`resolveSecurityStatus` / `getSecurityStatus`）
- [x] point-in-time semantics（availability + knowledge date + no leakage）
- [x] tests（§九 10 项全覆盖）
- [x] migration status（审计 + 手动 DDL，pending apply，见 MIGRATION 报告）
- [x] reports（4 份）
- [~] 历史 ST / 退市 / 停牌**真实数据覆盖** → **CONDITIONAL PASS**（不伪造）
