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

# 只有剧情明确要求“完全离场”的帧允许全透明。Save-Strip 会把其他空帧当错误报警，
# 防止以后新增动画时不小心把闪烁直接烘进资源。
$ALLOWED_EMPTY_FRAMES = @{
  "enter.png" = @(0)
  "hide-up.png" = @(8)
  "unhide-up.png" = @(3)
}

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
    $visiblePixels = 0
    for ($y = 0; $y -lt $SIZE; $y++) {
      for ($x = 0; $x -lt $SIZE; $x++) {
        $pixel = $frames[$i].GetPixel($x, $y)
        if ($pixel.A -ne 0) { $visiblePixels++ }
        [void]$sb.Append($pixel.ToArgb())
      }
    }
    if ($visiblePixels -eq 0) {
      $allowed =
        $ALLOWED_EMPTY_FRAMES.ContainsKey($name) -and
        $ALLOWED_EMPTY_FRAMES[$name] -contains $i
      if (-not $allowed) { Write-Warning "$name 第 $i 帧完全透明（会造成桌宠闪烁！）" }
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

# 上瞟眼：瞳孔整体上移 1px 到 y12-13（思考时翻眼望天）
function Look-Up([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(8, 9, 20, 21) 12 $DARK
  Set-Px $bmp @(8, 9, 20, 21) 13 $DARK
}

# 侧瞟眼：瞳孔整体左移 1px（思考时目光飘向一边）
function Look-Side([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(7, 8, 19, 20) 13 $DARK
  Set-Px $bmp @(7, 8, 19, 20) 14 $DARK
}

# 右瞟眼：Look-Side 的镜像，瞳孔整体右移 1px（入场探头左右张望用）
function Look-Right([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(9, 10, 21, 22) 13 $DARK
  Set-Px $bmp @(9, 10, 21, 22) 14 $DARK
}

# 警觉瞪圆眼：瞳孔纵向拉长 1px，比普通 2x2 眼更醒目但仍保持像素风。
function Wide-Eyes([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  foreach ($y in 12, 13, 14) { Set-Px $bmp @(8, 9, 20, 21) $y $DARK }
}

# 面朝上：瞳孔 + w 嘴整体上移 1px——五官压向行进方向（仰着头往上走），
# 与 Face-Left 同一套动势语言；只动五官，头身轮廓不动避免破边
function Face-Up([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(8, 9, 20, 21) 12 $DARK
  Set-Px $bmp @(8, 9, 20, 21) 13 $DARK
  Clear-Mouth $bmp
  Set-Px $bmp @(11, 14, 15, 18) 15 $DARK
  Set-Px $bmp @(12, 13, 16, 17) 16 $DARK
}

# 仰头眨眼：Face-Up 之后用——收掉上移瞳孔的上排（行进中轻眨）
function Face-Up-Blink([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(8, 9, 20, 21) 12 $BODY
}

# 仰头喘气嘴：Face-Up 之后用——上移 w 嘴换成一条微开线「——」。
# 只给喘气变体整条帧带统一用，不与 w 嘴帧混切（逐帧横跳不协调）
function Face-Up-Pant([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(11, 14, 15, 18) 15 $BODY
  Set-Px $bmp @(12, 13, 16, 17) 16 $BODY
  Set-Px $bmp @(13, 14, 15, 16) 15 $DARK
}

# 面朝下：瞳孔 + w 嘴整体下移 1px——低着头往下走看脚下（Face-Up 的对偶）
function Face-Down([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(8, 9, 20, 21) 14 $DARK
  Set-Px $bmp @(8, 9, 20, 21) 15 $DARK
  Clear-Mouth $bmp
  Set-Px $bmp @(11, 14, 15, 18) 17 $DARK
  Set-Px $bmp @(12, 13, 16, 17) 18 $DARK
}

# 低头眨眼：Face-Down 之后用——收掉下移瞳孔的上排
function Face-Down-Blink([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(8, 9, 20, 21) 14 $BODY
}

# 低头喘气嘴：Face-Down 之后用——下移 w 嘴换成一条微开线
function Face-Down-Pant([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(11, 14, 15, 18) 17 $BODY
  Set-Px $bmp @(12, 13, 16, 17) 18 $BODY
  Set-Px $bmp @(13, 14, 15, 16) 17 $DARK
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

# 大哈欠：4x3 全张嘴（上两行深色大开口 + 底行粉舌），比 Open-Mouth 高一行
function Yawn-Mouth([System.Drawing.Bitmap]$bmp) {
  Clear-Mouth $bmp
  Set-Px $bmp @(13, 14, 15, 16) 15 $DARK
  Set-Px $bmp @(13, 14, 15, 16) 16 $DARK
  Set-Px $bmp @(13, 16) 17 $DARK
  Set-Px $bmp @(14, 15) 17 $PINK
}

# 脸颊腮红（两颊各 2x1 粉块）
function Add-Blush([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(5, 6) 15 $PINK
  Set-Px $bmp @(23, 24) 15 $PINK
}

# 面朝左：瞳孔 + w 嘴整体左移 2px——五官压向行进方向，走出「往左去」的动势
# （向左走帧带每帧都套；只动五官，头身轮廓不动避免破边）
function Face-Left([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(6, 7, 18, 19) 13 $DARK
  Set-Px $bmp @(6, 7, 18, 19) 14 $DARK
  Clear-Mouth $bmp
  Set-Px $bmp @(9, 12, 13, 16) 16 $DARK
  Set-Px $bmp @(10, 11, 14, 15) 17 $DARK
}

# 左脸眨眼：Face-Left 之后用——收掉左移瞳孔的上排（行进中轻眨）
function Face-Left-Blink([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(6, 7, 18, 19) 13 $BODY
}

# 左脸喘气嘴：Face-Left 之后用——左移 w 嘴换成一条偏左微开线「——」。
# 只给喘气变体整条帧带统一用，不与 w 嘴帧混切（逐帧横跳不协调）
function Face-Left-Pant([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(9, 12, 13, 16) 16 $BODY
  Set-Px $bmp @(10, 11, 14, 15) 17 $BODY
  Set-Px $bmp @(11, 12, 13, 14) 16 $DARK
}

# 面朝右：Face-Left 的镜像，瞳孔 + w 嘴整体右移 2px（从左缘跑回屏内这类
# 「原地朝右」的帧用；整段向右走仍走 Add-Flip 整帧镜像，不用它）
function Face-Right([System.Drawing.Bitmap]$bmp) {
  Clear-Eyes $bmp
  Set-Px $bmp @(10, 11, 22, 23) 13 $DARK
  Set-Px $bmp @(10, 11, 22, 23) 14 $DARK
  Clear-Mouth $bmp
  Set-Px $bmp @(13, 16, 17, 20) 16 $DARK
  Set-Px $bmp @(14, 15, 18, 19) 17 $DARK
}

# 头顶 3x3 的 Z 字（睡觉 Zzz 用），(x0, y0) 为左上角
function Add-Z([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$y0) {
  Set-Px $bmp @($x0, ($x0 + 1), ($x0 + 2)) $y0 $DARK
  Set-Px $bmp @(($x0 + 1)) ($y0 + 1) $DARK
  Set-Px $bmp @($x0, ($x0 + 1), ($x0 + 2)) ($y0 + 2) $DARK
}

# 头顶惊叹号「!」：x14-15 竖条 y0-2 + 点 y4。悬浮标记要在 Hop 之后画，
# 身体弹起时它留在原地；躲边受惊和随机警觉动作共用。
function Alert-Mark([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(14, 15) 0 $DARK
  Set-Px $bmp @(14, 15) 1 $DARK
  Set-Px $bmp @(14, 15) 2 $DARK
  Set-Px $bmp @(14, 15) 4 $DARK
}

# 左耳外侧的听觉波纹：$phase 1-3 由近到远扩散。放在所有耳朵形变之后画，
# 波纹悬在空气里，不跟着耳尖刚性移动。
function Listening-Waves([System.Drawing.Bitmap]$bmp, [int]$phase) {
  if ($phase -ge 1) {
    $bmp.SetPixel(3, 7, $DARK)
    $bmp.SetPixel(2, 8, $DARK)
    $bmp.SetPixel(3, 9, $DARK)
  }
  if ($phase -ge 2) {
    $bmp.SetPixel(1, 6, $DARK)
    $bmp.SetPixel(0, 8, $DARK)
    $bmp.SetPixel(1, 10, $DARK)
  }
  if ($phase -ge 3) {
    $bmp.SetPixel(0, 4, $PINK)
    $bmp.SetPixel(0, 12, $PINK)
  }
}

# 成功勾：右上角先画短划，再补成完整勾，最后闪一下粉色星点。
function Success-Mark([System.Drawing.Bitmap]$bmp, [int]$phase) {
  if ($phase -ge 1) { Set-Px $bmp @(26, 27) 3 $DARK }
  if ($phase -ge 2) {
    $bmp.SetPixel(27, 4, $DARK)
    $bmp.SetPixel(28, 3, $DARK)
    $bmp.SetPixel(29, 2, $DARK)
    $bmp.SetPixel(30, 1, $DARK)
  }
  if ($phase -ge 3) {
    $bmp.SetPixel(25, 0, $PINK)
    $bmp.SetPixel(31, 4, $PINK)
  }
}

# 错误叉：两耳之间逐步亮起的 5x5 像素叉。
function Error-Mark([System.Drawing.Bitmap]$bmp, [int]$phase) {
  if ($phase -ge 1) {
    $bmp.SetPixel(13, 0, $DARK); $bmp.SetPixel(17, 0, $DARK)
    $bmp.SetPixel(14, 1, $DARK); $bmp.SetPixel(16, 1, $DARK)
  }
  if ($phase -ge 2) {
    $bmp.SetPixel(15, 2, $PINK)
    $bmp.SetPixel(14, 3, $DARK); $bmp.SetPixel(16, 3, $DARK)
  }
  if ($phase -ge 3) {
    $bmp.SetPixel(13, 4, $DARK); $bmp.SetPixel(17, 4, $DARK)
  }
}

# 委屈的倒弧嘴，和成功态的开心脸形成明确对照。
function Sad-Mouth([System.Drawing.Bitmap]$bmp) {
  Clear-Mouth $bmp
  Set-Px $bmp @(14, 15, 16) 15 $DARK
  Set-Px $bmp @(12, 13, 17, 18) 16 $DARK
}

# 等待批准时举起的小牌子：深色描边、尾灰牌面、中央问号，两侧白爪扶住。
# $dy 在 0/-1 间切换，做出犹豫地把牌子举高又放低的呼吸感。
function Approval-Board([System.Drawing.Bitmap]$bmp, [int]$dy = 0) {
  # 外侧两条腿抬起来扶牌，先从地面擦掉；中间两条腿保留支撑身体。
  foreach ($y in 25, 26, 27, 28) {
    foreach ($x in 5, 6, 7, 8, 21, 22, 23, 24) { $bmp.SetPixel($x, $y, $CLEAR) }
  }
  $top = 19 + $dy
  $bottom = 25 + $dy
  for ($y = $top; $y -le $bottom; $y++) {
    for ($x = 10; $x -le 20; $x++) { $bmp.SetPixel($x, $y, $TGREY) }
  }
  Set-Px $bmp @(9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21) ($top - 1) $DARK
  Set-Px $bmp @(9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21) ($bottom + 1) $DARK
  for ($y = $top; $y -le $bottom; $y++) {
    $bmp.SetPixel(9, $y, $DARK); $bmp.SetPixel(21, $y, $DARK)
  }
  # 问号
  Set-Px $bmp @(13, 14, 15, 16, 17) ($top + 1) $WHITE
  $bmp.SetPixel(17, ($top + 2), $WHITE)
  Set-Px $bmp @(15, 16, 17) ($top + 3) $WHITE
  $bmp.SetPixel(15, ($top + 4), $WHITE)
  $bmp.SetPixel(15, ($top + 6), $PINK)
  # 扶牌子的两只爪
  Set-Px $bmp @(7, 8, 9, 21, 22, 23) ($top + 2) $DARK
  Set-Px $bmp @(7, 8, 9, 21, 22, 23) ($top + 4) $DARK
  Set-Px $bmp @(8, 9, 21, 22) ($top + 3) $WHITE
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

# 右耳尖内抖：旧动画共用的小动作，保持原来的局部耳尖形变
function Flick-Ear([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 21 3 25 5 -1 0 }

# 纵向藏边专用的“揪耳朵”形变：耳根 y6-9 完全钉住，只把 y3-5 的耳尖向内
# 弯 1px。横向区域包住耳尖的完整描边/耳肉，因此轮廓跟着弯，不会留黑边残影；
# 同时又不像把整只耳朵刚性横移。
function Bend-Ear([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 17 3 25 5 -1 0 }
function Bend-Ear-Left([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 5 3 13 5 1 0 }

# 警觉竖耳：耳根 y6-9 固定，只把两边完整耳尖各向外撑 1px，形成突然捕捉到
# 动静的展开姿态；描边和耳肉一起移动，不留悬空黑边。
function Flare-Ears([System.Drawing.Bitmap]$bmp) {
  Shift-Region $bmp 5 3 13 5 -1 0
  Shift-Region $bmp 17 3 25 5 1 0
}

# 全身上跳 $px 像素（内容最高点 y3，最多跳 2 不会顶出画布）。
# 注意：整画布平移，必须放在该帧所有绝对坐标操作之后
function Hop([System.Drawing.Bitmap]$bmp, [int]$px = 1) {
  Shift-Region $bmp 0 0 31 31 0 (-$px)
}

# 整帧水平镜像：向右走 = 向左走帧的镜像——尾巴换到左侧拖在身后（不然像
# 倒退），五官偏移/下盘压向/尾摆方向全部随之翻转。必须是该帧最后一个 op
function Flip-H([System.Drawing.Bitmap]$bmp) {
  $bmp.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX)
}

# 整帧垂直镜像：顶部倒挂探头复用底部双耳/探头动画。必须是该帧最后一个 op
function Flip-V([System.Drawing.Bitmap]$bmp) {
  $bmp.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipY)
}

# 抬腿：腿身 y26-28 上移 1px（脚底并到 y27、y28 清空 → 缩腿离地，
# y24 的身体底轮廓不动）。$x0-$x1 = 某条腿的横向范围
function Lift-Leg([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$x1) {
  Shift-Region $bmp $x0 26 $x1 28 0 -1
}

# 下盘横摆：整排腿（y25-28 全宽）左右平移 $dx px——迈步时重心/胯部压向
# 一侧，走路不再只有头在上下动。腿排四周是空气不会破边；须在 Lift-Leg 之后
function Legs-Shift([System.Drawing.Bitmap]$bmp, [int]$dx) {
  Shift-Region $bmp 0 25 31 28 $dx 0
}

# 整身下沉 $n px（含竖尾，x0-31 的 y0-24）：身体坐向地面，四腿自上而下被
# 盖住（入睡趴下 / 睡醒撑起的过渡帧；n=4 即猫貌团的坐地深度）
function Sink([System.Drawing.Bitmap]$bmp, [int]$n) { Shift-Region $bmp 0 0 31 24 0 $n }

# 踮脚伸展：躯干（含竖尾）整体上移 $n px，腿部原地、在空出的行里按
# DWWD 补画腿柱 → 四腿拉长踮起（伸懒腰的最高点）。绝对坐标 op 之后调用
function Stretch-Up([System.Drawing.Bitmap]$bmp, [int]$n) {
  Shift-Region $bmp 0 0 31 24 0 (-$n)
  foreach ($leg in 5, 10, 16, 21) {
    for ($i = 1; $i -le $n; $i++) {
      $bmp.SetPixel($leg, (25 - $i), $DARK)
      $bmp.SetPixel(($leg + 1), (25 - $i), $WHITE)
      $bmp.SetPixel(($leg + 2), (25 - $i), $WHITE)
      $bmp.SetPixel(($leg + 3), (25 - $i), $DARK)
    }
  }
}

# 托腮：右外侧腿（x21-24 y25-28）整条离地收起，化作贴在右脸颊上的
# 4x4 白爪（白 2x2 芯）——托着腮帮想事情，地上只剩三条腿
function Think-Paw([System.Drawing.Bitmap]$bmp) {
  for ($y = 25; $y -le 28; $y++) {
    for ($x = 21; $x -le 24; $x++) { $bmp.SetPixel($x, $y, $CLEAR) }
  }
  Set-Px $bmp @(22, 23, 24, 25) 15 $DARK
  foreach ($y in 16, 17) {
    $bmp.SetPixel(22, $y, $DARK)
    $bmp.SetPixel(23, $y, $WHITE)
    $bmp.SetPixel(24, $y, $WHITE)
    $bmp.SetPixel(25, $y, $DARK)
  }
  Set-Px $bmp @(22, 23, 24, 25) 18 $DARK
}

# 头顶思考点点：最多三颗 2x2 深色圆点（x11/x15/x19，y3-4 两耳间空区），
# $n = 画前几颗（0-3，逐帧递增 = 「…」在冒）。须在 Squash-Top 之后画（悬浮不随头动）
function Think-Dots([System.Drawing.Bitmap]$bmp, [int]$n) {
  $cols = @(11, 15, 19)
  for ($i = 0; $i -lt $n; $i++) {
    $x = $cols[$i]
    Set-Px $bmp @($x, ($x + 1)) 3 $DARK
    Set-Px $bmp @($x, ($x + 1)) 4 $DARK
  }
}

# 举腿挥手：左前腿（x5-8 y25-28）整条离地收起，化作身体左侧腾空挥动的
# 小白爪（3 宽 4 高、白 2x2 芯，右缘贴身体轮廓 x3 = 从身侧举起）——
# 猫只有四条腿：一条在挥，地上只剩三条。$top = 爪顶行，11 高位 / 13 低位
function Wave-Leg([System.Drawing.Bitmap]$bmp, [int]$top) {
  for ($y = 25; $y -le 28; $y++) {
    for ($x = 5; $x -le 8; $x++) { $bmp.SetPixel($x, $y, $CLEAR) }
  }
  Set-Px $bmp @(0, 1, 2) $top $DARK
  foreach ($y in ($top + 1), ($top + 2)) {
    $bmp.SetPixel(0, $y, $DARK)
    $bmp.SetPixel(1, $y, $WHITE)
    $bmp.SetPixel(2, $y, $WHITE)
  }
  Set-Px $bmp @(0, 1, 2) ($top + 3) $DARK
}

# 洗脸用右前爪：右外侧腿收起，在脸颊上画一只 4x4 白爪。
# $top=14 是嘴边舔爪，12 是脸颊，10 是擦到眼睛/额头。
function Groom-Paw([System.Drawing.Bitmap]$bmp, [int]$top) {
  for ($y = 25; $y -le 28; $y++) {
    for ($x = 21; $x -le 24; $x++) { $bmp.SetPixel($x, $y, $CLEAR) }
  }
  Set-Px $bmp @(21, 22, 23, 24) $top $DARK
  foreach ($y in ($top + 1), ($top + 2)) {
    $bmp.SetPixel(21, $y, $DARK)
    $bmp.SetPixel(22, $y, $WHITE)
    $bmp.SetPixel(23, $y, $WHITE)
    $bmp.SetPixel(24, $y, $DARK)
  }
  Set-Px $bmp @(21, 22, 23, 24) ($top + 3) $DARK
}

# 舔右爪的小舌头：嘴向右侧伸出两格，刚好朝向嘴边的 Groom-Paw。
function Lick-Right([System.Drawing.Bitmap]$bmp) {
  Clear-Mouth $bmp
  Set-Px $bmp @(14, 15, 16, 17) 16 $DARK
  Set-Px $bmp @(16, 17, 18) 17 $PINK
  $bmp.SetPixel(19, 17, $DARK)
}

# 挠左耳用后爪：左外侧腿收起，在左耳外侧画一只 4x4 白爪；top 在 5/7 间
# 交替即形成快速挠动，top=9 是抬腿靠近/放下的过渡。
function Scratch-Paw([System.Drawing.Bitmap]$bmp, [int]$top) {
  for ($y = 25; $y -le 28; $y++) {
    for ($x = 5; $x -le 8; $x++) { $bmp.SetPixel($x, $y, $CLEAR) }
  }
  Set-Px $bmp @(1, 2, 3, 4) $top $DARK
  foreach ($y in ($top + 1), ($top + 2)) {
    $bmp.SetPixel(1, $y, $DARK)
    $bmp.SetPixel(2, $y, $WHITE)
    $bmp.SetPixel(3, $y, $WHITE)
    $bmp.SetPixel(4, $y, $DARK)
  }
  Set-Px $bmp @(1, 2, 3, 4) ($top + 3) $DARK
}

# 挠耳速度短线：两相交错，避免每拍只做爪子刚性上下平移。
function Scratch-Lines([System.Drawing.Bitmap]$bmp, [int]$phase) {
  if ($phase -eq 1) {
    Set-Px $bmp @(0, 1) 5 $TGREY
    Set-Px $bmp @(0) 8 $TGREY
  } else {
    Set-Px $bmp @(0) 4 $TGREY
    Set-Px $bmp @(0, 1) 9 $TGREY
  }
}

# 喷嚏飞沫：向左侧散开的两档小灰点，落在身体轮廓外的空气区。
function Sneeze-Specks([System.Drawing.Bitmap]$bmp, [int]$phase) {
  if ($phase -eq 1) {
    $bmp.SetPixel(0, 13, $TGREY)
    $bmp.SetPixel(2, 15, $TGREY)
    $bmp.SetPixel(0, 18, $TGREY)
  } else {
    $bmp.SetPixel(1, 12, $TGREY)
    $bmp.SetPixel(0, 16, $TGREY)
  }
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

# 趴姿半睁眼：清掉闭眼线，只留下排 2x1 低瞳（睡眼惺忪的醒来第一眼）
function Loaf-Eyes-Half([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(7, 8, 9, 10, 19, 20, 21, 22) 18 $BODY
  Set-Px $bmp @(8, 9, 20, 21) 18 $DARK
}

# 趴姿全睁眼：闭眼线两端清掉、瞳孔 2x2 复原（趴着但已经醒了）
function Loaf-Eyes-Open([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(7, 10, 19, 22) 18 $BODY
  Set-Px $bmp @(8, 9, 20, 21) 17 $DARK
  Set-Px $bmp @(8, 9, 20, 21) 18 $DARK
}

# 趴姿开心眼：把睡觉横线改成两道上拱弧；配合 Loaf-Blush 表示做了美梦。
function Loaf-Eyes-Happy([System.Drawing.Bitmap]$bmp) {
  Set-Px $bmp @(7, 8, 9, 10, 19, 20, 21, 22) 18 $BODY
  Set-Px $bmp @(8, 9, 20, 21) 17 $DARK
  Set-Px $bmp @(7, 10, 19, 22) 18 $DARK
}

# 趴姿脸比站姿整体低 4px，腮红也随之落到 y19。
function Loaf-Blush([System.Drawing.Bitmap]$bmp) { Set-Px $bmp @(5, 6, 23, 24) 19 $PINK }

# 5x4 粉色梦境爱心，逐帧向左上漂；放在头顶空气区，不随身体平移。
function Dream-Heart([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$y0) {
  Set-Px $bmp @($x0, ($x0 + 1), ($x0 + 3), ($x0 + 4)) $y0 $PINK
  Set-Px $bmp @(($x0 + 0)..($x0 + 4)) ($y0 + 1) $PINK
  Set-Px $bmp @(($x0 + 1), ($x0 + 2), ($x0 + 3)) ($y0 + 2) $PINK
  $bmp.SetPixel(($x0 + 2), ($y0 + 3), $PINK)
}

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
# 呼吸放慢：B0 占前半程、B1 占后半程，头部一个循环只沉/浮各一次（2.4s），
# 帧间差异由尾巴波浪（每帧在动）、尾峰处的眨眼弧、耳尖抖承担
Build-Strip "idle.png" @(
  { param($f) },                                          # 0  T0 B0 睁眼基准
  { param($f) Sway-Tail $f },                             # 1  T1 B0
  { param($f) Sway-Tail2 $f },                            # 2  T2 B0
  { param($f) Sway-Tail3 $f },                            # 3  T3 B0（尾峰）
  { param($f) Half-Eyes $f; Sway-Tail3 $f },              # 4  峰驻留 + 轻眨起
  { param($f) Close-Eyes $f; Sway-Tail3 $f },             # 5  全闭
  { param($f) Half-Eyes $f; Sway-Tail3 $f; Squash-Top $f }, # 6  呼气缓沉 + 睁回半
  { param($f) Sway-Tail2 $f; Squash-Top $f },             # 7  T2 B1（尾巴回摆）
  { param($f) Sway-Tail $f; Squash-Top $f },              # 8  T1 B1
  { param($f) Squash-Top $f },                            # 9  T0 B1
  { param($f) Flick-Ear $f; Squash-Top $f },              # 10 耳尖抖一下（先抖后压）
  { param($f) Half-Eyes $f }                              # 11 吸气回浮 + 轻眨 → 接回帧 0
)

# ==== 随机待机动作：idle 驻留时由行为调度低概率点播，全部 play-once → idle ====
# 这五条不是 idle 的等价换皮：每条都有清楚的起势—主体—收势，且首尾保留普通
# 站姿，插入/退出时不会跳轮廓。权重与冷却在 PetWindow.tsx 顶层配置。

# 左右张望：先眯眼听一听，目光从左扫到右，再抬眼确认头顶动静并回正。
Build-Strip "idle-look.png" @(
  { param($f) Half-Eyes $f },                                             # 0  收神
  { param($f) Look-Side $f; Sway-Tail $f },                              # 1  左瞟 T1
  { param($f) Look-Side $f; Sway-Tail2 $f },                             # 2  左瞟 T2
  { param($f) Face-Left $f; Sway-Tail3 $f },                             # 3  整张脸偏左 T3
  { param($f) Close-Eyes $f; Sway-Tail3 $f },                            # 4  转向间眨眼
  { param($f) Look-Right $f; Sway-Tail3 $f; Squash-Top $f },             # 5  右瞟 T3 B1
  { param($f) Look-Right $f; Sway-Tail2 $f; Squash-Top $f },             # 6  右瞟 T2 B1
  { param($f) Face-Right $f; Sway-Tail $f },                             # 7  整张脸偏右 T1
  { param($f) Half-Eyes $f; Sway-Tail2 $f },                             # 8  回中
  { param($f) Look-Up $f; Flick-Ear $f; Sway-Tail $f },                  # 9  抬眼听声
  { param($f) Half-Eyes $f; Squash-Top $f },                             # 10 放松呼气
  { param($f) Sway-Tail $f }                                             # 11 回普通站姿
)

# 舔爪洗脸：右爪抬到嘴边舔湿，沿脸颊擦到额头，来回两次后放回地面。
Build-Strip "idle-groom.png" @(
  { param($f) Half-Eyes $f; Lift-Leg $f 21 24; Sway-Tail $f },           # 0  抬右爪
  { param($f) Half-Eyes $f; Groom-Paw $f 14; Sway-Tail2 $f },            # 1  爪到嘴边
  { param($f) Half-Eyes $f; Lick-Right $f; Groom-Paw $f 14; Sway-Tail3 $f }, # 2 舔爪
  { param($f) Close-Eyes $f; Groom-Paw $f 12; Sway-Tail3 $f },           # 3  擦脸颊
  { param($f) Close-Eyes $f; Groom-Paw $f 10; Sway-Tail2 $f },           # 4  擦到额头
  { param($f) Happy-Eyes $f; Groom-Paw $f 12; Sway-Tail $f },            # 5  擦下来
  { param($f) Close-Eyes $f; Groom-Paw $f 10; Squash-Top $f },           # 6  第二次上擦
  { param($f) Half-Eyes $f; Lick-Right $f; Groom-Paw $f 12; Sway-Tail $f }, # 7 再舔一下
  { param($f) Half-Eyes $f; Groom-Paw $f 14; Sway-Tail2 $f; Squash-Top $f }, # 8 爪回嘴边
  { param($f) Half-Eyes $f; Think-Paw $f; Sway-Tail3 $f },               # 9  沿脸放下
  { param($f) Lift-Leg $f 21 24; Sway-Tail2 $f },                        # 10 爪将落地
  { param($f) Half-Eyes $f; Sway-Tail $f }                               # 11 洗完回神
)

# 挠左耳：左后爪抬到耳边，在两个高度间快速交替，耳尖配合弯动，最后抖耳收势。
Build-Strip "idle-scratch.png" @(
  { param($f) Look-Side $f; Lift-Leg $f 5 8; Sway-Tail $f },             # 0  察觉耳痒
  { param($f) Half-Eyes $f; Scratch-Paw $f 9; Sway-Tail2 $f },           # 1  爪靠近
  { param($f) Close-Eyes $f; Scratch-Paw $f 7; Sway-Tail3 $f },          # 2  起挠
  { param($f) Close-Eyes $f; Scratch-Paw $f 5; Scratch-Lines $f 1; Bend-Ear-Left $f; Sway-Tail2 $f }, # 3
  { param($f) Happy-Eyes $f; Scratch-Paw $f 7; Scratch-Lines $f 2; Sway-Tail3 $f; Squash-Top $f },     # 4
  { param($f) Close-Eyes $f; Scratch-Paw $f 5; Scratch-Lines $f 1; Bend-Ear-Left $f; Sway-Tail $f },   # 5
  { param($f) Happy-Eyes $f; Scratch-Paw $f 7; Scratch-Lines $f 2; Sway-Tail2 $f },                    # 6
  { param($f) Close-Eyes $f; Scratch-Paw $f 5; Scratch-Lines $f 1; Bend-Ear-Left $f },                 # 7
  { param($f) Half-Eyes $f; Scratch-Paw $f 7; Scratch-Lines $f 2; Squash-Top $f },                     # 8
  { param($f) Half-Eyes $f; Scratch-Paw $f 9; Sway-Tail $f },           # 9  爪离耳
  { param($f) Lift-Leg $f 5 8; Bend-Ear-Left $f; Sway-Tail2 $f },       # 10 放腿、耳朵还歪
  { param($f) Half-Eyes $f; Flick-Ear $f; Sway-Tail $f }                 # 11 抖耳回正
)

# 打喷嚏：鼻痒蓄力、闭眼缩成一团、弹起喷出飞沫，再迷糊地抖耳恢复。
Build-Strip "idle-sneeze.png" @(
  { param($f) Half-Eyes $f; Sway-Tail $f },                              # 0  鼻子发痒
  { param($f) Look-Up $f; Sway-Tail2 $f },                               # 1  吸气
  { param($f) Half-Eyes $f; Half-Mouth $f; Sway-Tail3 $f },              # 2  蓄力
  { param($f) Close-Eyes $f; Open-Mouth $f; Sway-Tail3 $f; Squash-Top $f }, # 3 缩起来
  { param($f) Close-Eyes $f; Yawn-Mouth $f; Sway-Tail2 $f; Hop $f 1; Sneeze-Specks $f 1 }, # 4 哈啾！
  { param($f) Close-Eyes $f; Open-Mouth $f; Squash-Top $f; Sneeze-Specks $f 2 },            # 5 飞沫散去
  { param($f) Half-Eyes $f; Open-Mouth $f; Sway-Tail2 $f },              # 6  喘口气
  { param($f) Close-Eyes $f; Sway-Tail $f },                             # 7  余震眨眼
  { param($f) Half-Eyes $f; Squash-Top $f },                             # 8  迷糊下沉
  { param($f) Half-Eyes $f; Flick-Ear $f; Sway-Tail $f },                # 9  抖耳清醒
  { param($f) Look-Up $f; Sway-Tail2 $f; Squash-Top $f },                # 10 确认不会再来
  { param($f) Sway-Tail $f }                                             # 11 回正
)

# 突然警觉：左右捕捉声音、双耳外撑、瞪眼弹起冒「!」，观察片刻后解除警报。
Build-Strip "idle-alert.png" @(
  { param($f) Look-Side $f; Sway-Tail $f },                              # 0  左边有声音？
  { param($f) Look-Right $f; Sway-Tail2 $f },                            # 1  又看右边
  { param($f) Half-Eyes $f; Flare-Ears $f; Sway-Tail3 $f },              # 2  双耳展开
  { param($f) Wide-Eyes $f; Flare-Ears $f; Sway-Tail3 $f; Hop $f 1; Alert-Mark $f }, # 3 惊起！
  { param($f) Wide-Eyes $f; Flare-Ears $f; Sway-Tail2 $f; Alert-Mark $f },            # 4 定睛
  { param($f) Look-Side $f; Flare-Ears $f; Sway-Tail3 $f },              # 5  警觉左看
  { param($f) Look-Right $f; Flare-Ears $f; Sway-Tail2 $f },             # 6  警觉右看
  { param($f) Wide-Eyes $f; Bend-Ear $f; Sway-Tail $f },                 # 7  单耳追声
  { param($f) Half-Eyes $f; Bend-Ear-Left $f; Sway-Tail2 $f; Squash-Top $f }, # 8 放松
  { param($f) Look-Up $f; Flick-Ear $f; Sway-Tail3 $f },                 # 9  最后确认
  { param($f) Half-Eyes $f; Sway-Tail2 $f },                             # 10 警报解除
  { param($f) Sway-Tail $f }                                             # 11 回正
)

# ==== 业务状态反馈：聆听 / 等待批准 / 成功 / 错误 ====
# 聆听（循环）：双耳外撑捕捉声音，左侧声波由近到远扩散；目光跟着声源左右找，
# 但身体保持站稳，适合用户按住麦克风时持续播放。
Build-Strip "listening.png" @(
  { param($f) Half-Eyes $f; Flare-Ears $f; Listening-Waves $f 1 },
  { param($f) Wide-Eyes $f; Flare-Ears $f; Sway-Tail $f; Listening-Waves $f 2 },
  { param($f) Look-Side $f; Bend-Ear-Left $f; Sway-Tail2 $f; Listening-Waves $f 3 },
  { param($f) Look-Side $f; Flare-Ears $f; Sway-Tail3 $f; Listening-Waves $f 2 },
  { param($f) Wide-Eyes $f; Bend-Ear $f; Sway-Tail2 $f; Listening-Waves $f 1 },
  { param($f) Half-Eyes $f; Flare-Ears $f; Squash-Top $f; Sway-Tail $f; Listening-Waves $f 2 },
  { param($f) Wide-Eyes $f; Flare-Ears $f; Sway-Tail3 $f; Listening-Waves $f 3 },
  { param($f) Look-Right $f; Bend-Ear $f; Sway-Tail2 $f; Listening-Waves $f 2 },
  { param($f) Look-Right $f; Flare-Ears $f; Sway-Tail $f; Listening-Waves $f 1 },
  { param($f) Half-Eyes $f; Bend-Ear-Left $f; Squash-Top $f; Listening-Waves $f 2 },
  { param($f) Wide-Eyes $f; Flare-Ears $f; Sway-Tail2 $f; Listening-Waves $f 3 },
  { param($f) Look-Up $f; Flick-Ear $f; Sway-Tail $f; Listening-Waves $f 1 }
)

# 等待批准（循环）：举着「?」牌左右看主人，牌子轻轻抬落、耳朵跟着犹豫。
Build-Strip "waiting-approval.png" @(
  { param($f) Wide-Eyes $f; Flare-Ears $f; Approval-Board $f 0 },
  { param($f) Look-Side $f; Sway-Tail $f; Approval-Board $f -1 },
  { param($f) Look-Side $f; Bend-Ear-Left $f; Sway-Tail2 $f; Approval-Board $f -1 },
  { param($f) Half-Eyes $f; Sway-Tail3 $f; Approval-Board $f 0 },
  { param($f) Wide-Eyes $f; Bend-Ear $f; Sway-Tail2 $f; Approval-Board $f 0 },
  { param($f) Look-Right $f; Flare-Ears $f; Sway-Tail $f; Approval-Board $f -1 },
  { param($f) Half-Eyes $f; Squash-Top $f; Sway-Tail2 $f; Approval-Board $f -1 },
  { param($f) Look-Right $f; Bend-Ear $f; Sway-Tail3 $f; Approval-Board $f 0 },
  { param($f) Wide-Eyes $f; Flare-Ears $f; Sway-Tail2 $f; Approval-Board $f 0 },
  { param($f) Look-Side $f; Bend-Ear-Left $f; Sway-Tail $f; Approval-Board $f -1 },
  { param($f) Half-Eyes $f; Flick-Ear $f; Sway-Tail2 $f; Approval-Board $f 0 },
  { param($f) Wide-Eyes $f; Sway-Tail $f; Approval-Board $f 0 }
)

# 成功（一次性）：勾号亮起 → 开心蹦一下并挥爪 → 满足地站稳。
Build-Strip "success.png" @(
  { param($f) Half-Eyes $f; Success-Mark $f 1 },
  { param($f) Wide-Eyes $f; Flare-Ears $f; Sway-Tail $f; Success-Mark $f 2 },
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail2 $f; Success-Mark $f 3 },
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail3 $f; Hop $f 1; Success-Mark $f 3 },
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail2 $f; Hop $f 2; Success-Mark $f 3 },
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail3 $f; Hop $f 1; Success-Mark $f 2 },
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail2 $f; Squash-Top $f; Success-Mark $f 3 },
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Wave-Leg $f 13; Sway-Tail $f; Success-Mark $f 2 },
  { param($f) Happy-Eyes $f; Add-Blush $f; Wave-Leg $f 11; Sway-Tail2 $f; Success-Mark $f 3 },
  { param($f) Happy-Eyes $f; Add-Blush $f; Wave-Leg $f 13; Sway-Tail $f; Success-Mark $f 2 },
  { param($f) Half-Eyes $f; Add-Blush $f; Sway-Tail2 $f; Success-Mark $f 1 },
  { param($f) Happy-Eyes $f; Sway-Tail $f }
)

# 错误（一次性）：叉号逐步出现，猫惊住后垂耳委屈，最后缓过神等待下一步。
Build-Strip "error.png" @(
  { param($f) Half-Eyes $f; Error-Mark $f 1 },
  { param($f) Wide-Eyes $f; Flare-Ears $f; Alert-Mark $f; Error-Mark $f 1 },
  { param($f) Wide-Eyes $f; Half-Mouth $f; Sway-Tail $f; Error-Mark $f 2 },
  { param($f) Wide-Eyes $f; Sad-Mouth $f; Bend-Ear $f; Bend-Ear-Left $f; Sway-Tail2 $f; Error-Mark $f 3 },
  { param($f) Close-Eyes $f; Sad-Mouth $f; Bend-Ear $f; Bend-Ear-Left $f; Squash-Top $f; Error-Mark $f 3 },
  { param($f) Look-Side $f; Sad-Mouth $f; Bend-Ear-Left $f; Sway-Tail3 $f; Error-Mark $f 3 },
  { param($f) Look-Right $f; Sad-Mouth $f; Bend-Ear $f; Sway-Tail2 $f; Error-Mark $f 2 },
  { param($f) Close-Eyes $f; Sad-Mouth $f; Bend-Ear $f; Bend-Ear-Left $f; Sway-Tail $f; Error-Mark $f 3 },
  { param($f) Half-Eyes $f; Sad-Mouth $f; Squash-Top $f; Sway-Tail2 $f; Error-Mark $f 2 },
  { param($f) Close-Eyes $f; Sad-Mouth $f; Flick-Ear $f; Sway-Tail $f; Error-Mark $f 1 },
  { param($f) Half-Eyes $f; Sway-Tail2 $f; Squash-Top $f },
  { param($f) Look-Up $f; Sway-Tail $f }
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

# ==== walk：对角步态 + 下盘横摆 + 尾巴打拍子 + 脸部微变化 ====
# A 步重心压左 / B 步重心压右（Legs-Shift 整排腿横移 = 左右摇摆的猫步），
# 头顶起伏照旧；抬步第二拍配小喘（半张嘴），中途一次行进眨眼
Build-Strip "walk.png" @(
  { param($f) },                                                                                       # 0  着地 T0 B0 居中
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },     # 1  抬A T1 B1 压左
  { param($f) Half-Mouth $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },  # 2  抬A T2 B1 压左 小喘
  { param($f) Sway-Tail3 $f },                                                                         # 3  着地 T3 B0 居中
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail3 $f; Squash-Top $f },   # 4  抬B T3 B1 压右
  { param($f) Half-Mouth $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail2 $f; Squash-Top $f },  # 5  抬B T2 B1 压右 小喘
  { param($f) Half-Eyes $f; Sway-Tail $f },                                                            # 6  着地 T1 B0 行进眨眼
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Squash-Top $f },                   # 7  抬A T0 B1 压左
  { param($f) Half-Mouth $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f },     # 8  抬A T1 B0 压左 小喘
  { param($f) Sway-Tail2 $f },                                                                         # 9  着地 T2 B0 居中
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Squash-Top $f },    # 10 抬B T1 B1 压右
  { param($f) Half-Mouth $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Squash-Top $f }    # 11 抬B T0 B1 压右 小喘
)

# ==== walk-left / walk-right：向左走 + 它的整帧镜像 ====
# 两套口型变体，播放侧进入状态时随机抽一套整段播。
# 步态轨道两套完全相同（下盘一律压左 = 身体往左倾着走，F6 行进眨眼）；
# 区别只在口型：A 版全程 w 嘴 / B 版全程喘气线「——」。口型不做段中混切
# （w↔喘气逐帧横跳不协调）。窗口向左位移时播（对话/散步同一条通路）。
# 向右走 = 下方 spec 逐帧套 Flip-H 镜像（尾巴换到左侧拖在身后，不然像倒退）

# 变体 A：w 嘴版
$WALK_LEFT_W = @(
  { param($f) Face-Left $f },                                                                                        # 0  着地 T0 B0 居中
  { param($f) Face-Left $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },     # 1  抬A T1 B1 压左
  { param($f) Face-Left $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },    # 2  抬A T2 B1 压左
  { param($f) Face-Left $f; Sway-Tail3 $f },                                                                         # 3  着地 T3 B0 居中
  { param($f) Face-Left $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail3 $f; Squash-Top $f },  # 4  抬B T3 B1 压左
  { param($f) Face-Left $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },  # 5  抬B T2 B1 压左
  { param($f) Face-Left $f; Face-Left-Blink $f; Sway-Tail $f },                                                      # 6  着地 T1 B0 行进眨眼
  { param($f) Face-Left $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Squash-Top $f },                   # 7  抬A T0 B1 压左
  { param($f) Face-Left $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f },                    # 8  抬A T1 B0 压左
  { param($f) Face-Left $f; Sway-Tail2 $f },                                                                         # 9  着地 T2 B0 居中
  { param($f) Face-Left $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },   # 10 抬B T1 B1 压左
  { param($f) Face-Left $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Squash-Top $f }                  # 11 抬B T0 B1 压左
)

# 变体 B：喘气线版（帧序同 A，每帧多套一个 Face-Left-Pant）
$WALK_LEFT_PANT = @(
  { param($f) Face-Left $f; Face-Left-Pant $f },                                                                                        # 0  着地 T0 B0 居中
  { param($f) Face-Left $f; Face-Left-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },     # 1  抬A T1 B1 压左
  { param($f) Face-Left $f; Face-Left-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },    # 2  抬A T2 B1 压左
  { param($f) Face-Left $f; Face-Left-Pant $f; Sway-Tail3 $f },                                                                         # 3  着地 T3 B0 居中
  { param($f) Face-Left $f; Face-Left-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail3 $f; Squash-Top $f },  # 4  抬B T3 B1 压左
  { param($f) Face-Left $f; Face-Left-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },  # 5  抬B T2 B1 压左
  { param($f) Face-Left $f; Face-Left-Pant $f; Face-Left-Blink $f; Sway-Tail $f },                                                      # 6  着地 T1 B0 行进眨眼
  { param($f) Face-Left $f; Face-Left-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Squash-Top $f },                   # 7  抬A T0 B1 压左
  { param($f) Face-Left $f; Face-Left-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f },                    # 8  抬A T1 B0 压左
  { param($f) Face-Left $f; Face-Left-Pant $f; Sway-Tail2 $f },                                                                         # 9  着地 T2 B0 居中
  { param($f) Face-Left $f; Face-Left-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },   # 10 抬B T1 B1 压左
  { param($f) Face-Left $f; Face-Left-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Squash-Top $f }                  # 11 抬B T0 B1 压左
)

# 镜像包装：原 spec 跑完后整帧水平翻转（向右走复用向左走的全部帧序）
function Add-Flip([scriptblock[]]$specs) {
  # GetNewClosure 会把闭包放进独立动态模块，里面看不到调用方会话里的 Flip-H
  # 函数；先把函数体作为 scriptblock 捕获进去，保证脚本从任意 PowerShell
  # 入口运行都能稳定生成镜像帧（而不是悄悄写出未翻转的右向资源）。
  $flip = ${function:Flip-H}
  $specs | ForEach-Object {
    $orig = $_
    { param($f) & $orig $f; & $flip $f }.GetNewClosure()
  }
}

# 垂直镜像包装：底部藏耳/探头逐帧镜像成顶部倒挂版本
function Add-FlipV([scriptblock[]]$specs) {
  $flip = ${function:Flip-V}
  $specs | ForEach-Object {
    $orig = $_
    { param($f) & $orig $f; & $flip $f }.GetNewClosure()
  }
}

Build-Strip "walk-left.png" $WALK_LEFT_W
Build-Strip "walk-left-pant.png" $WALK_LEFT_PANT
Build-Strip "walk-right.png" (Add-Flip $WALK_LEFT_W)
Build-Strip "walk-right-pant.png" (Add-Flip $WALK_LEFT_PANT)

# ==== walk-up / walk-down：纵向步态（步序/尾拍/呼吸与 walk 完全同轨） ====
# 与向左/向右走同一套语言：五官整体压向行进方向（往上走 = 瞳孔+嘴上移 1px
# 仰头，往下走 = 下移 1px 低头看脚下），各配 w 嘴版/喘气线版两套口型变体，
# 播放侧进入状态时随机抽一套整段播（口型不做段中混切）。下盘 A/B 步左右
# 交替横摆（纵向行进胯部两侧倒重心，与压单侧的左右走不同），F6 行进眨眼

# 往上走 变体 A：w 嘴版
$WALK_UP_W = @(
  { param($f) Face-Up $f },                                                                                       # 0  着地 T0 B0 居中
  { param($f) Face-Up $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },    # 1  抬A T1 B1 压左
  { param($f) Face-Up $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },   # 2  抬A T2 B1 压左
  { param($f) Face-Up $f; Sway-Tail3 $f },                                                                        # 3  着地 T3 B0 居中
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail3 $f; Squash-Top $f },  # 4  抬B T3 B1 压右
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail2 $f; Squash-Top $f },  # 5  抬B T2 B1 压右
  { param($f) Face-Up $f; Face-Up-Blink $f; Sway-Tail $f },                                                       # 6  着地 T1 B0 行进眨眼
  { param($f) Face-Up $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Squash-Top $f },                  # 7  抬A T0 B1 压左
  { param($f) Face-Up $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f },                   # 8  抬A T1 B0 压左
  { param($f) Face-Up $f; Sway-Tail2 $f },                                                                        # 9  着地 T2 B0 居中
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Squash-Top $f },   # 10 抬B T1 B1 压右
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Squash-Top $f }                  # 11 抬B T0 B1 压右
)

# 往上走 变体 B：喘气线版（帧序同 A，每帧多套一个 Face-Up-Pant）
$WALK_UP_PANT = @(
  { param($f) Face-Up $f; Face-Up-Pant $f },                                                                                       # 0  着地 T0 B0 居中
  { param($f) Face-Up $f; Face-Up-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },    # 1  抬A T1 B1 压左
  { param($f) Face-Up $f; Face-Up-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },   # 2  抬A T2 B1 压左
  { param($f) Face-Up $f; Face-Up-Pant $f; Sway-Tail3 $f },                                                                        # 3  着地 T3 B0 居中
  { param($f) Face-Up $f; Face-Up-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail3 $f; Squash-Top $f },  # 4  抬B T3 B1 压右
  { param($f) Face-Up $f; Face-Up-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail2 $f; Squash-Top $f },  # 5  抬B T2 B1 压右
  { param($f) Face-Up $f; Face-Up-Pant $f; Face-Up-Blink $f; Sway-Tail $f },                                                       # 6  着地 T1 B0 行进眨眼
  { param($f) Face-Up $f; Face-Up-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Squash-Top $f },                  # 7  抬A T0 B1 压左
  { param($f) Face-Up $f; Face-Up-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f },                   # 8  抬A T1 B0 压左
  { param($f) Face-Up $f; Face-Up-Pant $f; Sway-Tail2 $f },                                                                        # 9  着地 T2 B0 居中
  { param($f) Face-Up $f; Face-Up-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Squash-Top $f },   # 10 抬B T1 B1 压右
  { param($f) Face-Up $f; Face-Up-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Squash-Top $f }                  # 11 抬B T0 B1 压右
)

# 往下走 变体 A：w 嘴版
$WALK_DOWN_W = @(
  { param($f) Face-Down $f },                                                                                       # 0  着地 T0 B0 居中
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },    # 1  抬A T1 B1 压左
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },   # 2  抬A T2 B1 压左
  { param($f) Face-Down $f; Sway-Tail3 $f },                                                                        # 3  着地 T3 B0 居中
  { param($f) Face-Down $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail3 $f; Squash-Top $f },  # 4  抬B T3 B1 压右
  { param($f) Face-Down $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail2 $f; Squash-Top $f },  # 5  抬B T2 B1 压右
  { param($f) Face-Down $f; Face-Down-Blink $f; Sway-Tail $f },                                                     # 6  着地 T1 B0 行进眨眼
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Squash-Top $f },                  # 7  抬A T0 B1 压左
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f },                   # 8  抬A T1 B0 压左
  { param($f) Face-Down $f; Sway-Tail2 $f },                                                                        # 9  着地 T2 B0 居中
  { param($f) Face-Down $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Squash-Top $f },   # 10 抬B T1 B1 压右
  { param($f) Face-Down $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Squash-Top $f }                  # 11 抬B T0 B1 压右
)

# 往下走 变体 B：喘气线版
$WALK_DOWN_PANT = @(
  { param($f) Face-Down $f; Face-Down-Pant $f },                                                                                       # 0  着地 T0 B0 居中
  { param($f) Face-Down $f; Face-Down-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },    # 1  抬A T1 B1 压左
  { param($f) Face-Down $f; Face-Down-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Squash-Top $f },   # 2  抬A T2 B1 压左
  { param($f) Face-Down $f; Face-Down-Pant $f; Sway-Tail3 $f },                                                                        # 3  着地 T3 B0 居中
  { param($f) Face-Down $f; Face-Down-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail3 $f; Squash-Top $f },  # 4  抬B T3 B1 压右
  { param($f) Face-Down $f; Face-Down-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail2 $f; Squash-Top $f },  # 5  抬B T2 B1 压右
  { param($f) Face-Down $f; Face-Down-Pant $f; Face-Down-Blink $f; Sway-Tail $f },                                                     # 6  着地 T1 B0 行进眨眼
  { param($f) Face-Down $f; Face-Down-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Squash-Top $f },                  # 7  抬A T0 B1 压左
  { param($f) Face-Down $f; Face-Down-Pant $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f },                   # 8  抬A T1 B0 压左
  { param($f) Face-Down $f; Face-Down-Pant $f; Sway-Tail2 $f },                                                                        # 9  着地 T2 B0 居中
  { param($f) Face-Down $f; Face-Down-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Squash-Top $f },   # 10 抬B T1 B1 压右
  { param($f) Face-Down $f; Face-Down-Pant $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Squash-Top $f }                  # 11 抬B T0 B1 压右
)

Build-Strip "walk-up.png" $WALK_UP_W
Build-Strip "walk-up-pant.png" $WALK_UP_PANT
Build-Strip "walk-down.png" $WALK_DOWN_W
Build-Strip "walk-down-pant.png" $WALK_DOWN_PANT

# ==== walk-stop：拖动松手后的落脚 / 回正过渡（play-once） ====
# 走路本体按固定帧率一致播放；松手后不直接从任意抬腿帧硬切 idle，
# 而是用四拍完成「最后一步落地 → 重心回中 → 五官回正」。四个方向分别
# 保留第一拍的朝向，末帧统一回到底图，随后可无缝接 idle / 对话活动态。
$WALK_STOP = @(
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Squash-Top $f }, # 0 最后一步仍抬着
  { param($f) Sway-Tail2 $f; Squash-Top $f },                                                       # 1 落地压低
  { param($f) Half-Eyes $f; Sway-Tail $f },                                                        # 2 重心回中
  { param($f) }                                                                                     # 3 站稳回正
)
$WALK_STOP_LEFT = @(
  { param($f) Face-Left $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },
  { param($f) Face-Left $f; Sway-Tail2 $f; Squash-Top $f },
  { param($f) Look-Side $f; Sway-Tail $f },
  { param($f) }
)
$WALK_STOP_RIGHT = @(
  { param($f) Face-Right $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f 1; Sway-Tail $f; Squash-Top $f },
  { param($f) Face-Right $f; Sway-Tail2 $f; Squash-Top $f },
  { param($f) Look-Right $f; Sway-Tail $f },
  { param($f) }
)
$WALK_STOP_UP = @(
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Squash-Top $f },
  { param($f) Face-Up $f; Sway-Tail2 $f; Squash-Top $f },
  { param($f) Look-Up $f; Sway-Tail $f },
  { param($f) }
)
$WALK_STOP_DOWN = @(
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Squash-Top $f },
  { param($f) Face-Down $f; Sway-Tail2 $f; Squash-Top $f },
  { param($f) Half-Eyes $f; Sway-Tail $f },
  { param($f) }
)
Build-Strip "walk-stop.png" $WALK_STOP
Build-Strip "walk-stop-left.png" $WALK_STOP_LEFT
Build-Strip "walk-stop-right.png" $WALK_STOP_RIGHT
Build-Strip "walk-stop-up.png" $WALK_STOP_UP
Build-Strip "walk-stop-down.png" $WALK_STOP_DOWN

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

# ==== yawn：打哈欠入睡过渡（play-once → sleeping） ====
# 三幕：睡意上头（半垂眼 + 嘴渐开）→ 大哈欠（闭眼 + 4x3 全张嘴 + 缩脖）
# → 逐帧趴下（Sink 1/2/3 递进、尾巴渐卷）团成猫貌团，末帧与 sleep 首帧无缝
Build-Strip "yawn.png" @(
  { param($f) Half-Eyes $f; Sway-Tail $f },                                  # 0  睡意上头 T1
  { param($f) Half-Eyes $f; Half-Mouth $f; Sway-Tail2 $f },                  # 1  嘴微张 T2
  { param($f) Close-Eyes $f; Open-Mouth $f; Sway-Tail3 $f },                 # 2  哈欠张开 T3
  { param($f) Close-Eyes $f; Yawn-Mouth $f; Sway-Tail3 $f; Squash-Top $f },  # 3  最大 + 缩脖 T3
  { param($f) Close-Eyes $f; Yawn-Mouth $f; Sway-Tail2 $f; Squash-Top $f },  # 4  持续 T2
  { param($f) Close-Eyes $f; Open-Mouth $f; Sway-Tail $f },                  # 5  哈欠收 T1
  { param($f) Half-Eyes $f; Half-Mouth $f; Squash-Top $f },                  # 6  眼皮重 B1
  { param($f) Half-Eyes $f },                                                # 7  迷糊站着
  { param($f) Close-Eyes $f; Sway-Tail $f; Sink $f 1 },                      # 8  开始趴 T1
  { param($f) Close-Eyes $f; Sway-Tail2 $f; Sink $f 2 },                     # 9  再趴 T2
  { param($f) Close-Eyes $f; Sway-Tail3 $f; Sink $f 3 },                     # 10 快贴地 T3
  { param($f) Make-Loaf $f }                                                 # 11 团成猫貌团 → 接 sleeping
)

# ==== stretch：伸懒腰醒来（play-once → idle） ====
# 三幕：趴着睁眼（半睁 → 全睁）→ 撑起站直（Sink 3/2/1 反向）→ 踮脚大伸展
# （Stretch-Up 1/2 腿拉长 + 眯眼张嘴「喵—」）→ 落地抖耳回神
Build-Strip "stretch.png" @(
  { param($f) Make-Loaf $f; Loaf-Eyes-Half $f },                              # 0  趴着半睁眼
  { param($f) Make-Loaf $f; Loaf-Eyes-Open $f },                              # 1  睁全眼
  { param($f) Half-Eyes $f; Sway-Tail3 $f; Sink $f 3 },                       # 2  撑起 T3
  { param($f) Half-Eyes $f; Sway-Tail2 $f; Sink $f 2 },                       # 3  再起 T2
  { param($f) Half-Eyes $f; Sway-Tail $f; Sink $f 1 },                        # 4  快站直 T1
  { param($f) Half-Eyes $f },                                                 # 5  站直
  { param($f) Close-Eyes $f; Open-Mouth $f; Sway-Tail2 $f; Stretch-Up $f 1 }, # 6  踮脚伸展 T2
  { param($f) Close-Eyes $f; Yawn-Mouth $f; Sway-Tail3 $f; Stretch-Up $f 2 }, # 7  伸到最高「喵—」T3
  { param($f) Close-Eyes $f; Open-Mouth $f; Sway-Tail2 $f; Stretch-Up $f 2 }, # 8  保持 T2
  { param($f) Half-Eyes $f; Sway-Tail $f; Stretch-Up $f 1 },                  # 9  落下来 T1
  { param($f) Squash-Top $f },                                                # 10 落地一沉
  { param($f) Sway-Tail $f; Flick-Ear $f }                                    # 11 抖耳回神 → idle
)

# ==== wake-startled：睡梦中受惊弹醒（play-once → idle） ====
# 趴睡耳动 → 半睁/瞪圆确认 → 带「!」整只弹起 → 落地压低 → 左右确认后回神。
Build-Strip "wake-startled.png" @(
  { param($f) Make-Loaf $f },                                                                            # 0  正在熟睡
  { param($f) Make-Loaf $f; Loaf-FlickEar $f },                                                          # 1  耳朵先听见动静
  { param($f) Make-Loaf $f; Loaf-Eyes-Half $f; Loaf-FlickEar $f },                                      # 2  迷糊半睁
  { param($f) Make-Loaf $f; Loaf-Eyes-Open $f; Alert-Mark $f },                                         # 3  突然看清「!」
  { param($f) Wide-Eyes $f; Open-Mouth $f; Flare-Ears $f; Sway-Tail3 $f; Hop $f 2; Alert-Mark $f },     # 4  整只弹起 H2
  { param($f) Wide-Eyes $f; Open-Mouth $f; Flare-Ears $f; Sway-Tail2 $f; Hop $f 1; Alert-Mark $f },     # 5  回落 H1
  { param($f) Wide-Eyes $f; Half-Mouth $f; Sway-Tail $f; Squash-Top $f; Alert-Mark $f },                 # 6  落地一沉
  { param($f) Wide-Eyes $f; Half-Mouth $f; Sway-Tail2 $f },                                             # 7  站直仍发愣
  { param($f) Half-Eyes $f; Look-Side $f; Sway-Tail3 $f },                                              # 8  往左确认
  { param($f) Look-Right $f; Sway-Tail2 $f },                                                            # 9  往右确认
  { param($f) Half-Eyes $f; Sway-Tail $f; Flick-Ear $f },                                               # 10 放松眨眼
  { param($f) Sway-Tail2 $f }                                                                            # 11 尾巴收住 → idle
)

# ==== wake-dream：做了美梦自然醒（play-once → idle） ====
# 爱心从梦里上飘 → 笑着睁眼 → 慢慢撑起 → 开心小跳一下再站稳。
Build-Strip "wake-dream.png" @(
  { param($f) Make-Loaf $f; Dream-Heart $f 24 3 },                                      # 0  梦里冒出爱心
  { param($f) Make-Loaf $f; Loaf-Eyes-Happy $f; Loaf-Blush $f; Dream-Heart $f 23 2 },   # 1  笑着睡
  { param($f) Make-Loaf $f; Loaf-Eyes-Happy $f; Loaf-Blush $f; Loaf-TipUp $f; Dream-Heart $f 22 1 }, # 2  爱心上飘
  { param($f) Make-Loaf $f; Loaf-Eyes-Half $f; Loaf-Blush $f; Dream-Heart $f 21 0 },     # 3  开心半睁
  { param($f) Half-Eyes $f; Add-Blush $f; Sway-Tail3 $f; Sink $f 3 },                    # 4  慢慢撑起 T3
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail2 $f; Sink $f 2 },                   # 5  撑起 T2
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail $f; Sink $f 1 },                    # 6  快站直 T1
  { param($f) Happy-Eyes $f; Add-Blush $f; Half-Mouth $f },                              # 7  醒来偷笑
  { param($f) Happy-Eyes $f; Add-Blush $f; Open-Mouth $f; Sway-Tail $f; Hop $f 1 },      # 8  开心小跳 H1
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail2 $f; Squash-Top $f },               # 9  落地一沉
  { param($f) Happy-Eyes $f; Add-Blush $f; Sway-Tail $f },                               # 10 余韵
  { param($f) Add-Blush $f; Flick-Ear $f }                                               # 11 睁眼抖耳 → idle
)

# ==== dangle：拖拽悬空（循环，拖窗时播放） ====
# 被拎起来：整身离地（Hop 1/2 摆荡）+ 对角双腿交替蹬空 + 尾巴大幅乱甩
# + 口型 w/半张/惊呼轮换、耳朵偶尔被风掀一下。Hop 必须是每帧最后一个 op
Build-Strip "dangle.png" @(
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Sway-Tail $f; Hop $f 1 },                                 # 0  H1 蹬A T1
  { param($f) Half-Mouth $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Sway-Tail2 $f; Hop $f 1 },               # 1  H1 蹬B T2
  { param($f) Open-Mouth $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Sway-Tail3 $f; Hop $f 2 },                 # 2  H2 蹬A T3 惊呼
  { param($f) Open-Mouth $f; Flick-Ear $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Sway-Tail3 $f; Hop $f 2 }, # 3  H2 蹬B T3 耳飞
  { param($f) Half-Mouth $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Sway-Tail2 $f; Hop $f 2 },                 # 4  H2 蹬A T2
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Sway-Tail $f; Hop $f 1 },                               # 5  H1 蹬B T1
  { param($f) Half-Mouth $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Hop $f 1 },                                # 6  H1 蹬A T0
  { param($f) Open-Mouth $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Sway-Tail $f; Hop $f 2 },                # 7  H2 蹬B T1
  { param($f) Open-Mouth $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Sway-Tail2 $f; Hop $f 2 },                 # 8  H2 蹬A T2
  { param($f) Half-Mouth $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Sway-Tail3 $f; Hop $f 1 },               # 9  H1 蹬B T3
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Sway-Tail2 $f; Hop $f 1 },                                # 10 H1 蹬A T2
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Hop $f 1 }                                              # 11 H1 蹬B T0 → 接回帧 0
)

