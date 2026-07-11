import type { MouseEvent } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 桌宠窗口（label="pet"）：透明 / 无边框 / 置顶 / 不上任务栏，按住任意处可拖动。
 *
 * 舞台上站的是真正的雪宝：32×32 像素方块猫源图整数倍放大（image-rendering:
 * pixelated 保持硬边像素），配待机浮动 + 落地软影，透明底直接融进桌面。
 * 由 Pet 页「召唤到桌面」按钮（pet_toggle 命令，再点即收起）唤出；点 X 的
 * 全局拦截同样适用于本窗口（关闭 = 隐藏）。
 */

// ---- 顶层可调常量 ----
/** 桌宠整体透明度 0~1：作用于整个舞台，调小就是「半透明幽灵猫」喵～ */
const PET_OPACITY = 1;
/** 源图边长 px（xuebao.png 为 32×32） */
const SPRITE_SIZE = 32;
/** 整数放大倍数：32×6=192，在 240 窗口里给浮动留出余量 */
const SPRITE_SCALE = 6;
/** 待机浮动动画：幅度 px / 周期 s（0 幅度 = 关闭浮动） */
const PET_FLOAT_AMP = 5;
const PET_FLOAT_DUR = 3.2;

/** 按住左键拖动整个窗口（舞台上没有输入控件，直接整窗拖拽最顺手） */
function startDrag(e: MouseEvent) {
  if (e.button !== 0) return;
  void getCurrentWindow().startDragging();
}

export function PetWindow() {
  return (
    <Stage onMouseDown={startDrag}>
      <Float>
        <Sprite
          src="/pet/xuebao.png"
          alt="雪宝"
          draggable={false}
          width={SPRITE_SIZE * SPRITE_SCALE}
          height={SPRITE_SIZE * SPRITE_SCALE}
        />
      </Float>
      <Shadow aria-hidden />
    </Stage>
  );
}

/* 舞台：铺满透明窗口，整体透明度在这里统一控制 */
const Stage = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  opacity: ${PET_OPACITY};
  cursor: grab;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
`;

/* 浮动层：克制的上下浮动，让小家伙看起来是活的喵 */
const Float = styled.div`
  position: relative;
  z-index: 1;
  animation: pet-float ${PET_FLOAT_DUR}s ease-in-out infinite;

  @keyframes pet-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-${PET_FLOAT_AMP}px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

/* 雪宝本体：整数倍放大的像素源图，pixelated 保住方块硬边不糊 */
const Sprite = styled.img`
  display: block;
  image-rendering: pixelated;
  -webkit-user-drag: none;
`;

/* 落地软影：椭圆暗斑随浮动反相缩放（宠物升到最高时影子最小最淡） */
const Shadow = styled.div`
  position: absolute;
  bottom: 14px;
  left: 50%;
  width: ${SPRITE_SIZE * SPRITE_SCALE * 0.52}px;
  height: 12px;
  margin-left: ${-SPRITE_SIZE * SPRITE_SCALE * 0.26}px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgba(30, 34, 40, 0.32),
    rgba(30, 34, 40, 0) 70%
  );
  animation: pet-shadow ${PET_FLOAT_DUR}s ease-in-out infinite;

  @keyframes pet-shadow {
    0%,
    100% {
      transform: scaleX(1);
      opacity: 1;
    }
    50% {
      transform: scaleX(0.86);
      opacity: 0.7;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
