// 雪豹（默认桌宠形象）静态全身像生成脚本 —— 方案C：大头构图（WorkBuddy「头即本体」血统）。
//
// 设计语言（参考 Claude Code 吉祥物 Claw'd）：
//   · 平涂色块 + 几何剪影：大 <> 脸占画面约 2/3，脸颊在胡须高度向外凸出成尖角，
//     顶部略窄 → 脸颊最宽 → 下巴收窄，六边形带菱形感，不走圆脸萌系也不做纯矩形
//   · 颜文字五官放大：绿色方块眼（G/g）+ ω 嘴 + 从脸颊尖伸出轮廓外的深色胡须
//   · 底部露出小小的身体：白手套前爪一对 + 从身后翘起的一截尾巴（深灰尾尖）
//   · 雪豹特征：银灰毛 + ticking 碎毛、白下巴/胸口、白爪、深灰尾尖、粉耳内
//
// 在 32×32 粗像素网格上手工摆放，×2 导出 64×64（大颗粒像素质感的来源）。
// 所有坐标都是 32 网格坐标，改完重跑：node scripts/gen-xuebao-c.mjs
// 输出：public/pet/xuebao-c.png（64×64 原生）+ xuebao-c-preview.png（256×256 预览）。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const GRID = 32; // 设计网格
const EXPORT_SCALE = 2; // 32 → 64 原生资产
const PREVIEW_SCALE = 8; // 32 → 256 预览

// ---- 调色板（三方案统一，勿改值）----
const PALETTE = {
  k: [74, 69, 80, 255], // 描边 / 胡须 / ω嘴（暖深灰）
  L: [216, 218, 222, 255], // 浅银（主体毛色）
  M: [178, 183, 192, 255], // 中银（ticking / 尾巴）
  D: [134, 141, 155, 255], // 深灰（ticking / 尾尖）
  W: [248, 247, 244, 255], // 白（下巴 / 胸口 / 白手套爪）
  G: [143, 185, 150, 255], // 浅绿（眼睛主体）
  g: [74, 112, 86, 255], // 深绿（眼睛描边/瞳色）
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
/** 中轴 x=15.5 的镜像（左右对称部件只写左半边） */
const mir = (x) => 31 - x;

// ================= 形象组装 =================

// 1) 大 <> 脸：顶边 y=5 略窄，向下逐行外扩，y=12 脸颊凸成尖角（最宽），
//    再逐行收回到下巴。左缘 x 查表，右缘按 mir 镜像。
const HEAD_L = {
  6: 9, 7: 8, 8: 7, 9: 6, 10: 5, 11: 4,
  12: 3, // ← 脸颊尖（剪影上的 <> 角）
  13: 4, 14: 5, 15: 6, 16: 7, 17: 8, 18: 8, 19: 9, 20: 10,
};
rect(10, 5, 21, 5, "k"); // 顶边
for (const [yStr, L] of Object.entries(HEAD_L)) {
  const y = +yStr;
  put(L, y, "k");
  put(mir(L), y, "k");
  rect(L + 1, y, mir(L) - 1, y, "L");
}
rect(11, 21, 20, 21, "k"); // 下巴底边（也是头/身体的分界线）

// 2) 猫耳：切在顶部轮廓上。外缘竖直（x=9），内缘向内下斜，耳内粉色，
//    耳根打通顶边让耳朵和头连成一体。
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  cells("k", [
    [X(10), 1], [X(11), 1], // 耳尖
    [X(9), 2], [X(12), 2],
    [X(9), 3], [X(13), 3],
    [X(9), 4], [X(14), 4],
    [X(9), 5], // 外缘接到头部左上角
  ]);
  cells("L", [[X(10), 2], [X(11), 2], [X(10), 3], [X(10), 4]]);
  cells("P", [[X(11), 3], [X(12), 3], [X(11), 4], [X(12), 4], [X(13), 4]]);
  for (let x = 10; x <= 13; x++) put(X(x), 5, "L"); // 打通顶边开口
}