# ==== greet：登场打招呼（play-once → idle，召唤到桌面时播一次） ====
# 三幕：蹦跳落地（Hop 2/1 + 落地压缩）→ 左前腿举起挥手「嗨！」（Wave-Leg
# 收腿化挥爪，地上只剩三条腿；开心眯眼 + 口型轮换）→ 收腿落地腮红回常态。
# 起手/收手各有一帧 Lift-Leg 抬腿过渡，腿的去向连贯
Build-Strip "greet.png" @(
  { param($f) Happy-Eyes $f; Open-Mouth $f; Sway-Tail $f; Hop $f 2 },         # 0  跳着登场 H2
  { param($f) Happy-Eyes $f; Open-Mouth $f; Sway-Tail2 $f; Hop $f 1 },        # 1  落下中 H1
  { param($f) Happy-Eyes $f; Sway-Tail $f; Squash-Top $f },                   # 2  落地压缩
  { param($f) Happy-Eyes $f },                                                # 3  站稳
  { param($f) Happy-Eyes $f; Lift-Leg $f 5 8; Sway-Tail $f },                 # 4  左前腿离地起手 T1
  { param($f) Happy-Eyes $f; Open-Mouth $f; Wave-Leg $f 11; Sway-Tail2 $f },  # 5  举到高位「嗨！」T2
  { param($f) Happy-Eyes $f; Open-Mouth $f; Wave-Leg $f 13; Sway-Tail3 $f },  # 6  挥下 T3
  { param($f) Happy-Eyes $f; Wave-Leg $f 11; Sway-Tail2 $f },                 # 7  再挥上 T2
  { param($f) Happy-Eyes $f; Half-Mouth $f; Wave-Leg $f 13; Sway-Tail $f },   # 8  再挥下 T1
  { param($f) Happy-Eyes $f; Add-Blush $f; Wave-Leg $f 11; Sway-Tail $f },    # 9  高位定格小害羞 T1
  { param($f) Happy-Eyes $f; Add-Blush $f; Lift-Leg $f 5 8; Sway-Tail2 $f },  # 10 收腿落地中 T2
  { param($f) Add-Blush $f }                                                  # 11 四腿站稳 + 腮红 → idle
)

