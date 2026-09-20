/**
 * 独立研究实验体系 · 前端公共面。
 *
 * 组成：
 *   - `./contract`   页面契约（`ExperimentPageProps` / `ExperimentPageComponent`）
 *   - `./pages`      页面注册表（pageKey → 组件）
 *
 * 消费方（`@/pages/researchExperiments/*`）从这里导入，不要直连子文件，
 * 以便将来调整目录时不改调用点。
 */

export type { ExperimentPageComponent, ExperimentPageProps } from "./contract";
export { EXPERIMENT_PAGES, experimentPageOf } from "./pages";
