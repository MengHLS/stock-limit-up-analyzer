# P1-T3 验收 — Industry securityId 关联回填

## 验收标准（来自 MASTER_TASK_TRACKING）
> securityId 非 NULL（A4）。

## 逐项判定

| 项 | 标准 | 实际 | 判定 |
|----|------|------|------|
| 关联回填 | securityId 从 NULL 回填为永久身份 | 5212/5212 全回填（null 5212→0） | ✅ |
| 映射确定性 | 无 code 映射到多 securityId | 歧义校验 0 个 | ✅ |
| 引用完整性 | industry.securityId 都能在 securities 找到 | 孤儿引用 0 | ✅ |
| 幂等 | 重跑不产生错误重复 | 重跑 affectedRows=0，直接跳过 | ✅ |
| Gate 联动 | G1 的 securityId 维度翻转 | `industrySecurityIdNull` 5212→0（gate JSON 实查） | ✅ |

## 结论
**VALIDATED**。industry_assignments.securityId 已 100% 关联到永久身份，映射确定性 + 引用完整性 + 幂等性均验证通过。G1 的 securityId 缺口已消除；剩余 G1 缺口为 effectiveFrom 单点（P1-T4 历史 PIT）。
