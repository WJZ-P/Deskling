import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PRIORITY_PAL, PX } from "./palettes";

/**
 * 像素风滑动条（Slider）：sunken 凹槽轨道 + accent 青填充 + raised 白滑块，
 * 与开关/进度槽同一套「内嵌」视觉语言。
 *  - 轨道凹槽（PX.well）铺低噪底；填充（PX.accent）从左铺到滑块中心，随交互噪声流动；
 *  - 滑块是一小块凸起白像素板（带硬投影），拖动/悬停时抬高一档；
 *  - 拖动 / 悬停 / 聚焦时，滑块正上方弹出数值小签（复用 PixelTip 的质感）；
 *  - 指针：按下即跳到点击处 + 起拖（setPointerCapture，拖出轨道仍跟手）；
 *  - 键盘：role=slider + 方向键/Home/End（按 step 步进），无障碍可达。
 *
 * 用法：<PixelSlider value={0.6} onChange={setV} formatTip={(v)=>`${Math.round(v*100)}%`} />
 */

// ---- 顶层可调常量 ----
const TRACK_W = 150; // 轨道宽 px
const TRACK_H = 26; // 轨道高 px
const THUMB = 16; // 滑块边长 px
const PAD = 6; // 滑块 / 填充距轨道内缘的留白 px（避免压住凹槽描边）
const FILL_INSET = PAD; // 填充内缩，与滑块留白一致
const TRAVEL = TRACK_W - THUMB - PAD * 2; // 滑块水平行程（两端各留 PAD）
const THUMB_TOP = (TRACK_H - THUMB) / 2; // 垂直居中（上下自然留白）

interface PixelSliderProps {
  /** 当前值（落在 [min, max]） */
  value: number;
  min?: number;
  max?: number;
  /** 步进（>0 时四舍五入到步长；默认 0.01） */
  step?: number;
  onChange: (v: number) => void;
  /** 数值小签文案（默认百分比）；v = 当前值 */
  formatTip?: (v: number) => string;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}

export function PixelSlider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  formatTip,
  "aria-label": ariaLabel,
  disabled,
  className,
}: PixelSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false); // 同步守卫（state 更新滞后，move 判定用它）
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = !disabled && (dragging || hovered || focused); // 显小签 + 抬滑块

  const range = max - min || 1;
  const frac = Math.min(1, Math.max(0, (value - min) / range));
  const thumbLeft = PAD + frac * TRAVEL; // 两端各留 PAD
  const thumbCenter = thumbLeft + THUMB / 2;
  const label = formatTip ? formatTip(value) : `${Math.round(frac * 100)}%`;

  // 指针 x → 值：把 [PAD+THUMB/2, TRACK_W-PAD-THUMB/2] 映到 [min,max]（滑块中心跟
  // 指针），按 step 量化并 clamp
  const valueFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    let f = (clientX - rect.left - PAD - THUMB / 2) / TRAVEL;
    f = Math.min(1, Math.max(0, f));
    let v = min + f * range;
    if (step > 0) v = Math.round(v / step) * step;
    return Math.min(max, Math.max(min, v));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    onChange(valueFromClientX(e.clientX)); // 点哪跳哪
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onChange(valueFromClientX(e.clientX));
  };
  const endDrag = () => {
    draggingRef.current = false;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let v = value;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        v = value - step;
        break;
      case "ArrowRight":
      case "ArrowUp":
        v = value + step;
        break;
      case "Home":
        v = min;
        break;
      case "End":
        v = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (step > 0) v = Math.round(v / step) * step;
    onChange(Math.min(max, Math.max(min, v)));
  };

  return (
    <Root
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
    >
      {/* 凹槽轨道底 */}
      <PixelFrame
        palette={PX.well}
        variant="sunken"
        pixel={3}
        radius={2}
        noise={0.1}
        noiseGranularity={2}
      />
      {/* 填充：内缩后从左铺到滑块中心，accent 青，交互时低噪流动 */}
      <Fill style={{ width: Math.max(0, thumbCenter - FILL_INSET) }}>
        <PixelFrame
          palette={PX.accent}
          variant="raised"
          pixel={3}
          radius={1}
          noise={0.1}
          noiseGranularity={2}
          noiseSpeed={active ? 0.8 : 0}
          liveResize
        />
      </Fill>
      {/* 滑块 */}
      <Thumb style={{ left: thumbLeft }}>
        <PixelFrame
          palette={PRIORITY_PAL.low}
          variant="raised"
          pixel={3}
          radius={1}
          noise={0.08}
          noiseGranularity={2}
          elevation={active ? 3 : 2}
        />
      </Thumb>
      {/* 数值小签：拖动 / 悬停 / 聚焦时，钉在滑块正上方 */}
      {active && (
        <Tip style={{ left: thumbCenter }}>
          <PixelFrame
            palette={PRIORITY_PAL.low}
            variant="raised"
            pixel={2}
            radius={1}
            noise={0.06}
            noiseGranularity={2}
            elevation={2}
          />
          <TipLabel>{label}</TipLabel>
        </Tip>
      )}
    </Root>
  );
}

/* 轨道容器：定位锚，视觉全交给内部 PixelFrame（凹槽底铺满、绝对定位在最底层） */
const Root = styled.div`
  position: relative;
  flex: 0 0 auto;
  width: ${TRACK_W}px;
  height: ${TRACK_H}px;
  cursor: pointer;
  outline: none;
  touch-action: none;

  &[data-disabled] {
    opacity: 0.5;
    cursor: default;
  }
`;

/* 填充条：内缩后贴在凹槽里，宽度随值变（liveResize 让 PixelFrame 跟着重绘） */
const Fill = styled.span`
  position: absolute;
  z-index: 1;
  top: ${FILL_INSET}px;
  left: ${FILL_INSET}px;
  height: ${TRACK_H - FILL_INSET * 2}px;
  pointer-events: none;
`;

/* 滑块：绝对定位在轨道上，left 随值走；视觉交给内部 PixelFrame */
const Thumb = styled.span`
  position: absolute;
  z-index: 2;
  top: ${THUMB_TOP}px;
  width: ${THUMB}px;
  height: ${THUMB}px;
  pointer-events: none;
`;

/* 数值小签：钉在滑块正上方、水平居中，向上弹出（复用 PixelTip 的弹簧手感） */
const Tip = styled.span`
  position: absolute;
  bottom: calc(100% + 6px);
  z-index: 30;
  display: inline-flex;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
  transform-origin: bottom center;
  animation: pixel-slider-tip-in 0.16s ease both;

  @keyframes pixel-slider-tip-in {
    0% {
      opacity: 0;
      transform: translateX(-50%) translateY(4px) scale(0.9);
    }
    65% {
      opacity: 1;
      transform: translateX(-50%) translateY(-1px) scale(1.02);
    }
    100% {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }
`;

const TipLabel = styled.span`
  position: relative;
  z-index: 1;
  padding: 3px 8px;
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 0.5px;
  color: ${t.colorTextOnBtn};
`;
