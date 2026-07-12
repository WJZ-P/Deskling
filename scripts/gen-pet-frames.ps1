# 桌宠帧动画帧带生成器：从单帧底图（public/pet/xuebao.png）做像素级改帧，
# 输出横向帧带到 public/pet/anim/。每个动画 12 帧左右、逐帧微差
# （呼吸/甩尾/眨眼/点头等微动作编织进循环），播放侧直接顺播 0..N。
# 新增状态动画 = 底部加一段 Build-Strip 逐帧 spec。
#
# 用法：powershell -File scripts/gen-pet-frames.ps1
# 注意：本文件必须保存为 UTF-8 带 BOM（PowerShell 5.1 对无 BOM 中文注释按 ANSI 解码会解析报错）
#
# 底图坐标备忘（32x32）：
#   左眼 2x2 = (8-9, 13-14)   右眼 2x2 = (20-21, 13-14)
#   嘴 w 形 = y16(11,14,15,18) + y17(12,13,16,17)
#   头顶两耳间空区 ≈ x10-19, y0-8（可画 Zzz）；右侧竖尾巴 x28-31（顶端 y6）
#   四腿 4x4（y25-28）：x5-8 / x10-13 / x16-19 / x21-24
#   睡觉趴姿（Make-Loaf 变形后）：眼 y17-18、耳尖 y7、地线 y28、
#     尾尖 x5-6 y26-27、头顶空区 y0-6（画 Zzz）
#   身体灰 = (216,218,222)  描线深色 = (74,69,80)  耳粉 = (232,168,172)

Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$srcPath = Join-Path $root "public/pet/xuebao.png"
$outDir = Join-Path $root "public/pet/anim"
New-Item -ItemType Directory -Force $outDir | Out-Null

$SIZE = 32
$BODY = [System.Drawing.Color]::FromArgb(255, 216, 218, 222)  # 身体灰
$DARK = [System.Drawing.Color]::FromArgb(255, 74, 69, 80)     # 描线深色
$PINK = [System.Drawing.Color]::FromArgb(255, 232, 168, 172)  # 耳粉（舌头/腮红/贴纸）
$TGREY = [System.Drawing.Color]::FromArgb(255, 134, 141, 155) # 尾灰（笔记本壳）
$WHITE = [System.Drawing.Color]::FromArgb(255, 248, 246, 240) # 绒白（爪子）
$CLEAR = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)         # 透明（擦除用）

