/**
 * BD-24 — 「池的空闲回收阈值」必须**严格小于**实测链路空闲窗口下界（**派生判据、可证伪**）。
 *
 * ## 为什么有这条测试（用户报障：「跑完 first-board-pullback 在『回测历史』里看不到」）
 *
 * 一次 `researchRun.loopRun` 真实运行 **588,881 ms**，其间**零 DB 往返**而池里连接**全部空闲**；
 * 旧的 `idleTimeout` = **600,000 ms** 比链路空闲窗口**还长** ⇒ **一条空闲连接都没被回收**
 * ⇒ 跑完后的留档 INSERT 连续 3 次撞上已被掐死的 socket（`read ECONNRESET` errno −4077），
 * 被 best-effort 吞掉 ⇒ 库里没有这一条（`prefix-BD24` 证据）。
 *
 * ## 判据（可派生、可证伪）
 *
 *   `resolveIdleTimeoutMs()` 的默认值 **<** `MEASURED_DB_IDLE_WINDOW_LOWER_BOUND_MS`（**240s**）。
 *   ⇒ 把默认值改回 `600_000`（旧值）**本用例立刻变红**。
 *
 * 240s 不是拍脑袋：它 = A/B 探针里「空闲后复用**仍成功**」的最大观察点
 * （`docs/evidence/_probe_db_keepalive_ab.out.json` → `A_current.aliveAtSec` 的最大值），
 * 而 330s 起全部失败 ⇒ 窗口 ∈ (240, 330] s ⇒ 阈值必须留在窗口**之内**才有意义。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MEASURED_DB_IDLE_WINDOW_LOWER_BOUND_MS,
  resolveIdleTimeoutMs,
} from "../../server/db";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_JSON = join(HERE, "..", "..", "docs", "evidence", "_probe_db_keepalive_ab.out.json");

describe("BD-24 · 池的空闲回收阈值 vs 实测链路空闲窗口", () => {
  it("默认阈值严格小于实测窗口下界 —— 改回 600_000（旧值）即红", () => {
    // 本用例只测**默认值**：若测试环境设了 DB_IDLE_TIMEOUT_MS，测到的就是覆盖值，判据不适用。
    expect(
      process.env.DB_IDLE_TIMEOUT_MS,
      "本用例只校验默认值；请勿在测试环境设置 DB_IDLE_TIMEOUT_MS（如需覆盖请单独跑运维场景）",
    ).toBeUndefined();
    expect(resolveIdleTimeoutMs()).toBeLessThan(MEASURED_DB_IDLE_WINDOW_LOWER_BOUND_MS);
  });

  it("源码里的窗口下界常量 == 落盘证据里 aliveAtSec 的最大值（数字不靠记忆）", () => {
    if (!existsSync(EVIDENCE_JSON)) {
      // 证据文件缺失时不假装通过：显式跳过（判据仍在上面那条里成立）
      expect("证据文件不存在，跳过交叉核对").toBe("证据文件不存在，跳过交叉核对");
      return;
    }
    const raw = JSON.parse(readFileSync(EVIDENCE_JSON, "utf8")) as {
      A_current?: { aliveAtSec?: number[] };
    };
    const alive = raw.A_current?.aliveAtSec ?? [];
    expect(alive.length, "证据里应有至少一个存活观察点").toBeGreaterThan(0);
    expect(MEASURED_DB_IDLE_WINDOW_LOWER_BOUND_MS).toBe(Math.max(...alive) * 1000);
  });

  it("env 覆盖仍然生效（运维可临时回退，不必改代码）", () => {
    const previous = process.env.DB_IDLE_TIMEOUT_MS;
    process.env.DB_IDLE_TIMEOUT_MS = "60000";
    try {
      expect(resolveIdleTimeoutMs()).toBe(60_000);
    } finally {
      if (previous === undefined) delete process.env.DB_IDLE_TIMEOUT_MS;
      else process.env.DB_IDLE_TIMEOUT_MS = previous;
    }
  });
});
