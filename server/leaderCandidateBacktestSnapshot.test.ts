import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MAX_FILES,
  LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MIN_BYTES,
  clearLeaderCandidateBacktestSnapshots,
  clearLeaderCandidateBacktestSnapshotsSync,
  readLeaderCandidateBacktestSnapshot,
  writeLeaderCandidateBacktestSnapshot,
} from "./leaderCandidateBacktestSnapshot";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lc-snapshot-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    clearLeaderCandidateBacktestSnapshotsSync({ dir });
  }
});

/** 造一个超过落盘阈值的载荷（≈1MB，确保高于 MIN_BYTES）。 */
function bigPayload(tag: string) {
  return { tag, rows: Array.from({ length: 20000 }, (_unused, index) => ({ index, value: `${tag}-${index}` })) };
}

describe("回测结果磁盘快照", () => {
  it("写入后可原样读回（大结果才落盘）", async () => {
    const dir = tempDir();
    const payload = bigPayload("a");
    const write = await writeLeaderCandidateBacktestSnapshot("key1", payload, { dir, now: 1_000 });
    expect(write.written).toBe(true);
    expect(write.bytes).toBeGreaterThanOrEqual(LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MIN_BYTES);
    expect(readdirSync(dir)).toEqual(["key1.json"]);

    const read = await readLeaderCandidateBacktestSnapshot<typeof payload>("key1", { dir, now: 2_000 });
    expect(read?.payload).toEqual(payload);
    expect(read?.savedAt).toBe(1_000);
  });

  it("小结果不落盘（收益低于 IO 成本）", async () => {
    const dir = tempDir();
    const write = await writeLeaderCandidateBacktestSnapshot("small", { rows: [] }, { dir, now: 1_000 });
    expect(write.written).toBe(false);
    expect(write.bytes).toBeLessThan(LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MIN_BYTES);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("TTL 过期视为未命中", async () => {
    const dir = tempDir();
    await writeLeaderCandidateBacktestSnapshot("key1", bigPayload("a"), { dir, now: 1_000 });
    const fresh = await readLeaderCandidateBacktestSnapshot("key1", { dir, ttlMs: 500, now: 1_400 });
    expect(fresh).not.toBeNull();
    const expired = await readLeaderCandidateBacktestSnapshot("key1", { dir, ttlMs: 500, now: 1_600 });
    expect(expired).toBeNull();
  });

  it("key 不匹配视为未命中（不同参数不得互相复用）", async () => {
    const dir = tempDir();
    await writeLeaderCandidateBacktestSnapshot("key1", bigPayload("a"), { dir, now: 1_000 });
    const other = await readLeaderCandidateBacktestSnapshot("key2", { dir, now: 1_100 });
    expect(other).toBeNull();
  });

  it("版本不一致视为未命中", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "key1.json"), JSON.stringify({
      version: 999,
      key: "key1",
      savedAt: Date.now(),
      payload: bigPayload("a"),
    }), "utf8");
    const read = await readLeaderCandidateBacktestSnapshot("key1", { dir, now: Date.now() });
    expect(read).toBeNull();
  });

  it("损坏 JSON / 缺失文件静默降级，不抛异常", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "broken.json"), "{not json", "utf8");
    await expect(readLeaderCandidateBacktestSnapshot("broken", { dir })).resolves.toBeNull();
    await expect(readLeaderCandidateBacktestSnapshot("missing", { dir })).resolves.toBeNull();
  });

  it("payload 非对象视为未命中（防半截写入）", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "key1.json"), JSON.stringify({ version: 1, key: "key1", savedAt: Date.now(), payload: null }), "utf8");
    await expect(readLeaderCandidateBacktestSnapshot("key1", { dir, now: Date.now() })).resolves.toBeNull();
  });

  it("清空删除全部快照文件（写入路径失效语义）", async () => {
    const dir = tempDir();
    await writeLeaderCandidateBacktestSnapshot("key1", bigPayload("a"), { dir, now: 1_000 });
    await writeLeaderCandidateBacktestSnapshot("key2", bigPayload("b"), { dir, now: 1_000 });
    expect(readdirSync(dir).length).toBe(2);
    const removed = clearLeaderCandidateBacktestSnapshotsSync({ dir });
    expect(removed).toBe(2);
    expect(readdirSync(dir)).toEqual([]);
    await expect(readLeaderCandidateBacktestSnapshot("key1", { dir })).resolves.toBeNull();
  });

  it("异步清空同样生效，目录不存在时不抛异常", async () => {
    const dir = tempDir();
    await writeLeaderCandidateBacktestSnapshot("key1", bigPayload("a"), { dir, now: 1_000 });
    await expect(clearLeaderCandidateBacktestSnapshots({ dir })).resolves.toBe(1);
    await expect(clearLeaderCandidateBacktestSnapshots({ dir: join(dir, "not-exists") })).resolves.toBe(0);
    expect(clearLeaderCandidateBacktestSnapshotsSync({ dir: join(dir, "not-exists") })).toBe(0);
  });

  it("超过上限时淘汰最旧快照", async () => {
    const dir = tempDir();
    const total = LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MAX_FILES + 2;
    for (let index = 0; index < total; index += 1) {
      await writeLeaderCandidateBacktestSnapshot(`key${index}`, bigPayload(`p${index}`), { dir, now: 1_000 + index });
    }
    const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(files.length).toBe(LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MAX_FILES);
    // 最新写入的必须仍在。
    expect(files).toContain(`key${total - 1}.json`);
    expect(files).not.toContain("key0.json");
  });

  it("写入不遗留 .tmp 临时文件", async () => {
    const dir = tempDir();
    await writeLeaderCandidateBacktestSnapshot("key1", bigPayload("a"), { dir, now: 1_000 });
    await writeLeaderCandidateBacktestSnapshot("key1", bigPayload("b"), { dir, now: 2_000 });
    expect(readdirSync(dir)).toEqual(["key1.json"]);
    const read = await readLeaderCandidateBacktestSnapshot<{ tag: string }>("key1", { dir, now: 2_100 });
    expect(read?.payload.tag).toBe("b");
  });
});
