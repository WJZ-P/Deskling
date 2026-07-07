// 雪豹（默认桌宠形象）静态全身像 —— 方案A：粗颗粒方块进化版。
//
// 在 v5 方块猫基础上的三处核心改动：
//   ① 两侧轮廓改成 <> 形：脸颊在胡须高度向外凸出成尖角（col4→3→2 再收回），
//      告别直上直下的矩形侧边，但保留方块猫的几何感
//   ② 每侧 2 根 k 色胡须，从脸颊尖上下两侧水平伸出轮廓外 3 格
//   ③ 眼睛改绿色（深绿 g 主体 2×2 + 浅绿 G 高光 1 格）
//   尾巴改贴地横卧式：从右后腿后方水平伸出 + 深灰尾尖（不再与右侧胡须打架）
//
// 在 32×32 粗像素网格上手工摆放，×2 导出 64×64（大颗粒像素质感的来源）。
// 所有坐标都是 32 网格坐标，改完重跑：node scripts/gen-xuebao-a.mjs
// 输出：public/pet/xuebao-a.png（64×64）+ xuebao-a-preview.png（256×256）。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GRID = 32; // 设计网格
const EXPORT_SCALE = 2; // 32 → 64 原生资产
const PREVIEW_SCALE = 8; // 32 → 256 预览

// ---- 调色板（三方案统一，勿改值） ----
const PALETTE = {
  k: [74, 69, 80, 255], // 描边 / 胡须 / ω嘴（暖深灰）
  L: [216, 218, 222, 255], // 浅银（主体毛色）
  M: [178, 183, 192, 255], // 中银（ticking / 尾巴）
  D: [134, 141, 155, 255], // 深灰（ticking / 尾尖）
  W: [248, 247, 244, 255], // 白（肚皮 / 白手套腿）
  G: [143, 185, 150, 255], // 浅绿（眼睛高光）
  g: [74, 112, 86, 255], // 深绿（眼睛主体）
  P: [232, 168, 172, 255], // 粉（耳内）
};

// ---- 网格与绘制辅助 ----
const grid = Array.from({ length: GRID }, () => Array(GRID).fill("."));
function put(x, y, ch) {
  if (x >= 0 && y >= 0 && x < GRID && y < GRID) grid[y][x] = ch;
}
/** 实心矩形（含两端） */
function rect(x0, y0, x1, y1, ch) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ch);
}
/** 一组散点 */
function cells(ch, pts) {
  for (const [x, y] of pts) put(x, y, ch);
}
/** 身体中轴 x=14.5 的镜像（左右对称部件只写左半边） */
const mir = (x) => 29 - x;

// ================= 形象组装 =================

// 1) <> 轮廓的头身一体：逐行给出左侧最外 k 描边所在列（右侧镜像）。
//    row14 的 col2 是脸颊尖峰；向上逐级收到 col6 接顶边、向下收回 col4 接底边，
//    头顶明显窄于脸颊 → 剪影上 <> 尖角清晰。
const SIDE = {
  9: 6, 10: 5, 11: 4, 12: 4, // 上段逐级收窄（胡须上根从 row12 伸出）
  13: 3, 14: 2, 15: 3, // 脸颊 <> 尖角（峰在 row14）
  16: 4, 17: 4, 18: 4, 19: 4, 20: 4, 21: 4, 22: 4, 23: 4, // 下段身体
};
rect(7, 8, 22, 8, "k"); // 顶边
for (const [row, sx] of Object.entries(SIDE)) {
  const y = +row;
  put(sx, y, "k");
  put(mir(sx), y, "k");
  rect(sx + 1, y, mir(sx) - 1, y, "L");
}
rect(5, 24, 24, 24, "k"); // 底边

// 2) 猫耳：外缘竖直、斜边向内下，切进顶部轮廓（耳内开口打通身体）
//    随头顶收窄，耳朵整体比 v5 内移一格（外缘 col6 对上 row9 的侧边描边）
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  cells("k", [
    [X(6), 2], [X(7), 2], // 耳尖
    [X(6), 3], [X(8), 3],
    [X(6), 4], [X(9), 4],
    [X(6), 5], [X(10), 5],
    [X(6), 6], [X(11), 6],
    [X(6), 7], [X(12), 7], // 斜边落到身体顶边
    [X(6), 8], // 外缘下延，接 row9 的侧边描边
  ]);
  cells("L", [[X(7), 3], [X(7), 4], [X(7), 5], [X(7), 6], [X(7), 7], [X(11), 7]]);
  cells("P", [[X(8), 4], [X(8), 5], [X(9), 5], [X(8), 6], [X(9), 6], [X(10), 6], [X(8), 7], [X(9), 7], [X(10), 7]]);
  for (let x = 7; x <= 11; x++) put(X(x), 8, "L"); // 打通顶边开口
}

