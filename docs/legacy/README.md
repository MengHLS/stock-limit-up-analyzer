# `docs/legacy/` —— 根目录非 `_*` 文件的归档（2026-09-13）

> **这是什么**：原本散落在仓库根目录的 **14 个非 `_*` 文件**（阶段报告 / 路线图 / 验收 JSON / 示例脚本），
> 于 2026-09-13 归入本目录。与 `docs/evidence/`（同日归位的 85 个 `_*` 证据探针）**是同一批清理的两半**，
> 改动集互不重叠：`docs/evidence/` 收 `_*`，本目录收非 `_*`。

## 为什么归位

根目录文件数当时为 **131 个**，其中 `_*` 占 96 个、另有一批早期阶段的 `.md` / `.json` 报告。
本批只做**移动**（`git mv`），**零删除**，因此全部可通过 git 一键回滚。

## 文件索引（14 项）

| 文件 | 归位前位置 | 说明 |
|---|---|---|
| `API_UPLOAD_INTERFACE_GUIDE.md` | 根目录 | 上传接口指南。内文引用 **已废弃的 `manus.computer` 平台** ⇒ 归 `legacy` 语义正确 |
| `LOCAL_UPLOAD_DEBUGGING_GUIDE.md` | 根目录 | 同上，引用 `manus.computer` |
| `LLM_RECOGNITION_PROMPT.md` | 根目录 | LLM 识别提示词（早期方案） |
| `IMPROVEMENTS.md` | 根目录 | 早期改进清单 |
| `MARKET_DATA_API_GUIDE.md` | 根目录 | 行情数据 API 指南 |
| `QUANT-ROADMAP-001.md` | 根目录 | 量化路线图（已被 `ROADMAP.md` 取代） |
| `AUDIT-003_FULL_QUANT_SYSTEM_MASTER_AUDIT.md` | 根目录 | 阶段审计报告 |
| `FINAL_PRODUCTIZATION_STATUS_REPORT.md` | 根目录 | 产品化状态报告 |
| `STEP_12_HISTORICAL_DATASET_PRODUCTION_BACKFILL_REPORT.md` | 根目录 | STEP 12 回填报告 |
| `upload_script_example.py` | 根目录 | 上传示例脚本（被上述 3 篇指南引用，同步归位以保住相对引用） |
| `home-interaction-performance.json` | 根目录 | 首页交互性能验收数据 |
| `preview-interaction-acceptance.json` | 根目录 | 预览交互验收数据 |
| `real-recognition-acceptance.json` | 根目录 | 真实识别验收数据 |
| `search-date-interaction-acceptance.json` | 根目录 | 搜索日期交互验收数据 |

## 回滚方式（全批可逆）

```bash
# 全部还原到根目录（本批以 git mv 执行 ⇒ git 记为 R，可直接撤销）
git checkout -- \
  API_UPLOAD_INTERFACE_GUIDE.md LOCAL_UPLOAD_DEBUGGING_GUIDE.md LLM_RECOGNITION_PROMPT.md \
  IMPROVEMENTS.md MARKET_DATA_API_GUIDE.md QUANT-ROADMAP-001.md \
  AUDIT-003_FULL_QUANT_SYSTEM_MASTER_AUDIT.md FINAL_PRODUCTIZATION_STATUS_REPORT.md \
  STEP_12_HISTORICAL_DATASET_PRODUCTION_BACKFILL_REPORT.md upload_script_example.py \
  home-interaction-performance.json preview-interaction-acceptance.json \
  real-recognition-acceptance.json search-date-interaction-acceptance.json
```

## ⚠️ 待裁定的不一致（如实登记，未单方面处置）

其中 **5 篇面向人**的指南（`API_UPLOAD_INTERFACE_GUIDE` / `LOCAL_UPLOAD_DEBUGGING_GUIDE` /
`LLM_RECOGNITION_PROMPT` / `IMPROVEMENTS` / `MARKET_DATA_API_GUIDE`）被移入本目录，
与**同日另一会话**技能里「面人类根级文档默认保留在根目录」的约定不一致
（该约定见用户级技能 `stock-limit-up-repo-cleanup` 收尾段；该会话已如实登记并明确「归属本批、未干预」）。

- 其中 `API_UPLOAD_INTERFACE_GUIDE.md` / `LOCAL_UPLOAD_DEBUGGING_GUIDE.md` 内文指向**已废弃的
  `manus.computer` 平台** ⇒ 留在 `legacy/` 语义正确。
- 其余 3 篇是否算「仍面向人的当前指南」**待用户裁定**：可留本目录、可提到 `docs/`、也可还原根目录。

## 相关

- `docs/evidence/README.md` —— 同批 `_*` 证据探针的归位索引（85 项，含「旧文档裸文件名一律指向本目录」的路径约定）。
- `.workbuddy/memory/2026-09-13.md` —— 两半清理的完整登记（含并行会话交叉记录）。