# ---- 躲屏幕边缘道具（hide / hidden 用） ----
# 整画布左移 $px：跑出画面的像素直接裁掉（身体滑出屏幕边）。必须是该帧
# 最后一个身体 op（速度线/尘土这类留在原地的场景装饰在它之后按绝对坐标画）
function Slide-Left([System.Drawing.Bitmap]$bmp, [int]$px) {
  Shift-Region $bmp 0 0 31 31 (-$px) 0
}

# 整画布向上/下滑：纵向藏边用。与 Slide-Left 相同，须放在身体动作最后
function Slide-Up([System.Drawing.Bitmap]$bmp, [int]$px) {
  Shift-Region $bmp 0 0 31 31 0 (-$px)
}
function Slide-Down([System.Drawing.Bitmap]$bmp, [int]$px) {
  Shift-Region $bmp 0 0 31 31 0 $px
}

# 底部只留双耳时去掉右侧竖尾，避免尾尖与耳朵一起从边缘露出来
function Hide-Standing-Tail([System.Drawing.Bitmap]$bmp) {
  Shift-Region $bmp 27 6 31 16 6 0
}

# 冲刺速度线：身后三条 3px 灰短线（y12/17/22 交错），$x0 = 三条线的最左列。
# 在 Slide-Left 之后画——落在身体腾出来的空区，跟着每帧的车尾走
function Dash-Lines([System.Drawing.Bitmap]$bmp, [int]$x0) {
  Set-Px $bmp @(($x0 + 1), ($x0 + 2), ($x0 + 3)) 12 $TGREY
  Set-Px $bmp @($x0, ($x0 + 1), ($x0 + 2)) 17 $TGREY
  Set-Px $bmp @(($x0 + 1), ($x0 + 2), ($x0 + 3)) 22 $TGREY
}