// 3) 白肚皮（平涂色块，不描边，顶角切一级台阶）
rect(11, 19, 18, 19, "W");
rect(10, 20, 19, 23, "W");

// 4) 颜文字脸 ･ω･ ：绿色小方眼（深绿主体 + 外上角白高光）+ ω 嘴
rect(9, 12, 10, 13, "g");
rect(19, 12, 20, 13, "g");
put(9, 12, "W"); // 左眼高光（外上角）
put(20, 12, "W"); // 右眼高光（镜像）
cells("k", [
  [11, 15], [14, 15], [15, 15], [18, 15], // ω 上排：两端 + 中峰
  [12, 16], [13, 16], [16, 16], [17, 16], // ω 下排：两个弧底
]);

// 5) 胡须：每侧 2 根，贴着脸颊尖上下、从轮廓水平伸出 3 格（k 色，任何壁纸可见）。
//    粗颗粒下水平直线最干净——斜向末端试过会碎成浮空点，已回退。
for (const y of [12, 16]) {
  rect(1, y, 3, y, "k"); // 左侧（与 SIDE[y]=4 的描边相连）
  rect(mir(3), y, mir(1), y, "k"); // 右侧镜像
}

// 6) 银渐层 ticking：手工散布的碎毛（只落在浅银上，避开脸、肚皮和脸颊尖内侧——
//    脸颊附近的碎毛会干扰 <> 剪影的读取）
for (const [x, y, ch] of [
  [8, 9, "M"], [13, 9, "D"], [18, 9, "M"], [22, 10, "M"],
  [6, 11, "M"], [23, 11, "D"],
  [5, 18, "M"], [23, 18, "D"], [7, 21, "M"], [22, 21, "M"],
]) if (grid[y][x] === "L") put(x, y, ch);

// 7) 四条白手套小短腿（Claw'd 式短粗腿，白色 = 雪豹的白爪爪）
for (const c of [5, 10, 16, 21]) {
  rect(c, 25, c, 27, "k");
  rect(c + 3, 25, c + 3, 27, "k");
  rect(c + 1, 25, c + 2, 27, "W");
  rect(c, 28, c + 3, 28, "k");
}

// 8) 尾巴：贴地横卧 + 末端上翘的 L 形粗尾（深灰尾尖翘起 → 剪影一眼是猫尾）
//    横段左缘与右后腿的 k 边共享，底线与腿底对齐 → 贴着地面从身后甩出
rect(25, 25, 27, 25, "k"); // 横段顶边
rect(25, 26, 27, 27, "M"); // 横段尾干
rect(28, 23, 29, 27, "D"); // 上翘尾尖（深灰）
rect(29, 22, 30, 22, "k"); // 尾尖顶盖（错位一格，与竖缘斜接）
put(28, 22, "k");
rect(27, 23, 27, 24, "k"); // 尾尖左缘（落到横段顶边）
rect(30, 23, 30, 27, "k"); // 尾尖右缘
rect(25, 28, 30, 28, "k"); // 底边

// ================= PNG 编码输出 =================
function toRgba(scale) {
  const w = GRID * scale;
  const buf = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const ch = grid[(y / scale) | 0][(x / scale) | 0];
      if (ch !== ".") buf.set(PALETTE[ch], (y * w + x) * 4);
    }
  return { w, buf };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng({ w, buf }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(w * (1 + w * 4)); // 每行前置 filter=0 字节
  for (let y = 0; y < w; y++)
    buf.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "pet");
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "xuebao-a.png"), encodePng(toRgba(EXPORT_SCALE)));
writeFileSync(join(OUT_DIR, "xuebao-a-preview.png"), encodePng(toRgba(PREVIEW_SCALE)));
console.log("已生成 public/pet/xuebao-a.png (64×64) 与 xuebao-a-preview.png (256×256)");
