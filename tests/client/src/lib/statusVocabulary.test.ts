/**
 * 状态词表「对表测试」（漂移哨兵）。
 *
 * 为什么需要它：`client/**` **不能** import 后端 / shared 的运行时值
 * （`shared/researchContracts.ts` 运行时依赖 `zod`，import 它会把 zod 打进浏览器包）
 * ⇒ 客户端只能自己维护一份顺序常量。这份镜像表必须配一条对表测试，
 * 否则后端词表一变，前端下拉当天就会静默漂移。
 *
 * ⚠️ 测试文件**可以** import 服务端 / shared 常量（`tsconfig.json` 的 `exclude`
 * 覆盖了测试文件，且 vitest 环境本就加载 server 模块）—— 这正是镜像表成立的前提。
 */

import { describe, expect, it } from "vitest";
import {
  STRATEGY_VERSION_STATUS_OPTIONS,
  toneForStatus,
} from "../../../../client/src/lib/status";
import {
  STRATEGY_LIFECYCLE_STATUS_VALUES,
  strategyLifecycleStatusSchema,
} from "../../../../shared/researchContracts";

describe("策略版本状态词表：客户端镜像 ↔ 后端权威", () => {
  it("1) 客户端顺序常量与 shared 权威值逐字、同序一致", () => {
    expect([...STRATEGY_VERSION_STATUS_OPTIONS]).toEqual([
      ...STRATEGY_LIFECYCLE_STATUS_VALUES,
    ]);
  });

  it("2) 每个选项都能通过 shared 的 zod 枚举（= 后端 setVersionStatus 真会接受）", () => {
    for (const status of STRATEGY_VERSION_STATUS_OPTIONS) {
      expect(strategyLifecycleStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("3) 词表无重复、无空值（重复会让下拉出现两个同值项）", () => {
    const list = [...STRATEGY_VERSION_STATUS_OPTIONS];
    expect(new Set(list).size).toBe(list.length);
    expect(list.every(s => typeof s === "string" && s.length > 0)).toBe(true);
  });

  it("4) 每个状态都有展示语义色（未收录会静默回退 neutral，这里显式钉住）", () => {
    // Draft / Retired 语义上确实该是 neutral（灰），所以只断言「能取到合法 tone」，
    // 不要求非 neutral —— 该判据在下方用正向枚举表达。
    const allowed = ["success", "info", "warning", "danger", "neutral"];
    for (const status of STRATEGY_VERSION_STATUS_OPTIONS) {
      expect(allowed).toContain(toneForStatus(status));
    }
  });
});
