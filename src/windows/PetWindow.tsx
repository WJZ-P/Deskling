import type { MouseEvent } from "react";
import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "../styles/theme";
import { PixelFrame } from "../components/pixel/PixelFrame";
import { PRIORITY_PAL } from "../components/pixel/palettes";

/**
 * 桌宠窗口（label="pet"）：透明 / 无边框 / 置顶 / 不上任务栏，按住任意处可拖动。
 *
 * 目前只是框架：像素小面板 + 颜文字占位，后续换成真正的桌宠形象 / 动画 / 对话。
 * 由 Pet 页「召唤到桌面」按钮（pet_toggle 命令，再点即收起）唤出；点 X 的
 * 全局拦截同样适用于本窗口（关闭 = 隐藏）。
 */

// ---- 顶层可调常量 ----
/** 桌宠整体透明度 0~1：作用于整个舞台，调小就是「半透明幽灵猫」喵～ */
const PET_OPACITY = 0.8;
/** 占位面板宽度 px */
const PET_PANEL_WIDTH = 176;
/** 待机浮动动画：幅度 px / 周期 s（0 幅度 = 关闭浮动） */
const PET_FLOAT_AMP = 5;
const PET_FLOAT_DUR = 3.2;

/** 按住左键拖动整个窗口（占位内容没有输入控件，直接整窗拖拽最顺手） */
function startDrag(e: MouseEvent) {
  if (e.button !== 0) return;
  void getCurrentWindow().startDragging();
}

export function PetWindow() {
  return (
    <Stage onMouseDown={startDrag}>
      <Panel>
        <PixelFrame
          palette={PRIORITY_PAL.low}
          variant="raised"
          pixel={3}
          radius={3}
          noise={0.05}
          noiseGranularity={2}
          elevation={4}
        />
        <Body>
          <Face>(=^･ω･^=)</Face>
          <Name>Deskling · 待命中</Name>
        </Body>
      </Panel>
    </Stage>
  );
}

/* 舞台：铺满透明窗口，整体透明度在这里统一控制 */
const Stage = styled.div`
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

/* 占位像素面板：带一个克制的上下浮动，让小家伙看起来是活的喵 */
const Panel = styled.div`
  position: relative;
  width: ${PET_PANEL_WIDTH}px;
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

const Body = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 12px 14px;
`;

const Face = styled.div`
  font: ${t.textLg};
  letter-spacing: 1px;
  color: ${t.colorText};
  white-space: nowrap;
`;

const Name = styled.div`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;
