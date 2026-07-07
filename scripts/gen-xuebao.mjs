// 雪豹（默认桌宠形象）· 主形象静态全身像，64×64。
//
// 设计骨架（参考主人给的坐姿方块猫）：
//   · 头身连成一个「圆角竖块」——方正但四角收圆，避免生硬箱子的诡异感
//   · 顶部两只三角耳（耳内一抹粉），底部露出并排的白手套小爪爪
//   · 右侧一条粗尾巴从身后绕到身前，末端深灰尾尖
//   · 颜文字脸：绿眼睛（主人雪豹的绿瞳）+ 粉鼻头 + ω 小嘴，两颊各画一点胡须
//   · 银渐层：浅银主色 + 头顶/两肋的 M/D ticking 碎毛，白下巴连白肚皮
//
// 每像素即最终像素，×1 导出 64、×4 导出 256 预览。改完重跑：node scripts/gen-xuebao.mjs
// 输出：public/pet/xuebao.png（64×64）+ xuebao-preview.png（256×256）。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const GRID = 64;
const EXPORT_SCALE = 1;
const PREVIEW_SCALE = 4;

// ---- 调色板 ----
const PALETTE = {
  k: [74, 69, 80, 255], // 描边 / 胡须 / ω嘴
  L: [216, 218, 222, 255], // 浅银（主体毛色）
  M: [178, 183, 192, 255], // 中银（ticking / 尾巴）
  D: [134, 141, 155, 255], // 深灰（ticking / 尾尖）
  W: [248, 247, 244, 255], // 白（下巴 / 肚皮 / 白手套 / 眼高光）
  G: [143, 185, 150, 255], // 浅绿（眼内芯）
  g: [74, 112, 86, 255], // 深绿（眼外圈）
  P: [232, 168, 172, 255], // 粉（耳内 / 鼻头）
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
const mir = (x) => 63 - x; // 中轴 x=31.5 镜像
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

// ================= 形象组装（严格复刻主人参考图的坐姿方块猫） =================
// 参考图降采样测得的骨架（64 网格）：
//   · 头身一体的「瘦高圆角竖块」：左缘 x=18、右缘 x=45（宽 28），y=18~39
//   · 头顶两只三角耳分得较开、中间有缺口，耳内一抹粉
//   · 尾巴是身体右侧「竖着绕上来的一条」，不是身前大卷尾
//   · 大眼睛靠上、绿瞳；小粉鼻 + ω 嘴；白胸兜
//   · 底部四只白色小脚趾并排

// 1) 头身「瘦高圆角竖块」：逐行左缘表（右缘镜像），铺满浅银 L
const bodyLX = { 18: 22, 19: 20, 20: 19 };
for (let y = 21; y <= 36; y++) bodyLX[y] = 18; // 笔直的身侧
Object.assign(bodyLX, { 37: 18, 38: 19, 39: 21 }); // 底部收圆
for (const [yStr, lx] of Object.entries(bodyLX)) {
  const y = +yStr;
  rect(lx, y, mir(lx), y, "L");
}

// 2) 尾巴：身体右侧一条独立细竖条（与身体留 1px 缝，尾尖在上贴近耳），浅银 + 深灰尾尖
rect(49, 15, 51, 15, "L"); // 圆尾尖
rect(48, 16, 51, 38, "L"); // 竖直尾干
cells("M", [[50, 23], [50, 24], [50, 31], [50, 32]]); // 两道淡银环纹
rect(49, 15, 51, 17, "D"); // 尾尖压深

// 3) 三角耳（左耳 + 镜像右耳）：分开、有缺口，耳内一抹粉
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  // 外耳浅银三角：尖在上、底边 y=18
  for (let r = 10; r <= 18; r++) {
    const hw = Math.round(((r - 10) / 8) * 5); // 半宽 0→5
    rect(X(24 - hw), r, X(24 + hw), r, "L");
  }
  // 耳内粉（小一号三角）
  for (let r = 13; r <= 18; r++) {
    const hw = Math.round(((r - 13) / 5) * 3);
    rect(X(24 - hw), r, X(24 + hw), r, "P");
  }
}

// 4) 整体描边（此刻剪影 = 身 + 尾 + 双耳，描出干净外轮廓）
outline();

// 5) 白胸兜（平涂，不描边；圆角竖椭）
rect(27, 31, 36, 31, "W");
rect(26, 32, 37, 37, "W");
rect(28, 38, 35, 38, "W");

// 6) 绿眼睛：深绿外圈 g + 浅绿内芯 G + 左上白高光（主人雪豹银渐层的绿瞳）
for (const flip of [false, true]) {
  const X = (x) => (flip ? mir(x) : x);
  rect(X(24), 21, X(28), 25, "g"); // 外圈 5×5
  rect(X(25), 22, X(27), 24, "G"); // 内芯
  cells("W", [[X(25), 22], [X(26), 22]]); // 高光
}

// 7) 粉鼻头 + ω 小嘴（雪豹的萌点）
rect(30, 26, 33, 26, "P");
rect(31, 27, 32, 27, "P");
cells("k", [[30, 28], [31, 29], [32, 29], [33, 28]]); // ω

// 8) 银渐层 ticking：只在额头对称落两点，克制即可（参考图整体是干净平银）
for (const [x, y, ch] of [
  [24, 19, "M"], [39, 19, "M"],
]) if (grid[y] && grid[y][x] === "L") put(x, y, ch);

// 10) 底部四只白色小脚趾并排（k 描边 + 白脚垫），坐姿收在身下
for (const c of [19, 27, 35, 42]) {
  rect(c, 40, c, 44, "k"); // 左缘
  rect(c + 3, 40, c + 3, 44, "k"); // 右缘
  rect(c + 1, 40, c + 2, 44, "W"); // 脚垫
  rect(c, 44, c + 3, 44, "k"); // 底缘
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
console.log("已生成 public/pet/xuebao.png (64×64) 与 xuebao-preview.png (256×256)");
