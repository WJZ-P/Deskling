import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelFrame } from "./PixelFrame";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./PixelSurface";
import { PRIORITY_PAL, type Priority } from "./palettes";

/**
 * 像素下拉选择器（全自定义，不用原生 <select>）：
 *  - 触发器底层复用按钮的 PixelSurface 弹簧引擎 → 拥有和按钮一致的持续动效
 *    （低噪一直在、hover/展开时边框逐像素错落点亮、按下凹陷，全程弹簧丝滑）；
 *  - 弹出的候选列表也是像素面板 → 整套下拉都是像素风，不受操作系统原生控件影响；
 *  - 候选项高亮走 CSS 渐变（非生硬切换）、弹层带丝滑入场动画；
 *  - 支持键盘导航（↑↓ 移动、Enter 选中、Esc 关闭）与点击外部关闭。
 *  - 触发器手感参数与按钮一致（见 SELECT_TUNE）喵～
 */

// ---- 顶层可调常量 ----
const SELECT_PIXEL = 4; // 触发器像素大小（同按钮）
const SELECT_RADIUS = 2; // 像素切角（同按钮）
const SELECT_NOISE = 0.1; // 面像素基准低噪强度（同按钮）
const MENU_PIXEL = 3; // 弹层面板像素大小
const MENU_RADIUS = 2; // 弹层切角
const MENU_ELEV = 5; // 弹层硬投影（比触发器更高，显浮起）
const MENU_NOISE = 0.05; // 弹层面板静态底噪
const MENU_MAX_H = 240; // 弹层最大高度 px（超出滚动）
const MENU_GAP = 6; // 触发器与弹层间距 px

/** 触发器手感：沿用按钮默认动效，仅去掉纵向位移（下拉触发器跳动会怪） */
const SELECT_TUNE: Partial<SurfaceTune> = {
  hoverTy: 0,
  pressTy: 0,
};

export interface PixelSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface PixelSelectProps {
  options: PixelSelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** 优先级色阶：normal(浅青/默认) · low(白底) · primary(深色) */
  variant?: Priority;
  disabled?: boolean;
  className?: string;
}

export function PixelSelect({
  options,
  value,
  onChange,
  placeholder = "请选择…",
  variant = "normal",
  disabled,
  className,
}: PixelSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const [active, setActive] = useState(() => (selectedIndex >= 0 ? selectedIndex : 0));

  // 弹层通过 Portal 挂到 body，用 fixed 定位（避开卡片等祖先的层叠上下文/裁剪）
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    up: boolean;
  } | null>(null);

  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // 触发器状态：按下→press；展开/悬停→hover（低噪持续 + 边框点亮）；否则 rest
  const state: SurfaceState = disabled
    ? "rest"
    : pressed
      ? "press"
      : open || hovered
        ? "hover"
        : "rest";

  const close = useCallback(() => setOpen(false), []);

  const commit = useCallback(
    (idx: number) => {
      const opt = options[idx];
      if (!opt || opt.disabled) return;
      onChange?.(opt.value);
      setOpen(false);
    },
    [options, onChange],
  );

  // 测量触发器位置 → 决定弹层 fixed 坐标（下方空间不足则向上翻）
  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < MENU_MAX_H + MENU_GAP && r.top > spaceBelow;
    setPos({
      left: r.left,
      width: r.width,
      top: openUp ? undefined : r.bottom + MENU_GAP,
      bottom: openUp ? window.innerHeight - r.top + MENU_GAP : undefined,
      up: openUp,
    });
  }, []);

  // 打开时先同步测量一次（useLayoutEffect 避免首帧位置闪烁）
  useLayoutEffect(() => {
    if (open) updatePos();
  }, [open, updatePos]);

  // 打开期间：滚动/缩放实时跟随；点击「触发器与弹层之外」关闭
  useEffect(() => {
    if (!open) return;
    const onScrollResize = () => updatePos();
    // capture=true 以捕获任意祖先容器的滚动
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    const onDoc = (e: PointerEvent) => {
      const target = e.target as Node;
      const inRoot = rootRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inRoot && !inMenu) close();
    };
    document.addEventListener("pointerdown", onDoc);
    return () => {
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
      document.removeEventListener("pointerdown", onDoc);
    };
  }, [open, close, updatePos]);

  // 展开时把高亮同步到当前选中项
  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  const moveActive = (dir: 1 | -1) => {
    setActive((prev) => {
      const n = options.length;
      let i = prev;
      for (let step = 0; step < n; step++) {
        i = (i + dir + n) % n;
        if (!options[i]?.disabled) return i;
      }
      return prev;
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) setOpen(true);
        else moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) setOpen(true);
        else moveActive(-1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) commit(active);
        else setOpen(true);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        if (open) close();
        break;
    }
  };

  return (
    <Root ref={rootRef} className={className} data-disabled={disabled || undefined}>
      <Trigger
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-variant={variant}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => {
          setHovered(false);
          setPressed(false);
        }}
        onPointerDown={() => !disabled && setPressed(true)}
        onPointerUp={() => setPressed(false)}
      >
        <PixelSurface
          palette={PRIORITY_PAL[variant]}
          state={state}
          pixel={SELECT_PIXEL}
          radius={SELECT_RADIUS}
          noise={SELECT_NOISE}
          tune={SELECT_TUNE}
          rootStyle={{ display: "flex", width: "100%" }}
          contentStyle={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            gap: 8,
            minHeight: 34,
            padding: "6px 12px",
          }}
        >
          <TriggerText data-variant={variant} data-placeholder={selected == null || undefined}>
            {selected != null ? selected.label : placeholder}
          </TriggerText>
          <Arrow data-open={open || undefined} aria-hidden />
        </PixelSurface>
      </Trigger>

      {open &&
        pos != null &&
        createPortal(
          <Menu
            ref={menuRef}
            role="listbox"
            data-up={pos.up || undefined}
            style={{
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
            }}
          >
            <PixelFrame
              palette={PRIORITY_PAL.low}
              variant="raised"
              pixel={MENU_PIXEL}
              radius={MENU_RADIUS}
              noise={MENU_NOISE}
              noiseGranularity={2}
              elevation={MENU_ELEV}
            />
            <MenuScroll style={{ maxHeight: MENU_MAX_H }}>
              {options.map((opt, i) => (
                <OptionRow
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  data-active={i === active || undefined}
                  data-selected={opt.value === value || undefined}
                  data-disabled={opt.disabled || undefined}
                  onPointerEnter={() => !opt.disabled && setActive(i)}
                  onClick={() => commit(i)}
                >
                  <OptionMark aria-hidden>{opt.value === value ? "▸" : ""}</OptionMark>
                  <OptionLabel>{opt.label}</OptionLabel>
                </OptionRow>
              ))}
            </MenuScroll>
          </Menu>,
          document.body,
        )}
    </Root>
  );
}

