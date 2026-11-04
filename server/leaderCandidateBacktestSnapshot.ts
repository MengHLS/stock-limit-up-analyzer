/**
 * 龙头候选回测结果的**磁盘快照缓存**（性能层，不含任何业务语义）。
 *
 * 背景（2026-09-11 实测）：全区间回测在跨境 TiDB 上需要 ≈305s，其中 ≈196s 花在
 * 拉取 1,524,646 行 `stock_daily_prices`（99,577 条涨停记录 × ±44 天窗口的并集）
 * 上；`backtestResultCache` 虽有 30 分钟 TTL，但进程重启即失效，且 30 分钟后
 * 再次打开页面要重新等 5 分钟 —— 页面表现为「卡住、无法渲染」。
 *
 * 本模块把已算出的结果落盘，让「重算」只发生在数据真的变化时：
 *   · 命中判定：key（参数稳定哈希）一致 + 快照年龄 <= TTL；
 *   · 失效：① TTL（默认 6h，兜住绕过服务端的脚本回填）；
 *           ② 涨停记录 / 日线行情写入时 `clearLeaderCandidateBacktestSnapshotsSync()`；
 *   · 只缓存「昂贵」结果（序列化 >= 阈值），避免为轻量结果写盘。
 *
 * 铁律：缓存只做加速，绝不改变计算结果。任何 IO 异常都当作「未命中」，不得向上抛出，
 * 否则缓存故障会直接变成页面故障。
 */
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/** 快照结构版本：结构变更时递增，旧快照自动视为未命中。 */
export const LEADER_CANDIDATE_BACKTEST_SNAPSHOT_VERSION = 1;
/** 默认 TTL：6 小时。到期后必须重算，兜住绕过服务端的脚本回填。 */
export const LEADER_CANDIDATE_BACKTEST_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
/** 小于该体积的结果不落盘（落盘收益低于 IO 成本）。全区间结果约 5.5MB。 */
export const LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MIN_BYTES = 256 * 1024;
/** 最多保留的快照文件数（每个约 5.5MB），超出按修改时间淘汰最旧。 */
export const LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MAX_FILES = 6;

const SNAPSHOT_DIR = resolve(process.cwd(), ".cache", "leader-candidate-backtest");

export type LeaderCandidateBacktestSnapshotOptions = {
  /** 快照目录，默认 `.cache/leader-candidate-backtest`（测试可注入临时目录）。 */
  dir?: string;
  /** TTL 毫秒，默认 6 小时。 */
  ttlMs?: number;
  /** 当前时间（测试可注入）。 */
  now?: number;
};

type SnapshotEnvelope = {
  version?: number;
  key?: string;
  savedAt?: number;
  payload?: unknown;
};

/** 参数哈希 → 快照文件名（哈希已由 stableHash 归一，仅含十六进制）。 */
function snapshotPath(key: string, dir: string): string {
  return resolve(dir, `${key}.json`);
}

function resolveOptions(options: LeaderCandidateBacktestSnapshotOptions = {}) {
  return {
    dir: options.dir ?? SNAPSHOT_DIR,
    ttlMs: options.ttlMs ?? LEADER_CANDIDATE_BACKTEST_SNAPSHOT_TTL_MS,
    now: options.now ?? Date.now(),
  };
}

/**
 * 读取快照。任何不满足「版本一致 + key 一致 + 未过期 + 结构完整」的情形都返回 null。
 * 读取或解析失败一律静默降级（缓存故障不得中断回测）。
 */
export async function readLeaderCandidateBacktestSnapshot<T>(
  key: string,
  options: LeaderCandidateBacktestSnapshotOptions = {},
): Promise<{ payload: T; savedAt: number; fromDisk: true } | null> {
  const { dir, ttlMs, now } = resolveOptions(options);
  try {
    const text = await readFile(snapshotPath(key, dir), "utf8");
    const parsed = JSON.parse(text) as SnapshotEnvelope;
    if (parsed.version !== LEADER_CANDIDATE_BACKTEST_SNAPSHOT_VERSION) return null;
    if (parsed.key !== key) return null;
    if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) return null;
    if (now - parsed.savedAt > ttlMs) return null;
    if (typeof parsed.payload !== "object" || parsed.payload === null) return null;
    return { payload: parsed.payload as T, savedAt: parsed.savedAt, fromDisk: true };
  } catch {
    return null;
  }
}

