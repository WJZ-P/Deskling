// 雪豹（默认桌宠形象）· 方案B：64×64 原生细绘全身像。
//
// 设计语言（参考 Claude Code 吉祥物 Claw'd）：
//   · 平涂色块 + 几何棱角：轮廓用阶梯斜切，不做椭圆也不退回矩形
//   · 脸部两侧是 <> 造型——脸颊在胡须高度向外凸出成尖角，向上向下都收回去
//   · 颜文字脸 ･ω･：绿眼睛（深绿外圈 g + 浅绿内芯 G + 白高光）+ ω 双弧小嘴
//   · 雪豹特征：银灰毛 + ticking 碎毛、白下巴/白肚皮、四条白手套腿、粗尾巴深灰尾尖
//
// 直接在 64×64 网格上绘制（每像素即最终像素），×1 导出 64、×4 导出 256 预览。
// 改完重跑：node scripts/gen-xuebao-b.mjs
// 输出：public/pet/xuebao-b.png（64×64）+ xuebao-b-preview.png（256×256）。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const GRID = 64; // 设计网格 = 最终像素
const EXPORT_SCALE = 1; // 64 → 64 原生资产
const PREVIEW_SCALE = 4; // 64 → 256 预览

// ---- 调色板（三方案统一，勿改值）----
const PALETTE = {
  k: [74, 69, 80, 255], // 描边 / 胡须 / ω嘴（暖深灰）
  L: [216, 218, 222, 255], // 浅银（主体毛色）
  M: [178, 183, 192, 255], // 中银（ticking / 尾巴）
  D: [134, 141, 155, 255], // 深灰（ticking / 尾尖）
  W: [248, 247, 244, 255], // 白（下巴 / 肚皮 / 白手套腿 / 眼高光）
  G: [143, 185, 150, 255], // 浅绿（眼内芯）
  g: [74, 112, 86, 255], // 深绿（眼外圈）
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
/** 身体中轴 x=31.5 的镜像（左右对称部件只写左半边） */
const mir = (x) => 63 - x;

// ================= 形象组装 =================

// 1) 头部 <> 侧影：逐行左缘表（右缘 = 镜像）。
//    从头顶 x=15 逐级斜出到 y=24 的脸颊尖角 x=8，再逐级收回到 x=15 → 剪影即 <>。
const headLX = {
  11: 15, 12: 15, 13: 14, 14: 14, 15: 13, 16: 13, 17: 12, 18: 12,
  19: 11, 20: 11, 21: 10, 22: 10, 23: 9, 24: 8, // ← 脸颊尖角行
  25: 9, 26: 10, 27: 10, 28: 11, 29: 11, 30: 12, 31: 12, 32: 13,
  33: 13, 34: 14, 35: 14, 36: 15, 37: 15,
};
rect(15, 10, 48, 10, "k"); // 头顶边
for (const [yStr, lx] of Object.entries(headLX)) {
  const y = +yStr;
  put(lx, y, "k");
  put(mir(lx), y, "k");
  rect(lx + 1, y, mir(lx) - 1, y, "L");
}

// 2) 身体：颈部微收后向臀部逐级放宽（坐姿的梨形下盘，避免冰箱式矩形）
const bodyLX = {
  38: 15, 39: 15, 40: 14, 41: 14, 42: 14,
  43: 13, 44: 13, 45: 13, 46: 13, 47: 13, 48: 13, 49: 13, 50: 13,
};
for (const [yStr, lx] of Object.entries(bodyLX)) {
  const y = +yStr;
  put(lx, y, "k");
  put(mir(lx), y, "k");
  rect(lx + 1, y, mir(lx) - 1, y, "L");
}
cells("k", [[14, 51], [49, 51]]); // 底角台阶
rect(15, 51, 48, 51, "L");
rect(15, 52, 48, 52, "k"); // 底边

// 3) 猫耳：外缘近竖直、内缘 45° 斜切进头顶，耳内粉色三角，开口打通头顶
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  cells("k", [
    [X(18), 3], [X(19), 3], // 耳尖
    [X(17), 4], [X(20), 4],
    [X(16), 5], [X(21), 5],
    [X(16), 6], [X(22), 6],
    [X(15), 7], [X(23), 7],
    [X(15), 8], [X(24), 8],
    [X(15), 9], [X(25), 9], // 内缘落到头顶边
  ]);
  cells("L", [
    [X(18), 4], [X(19), 4],
    [X(17), 5], [X(18), 5],
    [X(17), 6], [X(18), 6],
    [X(16), 7], [X(17), 7], [X(18), 7],
    [X(16), 8], [X(17), 8], [X(18), 8],
    [X(16), 9], [X(17), 9], [X(18), 9],
  ]);
  cells("P", [
    [X(19), 5], [X(20), 5],
    [X(19), 6], [X(20), 6], [X(21), 6],
    [X(19), 7], [X(20), 7], [X(21), 7], [X(22), 7],
    [X(19), 8], [X(20), 8], [X(21), 8], [X(22), 8], [X(23), 8],
    [X(19), 9], [X(20), 9], [X(21), 9], [X(22), 9], [X(23), 9], [X(24), 9],
  ]);
  for (let x = 16; x <= 24; x++) put(X(x), 10, "L"); // 打通头顶开口
}