# 底图转 32bppArgb（索引色 PNG 不支持 SetPixel）
$raw = [System.Drawing.Bitmap]::new($srcPath)
$base = $raw.Clone(
  [System.Drawing.Rectangle]::new(0, 0, $SIZE, $SIZE),
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$raw.Dispose()

function New-Frame([System.Drawing.Bitmap]$from) {
  $from.Clone(
    [System.Drawing.Rectangle]::new(0, 0, $SIZE, $SIZE),
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
}

# 把若干帧逐像素拼成横向帧带并保存（手工拷贝，避开 GDI+ 缩放/DPI 的坑）。
# 存前查重：任意两帧完全相同 = 凑数帧，直接报警（帧帧必须有像素差异）
function Save-Strip([System.Drawing.Bitmap[]]$frames, [string]$name) {
  $sigs = @{}
  for ($i = 0; $i -lt $frames.Count; $i++) {
    $sb = [System.Text.StringBuilder]::new()
    for ($y = 0; $y -lt $SIZE; $y++) {
      for ($x = 0; $x -lt $SIZE; $x++) {
        [void]$sb.Append($frames[$i].GetPixel($x, $y).ToArgb())
      }
    }
    $sig = $sb.ToString()
    if ($sigs.ContainsKey($sig)) {
      Write-Warning "$name 第 $($sigs[$sig]) 帧与第 $i 帧完全相同（凑数帧！）"
    } else {
      $sigs[$sig] = $i
    }
  }
  $strip = [System.Drawing.Bitmap]::new(
    $SIZE * $frames.Count, $SIZE,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  for ($i = 0; $i -lt $frames.Count; $i++) {
    for ($y = 0; $y -lt $SIZE; $y++) {
      for ($x = 0; $x -lt $SIZE; $x++) {
        $strip.SetPixel($i * $SIZE + $x, $y, $frames[$i].GetPixel($x, $y))
      }
    }
  }
  $out = Join-Path $outDir $name
  $strip.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $strip.Dispose()
  Write-Output "写出 $out（$($frames.Count) 帧）"
}

# ---- 表情小工具 ----
function Set-Px([System.Drawing.Bitmap]$bmp, [int[]]$xs, [int]$y, [System.Drawing.Color]$c) {
  foreach ($x in $xs) { $bmp.SetPixel($x, $y, $c) }
}

# 清掉 2x2 眼块（还原成无眼底色）
function Clear-Eyes([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(8, 9, 20, 21) 13 $BODY
  Set-Px $bmp @(8, 9, 20, 21) 14 $BODY
}

# 半垂眼：收掉眼睛上排（眨眼过渡 / 盯屏专注脸）
function Half-Eyes([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(8, 9, 20, 21) 13 $BODY
}

# 安详合眼：略宽的一字闭眼线
function Close-Eyes([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(7, 8, 9, 10, 19, 20, 21, 22) 14 $DARK
}

# 开心眯眼：∩∩ 上拱弧
function Happy-Eyes([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(8, 9, 20, 21) 13 $DARK
  Set-Px $bmp @(7, 10, 19, 22) 14 $DARK
}

# 清掉 w 嘴（还原成无嘴底色）
function Clear-Mouth([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(11, 14, 15, 18) 16 $BODY
  Set-Px $bmp @(12, 13, 16, 17) 17 $BODY
}

# 张嘴：4x2 小开口 + 粉舌
function Open-Mouth([System.Drawing.Bitmap]$bmp) {
  Clear-Mouth $bmp
  Set-Px $bmp @(13, 14, 15, 16) 16 $DARK
  Set-Px $bmp @(13, 16) 17 $DARK
  Set-Px $bmp @(14, 15) 17 $PINK
}

# 半张嘴：一条 4px 微开线（w 嘴与全开之间的过渡口型）
function Half-Mouth([System.Drawing.Bitmap]$bmp) {
  Clear-Mouth $bmp
  Set-Px $bmp @(13, 14, 15, 16) 16 $DARK
}

# 脸颊腮红（两颊各 2x1 粉块）
function Add-Blush([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(5, 6) 15 $PINK
  Set-Px $bmp @(23, 24) 15 $PINK
}

# 头顶 3x3 的 Z 字（睡觉 Zzz 用），(x0, y0) 为左上角
function Add-Z([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$y0) {
  Set-Px $bmp @($x0, ($x0 + 1), ($x0 + 2)) $y0 $DARK
  Set-Px $bmp @(($x0 + 1)) ($y0 + 1) $DARK
  Set-Px $bmp @($x0, ($x0 + 1), ($x0 + 2)) ($y0 + 2) $DARK
}

# ---- 身体动作（区域平移引擎） ----
# 矩形区域整体平移 (dx,dy)：抓快照 → 清空区域 → 非透明像素回填到偏移处
# （透明像素不落笔：目标处原有内容保留，区域边界拼接自然）
function Shift-Region(
  [System.Drawing.Bitmap]$bmp,
  [int]$x0, [int]$y0, [int]$x1, [int]$y1,
  [int]$dx, [int]$dy
) {
  $w = $x1 - $x0 + 1
  $h = $y1 - $y0 + 1
  $snap = New-Object 'System.Drawing.Color[]' ($w * $h)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) { $snap[$y * $w + $x] = $bmp.GetPixel($x0 + $x, $y0 + $y) }
  }
  $blank = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)
  for ($y = $y0; $y -le $y1; $y++) {
    for ($x = $x0; $x -le $x1; $x++) { $bmp.SetPixel($x, $y, $blank) }
  }
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $c = $snap[$y * $w + $x]
      if ($c.A -eq 0) { continue }
      $tx = $x0 + $x + $dx
      $ty = $y0 + $y + $dy
      if ($tx -ge 0 -and $tx -lt $SIZE -and $ty -ge 0 -and $ty -lt $SIZE) { $bmp.SetPixel($tx, $ty, $c) }
    }
  }
}

# 尾摆一段：尾上段 y6-13 向身体侧平移 1px → y13/14 折角，尾尖内摆
function Sway-Tail([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 27 6 31 13 -1 0 }

# 尾摆两段：一段基础上顶段 y6-10 再进 1px → 渐进弯曲，摆得更狠
function Sway-Tail2([System.Drawing.Bitmap]$bmp) {
  Sway-Tail $bmp
  Shift-Region $bmp 26 6 31 10 -1 0
}

# 尾摆三段：两段基础上尾尖 y6-8 再进 1px → 大回勾（波浪最高点）
function Sway-Tail3([System.Drawing.Bitmap]$bmp) {
  Sway-Tail2 $bmp
  Shift-Region $bmp 25 6 30 8 -1 0
}

# 呼吸压缩：头顶/双耳（x0-26 的 y0-11）下压 1px；五官在 y13 起，不受影响
function Squash-Top([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 0 0 26 11 0 1 }

# 右耳尖内抖：耳尖 y3-5（x22-24）向内平移 1px，y5/6 处折角（偶发小细节）
function Flick-Ear([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 21 3 25 5 -1 0 }

# 全身上跳 $px 像素（内容最高点 y3，最多跳 2 不会顶出画布）。
# 注意：整画布平移，必须放在该帧所有绝对坐标操作之后
function Hop([System.Drawing.Bitmap]$bmp, [int]$px = 1) {
  Shift-Region $bmp 0 0 31 31 0 (-$px)
}

# 抬腿：腿身 y26-28 上移 1px（脚底并到 y27、y28 清空 → 缩腿离地，
# y24 的身体底轮廓不动）。$x0-$x1 = 某条腿的横向范围
function Lift-Leg([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$x1) {
  Shift-Region $bmp $x0 26 $x1 28 0 -1
}

# ---- 敲电脑道具 ----
# 笔记本：屏幕背面朝外立在胸前（贴粉色小贴纸），底座盖住中间两腿、
# 与外侧脚同踩地线。眼神由各帧 spec 自配（盯屏用 Half-Eyes）
function Draw-Laptop([System.Drawing.Bitmap]$bmp) {
  # 屏幕背面：外框 x10-20 y19-25，内里 T 灰
  for ($x = 10; $x -le 20; $x++) { $bmp.SetPixel($x, 19, $DARK); $bmp.SetPixel($x, 25, $DARK) }
  for ($y = 19; $y -le 25; $y++) { $bmp.SetPixel(10, $y, $DARK); $bmp.SetPixel(20, $y, $DARK) }
  for ($y = 20; $y -le 24; $y++) {
    for ($x = 11; $x -le 19; $x++) { $bmp.SetPixel($x, $y, $TGREY) }
  }
  # 屏幕背面贴纸：2x2 粉
  Set-Px $bmp @(14, 15) 21 $PINK
  Set-Px $bmp @(14, 15) 22 $PINK
  # 键盘底座（背视）：x8-21 y26-28，盖掉中间两腿
  for ($y = 26; $y -le 27; $y++) {
    $bmp.SetPixel(8, $y, $DARK); $bmp.SetPixel(21, $y, $DARK)
    for ($x = 9; $x -le 20; $x++) { $bmp.SetPixel($x, $y, $TGREY) }
  }
  for ($x = 8; $x -le 21; $x++) { $bmp.SetPixel($x, 28, $DARK) }
}

# 一只扒屏幕侧缘的白爪：2x2 白 + 描边圈（内侧缘由屏幕外框代劳）
# $xf0/$xf1 = 白色填充两列，$xe = 外侧描边列，$lift = 上抬像素（敲键盘抬爪）
function Draw-Paw([System.Drawing.Bitmap]$bmp, [int]$xf0, [int]$xf1, [int]$xe, [int]$lift) {
  $top = 21 - $lift
  Set-Px $bmp @($xe, $xf0, $xf1) $top $DARK
  foreach ($y in ($top + 1), ($top + 2)) {
    $bmp.SetPixel($xe, $y, $DARK)
    $bmp.SetPixel($xf0, $y, $WHITE)
    $bmp.SetPixel($xf1, $y, $WHITE)
  }
}
# 左爪 / 右爪快捷封装
function Paw-L([System.Drawing.Bitmap]$bmp, [int]$lift) { Draw-Paw $bmp 8 9 7 $lift }
function Paw-R([System.Drawing.Bitmap]$bmp, [int]$lift) { Draw-Paw $bmp 21 22 23 $lift }

# ---- 睡觉猫貌团（趴姿变形） ----
# 从站姿底图变出「整身趴地 + 四腿收起 + 揣手手」的猫貌团：
#   去竖尾 → 整体下沉 4px 坐到原脚底地线（腿被身体盖住 = 收起）→ 两侧腰身
#   外扩 1px（趴开的胖）→ 闭眼（趴姿眼位 y17-18）→ 尾巴贴地横躺身前（左端
#   深色粗尾尖、右端上折从身后绕出）→ 双白爪从胸口搭在尾巴上沿（枕尾而睡）。
# 之后的轨道 op（Loaf-Breath / Loaf-TipUp / Loaf-FlickEar / Add-Z）都按此姿势坐标
function Make-Loaf([System.Drawing.Bitmap]$bmp) {
  # 去竖尾（x27-31 整条）
  for ($y = 6; $y -le 24; $y++) {
    for ($x = 27; $x -le 31; $x++) { $bmp.SetPixel($x, $y, $CLEAR) }
  }
  # 整体下沉 4px 坐地
  Shift-Region $bmp 0 0 26 24 0 4
  # 两侧腰身外扩 1px（只推 x3/x26 的竖直墙段，脸颊斜坡保留）
  for ($y = 18; $y -le 27; $y++) {
    $c3 = $bmp.GetPixel(3, $y)
    if ($c3.A -ge 32 -and $c3.R -eq 74 -and $bmp.GetPixel(2, $y).A -lt 32) {
      $bmp.SetPixel(2, $y, $DARK); $bmp.SetPixel(3, $y, $BODY)
    }
    $c26 = $bmp.GetPixel(26, $y)
    if ($c26.A -ge 32 -and $c26.R -eq 74 -and $bmp.GetPixel(27, $y).A -lt 32) {
      $bmp.SetPixel(27, $y, $DARK); $bmp.SetPixel(26, $y, $BODY)
    }
  }
  # 闭眼（趴姿：眼在 y17-18，闭眼线 y18）
  Set-Px $bmp @(8, 9, 20, 21) 17 $BODY
  Set-Px $bmp @(8, 9, 20, 21) 18 $BODY
  Set-Px $bmp @(7, 8, 9, 10, 19, 20, 21, 22) 18 $DARK
  # 底部左角台阶（尾尖左侧可见的身体轮廓）
  $bmp.SetPixel(3, 27, $DARK)
  # 尾巴贴地横躺身前：y25 上沿描线，y26-27 尾灰填充，右端上折、左端深色粗尾尖
  $bmp.SetPixel(25, 24, $DARK); $bmp.SetPixel(26, 24, $DARK)
  Set-Px $bmp @(6..24) 25 $DARK
  Set-Px $bmp @(25, 26) 25 $TGREY
  Set-Px $bmp @(5, 6) 26 $DARK
  Set-Px $bmp @(5, 6) 27 $DARK
  Set-Px $bmp @(7..26) 26 $TGREY
  Set-Px $bmp @(7..25) 27 $TGREY
  $bmp.SetPixel(26, 27, $DARK)
  $bmp.SetPixel(25, 28, $DARK)
  # 双爪搭尾：两只 2x2 白手 + 描边，爪底陷进尾巴上沿（揣在尾巴上）
  Set-Px $bmp @(10, 11) 23 $DARK
  Set-Px $bmp @(9, 12) 24 $DARK
  Set-Px $bmp @(10, 11) 24 $WHITE
  Set-Px $bmp @(9, 12) 25 $DARK
  Set-Px $bmp @(10, 11) 25 $WHITE
  Set-Px $bmp @(15, 16) 23 $DARK
  Set-Px $bmp @(14, 17) 24 $DARK
  Set-Px $bmp @(15, 16) 24 $WHITE
  Set-Px $bmp @(14, 17) 25 $DARK
  Set-Px $bmp @(15, 16) 25 $WHITE
}

# 趴姿呼吸：眼睛以上（y7-16）下压 1px，头顶/双耳随呼气沉一沉
# （趴姿版 Squash-Top；尾巴/爪爪在 y23+ 不受影响）
function Loaf-Breath([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 0 7 26 16 0 1 }

# 趴姿尾尖上翘：深色尾尖从 y26-27 抬到 y25-26，尖下露出空隙（睡梦中抽动一下）
function Loaf-TipUp([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(5, 6) 25 $DARK
  Set-Px $bmp @(5, 6) 27 $CLEAR
  $bmp.SetPixel(7, 27, $DARK)
}

# 趴姿右耳尖内抖：站姿 Flick-Ear 的下沉版（耳尖在 y7-9）。
# 与 Loaf-Breath 同帧时必须先抖后压（抖的是压缩前的耳尖坐标）
function Loaf-FlickEar([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 21 7 25 9 -1 0 }

# ---- 组帧器：每个动画一组逐帧 spec（scriptblock 收到一张底图副本随意改） ----
function Build-Strip([string]$name, [scriptblock[]]$specs) {
  $frames = @()
  foreach ($spec in $specs) {
    $f = New-Frame $base
    & $spec $f
    $frames += $f
  }
  Save-Strip $frames $name
  foreach ($f in $frames) { $f.Dispose() }
}

# 每个动作 = 几条并行运动轨道错开相位（尾 T0-T3 / 呼吸 B0-B1 / 眼型 / 口型 /
# 爪腿），保证 12 帧张张像素不同——Save-Strip 查重兜底。
# 注释里标注每帧轨道值，调节奏就是改这张表。

# ==== idle：尾巴慢波浪贯穿 + 呼吸错拍 + 收尾眨眼/耳抖（2.4s 一循环） ====
Build-Strip "idle.png" @(
  { param($f) },                                          # 0  T0 B0 睁眼
  { param($f) Sway-Tail $f },                             # 1  T1 B0
  { param($f) Sway-Tail2 $f; Squash-Top $f },             # 2  T2 B1（呼气）
  { param($f) Sway-Tail3 $f },                            # 3  T3 B0（尾峰）
  { param($f) Sway-Tail3 $f; Squash-Top $f },             # 4  T3 B1
  { param($f) Sway-Tail2 $f },                            # 5  T2 B0（回摆）
  { param($f) Sway-Tail $f; Squash-Top $f },              # 6  T1 B1
  { param($f) Squash-Top $f },                            # 7  T0 B1
  { param($f) Half-Eyes $f },                             # 8  眨眼：半闭
  { param($f) Close-Eyes $f; Squash-Top $f },             # 9  全闭 + 呼气
  { param($f) Half-Eyes $f; Sway-Tail $f },               # 10 半睁，尾巴又动了
  { param($f) Flick-Ear $f }                              # 11 耳尖抖一下收场
)

# ==== talk：三态口型不停换 + 尾巴波浪 + 点头 + 一次眨眼 ====
Build-Strip "talk.png" @(
  { param($f) },                                          # 0  w嘴 T0 B0
  { param($f) Half-Mouth $f; Squash-Top $f },             # 1  半开 T0 B1
  { param($f) Open-Mouth $f; Sway-Tail $f },              # 2  全开 T1 B0
  { param($f) Half-Mouth $f; Sway-Tail $f; Squash-Top $f },  # 3  半开 T1 B1
  { param($f) Open-Mouth $f; Sway-Tail2 $f },             # 4  全开 T2 B0
  { param($f) Sway-Tail2 $f; Squash-Top $f },             # 5  w嘴 T2 B1
  { param($f) Open-Mouth $f; Sway-Tail3 $f },             # 6  全开 T3 B0（讲到兴头）
  { param($f) Half-Mouth $f; Sway-Tail3 $f; Squash-Top $f }, # 7  半开 T3 B1
  { param($f) Half-Eyes $f; Sway-Tail3 $f },              # 8  w嘴 T3 眨眼
  { param($f) Open-Mouth $f; Sway-Tail2 $f; Squash-Top $f }, # 9  全开 T2 B1
  { param($f) Half-Mouth $f; Sway-Tail2 $f },             # 10 半开 T2 B0
  { param($f) Sway-Tail $f; Squash-Top $f }               # 11 w嘴 T1 B1 收拍
)

# ==== walk：对角步态 + 尾巴全程打拍子 + 步点起伏（每帧腿/尾/头至少一处在变） ====
Build-Strip "walk.png" @(
  { param($f) },                                                                     # 0  着地 T0 B0
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Sway-Tail $f; Squash-Top $f },     # 1  抬A T1 B1
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Sway-Tail2 $f; Squash-Top $f },    # 2  抬A T2 B1
  { param($f) Sway-Tail3 $f },                                                       # 3  着地 T3 B0
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Sway-Tail3 $f; Squash-Top $f },  # 4  抬B T3 B1
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Sway-Tail2 $f; Squash-Top $f },  # 5  抬B T2 B1
  { param($f) Sway-Tail $f },                                                        # 6  着地 T1 B0
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Squash-Top $f },                   # 7  抬A T0 B1
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Sway-Tail $f },                    # 8  抬A T1 B0
  { param($f) Sway-Tail2 $f },                                                       # 9  着地 T2 B0
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Sway-Tail $f; Squash-Top $f },   # 10 抬B T1 B1
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Squash-Top $f }                  # 11 抬B T0 B1
)

# ==== typing：左右爪敲击 + 双爪齐拍 + 眨眼/抬眼/顿一下（每帧爪位或眼神在变） ====
Build-Strip "typing.png" @(
  { param($f) Half-Eyes $f; Draw-Laptop $f; Paw-L $f 0; Paw-R $f 0 },                 # 0  落定 半垂眼
  { param($f) Half-Eyes $f; Draw-Laptop $f; Paw-L $f 1; Paw-R $f 0 },                 # 1  左抬
  { param($f) Half-Eyes $f; Squash-Top $f; Draw-Laptop $f; Paw-L $f 0; Paw-R $f 1 },  # 2  右抬 + 点头
  { param($f) Half-Eyes $f; Squash-Top $f; Draw-Laptop $f; Paw-L $f 1; Paw-R $f 0 },  # 3  左抬 + 点头
  { param($f) Half-Eyes $f; Draw-Laptop $f; Paw-L $f 0; Paw-R $f 1 },                 # 4  右抬
  { param($f) Half-Eyes $f; Squash-Top $f; Draw-Laptop $f; Paw-L $f 1; Paw-R $f 1 },  # 5  双爪齐拍！
  { param($f) Close-Eyes $f; Draw-Laptop $f; Paw-L $f 1; Paw-R $f 0 },                # 6  边敲边眨眼
  { param($f) Close-Eyes $f; Draw-Laptop $f; Paw-L $f 0; Paw-R $f 0 },                # 7  眨眼落定
  { param($f) Half-Eyes $f; Draw-Laptop $f; Paw-L $f 1; Paw-R $f 1 },                 # 8  双爪齐拍（不点头）
  { param($f) Close-Eyes $f; Squash-Top $f; Draw-Laptop $f; Paw-L $f 0; Paw-R $f 0 }, # 9  停爪闭眼想一下
  { param($f) Draw-Laptop $f; Paw-L $f 0; Paw-R $f 0 },                               # 10 睁眼抬头瞟一下
  { param($f) Draw-Laptop $f; Paw-L $f 0; Paw-R $f 1 }                                # 11 睁着眼接着敲
)

# ==== petted：两轮蹦跶弧线，跳高/口型/尾巴全程演进，播一遍即止 ====
# Hop 是整画布平移，必须放在每帧最后
Build-Strip "petted.png" @(
  { param($f) Happy-Eyes $f; Add-Blush $f },                                          # 0  眯眼腮红 T0 地面
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail $f },             # 1  开心叫 T1
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail2 $f; Hop $f 1 },  # 2  起跳 T2
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail3 $f; Hop $f 2 },  # 3  最高点 T3
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail2 $f; Hop $f 1 },                 # 4  回落收嘴 T2
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail $f; Squash-Top $f },             # 5  落地压缩 T1
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail $f; Hop $f 1 },   # 6  二跳 T1
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail2 $f; Hop $f 2 },  # 7  最高点 T2
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail3 $f; Hop $f 1 },                 # 8  回落 T3 尾甩到最弯
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail2 $f; Squash-Top $f },            # 9  落地压缩 T2
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail $f },                            # 10 站定 T1
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f }                            # 11 意犹未尽 T0
)

