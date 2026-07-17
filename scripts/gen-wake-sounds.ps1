param(
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\public\audio")
)

# 语音唤醒的两枚正式提示音（从 20 个候选里选定「软木确认」后收敛至此）：
#   wake-start.wav  命中唤醒词：两声轻软上行 =「在听」
#   wake-end.wav    一句话说完：同质感镜像下行 =「收到，去干活了」
# 纯正弦叠加合成，软攻击 + 轻弹簧，走现代系统提示音的克制路线。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SampleRate = 48000
$TwoPi = [Math]::PI * 2.0

function New-AudioBuffer([int]$DurationMs) {
  # Unary comma keeps PowerShell from unrolling the typed array through the
  # pipeline; otherwise each synthesis function receives a converted copy.
  return ,([double[]]::new([Math]::Ceiling($DurationMs * $SampleRate / 1000.0)))
}

function Add-Tone {
  param(
    [double[]]$Buffer,
    [double]$StartMs,
    [double]$DurationMs,
    [double]$FromHz,
    [double]$ToHz,
    [double]$Gain = 1.0,
    [ValidateSet("pure", "round", "soft", "glass", "hollow")]
    [string]$Color = "round",
    [double]$AttackMs = 7.0,
    [double]$DecayPower = 1.8,
    [double]$SpringHz = 0.0,
    [double]$SpringRate = 10.0,
    [double]$SpringDecay = 12.0
  )

  $start = [Math]::Round($StartMs * $SampleRate / 1000.0)
  $count = [Math]::Max(2, [Math]::Round($DurationMs * $SampleRate / 1000.0))
  $attackSeconds = [Math]::Max(0.001, $AttackMs / 1000.0)
  $phase = 0.0

  for ($i = 0; $i -lt $count; $i++) {
    $index = $start + $i
    if ($index -ge $Buffer.Length) { break }

    $time = $i / [double]$SampleRate
    $u = $i / [double]($count - 1)
    # Ease-out pitch travel plus a quickly settling spring overshoot gives the
    # notification its soft, jelly-like bounce instead of a plain arpeggio.
    $pitchEase = 1.0 - [Math]::Pow(1.0 - $u, 2.4)
    $frequency = $FromHz + ($ToHz - $FromHz) * $pitchEase
    $frequency += $SpringHz * [Math]::Sin($TwoPi * $SpringRate * $time) * [Math]::Exp(-$SpringDecay * $time)
    $frequency = [Math]::Max(70.0, $frequency)
    $phase += $TwoPi * $frequency / $SampleRate

    $attack = [Math]::Min(1.0, $time / $attackSeconds)
    $attack = $attack * $attack * (3.0 - 2.0 * $attack)
    $release = [Math]::Pow([Math]::Max(0.0, 1.0 - $u), $DecayPower)
    $envelope = $attack * $release

    $sample = switch ($Color) {
      "pure"   { [Math]::Sin($phase) }
      "round"  { 0.84 * [Math]::Sin($phase) + 0.13 * [Math]::Sin(2.0 * $phase) + 0.03 * [Math]::Sin(3.0 * $phase) }
      "soft"   { 0.92 * [Math]::Sin($phase) + 0.08 * [Math]::Sin(3.0 * $phase) }
      "glass"  { 0.83 * [Math]::Sin($phase) + 0.12 * [Math]::Sin(2.73 * $phase) + 0.05 * [Math]::Sin(4.11 * $phase) }
      "hollow" { 0.76 * [Math]::Sin($phase) + 0.19 * [Math]::Sin(2.0 * $phase) + 0.05 * [Math]::Sin(4.0 * $phase) }
    }
    $Buffer[$index] += $sample * $envelope * $Gain
  }
}

function Add-AirPop {
  param(
    [double[]]$Buffer,
    [double]$StartMs,
    [double]$Gain = 0.12,
    [int]$Seed = 1
  )

  $start = [Math]::Round($StartMs * $SampleRate / 1000.0)
  $count = [Math]::Round(26.0 * $SampleRate / 1000.0)
  $random = [Random]::new($Seed)
  $last = 0.0
  for ($i = 0; $i -lt $count; $i++) {
    $index = $start + $i
    if ($index -ge $Buffer.Length) { break }
    $u = $i / [double]($count - 1)
    $noise = $random.NextDouble() * 2.0 - 1.0
    # One-pole smoothing removes the sharp white-noise edge.
    $last = $last * 0.72 + $noise * 0.28
    $envelope = [Math]::Sin([Math]::PI * $u) * [Math]::Pow(1.0 - $u, 1.6)
    $Buffer[$index] += $last * $envelope * $Gain
  }
}