const Root = styled.div`
  position: relative;
  display: inline-flex;
  flex-direction: column;
  min-width: 180px;

  &[data-disabled] {
    opacity: 0.55;
  }
`;

const Trigger = styled.button`
  position: relative;
  display: inline-flex;
  box-sizing: border-box;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: ${t.colorTextOnBtn};

  &[data-variant="primary"] {
    color: ${t.colorTextOnBtnAccent};
  }

  &:disabled {
    cursor: not-allowed;
  }
`;

const TriggerText = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: ${t.textMd};
  letter-spacing: 1px;
  font-weight: bold;

  &[data-placeholder] {
    color: ${t.colorTextMuted};
    font-weight: normal;
  }
`;

/* 像素小三角：border 三角形，crisp 且随展开平滑旋转 */
const Arrow = styled.span`
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid currentColor;
  transition: transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.3);

  &[data-open] {
    transform: rotate(180deg);
  }
`;

/* Portal 到 body：fixed 定位，脱离一切祖先层叠上下文/裁剪，z-index 高于内容层 */
const Menu = styled.div`
  position: fixed;
  z-index: 1000;
  transform-origin: top center;
  animation: psel-in 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.2);

  &[data-up] {
    transform-origin: bottom center;
    animation-name: psel-in-up;
  }

  @keyframes psel-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scaleY(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scaleY(1);
    }
  }

  @keyframes psel-in-up {
    from {
      opacity: 0;
      transform: translateY(6px) scaleY(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scaleY(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const MenuScroll = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  padding: 6px;
  overflow-y: auto;
`;

const OptionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  cursor: pointer;
  font: ${t.textSm};
  letter-spacing: 1px;
  color: ${t.colorText};
  user-select: none;
  /* 高亮走渐变，不生硬切换喵 */
  background: transparent;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &[data-active] {
    background-color: ${t.colorAccentSoft};
  }

  &[data-selected] {
    color: ${t.colorTextOnBtn};
    font-weight: bold;
  }

  &[data-disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const OptionMark = styled.span`
  flex: 0 0 auto;
  width: 10px;
  color: ${t.colorAccent};
  transition: opacity 0.16s ease;
`;

const OptionLabel = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;