# 消失尘土：跑没影处地边扬起的灰粒（大 4 粒 → 小 2 粒两档渐散），
# Slide-Left 之后画；位置避开左移后的尾巴列（x2-6）下方留白区
function Dust-Big([System.Drawing.Bitmap]$bmp) {
  $bmp.SetPixel(6, 25, $TGREY)
  $bmp.SetPixel(8, 26, $TGREY)
  $bmp.SetPixel(5, 27, $TGREY)
  $bmp.SetPixel(9, 27, $TGREY)
}
function Dust-Small([System.Drawing.Bitmap]$bmp) {
  $bmp.SetPixel(7, 26, $TGREY)
  $bmp.SetPixel(6, 27, $TGREY)
}

# 尾巴松垂：竖尾上段（x28-31 y6-14）下沉 1px——顶帽降一格、尾巴显短一截，
# 露在屏幕外的尾巴「泄劲搭下来」用。与 Sway 组合须先垂后摆（摆区能罩住垂完的列）
function Tail-Sag([System.Drawing.Bitmap]$bmp) { Shift-Region $bmp 28 6 31 14 0 1 }

# ==== hide / hidden / peek：躲屏幕边缘（全屏应用来了，闪人！） ====
# hide（play-once → hidden）三幕：惊觉（左瞟 + 「!」+ 弹起）→ 压低蓄力 →
# 左冲出画（Slide-Left 3/7/12/17/21/24 递进 + 走路步态 + 身后速度线）→
# 消失扬尘，末帧只剩尾巴（Slide 25：尾巴挪到 x3-6、屁股沿贴边 x0-1）。
# hidden（循环）：近静态只剩尾巴。peek（play-once → hidden）：探头偷看，
# 播放侧随机 1-3 分钟才定时触发一次。右侧版一律 Add-Flip 整帧镜像
$HIDE_LEFT = @(
  { param($f) Look-Side $f; Flick-Ear $f; Alert-Mark $f },                                                            # 0  惊觉：左瞟 + 耳抖 + 「!」
  { param($f) Look-Side $f; Open-Mouth $f; Sway-Tail $f; Hop $f 1; Alert-Mark $f },                                   # 1  吓得弹起（「!」悬停原地）
  { param($f) Face-Left $f; Sway-Tail2 $f; Legs-Shift $f -1; Squash-Top $f },                                         # 2  压低蓄力朝左
  { param($f) Face-Left $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Slide-Left $f 3 },   # 3  起跑 S3
  { param($f) Face-Left $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail3 $f; Slide-Left $f 7; Dash-Lines $f 27 },  # 4  加速 S7
  { param($f) Face-Left $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Slide-Left $f 12; Dash-Lines $f 23 },   # 5  半出画 S12
  { param($f) Face-Left $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Sway-Tail $f; Slide-Left $f 17; Dash-Lines $f 18 },  # 6  大半出画 S17
  { param($f) Face-Left $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Slide-Left $f 21; Dash-Lines $f 14 },                  # 7  只剩后身 S21
  { param($f) Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f -1; Slide-Left $f 24; Dash-Lines $f 10 },                              # 8  只剩后腿尾巴 S24
  { param($f) Sway-Tail $f; Slide-Left $f 25; Dust-Big $f },                                                          # 9  溜没了 T1 扬尘
  { param($f) Sway-Tail2 $f; Slide-Left $f 25; Dust-Small $f },                                                       # 10 尘散 T2
  { param($f) Sway-Tail $f; Slide-Left $f 25 }                                                                        # 11 只剩尾巴 T1 → 接 hidden
)

