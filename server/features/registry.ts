/**
 * STEP 5 — Feature Registry。
 *
 * 约束（与 Strategy Registry 对齐）：
 *   - 同一 feature id 重复注册 → 抛错；
 *   - 查询不存在的 feature id → 抛错；
 *   - 不依赖 Database / Network / Date.now / Math.random；
 *   - 不保存跨实例的可变计算状态。
 */

import type { FeatureFactory, FeatureMetadata } from "./contract";

export class FeatureRegistry {
  private readonly factories = new Map<string, FeatureFactory>();

  /** 注册特征工厂。id 已存在时抛错。 */
  register(factory: FeatureFactory): void {
    const { id } = factory.metadata;
    if (this.factories.has(id)) {
      throw new Error(`Feature 已注册，拒绝重复注册：${id}`);
    }
    this.factories.set(id, factory);
  }

  /** 是否已注册指定 id。 */
  has(id: string): boolean {
    return this.factories.has(id);
  }

  /** 按 id 取工厂；未知 id 抛错。 */
  get(id: string): FeatureFactory {
    const factory = this.factories.get(id);
    if (!factory) {
      throw new Error(`未注册的 Feature：${id}`);
    }
    return factory;
  }

  /** 列出全部 feature 元数据（按 id 字典序稳定排序）。 */
  list(): FeatureMetadata[] {
    return Array.from(this.factories.values())
      .map((factory) => ({ ...factory.metadata }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** 便捷：取工厂并按参数创建实例。 */
  create(id: string, params?: Record<string, number>): ReturnType<FeatureFactory["create"]> {
    return this.get(id).create(params);
  }
}

/** 全系统单例注册中心（仅保存工厂定义，无任何计算状态）。 */
export const featureRegistry = new FeatureRegistry();
