/**
 * STEP 7.6 — Python provider bridge（BaoStock / AkShare）。
 *
 * 通过子进程调用 Python 脚本（scripts/providers/*.py）获取外部数据。
 * Python 解释器优先取环境变量 MARKETDATA_PYTHON（或具体 provider 专属变量），缺省回退 `python`。
 */

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = new URL("../../../scripts/providers/", import.meta.url);

/** 运行一个 Python bridge 脚本，返回 stdout（调用方负责 JSON.parse）。 */
export function runPythonScript(scriptFileName: string, args: string[], pythonEnvVar?: string): Promise<string> {
  const python = process.env[pythonEnvVar ?? "MARKETDATA_PYTHON"] ?? "python";
  const script = fileURLToPath(new URL(scriptFileName, SCRIPT_ROOT));
  return new Promise((resolve, reject) => {
    execFile(
      python,
      [script, ...args],
      { timeout: 180_000, maxBuffer: 128 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message || String(error)).trim()));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