# hidden 循环：近静态——只剩尾巴，6 帧独立姿势（摆相 × 松垂），驻留节奏
# （长停 + 偶发一摆）由播放侧 sequence 编排（重复帧号 = 定格，不算凑数帧）
$HIDDEN_LEFT = @(
  { param($f) Slide-Left $f 25 },                              # 0  T0 尾巴立正（驻留主帧）
  { param($f) Sway-Tail $f; Slide-Left $f 25 },                # 1  T1
  { param($f) Sway-Tail2 $f; Slide-Left $f 25 },               # 2  T2
  { param($f) Sway-Tail3 $f; Slide-Left $f 25 },               # 3  T3 摆到最弯
  { param($f) Tail-Sag $f; Slide-Left $f 25 },                 # 4  T0 松垂
  { param($f) Tail-Sag $f; Sway-Tail $f; Slide-Left $f 25 }    # 5  T1 垂着轻摆
)

# peek 探头（play-once → hidden）：藏久了忍不住——蹭出来两步 → 右眼粉耳
# 探出画缘（Slide 20：右眼 x20-21 刚好露出）→ 眨眼/尾摇张望几拍 → 缩回去
$PEEK_LEFT = @(
  { param($f) Slide-Left $f 24 },                              # 0  蹭出 1px
  { param($f) Slide-Left $f 22 },                              # 1  再蹭
  { param($f) Slide-Left $f 20 },                              # 2  探到位（右眼露出）
  { param($f) Half-Eyes $f; Slide-Left $f 20 },                # 3  眨眼
  { param($f) Sway-Tail $f; Slide-Left $f 20 },                # 4  张望 T1
  { param($f) Sway-Tail2 $f; Slide-Left $f 20 },               # 5  T2
  { param($f) Sway-Tail3 $f; Slide-Left $f 20 },               # 6  T3
  { param($f) Half-Eyes $f; Sway-Tail2 $f; Slide-Left $f 20 }, # 7  再眨 T2
  { param($f) Sway-Tail $f; Slide-Left $f 21 },                # 8  开始缩 T1
  { param($f) Sway-Tail $f; Slide-Left $f 22 },                # 9  缩 T1
  { param($f) Sway-Tail $f; Slide-Left $f 23 },                # 10 缩 T1
  { param($f) Sway-Tail $f; Slide-Left $f 24 }                 # 11 缩到只剩尾巴 → 接 hidden
)

