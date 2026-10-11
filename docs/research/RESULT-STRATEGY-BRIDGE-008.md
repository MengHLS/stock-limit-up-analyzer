# RESULT-STRATEGY-BRIDGE-008 · 正式 Backtest 首次实际启动（**Goal round 7**）

> 🔴 **NON-PLATFORM-FORMAL-RUN**（**cursor 已真实构造，未产出 Run**）· **零数据库写入** · **零业务代码改动**
> Dataset **`780004`** · HEAD **`f8b6810`** · Goal round **7/256**

---

## 0. 本轮结论

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✅ **cursor 路径【实测跑通】**（首次真实构造 event-window cursor）                                       │
│                                                                                                      │
│   [cursor] 构造完成 6.0s                                                                              │
│   stats: { eventCount: 58983, tradingDayCount: 1750,                                                  │
│            datasetVersion: "rd-1.0.0-1-b7a3a34529cdaeba",                                             │
│            observationWindow: { start: 15, end: 55, unit: "TRADING_DAY" },                            │
│            🔴 maxRelativeDay: 56,          ← BRIDGE-007 解法【实测验证】                                │
│            contentSource: "TiDB 直读" }                                                                │
│                                                                                                      │
│  ⇒ `maxRelativeDay = 56` ⇒ **rd55（F40 出场日）确已覆盖** ✓                                            │
│  ⇒ 58,983 事件 · 1,750 交易日 · 6.0s 构造（流式，不物化）                                                │
│                                                                                                      │
│  🔴 **同时发现并修正一项前置结论**：                                                                     │
│     轻量 `dataset` 的 **`rows = 0`**（设计为「兼容装配摘要」）⇒ **不能喂给 `runCandidateEngine`**            │
│     ⇒ **`BRIDGE-006` 前置② 的表述需修正**：候选引擎侧**必须使用 cursor**（非轻量 dataset）                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. FACT · 实测证据

### 1.1 ✅ cursor 构造成功（**首次实跑**）

```
=== Variant 正式 Backtest · cursor 路径 ===
  datasetVersionId = 780004 · 区间 2019-01-03 ~ 2025-09-26
  [cursor] 构造完成 6.0s
  stats   : {"eventCount":58983,"tradingDayCount":1750,
             "datasetVersion":"rd-1.0.0-1-b7a3a34529cdaeba",
             "observationWindow":{"start":15,"end":55,"unit":"TRADING_DAY"},
             "maxRelativeDay":56,"contentSource":"TiDB 直读"}
  轻量 dataset: rows=0 · gate=PASS · version=rd-1.0.0-1-b7a3a34529cdaeba
```

| 观察 | 判定 |
|---|---|
| **`maxRelativeDay = 56`** | ✅ **`BRIDGE-007` 的 `maxRd = endRd + 1` 推导实测成立** ⇒ rd55 覆盖 |
| `eventCount = 58,983` | ✅ 与 Dataset 780004 元数据**完全一致** |
| `tradingDayCount = 1,750` | ✅ |
| `contentSource = "TiDB 直读"` | ✅ 真实读库（非快照） |
| 构造耗时 **6.0 s** | ✅ **流式**（未物化 10.32M 行） |
| `datasetVersion` | `rd-1.0.0-1-b7a3a34529cdaeba`（内容寻址，与 `750001` 的 v7 不同 ⇒ **本 Variant 绑定 780004 正确**） |

### 1.2 🔴 发现并修正：轻量 `dataset` **`rows = 0`**

```
FATAL: CandidateEngineError: 候选引擎：决策日 2019-01-03 为交易日但日期切片内无任何行，
       数据集在该日缺失（禁止以部分数据运行）
    at runCandidateEngine (…/signalEngine/engine.js:126)
```

| 事实 | 说明 |
|---|---|
| `built.dataset.rows.length === 0` | 轻量 dataset 是 **「兼容装配摘要 / 策略定义的轻量数据集」**（`BRIDGE-006` §2 引用的文件头原文）⇒ **无行情行** |
| `runCandidateEngine({ dataset })` 需要逐日行 | ⇒ **拒绝运行**（`禁止以部分数据运行` —— 平台的 FAIL LOUD 行为正确） |
| 🔴 **修正** | **`BRIDGE-006` 前置② 的表述不准确**：轻量 `dataset` **只服务「装配摘要 / 策略定义」**，**不能服务候选引擎** ⇒ **候选引擎侧必须走 cursor 路径** |

### 1.3 环境注入（工程细节，已解决）

🔴 编译产物（CJS）中 `import` 在**文件顶部**变成 `require` ⇒ 我的代码执行前模块已初始化 ⇒ **`.env` 必须由 wrapper 在 `require` 之前注入**。
已实现 `scripts/_scratch/runWithEnv.cjs`（把 `.env` 注入 `process.env` 后再 `require` 目标）⇒ `[env] 已注入 10 个变量（DATABASE_URL 存在=true）` ✓

**另**：CJS 编译需两处适配（**仅作用域为 `%TEMP%` 构建产物，非仓库代码**）：
1. 构建目录加 `{"type":"commonjs"}` 的 `package.json`
2. `server/datasetRegistry/snapshot/taskManager.js` 的 `import.meta.url` 替换为 `require("node:url").pathToFileURL(__filename).href`（ESM 专有构造，CJS 下不可用）

---

## 2. NOT PROVEN

| # | 未证明 |
|---|---|
| **N1** | ❌ **两个 Variant 的正式 Backtest 仍未完成** —— 阻塞于候选引擎的 **cursor 版入口**（§1.2） |
| **N2** | ⚠️ `runCandidateEngine` 是否存在 cursor 版（如 `runCandidateEngineFromCursor`）—— **下一轮勘定** |
| **N3** | ⚠️ 候选引擎 + simulator 的**端到端耗时**（cursor 构造 6.0s 已知；候选引擎与模拟未跑） |
| **N4** | ⚠️ 数据集 `canSellAtClose` ↔ 引擎板价判定的逐事件一致性（`BRIDGE-004` D2） |
| **N5** | ⚠️ `EQUAL_WEIGHT` + `maxPositions=180` 是否逐笔等于 `w = 1/180` |
| **N6** | ❌ OOS / WFA / 冲击成本 / `(A) 年度口径缺陷` |
| **N7** | ⚠️ **D1 口径差异**（`TIME_EXIT` 成交于 rd56 `open`）须在回测报告中显式标注 |

---

## 3. 合规声明

✅ **零业务代码改动** · ✅ **零数据库写入**（**只读** TiDB 直读）· ✅ **未产出 Run / 未创建 Candidate / Strategy Version** · ✅ **未跑 OOS / WFA** · ✅ **未做权重/仓位/TopN/参数搜索** · ✅ **未修改 3570001 / 既有因子定义 / Schema / Migration / Dataset** · ✅ 新增文件仅落 `scripts/_scratch/`（gitignore）

---

## 4. 下一步（**Goal 保持 active**）

```text
1. 勘定 runCandidateEngine 的 cursor 版入口（或用 cursor 逐日喂候选引擎）
2. 两个 Variant 跑正式 Backtest（2019-01-03 ~ 2025-09-26 · 20bps）
   · D1 口径差异（rd56 open 成交）须显式标注
3. 据结果决定是否进入 OOS / WFA
```

**本轮在此停止，Goal 继续。**