# ==== sleep：猫貌团趴睡 —— 呼吸起伏 + Zzz 逐帧上飘 + 尾尖/耳朵小动作（6s 一循环） ====
# 全帧基于 Make-Loaf 趴姿（身子坐地、腿收起、双爪枕在横躺的尾巴上）。
# 轨道：呼吸 B0/B1 三帧一换气；小 z（x21）/ 大 Z（x24）在头顶空区 y0-6 每帧
# 上飘 1px 到顶散去；安静段 F8-10 靠尾尖上翘两拍 + 右耳内抖补差异，帧帧像素不同
Build-Strip "sleep.png" @(
  { param($f) Make-Loaf $f; Add-Z $f 21 4 },                                # 0  B0 小 z 冒头
  { param($f) Make-Loaf $f; Add-Z $f 21 3 },                                # 1  B0 上飘
  { param($f) Make-Loaf $f; Add-Z $f 21 2; Add-Z $f 24 4 },                 # 2  B0 大 Z 跟上
  { param($f) Make-Loaf $f; Loaf-Breath $f; Add-Z $f 21 1; Add-Z $f 24 3 }, # 3  B1 呼气齐飘
  { param($f) Make-Loaf $f; Loaf-Breath $f; Add-Z $f 21 0; Add-Z $f 24 2 }, # 4  B1 小 z 到顶
  { param($f) Make-Loaf $f; Loaf-Breath $f; Add-Z $f 24 1 },                # 5  B1 小 z 散去
  { param($f) Make-Loaf $f; Add-Z $f 24 0 },                                # 6  B0 大 Z 到顶
  { param($f) Make-Loaf $f },                                               # 7  B0 静息
  { param($f) Make-Loaf $f; Loaf-TipUp $f },                                # 8  B0 尾尖翘起
  { param($f) Make-Loaf $f; Loaf-TipUp $f; Loaf-Breath $f },                # 9  B1 尾尖悬着 + 呼气
  { param($f) Make-Loaf $f; Loaf-FlickEar $f; Loaf-Breath $f },             # 10 B1 右耳内抖（先抖后压）
  { param($f) Make-Loaf $f; Loaf-Breath $f }                                # 11 B1 静息 → 接回帧 0
)

$base.Dispose()
