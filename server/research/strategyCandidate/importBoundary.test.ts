/**
 * RESEARCH-006.1 — **依赖方向守护测试**（把「靠人守」变成「靠测试守」）。
 *
 * 依据 006.0 §12 / §22 的依赖铁律：
 *
 *   Dataset Registry
 *         ↓
 *   Research Core
 *         ↓
 *   Strategy Candidate（桥，**唯一**允许同时看见两者的地方）
 *         ↓
 *   Strategy Persistence
 *
 * 禁止：
 *   - `server/researchCore/**`          → import `strategyPersistence` / `strategySchema`；
 *   - `server/research/strategyPersistence/**` → import `researchCore`；
 *   - `server/datasetRegistry/**`       → 反向依赖 Research Candidate / Research Core / Strategy；
 *   - 除桥之外的任何位置**同时** import `researchCore` 与 `strategyPersistence`。
 *
 * 实现方式：读源文件文本 + 解析 import 说明符（不依赖构建产物、不依赖 tsconfig paths）。
 * 只匹配**真实 import 语句**，注释里提到模块名不算（避免误伤文档性引用）。
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const SERVER_ROOT = join(REPO_ROOT, "server");

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx") || entry.endsWith(".mts")) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) specs.push(m[1]);
  return specs;
}

const TEST_ROOT_PREFIX = "server/research/strategyCandidate/";

interface Violation {
  file: string;
  spec: string;
  rule: string;
}

function scan(dir: string): Array<{ file: string; rel: string; specs: string[] }> {
  const dirPath = join(SERVER_ROOT, dir);
  if (!existsSync(dirPath)) return [];
  return listTsFiles(dirPath).map((file) => ({
    file,
    rel: relative(REPO_ROOT, file).split("\\").join("/"),
    specs: importsOf(file),
  }));
}

const RULES: Array<{ scope: string; forbidden: RegExp; rule: string }> = [
  {
    scope: "researchCore",
    forbidden: /(strategyPersistence|strategySchema)/,
    rule: "researchCore 不得 import strategyPersistence / strategySchema",
  },
  {
    scope: "research/strategyPersistence",
    forbidden: /(^|\/)researchCore(\/|$)/,
    rule: "strategyPersistence 不得 import researchCore",
  },
  {
    scope: "datasetRegistry",
    forbidden: /(researchCore|strategyCandidate|strategySchema|strategyPersistence)/,
    rule: "Dataset Registry 不得反向依赖 Research Core / Strategy Candidate / Strategy",
  },
];

describe("跨模块依赖方向守护（RESEARCH-006.1 §21 / §22）", () => {
  for (const { scope, forbidden, rule } of RULES) {
    it(rule, () => {
      const files = scan(scope);
      expect(files.length).toBeGreaterThan(0);
      const violations: Violation[] = [];
      for (const f of files) {
        for (const spec of f.specs) {
          if (forbidden.test(spec)) violations.push({ file: f.rel, spec, rule });
        }
      }
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }

  it("只有桥（server/research/strategyCandidate/**）可以同时 import researchCore 与 strategyPersistence", () => {
    const both: string[] = [];
    for (const f of listTsFiles(SERVER_ROOT)) {
      const rel = relative(REPO_ROOT, f).split("\\").join("/");
      if (rel.startsWith(TEST_ROOT_PREFIX)) continue; // 桥本身
      const specs = importsOf(f);
      const touchesResearch = specs.some((s) => /(^|\/)researchCore(\/|$)/.test(s));
      const touchesStrategy = specs.some((s) => /strategyPersistence/.test(s));
      if (touchesResearch && touchesStrategy) both.push(rel);
    }
    expect(both, `以下文件同时 import 了 researchCore 与 strategyPersistence：${JSON.stringify(both)}`).toEqual([]);
  });

  it("桥不得被 Research Core / Strategy Persistence 反向 import", () => {
    const violations: string[] = [];
    for (const scope of ["researchCore", "research/strategyPersistence"]) {
      for (const f of scan(scope)) {
        for (const spec of f.specs) {
          if (/strategyCandidate/.test(spec)) violations.push(`${f.rel} → ${spec}`);
        }
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("桥内部不得出现「Research 领域 ↔ Strategy 领域」的环（不得 import research 主 barrel）", () => {
    const violations: string[] = [];
    for (const f of scan("research/strategyCandidate")) {
      for (const spec of f.specs) {
        // `server/research/index.ts` 是 STEP 6.x legacy 链路 + 与 researchCore 同名不同物，
        // 引入它会把两套 Research 语义混在一个文件里。桥只允许显式引用具体模块。
        if (/research\/(index)?$/.test(spec) || spec === "../" || spec === "..") {
          violations.push(`${f.rel} → ${spec}`);
        }
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

/**
 * RESEARCH-006.2 追加的两条**本 STEP 专属**不变量。
 *
 * ⚠️ 第 ① 条是**阶段性**的：006.2 §21 明确「本 STEP 暂时不要 import strategyPersistence」。
 *   006.3 落地 `promote` 时，本条应当**被改写**为「只有 service.ts 与 provenance 写入点可以
 *   import strategyPersistence」，而不是直接删除 —— 桥是唯一允许跨界的地方，这条边界必须一直被断言。
 */
describe("RESEARCH-006.2 桥边界追加守护（§21 / §22 / §28）", () => {
  it("① 桥在 006.2 阶段不得 import Strategy 领域（promote 属 006.3）", () => {
    const violations: string[] = [];
    for (const f of scan("research/strategyCandidate")) {
      for (const spec of f.specs) {
        if (/strategyPersistence|strategySchema/.test(spec)) violations.push(`${f.rel} → ${spec}`);
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("② 桥不得出现写 `strategies` / `strategy_versions` 的痕迹（§28 防偷跑）", () => {
    const violations: string[] = [];
    for (const f of scan("research/strategyCandidate")) {
      // 测试自身会提到这些符号（本断言就在提），故只扫**生产源文件**。
      if (f.rel.endsWith(".test.ts")) continue;
      const text = readFileSync(f.file, "utf8");
      for (const pattern of [/strategyVersions/, /strategyVersionDatasets/, /INSERT\s+INTO\s+strateg/i]) {
        if (pattern.test(text)) violations.push(`${f.rel} 命中 ${String(pattern)}`);
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
