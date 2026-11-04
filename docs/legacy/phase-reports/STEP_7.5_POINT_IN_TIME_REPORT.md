# STEP 7.5 — POINT-IN-TIME REPORT

## 一、结论

**PASS。** point-in-time 语义完整落地：明确区分 `effective`（状态何时为真）与 `retrieved`（何时写入系统），通过 `availability` 建模「可知时点」，as-of 查询保证**无未来泄漏**，`UNKNOWN` 发布时点不擅自假设 T+1。

## 二、effective_date ≠ retrieved_at

每个状态区间携带两个正交时间：

| 字段 | 语义 |
| --- | --- |
| `effectiveFrom` / `effectiveTo` | 状态在真实世界何时为真（闭区间，null=至今） |
| `retrievedAt` | 我们何时把这条状态写入系统（可为 null） |
| `availability` | 这条状态「最早何时可被观察到」的建模 |

**禁止**把 `retrieved_at` 当作 `effective_date`，也**禁止**认为两者相等。

## 三、availability 模型

| availability | 可知日（knowledge date） |
| --- | --- |
| `IMMEDIATE` | `effectiveFrom` 当日（如上市/退市公告当日） |
| `T_PLUS_1` | `effectiveFrom` 次一自然日 |
| `UNKNOWN` | 若有 `retrievedAt` → 取其日期；否则 `null`（不可用于 as-of 推理） |

当来源发布时间未知时置 `UNKNOWN`，**不强行设置 T+1**（§八要求）。

## 四、核心函数

```ts
isEffectiveOn(interval, date)      // 闭区间生效判定（复用 7.4 intervalContains）
statusKnowledgeDate(interval)      // 最早可知日
isKnowableBy(interval, asOf)       // 在 asOf 时点是否已可知（无未来泄漏）
```

## 五、无未来泄漏保证

- `resolveSecurityStatus(intervals, securityId, date, { asOf })`：当 `asOf` 提供时，只纳入 `isKnowableBy(interval, asOf)` 为真的区间。
- 测试：`T_PLUS_1` 状态在生效日 `asOf=当日` → 维度 unknown；`asOf=次日` → 解析到该状态。
- `asOf=null` = 全知视角（当前查询），不排除未来可知状态。

## 六、as-of 查询语义

`getSecurityStatus(securityId, date, { asOf })` 返回 `SecurityStatusSnapshot`：

```ts
{
  securityId, date, asOf,
  resolved: Partial<Record<StatusType, ResolvedStatusValue>>,  // 仅「有已知数据」的维度
  unknownDimensions: StatusType[]                                // 无数据的维度（不默认填充）
}
```

- 无数据的维度进入 `unknownDimensions`，**不默认填充**（ST 不默认 NORMAL，TRADING 不默认 TRADING）。
- 多区间同时生效时，按 `effectiveFrom 最新 → confidence 最高 → retrievedAt 最新 → source 字典序` 确定性取一。

## 七、测试覆盖

- IMMEDIATE / T_PLUS_1（跨月、跨年）/ UNKNOWN（有/无 retrievedAt）四路可知日。
- `asOf` 早于/等于/晚于可知日三态。
- `UNKNOWN` 且无 `retrievedAt` 任何 `asOf` 均不可知。
- `asOf=null` 不排除未来状态。
- 生效日/失效日闭区间边界。

## 八、完成标准

- [x] effective 与 retrieved 分离
- [x] availability 模型（IMMEDIATE/T_PLUS_1/UNKNOWN）
- [x] UNKNOWN 不默认 T+1
- [x] as-of 查询
- [x] 无未来泄漏（§九 第 10 项）
