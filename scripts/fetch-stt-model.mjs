// 拉取 SenseVoice 语音识别模型到 src-tauri/resources/stt/（Tauri 打包资源）。
// 模型 ~230MB 超 GitHub 单文件 100MB 上限不进仓库；本脚本已挂进
// beforeDevCommand / beforeBuildCommand（pnpm fetch:stt），克隆后直接
// `pnpm tauri dev` 会自动补齐——模型已就绪时秒退，无感。
// 解压依赖系统 tar（Win10+ / macOS / Linux 都内置 bsdtar，原生支持 bz2）。

import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
const URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${NAME}.tar.bz2`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dst = path.join(root, "src-tauri", "resources", "stt");
const modelPath = path.join(dst, "sense-voice.int8.onnx");

if (existsSync(modelPath)) {
  console.log(`[stt-model] 模型已就绪：${modelPath}`);
  process.exit(0);
}

console.log(`[stt-model] 下载 ${URL}`);
const res = await fetch(URL, { redirect: "follow" });
if (!res.ok || !res.body) {
  throw new Error(`下载失败：HTTP ${res.status} ${res.statusText}`);
}

// 边下边报进度：每跨过 10% 打一行（无 content-length 时只报完成）
const total = Number(res.headers.get("content-length")) || 0;
let received = 0;
let lastPct = 0;
const progress = new Transform({
  transform(chunk, _enc, cb) {
    received += chunk.length;
    if (total > 0) {
      const pct = Math.floor((received / total) * 10) * 10;
      if (pct > lastPct) {
        lastPct = pct;
        console.log(`[stt-model] ${pct}%（${Math.round(received / 1e6)}MB / ${Math.round(total / 1e6)}MB）`);
      }
    }
    cb(null, chunk);
  },
});

const tarPath = path.join(tmpdir(), `${NAME}.tar.bz2`);
await pipeline(Readable.fromWeb(res.body), progress, createWriteStream(tarPath));

const extractDir = path.join(tmpdir(), `${NAME}-extract`);
await rm(extractDir, { recursive: true, force: true });
await mkdir(extractDir, { recursive: true });
console.log(`[stt-model] 解压 ${tarPath}`);
const tar = spawnSync("tar", ["-xjf", tarPath, "-C", extractDir], { stdio: "inherit" });
if (tar.status !== 0) {
  throw new Error(`解压失败（tar exit ${tar.status ?? "spawn error"}）`);
}

await mkdir(dst, { recursive: true });
await copyFile(path.join(extractDir, NAME, "model.int8.onnx"), modelPath);
await copyFile(path.join(extractDir, NAME, "tokens.txt"), path.join(dst, "tokens.txt"));
await rm(tarPath, { force: true });
await rm(extractDir, { recursive: true, force: true });
console.log(`[stt-model] 模型就绪：${dst}`);
