# 桌宠帧动画帧带生成器：从单帧底图（public/pet/xuebao.png）做像素级改帧，
# 输出横向帧带到 public/pet/anim/。新增状态动画在下方加帧函数 + 拼带，
# 保证帧素材可随底图重新生成。
#
# 用法：powershell -File scripts/gen-pet-frames.ps1
# 注意：本文件必须保存为 UTF-8 带 BOM（PowerShell 5.1 对无 BOM 中文注释按 ANSI 解码会解析报错）
#
# 底图坐标备忘（32x32）：
#   左眼 2x2 = (8-9, 13-14)   右眼 2x2 = (20-21, 13-14)
#   嘴 w 形 = y16(11,14,15,18) + y17(12,13,16,17)
#   头顶两耳间空区 ≈ x10-19, y0-8（可画 Zzz）；右侧竖尾巴占 x27-29
#   身体灰 = (216,218,222)  描线深色 = (74,69,80)  耳粉 = (232,168,172)

Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$srcPath = Join-Path $root "public/pet/xuebao.png"
$outDir = Join-Path $root "public/pet/anim"
New-Item -ItemType Directory -Force $outDir | Out-Null

$SIZE = 32
$BODY = [System.Drawing.Color]::FromArgb(255, 216, 218, 222) # 身体灰
$DARK = [System.Drawing.Color]::FromArgb(255, 74, 69, 80)    # 描线深色
$PINK = [System.Drawing.Color]::FromArgb(255, 232, 168, 172) # 耳粉（舌头/腮红）

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

# 把若干帧逐像素拼成横向帧带并保存（手工拷贝，避开 GDI+ 缩放/DPI 的坑）
function Save-Strip([System.Drawing.Bitmap[]]$frames, [string]$name) {
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

# ---- 像素小工具 ----
function Set-Px([System.Drawing.Bitmap]$bmp, [int[]]$xs, [int]$y, [System.Drawing.Color]$c) {
  foreach ($x in $xs) { $bmp.SetPixel($x, $y, $c) }
}

# 清掉 2x2 眼块（还原成无眼底色）
function Clear-Eyes([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(8, 9, 20, 21) 13 $BODY
  Set-Px $bmp @(8, 9, 20, 21) 14 $BODY
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

# 尾巴摆动：尾竖条在 x28-31（顶端 y6，y20 以下连体），上段 y6-13 向身体侧平移
# 1px，下段不动 → y13/14 处折角，读作尾尖内摆
function Sway-Tail([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 27 6 31 13 -1 0 }

# 呼吸压缩：头顶/双耳（x0-26 的 y0-11）下压 1px；五官在 y13 起，不受影响
function Squash-Top([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 0 0 26 11 0 1 }

# 全身上跳 1px（摸头开心蹦跶；最高内容在 y3，不会顶出画布）
function Hop([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 0 0 31 31 0 -1 }

# ==== idle：眨眼 + 甩尾 ====
# 帧 0 睁眼（原图）；帧 1 半闭；帧 2 安详合眼；帧 3 尾巴内摆（身体动作）
$open = New-Frame $base
$half = New-Frame $base
Set-Px $half @(8, 9, 20, 21) 13 $BODY
$closed = New-Frame $base
Close-Eyes $closed
$sway = New-Frame $base
Sway-Tail $sway
Save-Strip @($open, $half, $closed, $sway) "idle.png"
$half.Dispose(); $closed.Dispose()

# ==== talk：说话嘴部开合 + 甩尾 ====
# 帧 0/1 = 闭嘴/张嘴；帧 2/3 = 同款但尾巴内摆（说话时尾巴不安分）
$talkOpen = New-Frame $base
Open-Mouth $talkOpen
$talkOpenSway = New-Frame $talkOpen
Sway-Tail $talkOpenSway
Save-Strip @($open, $talkOpen, $sway, $talkOpenSway) "talk.png"
$talkOpen.Dispose(); $talkOpenSway.Dispose(); $sway.Dispose()

# ==== petted：摸头开心蹦跶 ====
# 帧 0 眯眼 + 腮红；帧 1 再张嘴 + 全身上跳 1px（交替播出蹦跳感）
$pet0 = New-Frame $base
Happy-Eyes $pet0
Add-Blush $pet0
$pet1 = New-Frame $pet0
Open-Mouth $pet1
Hop $pet1
Save-Strip @($pet0, $pet1) "petted.png"
$pet0.Dispose(); $pet1.Dispose()

# ==== walk：前视对角碎步（窗口被拖动 / 将来自主散步时播） ====
# 四腿 4x4（y25-28）：腿1 x5-8 / 腿2 x10-13 / 腿3 x16-19 / 腿4 x21-24
# 抬腿 = 腿身 y26-28 上移 1px：脚底并到 y27、y28 清空 → 缩腿离地，
# y24 的身体底轮廓不动（腿从「袜筒」里缩回去的读法）
function Lift-Leg([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$x1) {
  Shift-Region $bmp $x0 26 $x1 28 0 -1
}

# 帧 0 四脚着地（复用 open 底图）；帧 1 抬对角腿(1,3) + 步点头顶下压 + 甩尾；
# 帧 2 抬另一组对角腿(2,4) + 步点头顶下压（尾巴回正 → 打拍子）
$walkA = New-Frame $base
Lift-Leg $walkA 5 8
Lift-Leg $walkA 16 19
Squash-Top $walkA
Sway-Tail $walkA
$walkB = New-Frame $base
Lift-Leg $walkB 10 13
Lift-Leg $walkB 21 24
Squash-Top $walkB
Save-Strip @($open, $walkA, $walkB) "walk.png"
$walkA.Dispose(); $walkB.Dispose()

# ==== sleep：合眼 + 呼吸起伏 + 头顶 Zzz ====
# 帧 0 合眼 + 小 z；帧 1 头顶下压 1px（呼气）+ 小 z + 高处大 Z
# （Z 在头顶空区 y0-6，必须在压缩之后再画，否则会被区域平移清掉）
$sleep0 = New-Frame $base
Close-Eyes $sleep0
Add-Z $sleep0 12 4
$sleep1 = New-Frame $base
Close-Eyes $sleep1
Squash-Top $sleep1
Add-Z $sleep1 12 4
Add-Z $sleep1 16 1
Save-Strip @($sleep0, $sleep1) "sleep.png"
$sleep0.Dispose(); $sleep1.Dispose()

$open.Dispose(); $base.Dispose()