/**
 * 写入快照（原子写：临时文件 + rename，避免读到半截 JSON）。
 * 低于 MIN_BYTES 的结果只返回 written:false，不落盘。写盘失败同样静默降级。
 */
export async function writeLeaderCandidateBacktestSnapshot<T>(
  key: string,
  payload: T,
  options: LeaderCandidateBacktestSnapshotOptions = {},
): Promise<{ written: boolean; bytes: number }> {
  const { dir, now } = resolveOptions(options);
  let text: string;
  try {
    text = JSON.stringify({
      version: LEADER_CANDIDATE_BACKTEST_SNAPSHOT_VERSION,
      key,
      savedAt: now,
      payload,
    } satisfies SnapshotEnvelope);
  } catch {
    return { written: false, bytes: 0 };
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes < LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MIN_BYTES) return { written: false, bytes };
  try {
    await mkdir(dir, { recursive: true });
    const target = snapshotPath(key, dir);
    const temp = `${target}.tmp`;
    await writeFile(temp, text, "utf8");
    // rename 在同一目录内是原子替换；Windows 上目标已存在时 rename 会失败，故先删除目标。
    await rm(target, { force: true });
    await rename(temp, target);
    await pruneSnapshots(dir, LEADER_CANDIDATE_BACKTEST_SNAPSHOT_MAX_FILES);
    return { written: true, bytes };
  } catch {
    return { written: false, bytes };
  }
}

/** 只保留最新的 keep 个快照文件，其余删除；失败静默。 */
async function pruneSnapshots(dir: string, keep: number): Promise<void> {
  try {
    const entries = await readdir(dir);
    const files = entries.filter((name) => name.endsWith(".json"));
    if (files.length <= keep) return;
    const stats = await Promise.all(files.map(async (name) => {
      const path = resolve(dir, name);
      try {
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      } catch {
        return { path, mtimeMs: 0 };
      }
    }));
    stats.sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (const item of stats.slice(keep)) {
      try {
        await unlink(item.path);
      } catch {
        // 忽略：淘汰失败不影响本次命中。
      }
    }
  } catch {
    // 目录不存在等情况直接忽略。
  }
}

/**
 * 清空全部快照（数据写入后调用，保证页面看到的是最新数据）。
 * 同步实现：调用方位于写入路径上，且快照文件数量受 MAX_FILES 约束。
 */
export function clearLeaderCandidateBacktestSnapshotsSync(
  options: Pick<LeaderCandidateBacktestSnapshotOptions, "dir"> = {},
): number {
  const dir = options.dir ?? SNAPSHOT_DIR;
  try {
    const files = readdirSync(dir).filter((name) => name.endsWith(".json") || name.endsWith(".json.tmp"));
    for (const name of files) {
      try {
        rmSync(resolve(dir, name), { force: true });
      } catch {
        // 忽略单个文件删除失败。
      }
    }
    return files.length;
  } catch {
    return 0;
  }
}

/** 异步清空（供验收脚本 / 管理端点使用）。 */
export async function clearLeaderCandidateBacktestSnapshots(
  options: Pick<LeaderCandidateBacktestSnapshotOptions, "dir"> = {},
): Promise<number> {
  const dir = options.dir ?? SNAPSHOT_DIR;
  try {
    const files = (await readdir(dir)).filter((name) => name.endsWith(".json") || name.endsWith(".json.tmp"));
    await Promise.all(files.map(async (name) => {
      try {
        await unlink(resolve(dir, name));
      } catch {
        // 忽略。
      }
    }));
    return files.length;
  } catch {
    return 0;
  }
}

/** 供诊断/日志使用：默认快照目录。 */
export function leaderCandidateBacktestSnapshotDir(): string {
  return SNAPSHOT_DIR;
}
