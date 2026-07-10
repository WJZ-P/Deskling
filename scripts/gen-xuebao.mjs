// 雪宝（默认桌宠形象）· 主形象静态全身像，32×32 粗像素版。
//
// 设计骨架（主人钦定的方块猫喵）：
//   · 头身一体的「圆角大方块」，粗描边（1 格 = 预览 8px，憨厚敦实）
//   · 顶部两只分开的三角耳，耳内大块粉
//   · 颜文字脸：2×2 深色点点眼 + ω 小嘴（・ω・），不要写实眼睛
//   · 右侧一条独立的「竖立粗尾巴」，中灰填充、圆顶，与身体留缝
//   · 底部四只白色小脚爪并排露出
//   · 满身撒白色碎点（银渐层的 ticking 质感），少量中灰点缀
//
// 每像素即最终像素，×1 导出 32、×8 导出 256 预览。改完重跑：node scripts/gen-xuebao.mjs
// 输出：public/pet/xuebao.png（32×32）+ xuebao-preview.png（256×256）。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const GRID = 32;
const EXPORT_SCALE = 1;
const PREVIEW_SCALE = 8;

// ---- 调色板 ----
const PALETTE = {
  k: [74, 69, 80, 255], // 描边 / 眼睛 / ω嘴
  L: [216, 218, 222, 255], // 浅银（主体毛色）
  M: [178, 183, 192, 255], // 中银（少量杂点）
  D: [134, 141, 155, 255], // 深灰（尾巴）
  W: [248, 247, 244, 255], // 白（碎点 / 脚爪）
  P: [232, 168, 172, 255], // 粉（耳内）
};

// ---- 网格与绘制辅助 ----
const grid = Array.from({ length: GRID }, () => Array(GRID).fill("."));
function put(x, y, ch) {
  if (x >= 0 && y >= 0 && x < GRID && y < GRID) grid[y][x] = ch;
}
function rect(x0, y0, x1, y1, ch) {
  if (x0 > x1) [x0, x1] = [x1, x0]; // 容忍镜像后反序的坐标
  if (y0 > y1) [y0, y1] = [y1, y0];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ch);
}
function cells(ch, pts) {
  for (const [x, y] of pts) put(x, y, ch);
}
const mir = (x) => 29 - x; // 中轴 x=14.5 镜像（整猫靠左 1 格，右侧给尾巴留间隙列）
/** 给当前所有非空像素描 1px 外边（有透明四邻的填充像素→k），基于快照避免级联 */
function outline() {
  const snap = grid.map((r) => r.slice());
  const solid = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && snap[y][x] !== ".";
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      if (snap[y][x] === "." || snap[y][x] === "k") continue;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))
        put(x, y, "k");
    }
}

// ================= 形象组装 =================

// 1) 头身一体「矮胖圆角方块」：x3..26 × y9..24（宽 24 × 高 16，加宽给腿留位）。
//    顶部两角两级收圆；底部两级内缩 —— 描边后左下右下呈两阶黑色台阶，
//    且最后一行 L 身色也向内缩 1 像素（参考图的银渐层坐姿轮廓）
rect(5, 9, 24, 9, "L");
rect(4, 10, 25, 10, "L");
rect(3, 11, 26, 22, "L");
rect(4, 23, 25, 23, "L");
rect(5, 24, 24, 24, "L");

// 2) 直角三角耳（左耳 + 镜像右耳）：外缘垂直（x5）、斜边朝内下，
//    尖在外上角（5,3），底边接方块顶；耳内粉是小一号的同形直角三角
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  for (let r = 3; r <= 8; r++) {
    const w = Math.round(((r - 3) / 5) * 6); // 行宽 0→6，斜边向内展开
    rect(X(5), r, X(5 + w), r, "L");
  }
  for (let r = 5; r <= 8; r++) {
    const w = r - 5;
    rect(X(6), r, X(6 + w), r, "P");
  }
}

// 3) 整体描边（剪影 = 方块 + 双耳 → 干净粗轮廓；
//    腿不进剪影 —— 否则身体底边的黑 border 会被腿的白芯打断）
outline();

// 5) 尾巴：右侧竖条 + 底部向左拐弯接进身体（翘尾巴喵）。
//    在身体描完边之后再画、再补一遍描边 —— 尾巴获得自己的轮廓线，
//    与身体交界处隔着身体的 k 边，读作「贴在身后的独立尾巴」而非融成一坨。
rect(29, 6, 30, 6, "D"); // 圆尾尖
rect(28, 7, 31, 24, "D"); // 竖直尾干
rect(27, 20, 27, 24, "D"); // 底部拐弯段（贴上身体右缘的描边）
outline();

// 5.5) 四条小短腿：分开悬挂在身体底边黑 border 之下，手工描边
//      （k 侧框 + 白芯 2×3 + k 底），边框直接顶上身体底边、接壤处黑边完整包裹。
//      像素算术：4 条 4 宽腿全用 1px 间隔 = 19 格（奇数）在对称轴上摆不平，
//      故两侧间隔 1px、中间 2px → 整块 20 格，正对 14.5 轴，与底边 border 齐宽
for (const lx of [5, 10, 16, 21]) {
  rect(lx, 25, lx, 28, "k"); // 左框
  rect(lx + 3, 25, lx + 3, 28, "k"); // 右框
  rect(lx + 1, 28, lx + 2, 28, "k"); // 底框
  rect(lx + 1, 25, lx + 2, 27, "W"); // 白芯
}

// 6) 颜文字脸：2×2 点点眼 + ω 小嘴（・ω・）。
//    ω 八格宽：两端峰 1 宽、中峰 2 宽、两谷各 2 宽 —— 正好对称居中于 14.5 轴
rect(8, 13, 9, 14, "k");
rect(20, 13, 21, 14, "k");
cells("k", [
  [11, 16], [14, 16], [15, 16], [18, 16], // ω 上排：端峰 + 2 宽中峰 + 端峰
  [12, 17], [13, 17], [16, 17], [17, 17], // ω 下排两谷（各 2 宽）
]);

// 7) 满身白色碎点 + 少量中灰点（银渐层 ticking；避开五官与肚皮区）
cells("W", [
  [6, 11], [12, 10], [18, 11], [23, 13], [5, 16],
  [22, 16], [24, 20], [16, 11], [6, 20],
]);
cells("M", [
  [21, 19], [14, 11], [24, 17],
]);

// 8) 白肚皮：英短银渐层的白色肚肚 —— 底部居中一片圆顶白斑，坐在底边 border 上，
//    严格对称于 14.5 轴，周边不放碎点
rect(11, 19, 18, 19, "W");
rect(10, 20, 19, 20, "W");
rect(9, 21, 20, 23, "W");

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(w * (1 + w * 4));
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
writeFileSync("public/pet/xuebao.png", encodePng(toRgba(EXPORT_SCALE)));
writeFileSync("public/pet/xuebao-preview.png", encodePng(toRgba(PREVIEW_SCALE)));
console.log("已生成 public/pet/xuebao.png (32×32) 与 xuebao-preview.png (256×256)");
