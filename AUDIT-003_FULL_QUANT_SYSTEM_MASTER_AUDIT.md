**不要马上让它执行 T1～T13 全部任务**。

应该先让它根据这份 AUDIT-003 建立一个新的：

# `QUANT-ROADMAP-001`

它负责：

1. 接收 AUDIT-003；
2. 把所有问题转成任务；
3. 建立依赖关系；
4. 建立阶段 Gate；
5. 建立执行顺序；
6. 判断哪些任务可以并行；
7. 禁止跨阶段开发；
8. 每完成一个阶段必须生成 Validation Evidence；
9. 最终维护一个唯一 Roadmap。

特别是把：

```
CODE_READY
```

和：

```
VALIDATED
```

严格分开。

审计报告已经明确指出，当前 44 个 research 测试文件、约 1,191 个测试案例主要都是 synthetic fixture；真实数据 E2E 为 **0**。

所以以后 WorkBuddy 的任务状态最好统一成：

```
PLANNED
↓
IMPLEMENTING
↓
CODE_READY
↓
REAL_DATA_SMOKE
↓
VALIDATED
↓
CERTIFIED
```

而不是：

```

DONE
```










