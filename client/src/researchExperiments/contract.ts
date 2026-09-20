/**
 * RESEARCH-EXPERIMENT-001 — 前端页面契约（**页面作者唯一需要遵守的接口**）。
 *
 * ## 平台与页面的分工（规格 §7）
 *
 * 平台（`pages/researchExperiments/ExperimentDetail.tsx`）负责提供最小的东西：
 *
 * | 平台提供 | 页面提供 |
 * | --- | --- |
 * | 实验元数据（name / version / description / 参数定义） | 结果怎么画 |
 * | Dataset 版本选择器 + 参数表单（由参数定义自动渲染） | 自定义表格 / 图表 / 多维比较 |
 * | 「运行」动作 + 执行状态（loading / pending 文案） | 统计解释与自定义研究说明 |
 * | 错误状态（领域码 + 消息） | 样本详情与自定义研究结构 |
 * | 执行元数据（耗时 / Dataset 坐标 / 参数回显） | —— |
 *
 * ## 为什么页面**不自己发请求**
 *
 * 「实验怎么跑」在服务端只有一套（Registry + Runner）。若让每个页面自己 fetch，
 * 就会立刻出现第二套执行入口 —— 而那些入口无法共享参数校验、Dataset 校验与结果校验。
 * 因此页面拿到的是**平台已经跑完的结果**，它只负责「把结果讲清楚」。
 */

import type { ExperimentDescriptor, ExperimentRunOutcome } from "@shared/researchExperimentsContracts";
import type { ComponentType } from "react";

/** 实验页面收到的全部 props（**没有别的**）。 */
export interface ExperimentPageProps {
  /** 实验描述符（含参数定义 / Dataset 需求；平台已加载）。 */
  descriptor: ExperimentDescriptor;
  /**
   * 最近一次执行结果。
   *
   * `null` = 本次会话尚未运行过（**不是**「运行了但没结果」——
   * 执行失败的场景下 `outcome` 非空且 `outcome.error` 有值、`outcome.result` 为 null）。
   */
  outcome: ExperimentRunOutcome | null;
}

/** 实验页面组件类型。 */
export type ExperimentPageComponent = ComponentType<ExperimentPageProps>;