function Normalize-Buffer([double[]]$Buffer) {
  # Gentle master fade protects against boundary clicks.
  $fadeIn = [Math]::Round(4.0 * $SampleRate / 1000.0)
  $fadeOut = [Math]::Round(24.0 * $SampleRate / 1000.0)
  for ($i = 0; $i -lt $fadeIn; $i++) {
    $Buffer[$i] *= $i / [double]$fadeIn
  }
  for ($i = 0; $i -lt $fadeOut; $i++) {
    $index = $Buffer.Length - 1 - $i
    $Buffer[$index] *= $i / [double]$fadeOut
  }

  $peak = 0.0
  $energy = 0.0
  foreach ($sample in $Buffer) {
    $absolute = [Math]::Abs($sample)
    if ($absolute -gt $peak) { $peak = $absolute }
    $energy += $sample * $sample
  }
  $rms = [Math]::Sqrt($energy / $Buffer.Length)
  if ($peak -le 0.0 -or $rms -le 0.0) { return }

  # Keep perceived volume matched between the pair while retaining headroom.
  $gain = [Math]::Min(0.115 / $rms, 0.78 / $peak)
  for ($i = 0; $i -lt $Buffer.Length; $i++) {
    $Buffer[$i] *= $gain
  }
}

function Write-Wav([string]$Path, [double[]]$Buffer) {
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Create, [IO.FileAccess]::Write)
  try {
    $writer = [IO.BinaryWriter]::new($stream)
    try {
      $dataSize = $Buffer.Length * 2
      $writer.Write([Text.Encoding]::ASCII.GetBytes("RIFF"))
      $writer.Write([int](36 + $dataSize))
      $writer.Write([Text.Encoding]::ASCII.GetBytes("WAVE"))
      $writer.Write([Text.Encoding]::ASCII.GetBytes("fmt "))
      $writer.Write([int]16)
      $writer.Write([int16]1)
      $writer.Write([int16]1)
      $writer.Write([int]$SampleRate)
      $writer.Write([int]($SampleRate * 2))
      $writer.Write([int16]2)
      $writer.Write([int16]16)
      $writer.Write([Text.Encoding]::ASCII.GetBytes("data"))
      $writer.Write([int]$dataSize)
      foreach ($sample in $Buffer) {
        $pcm = [Math]::Round([Math]::Max(-1.0, [Math]::Min(1.0, $sample)) * 32767.0)
        $writer.Write([int16]$pcm)
      }
    } finally {
      $writer.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function New-Sound([string]$FileName, [int]$DurationMs, [scriptblock]$Compose) {
  $buffer = New-AudioBuffer $DurationMs
  & $Compose $buffer
  Normalize-Buffer $buffer
  Write-Wav (Join-Path $OutputDir $FileName) $buffer
}

$OutputDir = [IO.Path]::GetFullPath($OutputDir)
[IO.Directory]::CreateDirectory($OutputDir) | Out-Null

# 唤醒音（原候选 15「软木确认」原样）：370→405 / 515→555 两声轻软上行
New-Sound "wake-start.wav" 340 {
  param($b)
  Add-AirPop $b 0 0.018 1515
  Add-Tone $b 0 205 370 405 0.86 soft 5 2.8 10 10 15
  Add-Tone $b 102 205 515 555 1.00 soft 6 2.65 12 10 15
}

# 结束音（软木确认的镜像）：545→505 / 400→368 两声下行落座，
# 重音放在收尾低音上 =「话收到了，落停，开始干活」
New-Sound "wake-end.wav" 340 {
  param($b)
  Add-AirPop $b 0 0.018 2525
  Add-Tone $b 0 205 545 505 0.86 soft 5 2.8 -10 10 15
  Add-Tone $b 102 205 400 368 1.00 soft 6 2.65 -12 10 15
}

Get-ChildItem $OutputDir -Filter "wake-*.wav" | Sort-Object Name | ForEach-Object {
  [PSCustomObject]@{
    Name = $_.Name
    Kilobytes = [Math]::Round($_.Length / 1KB, 1)
  }
}