// 3) 颜文字五官（放大版 ･ω･，绿眼是硬性要求）
//    眼睛：3×4 大眼，深绿描边一圈拉开与银毛的对比，中心浅绿 + 顶部白高光。
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  rect(flip ? mir(11) : 9, 8, flip ? mir(9) : 11, 11, "g"); // 深绿底块
  put(X(10), 9, "W"); // 顶部高光
  put(X(10), 10, "G"); // 高光下的浅绿虹膜
}
//    ω 嘴：两端 + 中峰在上排，两个弧底在下排（中轴 15.5 对称）
cells("k", [
  [12, 14], [15, 14], [16, 14], [19, 14], // 上排
  [13, 15], [14, 15], [17, 15], [18, 15], // 下排
]);

// 4) 胡须：深色（k），从脸颊尖附近伸出轮廓外——上中下各一根，呈小扇形。
//    中间那根直接接在脸颊尖 (3,12) 上，上下两根贴着斜边根部伸出。
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  cells("k", [
    [X(2), 10], [X(3), 10], [X(4), 10], // 上须（接 y=10 的轮廓 x=5）
    [X(0), 12], [X(1), 12], [X(2), 12], // 中须（接脸颊尖 x=3）
    [X(2), 14], [X(3), 14], [X(4), 14], // 下须（接 y=14 的轮廓 x=5）
  ]);
}

// 5) 白下巴（平涂色块，不描边）：嘴下方一片白，向下接进胸口
rect(13, 17, 18, 17, "W");
rect(12, 18, 19, 20, "W");

// 6) 银渐层 ticking：碎毛左右镜像（保证整体对称），只落在浅银上，
//    避开眼睛和胡须区，免得读成杂点。
for (const [x, y, ch] of [
  [12, 7, "M"], [14, 6, "D"], [6, 13, "M"], [10, 17, "D"],
]) {
  if (grid[y][x] === "L") put(x, y, ch);
  if (grid[y][mir(x)] === "L") put(mir(x), y, ch);
}

// 7) 小身体：下巴线以下露出一小截（大头构图，身体是配角），
//    两侧描边顺着头底角落下来，胸口大片白。
rect(10, 21, 10, 24, "k"); // 左缘（(10,21) 与头部 (10,20) 角相接）
rect(21, 21, 21, 24, "k"); // 右缘
rect(11, 22, 20, 24, "L");
rect(13, 22, 18, 24, "W"); // 白胸口（与白下巴连成一片）
rect(10, 25, 21, 25, "k"); // 身体底边

// 8) 一对白手套前爪：从身体底边下方伸出的两只小短腿
for (const c of [11, 17]) {
  rect(c, 26, c, 27, "k");
  rect(c + 3, 26, c + 3, 27, "k");
  rect(c + 1, 26, c + 2, 27, "W");
  rect(c, 28, c + 3, 28, "k");
}

// 9) 尾巴（允许不对称）：从身后右侧贴地横出，末端向上勾起的 L 形粗尾，
//    勾起段顶端是深灰尾尖；底边与爪子同一条地面线，不悬空。
rect(25, 20, 28, 20, "k"); // 勾起段顶边（含两角）
rect(25, 21, 25, 25, "k"); // 勾起段左缘
rect(28, 21, 28, 27, "k"); // 勾起段右缘
rect(26, 21, 27, 22, "D"); // 深灰尾尖
rect(26, 23, 27, 27, "M"); // 勾起段尾干
rect(22, 25, 24, 25, "k"); // 横段顶边（顺着身体底边延伸过去）
rect(21, 26, 25, 27, "M"); // 横段尾干（从右腿后面伸出来，根部用 M 衔接不压黑）
rect(21, 28, 28, 28, "k"); // 尾巴底边（与爪子同一地面线）

// 10) 整体下移一行：让上下留白更均衡（耳尖上方 2 行、地面线下方 3 行）
grid.pop();
grid.unshift(Array(GRID).fill("."));

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

mkdirSync("public/pet", { recursive: true });
writeFileSync("public/pet/xuebao-c.png", encodePng(toRgba(EXPORT_SCALE)));
writeFileSync("public/pet/xuebao-c-preview.png", encodePng(toRgba(PREVIEW_SCALE)));
console.log("已生成 public/pet/xuebao-c.png (64×64) 与 xuebao-c-preview.png (256×256)");