# unhide 召回（play-once → idle）：藏够了 / 被叫回来——从只剩尾巴跑回画面。
# 三幕：尾巴一挺来精神 → 探头确认（露眼、眨眼）→ 面朝屏内小跑滑回
# （Face-Right + 走路步态，Slide 20→16→11→6→2 递减把身子拉回画中）→ 转正脸
# 刹车下压、尾巴一甩、抖耳回神。首帧 Slide 25 与 hidden 无缝衔接。
#
# 拆两段是因为收尾必须干净落回 idle（idle 非左右对称——尾巴恒在猫的右侧）：
#  · 「跑回」段 0-8（探头 + 朝右奔跑）左右各异，右侧走 Add-Flip 整帧镜像；
#  · 「站定」段 9-11（转正脸的落地收尾）左右共用同一份不镜像帧——尾巴一律
#    落在 home 右列，与 idle 首帧严丝合缝（否则镜像会把整只猫翻面、末帧交接
#    idle 时瞬间镜像跳变）。右侧那不可避免的「尾巴换边」被放在 8→9 转身这拍，
#    由转正脸的大动作盖住（猫转身尾巴顺势甩过来，合情合理），不落在静止收尾
$UNHIDE_RUN_L = @(
  { param($f) Slide-Left $f 25 },                                                                                    # 0  尾巴立正（衔接 hidden）
  { param($f) Sway-Tail2 $f; Slide-Left $f 25 },                                                                     # 1  尾巴一挺，来精神
  { param($f) Sway-Tail $f; Slide-Left $f 22 },                                                                      # 2  蹭出来一点
  { param($f) Slide-Left $f 20 },                                                                                    # 3  探头（右眼露出）望画里
  { param($f) Half-Eyes $f; Slide-Left $f 20 },                                                                      # 4  眨个眼确认
  { param($f) Face-Right $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Slide-Left $f 16 }, # 5  朝画里起跑 S16
  { param($f) Face-Right $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail2 $f; Slide-Left $f 11 }, # 6  加速跑回 S11
  { param($f) Face-Right $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Slide-Left $f 6 },  # 7  快到位 S6
  { param($f) Face-Right $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail2 $f; Slide-Left $f 2 }  # 8  最后一步 S2
)

# 站定收尾（左右共用，不镜像）：转正脸落地压缩 → 弹起甩尾 → 抖耳，尾巴恒在
# home 右列，末帧几乎等同 idle 首帧（仅差一个耳抖），交接 idle 无跳变
$UNHIDE_SETTLE = @(
  { param($f) Squash-Top $f },     # 9  转正脸、刹车下压落地
  { param($f) Sway-Tail $f },      # 10 弹起、尾巴一甩
  { param($f) Flick-Ear $f }       # 11 抖耳回神 → idle
)

Build-Strip "hide-left.png" $HIDE_LEFT
Build-Strip "hidden-left.png" $HIDDEN_LEFT
Build-Strip "peek-left.png" $PEEK_LEFT
Build-Strip "unhide-left.png" ($UNHIDE_RUN_L + $UNHIDE_SETTLE)
Build-Strip "hide-right.png" (Add-Flip $HIDE_LEFT)
Build-Strip "hidden-right.png" (Add-Flip $HIDDEN_LEFT)
Build-Strip "peek-right.png" (Add-Flip $PEEK_LEFT)
# 右侧：跑回段镜像 + 站定段共用不镜像（收尾干净落回 idle）
Build-Strip "unhide-right.png" ((Add-Flip $UNHIDE_RUN_L) + $UNHIDE_SETTLE)

