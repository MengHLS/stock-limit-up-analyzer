
import type { DiagnosticError } from "@/components/common";


// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/**
 * tRPC / 引擎错误 → 结构化诊断。
 *
 * 引擎的机器可读错误码（`server/researchEngine/types.ts`）在这里被翻译成「下一步该做什么」，
 * 而不是把 `ANALYSIS_FAILED` 直接甩给用户。
 */
const ENGINE_ERROR_HINTS: Record<string, { title: string; explanation: string; suggestions: string[] }> = {
  DATASET_VERSION_NOT_READY: {
    title: "Dataset 版本尚不可用",
    explanation: "只有状态为 READY（或 FAILED/CANCELLED 之外已就绪）的 Dataset 版本才能参与研究。",
    suggestions: ["到「数据集构建」确认该版本状态", "待构建完成后再创建实验"],
  },
  DATASET_VERSION_NOT_FOUND: {
    title: "Dataset 版本不存在",
    explanation: "实验引用的 datasetVersionId 在 Dataset Registry 中查不到。",
    suggestions: ["在「数据集构建」中确认版本是否存在"],
  },
  NO_ANALYSES: {
    title: "Run 下没有任何分析",
    explanation: "引擎需要至少一个分析定义才能执行。",
    suggestions: ["先在本页「分析」页签新建一个分析", "再点击「运行引擎」"],
  },
  UNKNOWN_ANALYSIS_TYPE: {
    title: "分析类型尚未实现",
    explanation:
      "RESEARCH-002 实现了 DESCRIPTIVE / EVENT_STUDY / QUANTILE / CONDITIONAL / STABILITY，"
      + "RESEARCH-004 增加了 SEGMENT_RELATION（分段关系）。",
    suggestions: ["改为上述类型之一", "IC / DISTRIBUTION / PATH / REGIME 尚未实现，当前不支持"],
  },
  WINDOW_OVERLAP: {
    title: "两个时间窗重叠了",
    explanation:
      "分段关系分析里，窗 B 的取值区间与窗 A 有交集 —— 窗 B 的结果里混进了用来分档的那段行情，"
      + "「后一段的表现」会有一部分是前一段的同义反复，相关系数被机械拉高。引擎因此拒绝执行。",
    suggestions: [
      "把窗 B 的起设为窗 A 的止之后（例如 窗 A = T+0..T+5、窗 B = T+5..T+20）",
      "注意锚点日不计入取值：窗 A 的取值是 T+1..T+5，故窗 B 从 T+5 起是合法的",
    ],
  },
  INVALID_ANALYSIS_CONFIG: {
    title: "分析配置不完整",
    explanation: "该分析类型要求的必填项缺失（如 QUANTILE 需要特征变量 + 目标变量 + 分组数）。",
    suggestions: ["检查分析的变量与分组数配置", "重新保存分析后再运行"],
  },
  UNKNOWN_VARIABLE: {
    title: "变量在当前 Dataset 中不存在",
    explanation: "变量目录由 Dataset 的真实视界推导，不会为不存在的视界发明变量。",
    suggestions: ["改为变量目录中实际列出的变量", "注意 outcome 只覆盖 {5,10,20}，而 path 覆盖 1~20"],
  },
  VARIABLE_ROLE_VIOLATION: {
    title: "变量角色用错",
    explanation: "特征变量只能来自 T 日及之前（event / prefix），结果变量只能来自 T+1 及之后（path / outcome）。",
    suggestions: ["把未来收益类变量放到「目标变量」", "把 T 日可观测的变量放到「特征变量」"],
  },
  OBSERVATION_WITHOUT_DECISION_DAY: {
    title: "该数据集没有「决策日」，不能用作观察日条件的判定依据",
    explanation:
      "观察日变量（obs_* / pullback_*）描述的是事件后第 k 个交易日的状态，"
      + "必须有明确的「最早在第几个交易日收盘可判定」才有意义。该 Dataset Version 未声明决策日，"
      + "引擎若放行就只能是「整窗事后回看」——用未来形态筛过去该买的样本，属 look-ahead。",
    suggestions: [
      "改用带「首板回踩」筛选、且已声明决策日 d 的数据集（构建时填写 decisionOffsetDays）",
      "或把该条件换成 T 日及以前可观测的特征变量",
    ],
  },
  INVALID_DECISION_OFFSET: {
    title: "决策日（decisionOffsetDays）取值非法",
    explanation:
      "决策日必须是不小于 1 的整数（在事件后第几个交易日做决策），它决定哪些观察日变量在当时可见。"
      + "写错的决策日不会被忽略——忽略它就等于退回「事后回看」。",
    suggestions: [
      "改成正整数（例如 2 表示在 T+2 判定）",
      "确认它写在 analysis.config / run.config / experiment.config 的同一语义下",
    ],
  },
  DECISION_OFFSET_CONFLICT: {
    title: "决策日有多处互相冲突的声明",
    explanation:
      "分析 / Run / Experiment / 数据集 都可以声明决策日，但它们必须指向同一个值；"
      + "多值并存会让同一份样本被两套信息边界解释，引擎因此拒绝执行。",
    suggestions: [
      "只保留一处声明（推荐放在 experiment.config.decisionOffsetDays）",
      "若数据集已按某个决策日筛过池子，则各层的值必须与它一致",
    ],
  },
  DATASET_TOO_LARGE: {
    title: "样本量超出引擎上限",
    explanation: "引擎不把整份 Dataset 读进内存；超出 maxSamples 会明确拒绝而不是拖垮进程。",
    suggestions: ["缩小 Run 的日期范围", "拆分实验分批研究"],
  },
  EMPTY_SAMPLE_SET: {
    title: "样本集为空",
    explanation: "在选定范围 / 条件下没有任何可用事件。",
    suggestions: ["放宽 Run 的日期范围", "检查是否为条件过严"],
  },
  RUN_NOT_PENDING: {
    title: "该 Run 当前不可执行",
    explanation: "只有 PENDING / FAILED / CANCELLED 状态的 Run 可以重新执行（已 COMPLETED 的 Run 不可覆盖）。",
    suggestions: ["新建一个 Run 再执行"],
  },
  REGIME_PROVIDER_UNAVAILABLE: {
    title: "市场环境维度不可用",
    explanation: "regime 分组需要接入合法的 RegimeTagProvider；当前 Dataset 未提供市场环境列。",
    suggestions: ["改用 year / month / board 等可用维度"],
  },
  ANALYSIS_FAILED: {
    title: "分析执行失败",
    explanation: "失败已如实落到 Run 的 errorCode / errorMessage，可在「运行」页签查看。",
    suggestions: ["查看 Run 的错误码定位原因", "修正后新建 Run 重跑"],
  },
  // ---- RESEARCH-002C：批量建分析 / 分析模板 ----
  BATCH_VALIDATION_FAILED: {
    title: "批量创建预检未通过",
    explanation:
      "预检发现的问题会逐项列出，且**一个分析都没有创建**（不是建了一半）。修正清单里的问题后重试即可。",
    suggestions: ["按提示逐项修正预览清单", "条件分析必须先填好条件（空条件等于全样本）"],
  },
  BATCH_TOO_LARGE: {
    title: "单批数量超限",
    explanation: "单次批量创建有数量上限；一次建太多既难核对，也容易在跨境写入上耗时过久。",
    suggestions: ["拆成多批提交", "或把常用组合存成模板分批铺开"],
  },
  TEMPLATE_NOT_FOUND: {
    title: "模板不存在",
    explanation: "该模板可能已被删除。",
    suggestions: ["刷新模板清单", "重新保存一份模板"],
  },
  TEMPLATE_NAME_CONFLICT: {
    title: "模板名已存在",
    explanation: "模板名全局唯一 —— 「一键铺开」时按名字引用必须不歧义。",
    suggestions: ["换一个模板名", "或先删除同名模板"],
  },
  TEMPLATE_VALIDATION_FAILED: {
    title: "模板内容不合法",
    explanation: "模板必须至少含一个分析，且每个分析的名称、类型、条件都要合法。",
    suggestions: ["检查预览清单里是否有被标出的问题项", "条件分析需要填好条件"],
  },
};

export function rpcErrorToDiagnostic(
  message: string | null | undefined,
  options?: { title?: string; technical?: string },
): DiagnosticError {
  const raw = (message ?? "").trim();
  const technical = options?.technical ?? raw;
  // tRPC 把错误消息序列化为 `<原始 message>`；引擎错误码就在开头的方括号或裸词里。
  const codeMatch = /\[([A-Z_]{3,})\]/u.exec(raw);
  const bareMatch = /^([A-Z][A-Z_]{3,})\b/u.exec(raw);
  const code = (codeMatch?.[1] ?? bareMatch?.[1] ?? "").trim();
  const hint = code ? ENGINE_ERROR_HINTS[code] : undefined;
  if (hint) {
    return {
      code,
      title: options?.title ? `${options.title}：${hint.title}` : hint.title,
      explanation: hint.explanation,
      suggestions: hint.suggestions,
      technical,
    };
  }
  return {
    code: code || "RPC_ERROR",
    title: options?.title ?? "请求失败",
    explanation: raw || "后端未返回可读的错误信息。",
    suggestions: ["重试一次", "若持续失败，查看服务端日志中的原始错误"],
    technical,
  };
}