// 4) 绿眼睛（左右对称）：深绿 g 外圈 + 浅绿 G 内芯 + 白高光，切角圆方块
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  // 外圈 g（6×7，四角切 1 级）
  for (let x = 21; x <= 24; x++) { put(X(x), 16, "g"); put(X(x), 22, "g"); }
  for (let y = 17; y <= 21; y++) { put(X(20), y, "g"); put(X(25), y, "g"); }
  // 内芯 G
  rect(flip ? mir(24) : 21, 17, flip ? mir(21) : 24, 21, "G");
  // 高光 W（固定落在每只眼的左上角内芯，两只眼同向 → 更像贴纸高光）
  put(flip ? mir(24) : 21, 17, "W");
  put(flip ? mir(23) : 22, 17, "W");
  put(flip ? mir(24) : 21, 18, "W");
}

// 5) ω 小嘴：双弧（左半 + 镜像右半），中央双峰在 x=31/32
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  cells("k", [
    [X(26), 26], [X(26), 27], // 左端
    [X(27), 28],
    [X(28), 29], [X(29), 29], // 弧底
    [X(30), 28],
    [X(31), 27], [X(31), 26], // 中峰
  ]);
}

// 6) 白下巴 + 白肚皮（平涂色块不描边，逐级放宽成大围兜）
rect(28, 30, 35, 30, "W");
rect(27, 31, 36, 31, "W");
rect(26, 32, 37, 32, "W");
rect(24, 33, 39, 33, "W");
rect(23, 34, 40, 34, "W");
rect(22, 35, 41, 36, "W");
rect(21, 37, 42, 51, "W");

// 7) 胡须：每侧 3 根 1px 细线，从脸颊尖附近伸出轮廓外（k 色，任何壁纸可见）
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  cells("k", [
    [X(10), 20], [X(9), 20], [X(8), 19], [X(7), 19], [X(6), 18], // 上须（微翘）
    [X(7), 24], [X(6), 24], [X(5), 24], [X(4), 24], // 中须（从颊尖水平伸出）
    [X(9), 27], [X(8), 28], [X(7), 28], [X(6), 29], [X(5), 29], // 下须（微垂）
  ]);
}

// 8) 银渐层 ticking：碎毛只落在浅银上（头顶最密，两肋其次，避开脸中央）
for (const [x, y, ch] of [
  [23, 11, "M"], [36, 11, "M"],
  [20, 12, "D"], [27, 12, "D"], [28, 12, "D"], [33, 12, "M"], [34, 12, "M"],
  [40, 12, "D"], [45, 12, "M"],
  [17, 13, "M"], [24, 14, "M"], [30, 13, "D"], [37, 14, "M"], [44, 13, "M"],
  [33, 15, "M"],
  [14, 19, "M"], [49, 20, "M"], [13, 24, "D"], [50, 24, "D"],
  [15, 29, "M"], [48, 30, "M"], [18, 31, "M"], [45, 32, "M"],
  [17, 33, "M"], [46, 34, "D"], [16, 39, "M"], [47, 40, "M"],
  [15, 44, "D"], [48, 45, "M"], [14, 46, "M"], [49, 47, "M"],
  [16, 49, "M"], [47, 49, "D"],
]) if (grid[y][x] === "L") put(x, y, ch);

// 9) 粗尾巴：从右后脚背后平卧伸出（先画，随后的右后脚会压在它前面）
//    中银尾干 + 深灰尾尖，尾端两级切角收圆，比脚略矮 1px → 「趴在地上」
rect(45, 54, 58, 54, "k"); // 上缘
rect(45, 55, 53, 55, "M");
rect(54, 55, 58, 55, "D");
put(59, 55, "k"); // 上角台阶
rect(45, 56, 53, 57, "M"); // 尾干
rect(54, 56, 59, 57, "D"); // 尾尖
rect(60, 56, 60, 57, "k"); // 尾端立缘
rect(45, 58, 53, 58, "M");
rect(54, 58, 58, 58, "D");
put(59, 58, "k"); // 下角台阶
rect(45, 59, 58, 59, "k"); // 下缘（与脚底同一地平线）

// 10) 坐姿四爪（全白手套）：外侧两只宽后脚 + 中间并拢的两只前爪
//    （宽脚窄缝，避免栅栏感；右后脚后画 → 压在尾巴根前面）
for (const c of [16, 25, 33, 42]) {
  rect(c, 53, c, 58, "k");
  rect(c + 5, 53, c + 5, 58, "k");
  rect(c + 1, 53, c + 4, 58, "W");
  rect(c, 59, c + 5, 59, "k");
}

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
writeFileSync("public/pet/xuebao-b.png", encodePng(toRgba(EXPORT_SCALE)));
writeFileSync("public/pet/xuebao-b-preview.png", encodePng(toRgba(PREVIEW_SCALE)));
console.log("已生成 public/pet/xuebao-b.png (64×64) 与 xuebao-b-preview.png (256×256)");