# ==== hide-down / hide-up：纵向藏边视觉原型（暂未接状态机） ====
# 底部：低头确认 → 一步步下沉 → 清掉竖尾，只留下完整双耳。
$HIDE_DOWN = @(
  { param($f) Face-Down $f; Bend-Ear $f; Alert-Mark $f },                                                                   # 0  发现压到下边缘
  { param($f) Face-Down $f; Open-Mouth $f; Hop $f 1; Alert-Mark $f },                                                       # 1  吓一跳
  { param($f) Face-Down $f; Squash-Top $f },                                                                                # 2  压低准备往下走
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Slide-Down $f 4 },                       # 3  第一步 D4
  { param($f) Face-Down $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Slide-Down $f 8 },       # 4  第二步 D8
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Slide-Down $f 12 },      # 5  半身下沉
  { param($f) Face-Down $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Slide-Down $f 16 },      # 6  只剩上半身
  { param($f) Face-Down $f; Half-Eyes $f; Sway-Tail2 $f; Slide-Down $f 19 },                                                # 7  眼睛沉到边缘
  { param($f) Face-Down $f; Hide-Standing-Tail $f; Slide-Down $f 20 },                                                      # 8  额头与耳朵
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 21 },                                                                    # 9  再缩一点
  { param($f) Bend-Ear $f; Hide-Standing-Tail $f; Slide-Down $f 22 },                                                       # 10 右耳轻动
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 22 }                                                                     # 11 双耳藏好 → hidden-down
)

# 双耳待机：主帧长驻，偶尔单耳/双耳动一下或一起压低一像素；播放节奏后续沿用 HIDDEN_SEQ。
$HIDDEN_DOWN = @(
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 22 },                                              # 0  双耳主帧
  { param($f) Bend-Ear $f; Hide-Standing-Tail $f; Slide-Down $f 22 },                                 # 1  右耳被轻轻揪弯
  { param($f) Bend-Ear-Left $f; Hide-Standing-Tail $f; Slide-Down $f 22 },                            # 2  左耳被轻轻揪弯
  { param($f) Bend-Ear $f; Bend-Ear-Left $f; Hide-Standing-Tail $f; Slide-Down $f 22 },               # 3  双耳一起弯
  { param($f) Squash-Top $f; Hide-Standing-Tail $f; Slide-Down $f 22 },                               # 4  两耳压低
  { param($f) Bend-Ear $f; Squash-Top $f; Hide-Standing-Tail $f; Slide-Down $f 22 }                   # 5  压低时弯右耳
)

# 底部探头：从双耳逐步露到眼睛，左右确认/眨眼后再缩回双耳。
$PEEK_DOWN = @(
  { param($f) Bend-Ear-Left $f; Hide-Standing-Tail $f; Slide-Down $f 22 },            # 0  左耳先弯一下再探头
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 20 },                              # 1  额头露出
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 18 },                              # 2  眉弓露出
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 16 },                              # 3  双眼探出
  { param($f) Look-Side $f; Hide-Standing-Tail $f; Slide-Down $f 16 },                # 4  看左边
  { param($f) Half-Eyes $f; Hide-Standing-Tail $f; Slide-Down $f 16 },                # 5  眨眼
  { param($f) Look-Right $f; Hide-Standing-Tail $f; Slide-Down $f 16 },               # 6  看右边
  { param($f) Bend-Ear $f; Hide-Standing-Tail $f; Slide-Down $f 16 },                 # 7  弯耳确认
  { param($f) Half-Eyes $f; Hide-Standing-Tail $f; Slide-Down $f 17 },                # 8  开始缩回
  { param($f) Look-Right $f; Hide-Standing-Tail $f; Slide-Down $f 18 },               # 9  边缩边看
  { param($f) Bend-Ear $f; Hide-Standing-Tail $f; Slide-Down $f 20 },                 # 10 只剩额头
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 22 }                               # 11 回到双耳
)

# 顶部：先正常朝上完整走出画面，空一拍后倒挂回来露双耳；之后待机/探头直接
# 垂直镜像底部版本，因此顶部探头是一只倒挂着往下看的猫。
$HIDE_UP = @(
  { param($f) Face-Up $f; Bend-Ear $f; Alert-Mark $f },                                                                   # 0  发现顶边
  { param($f) Face-Up $f; Open-Mouth $f; Hop $f 1; Alert-Mark $f },                                                       # 1  吓一跳
  { param($f) Face-Up $f; Squash-Top $f },                                                                                # 2  蓄力向上
  { param($f) Face-Up $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Slide-Up $f 4 },                         # 3  第一步 U4
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Slide-Up $f 8 },         # 4  第二步 U8
  { param($f) Face-Up $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Slide-Up $f 12 },        # 5  半身离场
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Slide-Up $f 17 },        # 6  只剩下半身
  { param($f) Lift-Leg $f 5 8; Lift-Leg $f 16 19; Slide-Up $f 23 },                                                       # 7  脚尖离场
  { param($f) Slide-Up $f 32 },                                                                                            # 8  完全消失（播放时驻留一拍）
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 28; Flip-V $f },                                                       # 9  倒挂耳尖回来
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 25; Flip-V $f },                                                       # 10 倒挂耳朵露出
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 22; Flip-V $f }                                                        # 11 双耳藏好 → hidden-up
)

# 底部召回：双耳先弯一下回应 → 逐步向上走回画面 → 落脚回正。
$UNHIDE_DOWN = @(
  { param($f) Bend-Ear-Left $f; Hide-Standing-Tail $f; Slide-Down $f 22 },                                               # 0  左耳回应
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 20 },                                                                 # 1  额头出现
  { param($f) Look-Side $f; Hide-Standing-Tail $f; Slide-Down $f 18 },                                                   # 2  眼睛确认
  { param($f) Face-Up $f; Hide-Standing-Tail $f; Slide-Down $f 15 },                                                     # 3  仰头准备上来
  { param($f) Face-Up $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Slide-Down $f 12 },                     # 4  第一步
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Slide-Down $f 8 },      # 5  第二步
  { param($f) Face-Up $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail2 $f; Slide-Down $f 4 },     # 6  大半回来
  { param($f) Face-Up $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail $f; Slide-Down $f 1 },      # 7  最后一步
  { param($f) Face-Up $f; Half-Eyes $f; Sway-Tail2 $f },                                                                # 8  回到画内眨眼
  { param($f) Squash-Top $f },                                                                                            # 9  落脚压低
  { param($f) Sway-Tail $f },                                                                                             # 10 弹回
  { param($f) Flick-Ear $f }                                                                                              # 11 抖耳站稳 → idle
)

# 顶部召回：倒挂双耳先缩回并完全消失，再恢复正常方向、脚先着边向下走回。
$UNHIDE_UP = @(
  { param($f) Bend-Ear $f; Hide-Standing-Tail $f; Slide-Down $f 22; Flip-V $f },                                         # 0  倒挂右耳回应
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 25; Flip-V $f },                                                       # 1  倒挂耳朵缩回
  { param($f) Hide-Standing-Tail $f; Slide-Down $f 28; Flip-V $f },                                                       # 2  只剩耳尖
  { param($f) Slide-Up $f 32 },                                                                                            # 3  完全消失、翻回正常方向
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Slide-Up $f 25 },                                       # 4  正常方向脚尖先回来
  { param($f) Face-Down $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Slide-Up $f 20 },                    # 5  下半身出现
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Slide-Up $f 14 },      # 6  半身回来
  { param($f) Face-Down $f; Lift-Leg $f 10 13; Lift-Leg $f 21 24; Legs-Shift $f 1; Sway-Tail2 $f; Slide-Up $f 8 },     # 7  继续向下
  { param($f) Face-Down $f; Lift-Leg $f 5 8; Lift-Leg $f 16 19; Legs-Shift $f -1; Sway-Tail $f; Slide-Up $f 3 },       # 8  最后一步
  { param($f) Squash-Top $f },                                                                                            # 9  落脚压低
  { param($f) Sway-Tail $f },                                                                                             # 10 弹回
  { param($f) Flick-Ear $f }                                                                                              # 11 抖耳站稳 → idle
)

Build-Strip "hide-down.png" $HIDE_DOWN
Build-Strip "hidden-down.png" $HIDDEN_DOWN
Build-Strip "peek-down.png" $PEEK_DOWN
Build-Strip "unhide-down.png" $UNHIDE_DOWN
Build-Strip "hide-up.png" $HIDE_UP
Build-Strip "hidden-up.png" (Add-FlipV $HIDDEN_DOWN)
Build-Strip "peek-up.png" (Add-FlipV $PEEK_DOWN)
Build-Strip "unhide-up.png" $UNHIDE_UP

# ==== think：思考中（循环，将来接对话窗事件桥的深度思考等待阶段） ====
# 右前腿举起托腮（Think-Paw，地上三条腿），头顶「…」点点逐帧冒出又散去，
# 眼神上瞟 → 侧瞟 → 眯眼轮换，配呼吸和慢速尾摆。op 顺序：眼/尾 → 托腮 →
# 呼吸压缩 → 点点（悬浮物最后画，不随头动）
# 整画布下沉 $px：坠出画布底的像素直接裁掉——身体大部分藏在画面下边，
# 只露头顶（从底边探出来的入场戏用）。绝对坐标的五官/耳朵 op 先做，
# 本 op 必须是该帧最后一个身体 op（同 Slide-Left 的约定）
function Sink-Deep([System.Drawing.Bitmap]$bmp, [int]$px) {
  Shift-Region $bmp 0 0 31 31 0 $px
}

# ==== enter：入场登台（play-once → greeting，召唤上桌 / 启动时播） ====
# 三幕：底边先冒耳朵尖（S25→S22→S19 逐帧上浮）→ 眼睛探出来（S16，嘴还
# 埋在画外）左右张望、尾巴尖跟着在右缘冒头轻摆、安心眨个眼 → 缩下去蓄力
# （S19 只剩耳朵 + 耳尖压平）→「蹦！」一帧直上跃出画面顶点（Hop 2 开心脸），
# 播完接 greeting 从同款腾空姿势落地挥手，整套登场一气呵成。
# 张望/蓄力的驻留节奏由播放侧 sequence 编排（重复帧号 = 定格）
Build-Strip "enter.png" @(
  { param($f) Sink-Deep $f 29 },                                       # 0  全埋（空帧起手，从无到有）
  { param($f) Sink-Deep $f 25 },                                       # 1  耳朵尖冒出来
  { param($f) Sink-Deep $f 22 },                                       # 2  两耳全露
  { param($f) Sink-Deep $f 19 },                                       # 3  露到眉弓（眼睛还藏着）
  { param($f) Sink-Deep $f 16 },                                       # 4  眼睛探出！正视
  { param($f) Look-Side $f; Sink-Deep $f 16 },                         # 5  瞟左
  { param($f) Look-Side $f; Sway-Tail $f; Sink-Deep $f 16 },           # 6  瞟左 + 尾尖轻摆
  { param($f) Look-Right $f; Sink-Deep $f 16 },                        # 7  瞟右
  { param($f) Look-Right $f; Sway-Tail $f; Sink-Deep $f 16 },          # 8  瞟右 + 尾尖轻摆
  { param($f) Half-Eyes $f; Sink-Deep $f 16 },                         # 9  确认安全，安心眨眼
  { param($f) Flick-Ear $f; Sink-Deep $f 19 },                         # 10 缩下去蓄力（耳尖压平）
  { param($f) Happy-Eyes $f; Open-Mouth $f; Sway-Tail2 $f; Hop $f 2 }  # 11 蹦！跃出顶点 → 接 greeting 落地挥手
)

Build-Strip "think.png" @(
  { param($f) Look-Up $f; Think-Paw $f; Think-Dots $f 1 },                               # 0  上瞟 ·   T0
  { param($f) Look-Up $f; Sway-Tail $f; Think-Paw $f; Think-Dots $f 2 },                 # 1  上瞟 ··  T1
  { param($f) Look-Up $f; Sway-Tail2 $f; Think-Paw $f; Think-Dots $f 3 },                # 2  上瞟 ··· T2
  { param($f) Look-Up $f; Sway-Tail2 $f; Think-Paw $f; Squash-Top $f; Think-Dots $f 3 }, # 3  持续 ··· T2 B1
  { param($f) Look-Side $f; Sway-Tail $f; Think-Paw $f; Think-Dots $f 3 },               # 4  目光飘走 ··· T1
  { param($f) Look-Side $f; Think-Paw $f; Squash-Top $f; Think-Dots $f 3 },              # 5  侧瞟 ··· T0 B1
  { param($f) Look-Side $f; Sway-Tail $f; Think-Paw $f },                                # 6  点点散了 T1
  { param($f) Half-Eyes $f; Sway-Tail2 $f; Think-Paw $f; Think-Dots $f 1 },              # 7  眯眼再想 · T2
  { param($f) Half-Eyes $f; Sway-Tail2 $f; Think-Paw $f; Squash-Top $f; Think-Dots $f 2 },# 8  眯眼 ·· T2 B1
  { param($f) Half-Eyes $f; Sway-Tail $f; Think-Paw $f; Think-Dots $f 3 },               # 9  眯眼 ··· T1
  { param($f) Look-Up $f; Sway-Tail $f; Think-Paw $f; Squash-Top $f; Think-Dots $f 3 },  # 10 回神上瞟 ··· T1 B1
  { param($f) Look-Up $f; Think-Paw $f; Squash-Top $f }                                  # 11 空点点 T0 B1 → 接回帧 0
)

