import { styled } from "@linaria/react";
import { PixelFrame } from "./PixelFrame";
import { PRIORITY_PAL, PX } from "./palettes";

/**
 * 像素开关（Switch）：sunken 凹槽轨道 + raised 白色滑块。
 *  - 轨道用 PixelFrame 凹陷 + 低噪铺底，与进度槽/输入区同一套「内嵌」视觉语言；
 *  - 开/关不是生硬换色：借 PixelFrame 的扫描状态机（sweepPalette + sweepActive），
 *    打开时青色（accent）从两端扫向中心、低噪随之持续流动（noiseSpeed>0），
 *    关闭时从中心褪回凹槽底色、噪声停息 —— 与工具调用卡 hover 同一套动效语言；
 *  - 滑块是一小块凸起白像素板（带低噪 + 硬投影），开关时水平滑动；
 *  - 外层是原生 button（role=switch），点击/Enter/Space 都能切换。
 */

// ---- 顶层可调常量 ----
const TRACK_W = 58; // 轨道宽 px
const TRACK_H = 32; // 轨道高 px
const THUMB = 22; // 滑块边长 px
const PAD = 5; // 滑块距轨道边缘 px
const THUMB_TOP = (TRACK_H - THUMB) / 2; // 垂直居中
const THUMB_TRAVEL = TRACK_W - THUMB - PAD * 2; // 开态水平位移

/** 轨道低噪强度（0~1）：开关面积小，噪声给足才有质感 */
const TRACK_NOISE = 0.12;
/** 开态低噪流动速度（每秒）：0=静止；参考工具卡 hover 的 0.9，稍慢更沉稳 */
const NOISE_SPEED_ON = 0.8;

interface PixelSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}

export function PixelSwitch({
  checked,
  onChange,
  "aria-label": ariaLabel,
  disabled,
  className,
}: PixelSwitchProps) {
  return (
    <Track
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={className}
      onClick={() => onChange(!checked)}
    >
      {/* 轨道：palette 始终是凹槽底色（well），开态由扫描状态机把噪声块
          渐染成 accent 青并持续流动；结构色（描边/内斜线）不变，无违和白边 */}
      <PixelFrame
        palette={PX.well}
        variant="sunken"
        pixel={3}
        radius={2}
        noise={TRACK_NOISE}
        noiseGranularity={2}
        noiseSpeed={checked ? NOISE_SPEED_ON : 0}
        sweepPalette={PX.accent}
        sweepActive={checked}
      />
      <Thumb data-on={checked || undefined}>
        <PixelFrame
          palette={PRIORITY_PAL.low}
          variant="raised"
          pixel={3}
          radius={1}
          noise={0.08}
          noiseGranularity={2}
          elevation={1}
        />
      </Thumb>
    </Track>
  );
}

const Track = styled.button`
  position: relative;
  flex: 0 0 auto;
  width: ${TRACK_W}px;
  height: ${TRACK_H}px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

/* 滑块载体：绝对定位在轨道上，开态平移到右端；视觉全交给内部 PixelFrame */
const Thumb = styled.span`
  position: absolute;
  z-index: 1;
  top: ${THUMB_TOP}px;
  left: ${PAD}px;
  width: ${THUMB}px;
  height: ${THUMB}px;
  transform: translateX(0);
  transition: transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.15);
  pointer-events: none;

  &[data-on] {
    transform: translateX(${THUMB_TRAVEL}px);
  }
`;
