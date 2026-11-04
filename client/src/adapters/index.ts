/**
 * Frontend Adapter barrel（任务 §17）。
 *
 * API Response → Adapter → ViewModel → UI。
 * UI 不直接依赖复杂后端 Contract，只消费这些 ViewModel。
 */

export * from "./strategyAdapter";
export * from "./runResultAdapter";
export * from "./datasetRegistryAdapter";
