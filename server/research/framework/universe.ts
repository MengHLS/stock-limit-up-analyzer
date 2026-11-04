/**
 * STEP 10 — UniverseProvider 参考实现。
 *
 * Universe 必须支持 as-of 日期，禁止读取「当前」股票列表：
 *   - StaticUniverseProvider：固定成员集合（与日期无关，用于演示/测试）；
 *   - MapUniverseProvider：显式的「日期 → 成员」映射，按 as-of 返回，缺失即 FAIL FAST，
 *     绝不回退到当前股票列表。
 */

import type { UniverseProvider } from "./contract";

/** 固定成员集合的 Universe（不随 as-of 变化）。 */
export class StaticUniverseProvider implements UniverseProvider {
  readonly universeId: string;
  private readonly members: readonly string[];

  constructor(universeId: string, members: readonly string[]) {
    if (!universeId || universeId.trim() === "") {
      throw new Error("StaticUniverseProvider: universeId 不能为空");
    }
    this.universeId = universeId;
    this.members = Object.freeze(Array.from(new Set(members)).sort());
  }

  getUniverse(): readonly string[] {
    return this.members;
  }
}

/** 显式「日期 → 成员」映射的 Universe，按 as-of 日期返回。 */
export class MapUniverseProvider implements UniverseProvider {
  readonly universeId: string;
  private readonly membersByDate: ReadonlyMap<string, readonly string[]>;

  constructor(universeId: string, membersByDate: Readonly<Record<string, readonly string[]>>) {
    if (!universeId || universeId.trim() === "") {
      throw new Error("MapUniverseProvider: universeId 不能为空");
    }
    this.universeId = universeId;
    const map = new Map<string, readonly string[]>();
    for (const [date, members] of Object.entries(membersByDate)) {
      map.set(date, Object.freeze(Array.from(new Set(members)).sort()));
    }
    this.membersByDate = map;
  }

  getUniverse(asOfDate: string): readonly string[] {
    const members = this.membersByDate.get(asOfDate);
    if (!members) {
      throw new Error(`MapUniverseProvider(${this.universeId}): 无 ${asOfDate} 的成员定义，禁止回退到当前股票列表`);
    }
    return members;
  }
}