# ---- 搜索道具（search 用） ----
# 头顶问号「?」：3 宽 6 高，(x0,y0) 左上角。悬浮标记——疑惑时冒出来
function Question-Mark([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$y0) {
  Set-Px $bmp @($x0, ($x0 + 1), ($x0 + 2)) $y0 $DARK        # 顶横
  $bmp.SetPixel(($x0 + 2), ($y0 + 1), $DARK)                # 右肩下折
  Set-Px $bmp @(($x0 + 1), ($x0 + 2)) ($y0 + 2) $DARK       # 勾回中
  $bmp.SetPixel(($x0 + 1), ($y0 + 3), $DARK)                # 短茎
  $bmp.SetPixel(($x0 + 1), ($y0 + 5), $DARK)                # 悬点
}

# 挑眉：右眼上方一道 3px 眉线（外高内低）——疑惑/端详的表情底。
# 放大镜端详左眼时，右眼这侧挑眉，凑出「一大一挑」的不对称疑惑脸
function Puzzle-Brow([System.Drawing.Bitmap]$bmp) {
  $bmp.SetPixel(22, 10, $DARK)
  $bmp.SetPixel(21, 11, $DARK)
  $bmp.SetPixel(20, 11, $DARK)
}

# 放大镜：镜框环（DARK 7x7，中心 9,13 罩住左眼）+ 镜内放大的左眼（3x3 大瞳
# + 高光 + 反光）+ 斜柄 + 握柄白爪（左前腿 x5-8 收起，地上剩三条腿）。举在
# 左眼前端详的道具，放左侧让开右侧竖尾。
#   $dy   = 整体上下浮动（举镜端详的微动，0 = 定位基准；镜框/柄/爪/镜内眼齐动）
#   $look = 镜内大瞳左右瞟（-1 左 / 0 中 / +1 右，扫视时跟着动）
#   $blink= 真则镜内闭眼（一道横线，眨那只大眼）
function Draw-Magnifier([System.Drawing.Bitmap]$bmp, [int]$dy = 0, [int]$look = 0, [bool]$blink = $false) {
  # 镜框环（半径 3，中心 9,13）
  Set-Px $bmp @(8, 9, 10) (10 + $dy) $DARK
  Set-Px $bmp @(7, 11) (11 + $dy) $DARK
  Set-Px $bmp @(6, 12) (12 + $dy) $DARK
  Set-Px $bmp @(6, 12) (13 + $dy) $DARK
  Set-Px $bmp @(6, 12) (14 + $dy) $DARK
  Set-Px $bmp @(7, 11) (15 + $dy) $DARK
  Set-Px $bmp @(8, 9, 10) (16 + $dy) $DARK
  # 擦原左眼 2x2
  Set-Px $bmp @(8, 9) 13 $BODY
  Set-Px $bmp @(8, 9) 14 $BODY
  if ($blink) {
    Set-Px $bmp @(7, 8, 9, 10, 11) (13 + $dy) $DARK   # 镜内闭眼横线
  } else {
    # 镜内放大瞳（3x3，随 $look 左右瞟）+ 左上高光
    $p = 8 + $look
    Set-Px $bmp @($p, ($p + 1), ($p + 2)) (12 + $dy) $DARK
    Set-Px $bmp @($p, ($p + 1), ($p + 2)) (13 + $dy) $DARK
    Set-Px $bmp @($p, ($p + 1), ($p + 2)) (14 + $dy) $DARK
    $bmp.SetPixel($p, (12 + $dy), $WHITE)
  }
  $bmp.SetPixel(10, (11 + $dy), $WHITE)                # 玻璃反光（内壁上沿）
  # 斜柄（镜框左下 → 握爪，2px 阶梯）
  $bmp.SetPixel(7, (17 + $dy), $DARK); $bmp.SetPixel(6, (17 + $dy), $DARK)
  $bmp.SetPixel(6, (18 + $dy), $DARK); $bmp.SetPixel(5, (18 + $dy), $DARK)
  $bmp.SetPixel(5, (19 + $dy), $DARK); $bmp.SetPixel(4, (19 + $dy), $DARK)
  # 握柄白爪（收起左前腿）
  for ($y = 25; $y -le 28; $y++) { for ($x = 5; $x -le 8; $x++) { $bmp.SetPixel($x, $y, $CLEAR) } }
  Set-Px $bmp @(3, 4, 5) (20 + $dy) $DARK
  $bmp.SetPixel(3, (21 + $dy), $DARK); $bmp.SetPixel(4, (21 + $dy), $WHITE); $bmp.SetPixel(5, (21 + $dy), $DARK)
  Set-Px $bmp @(3, 4, 5) (22 + $dy) $DARK
}

# 挑眉（左眼版）：左眼上方一道 3px 眉线——放大镜端详右眼时，左眼这侧挑眉，
# 凑出「一大一挑」的不对称疑惑脸（右眼版 Puzzle-Brow 的镜像）
function Puzzle-Brow-L([System.Drawing.Bitmap]$bmp) {
  $bmp.SetPixel(9, 10, $DARK)
  $bmp.SetPixel(10, 11, $DARK)
  $bmp.SetPixel(11, 11, $DARK)
}

# 放大镜·右眼版：镜框环（DARK 7x7，中心 21,13 罩住右眼）+ 镜内放大的右眼
# （3x3 大瞳 + 高光 + 反光）+ 斜柄 + 握柄白爪（右前腿 x21-24 收起，地上剩三条
# 腿）。举在右眼前端详——左眼版整套挪到右侧，握爪贴在竖尾前方。参数同左眼版：
#   $dy=举镜微浮  $look=镜内大瞳左右瞟  $blink=眨大眼
function Draw-Magnifier-R([System.Drawing.Bitmap]$bmp, [int]$dy = 0, [int]$look = 0, [bool]$blink = $false) {
  # 镜框环（半径 3，中心 21,13）
  Set-Px $bmp @(20, 21, 22) (10 + $dy) $DARK
  Set-Px $bmp @(19, 23) (11 + $dy) $DARK
  Set-Px $bmp @(18, 24) (12 + $dy) $DARK
  Set-Px $bmp @(18, 24) (13 + $dy) $DARK
  Set-Px $bmp @(18, 24) (14 + $dy) $DARK
  Set-Px $bmp @(19, 23) (15 + $dy) $DARK
  Set-Px $bmp @(20, 21, 22) (16 + $dy) $DARK
  # 擦原右眼 2x2
  Set-Px $bmp @(20, 21) 13 $BODY
  Set-Px $bmp @(20, 21) 14 $BODY
  if ($blink) {
    Set-Px $bmp @(19, 20, 21, 22, 23) (13 + $dy) $DARK   # 镜内闭眼横线
  } else {
    # 镜内放大瞳（3x3，随 $look 左右瞟）+ 左上高光
    $p = 20 + $look
    Set-Px $bmp @($p, ($p + 1), ($p + 2)) (12 + $dy) $DARK
    Set-Px $bmp @($p, ($p + 1), ($p + 2)) (13 + $dy) $DARK
    Set-Px $bmp @($p, ($p + 1), ($p + 2)) (14 + $dy) $DARK
    $bmp.SetPixel($p, (12 + $dy), $WHITE)
  }
  $bmp.SetPixel(22, (11 + $dy), $WHITE)               # 玻璃反光（内壁上沿）
  # 斜柄（镜框右下 → 握爪，2px 阶梯）
  $bmp.SetPixel(23, (17 + $dy), $DARK); $bmp.SetPixel(24, (17 + $dy), $DARK)
  $bmp.SetPixel(24, (18 + $dy), $DARK); $bmp.SetPixel(25, (18 + $dy), $DARK)
  $bmp.SetPixel(25, (19 + $dy), $DARK); $bmp.SetPixel(26, (19 + $dy), $DARK)
  # 握柄白爪（收起右前腿）
  for ($y = 25; $y -le 28; $y++) { for ($x = 21; $x -le 24; $x++) { $bmp.SetPixel($x, $y, $CLEAR) } }
  Set-Px $bmp @(25, 26, 27) (20 + $dy) $DARK
  $bmp.SetPixel(25, (21 + $dy), $DARK); $bmp.SetPixel(26, (21 + $dy), $WHITE); $bmp.SetPixel(27, (21 + $dy), $DARK)
  Set-Px $bmp @(25, 26, 27) (22 + $dy) $DARK
}

# ==== search-right：搜索中·放大镜右眼变体（循环，searching 随机抽到时播） ====
# 与 search.png 同构，只是放大镜挪到右眼、握在右爪，挑眉挪到左眼。进 searching
# 时与左眼版二选一整段播（PetAnimManager 随机抽变体）
Build-Strip "search-right.png" @(
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f 0 0 $false; Question-Mark $f 16 1 },                       # 0  端详正中
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f 0 -1 $false; Sway-Tail $f; Question-Mark $f 16 1 },        # 1  瞟左 T1
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f -1 -1 $false; Sway-Tail2 $f; Question-Mark $f 16 0 },      # 2  凑近看左、问号升 T2
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f 0 0 $false; Squash-Top $f; Sway-Tail3 $f; Question-Mark $f 16 1 }, # 3  回中歪头 T3
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f 0 1 $false; Sway-Tail2 $f; Question-Mark $f 16 1 },        # 4  瞟右 T2
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f -1 1 $false; Sway-Tail $f; Question-Mark $f 16 0 },        # 5  凑近看右、问号升 T1
  { param($f) Half-Eyes $f; Draw-Magnifier-R $f 0 0 $true; Question-Mark $f 16 1 },                            # 6  眨那只大眼（双眼半闭）
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f 0 0 $false; Squash-Top $f; Sway-Tail $f; Question-Mark $f 16 2 }, # 7  歪头、问号沉 T1
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f 0 -1 $false; Sway-Tail2 $f; Question-Mark $f 17 1 },       # 8  再扫左、问号偏右 T2
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f -1 0 $false; Sway-Tail3 $f; Question-Mark $f 16 0 },       # 9  举高居中、问号升 T3
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f 0 1 $false; Squash-Top $f; Sway-Tail2 $f; Question-Mark $f 16 1 }, # 10 扫右歪头 T2
  { param($f) Puzzle-Brow-L $f; Draw-Magnifier-R $f 0 0 $false; Sway-Tail $f; Question-Mark $f 15 1 }          # 11 回中、问号偏左 T1 → loop
)

# ==== search：网页搜索中（循环，接对话窗事件桥 web 搜索工具执行期间） ====
# 举放大镜端详左眼（镜内大瞳左右扫视 + 举镜微浮）+ 右眼挑眉 + 头顶问号
# 起伏，偶尔眨那只大眼、歪头（Squash-Top）一下，尾巴慢摆。op 顺序：挑眉 →
# 放大镜（含镜内眼）→ 呼吸压缩 → 问号（悬浮物最后画，不随头动）
Build-Strip "search.png" @(
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f 0 0 $false; Question-Mark $f 14 1 },                       # 0  端详正中
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f 0 -1 $false; Sway-Tail $f; Question-Mark $f 14 1 },        # 1  瞟左 T1
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f -1 -1 $false; Sway-Tail2 $f; Question-Mark $f 14 0 },      # 2  凑近看左、问号升 T2
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f 0 0 $false; Squash-Top $f; Sway-Tail3 $f; Question-Mark $f 14 1 }, # 3  回中歪头 T3
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f 0 1 $false; Sway-Tail2 $f; Question-Mark $f 14 1 },        # 4  瞟右 T2
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f -1 1 $false; Sway-Tail $f; Question-Mark $f 14 0 },        # 5  凑近看右、问号升 T1
  { param($f) Half-Eyes $f; Draw-Magnifier $f 0 0 $true; Question-Mark $f 14 1 },                          # 6  眨那只大眼（双眼半闭）
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f 0 0 $false; Squash-Top $f; Sway-Tail $f; Question-Mark $f 14 2 }, # 7  歪头、问号沉 T1
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f 0 -1 $false; Sway-Tail2 $f; Question-Mark $f 15 1 },       # 8  再扫左、问号偏右 T2
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f -1 0 $false; Sway-Tail3 $f; Question-Mark $f 14 0 },       # 9  举高居中、问号升 T3
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f 0 1 $false; Squash-Top $f; Sway-Tail2 $f; Question-Mark $f 14 1 }, # 10 扫右歪头 T2
  { param($f) Puzzle-Brow $f; Draw-Magnifier $f 0 0 $false; Sway-Tail $f; Question-Mark $f 13 1 }          # 11 回中、问号偏左 T1 → loop
)

$base.Dispose()
