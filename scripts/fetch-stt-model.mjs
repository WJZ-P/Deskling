// 拉取语音相关模型到 src-tauri/resources/stt/（Tauri 打包资源）。
//   SenseVoice    离线识别（~230MB）：按住说话 + 语音唤醒的命令识别共用
//   silero VAD    断句（~2MB）：语音唤醒后判定「一句话说完了」
//   KWS zipformer 唤醒词检测（~15MB）：常驻监听里跑的流式小模型
// 模型超 GitHub 单文件 100MB 上限不进仓库；本脚本已挂进 beforeDevCommand /
// beforeBuildCommand（pnpm fetch:models），克隆后直接 `pnpm tauri dev` 会自动
// 补齐——模型已就绪时秒退，无感。
// 解压依赖系统 tar（Win10+ / macOS / Linux 都内置 bsdtar，原生支持 bz2）。

import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dst = path.join(root, "src-tauri", "resources", "stt");

/** 下载一个 URL 到本地文件，带 10% 步进的进度输出 */
async function download(url, toPath) {
  console.log(`[stt-model] 下载 ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败：HTTP ${res.status} ${res.statusText}`);
  }
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
          console.log(
            `[stt-model] ${pct}%（${Math.round(received / 1e6)}MB / ${Math.round(total / 1e6)}MB）`,
          );
        }
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), progress, createWriteStream(toPath));
}

/** 下载 tar.bz2 并解压，把归档内（顶层目录 name 下的）指定文件复制到目标路径 */
async function fetchArchive(name, url, files) {
  const tarPath = path.join(tmpdir(), `${name}.tar.bz2`);
  await download(url, tarPath);
  const extractDir = path.join(tmpdir(), `${name}-extract`);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  console.log(`[stt-model] 解压 ${tarPath}`);
  const tar = spawnSync("tar", ["-xjf", tarPath, "-C", extractDir], { stdio: "inherit" });
  if (tar.status !== 0) {
    throw new Error(`解压失败（tar exit ${tar.status ?? "spawn error"}）`);
  }
  for (const [from, to] of files) {
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(path.join(extractDir, name, from), to);
  }
  await rm(tarPath, { force: true });
  await rm(extractDir, { recursive: true, force: true });
}

// ---- SenseVoice：离线识别主模型 ----
const SV = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
if (existsSync(path.join(dst, "sense-voice.int8.onnx"))) {
  console.log(`[stt-model] SenseVoice 已就绪`);
} else {
  await fetchArchive(
    SV,
    `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${SV}.tar.bz2`,
    [
      ["model.int8.onnx", path.join(dst, "sense-voice.int8.onnx")],
      ["tokens.txt", path.join(dst, "tokens.txt")],
    ],
  );
}

// ---- silero VAD：语音唤醒断句 ----
const vadPath = path.join(dst, "silero_vad.onnx");
if (existsSync(vadPath)) {
  console.log(`[stt-model] silero VAD 已就绪`);
} else {
  await mkdir(dst, { recursive: true });
  await download(
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
    vadPath,
  );
}

// ---- KWS zipformer：唤醒词流式检测（中文 wenetspeech，3.3M 参数） ----
const KWS = "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01";
const kwsDir = path.join(dst, "kws");
if (existsSync(path.join(kwsDir, "encoder.onnx"))) {
  console.log(`[stt-model] KWS 已就绪`);
} else {
  const stem = "epoch-12-avg-2-chunk-16-left-64";
  await fetchArchive(
    KWS,
    `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${KWS}.tar.bz2`,
    [
      [`encoder-${stem}.onnx`, path.join(kwsDir, "encoder.onnx")],
      [`decoder-${stem}.onnx`, path.join(kwsDir, "decoder.onnx")],
      [`joiner-${stem}.onnx`, path.join(kwsDir, "joiner.onnx")],
      ["tokens.txt", path.join(kwsDir, "tokens.txt")],
    ],
  );
}

console.log(`[stt-model] 全部模型就绪：${dst}`);
