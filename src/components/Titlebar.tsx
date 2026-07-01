import { styled } from "@linaria/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pixelCorners, t, type ThemeMode } from "../styles/theme";

interface TitlebarProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
}

async function runWindow(action: (w: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) {
  try {
    await action(getCurrentWindow());
  } catch (err) {
    // 在非 Tauri 环境（纯浏览器调试）下静默忽略
    console.warn("window control unavailable:", err);
  }
}

function Titlebar({ theme, onToggleTheme }: TitlebarProps) {
  return (
    <Bar data-tauri-drag-region>
      <Brand data-tauri-drag-region>
        <Paw>🐾</Paw>
        <span>Deskling</span>
      </Brand>

      <Controls>
        <ThemeBtn
          type="button"
          title={theme === "light" ? "切换到深色" : "切换到浅色"}
          onClick={onToggleTheme}
        >
          {theme === "light" ? "☾" : "☀"}
        </ThemeBtn>

        <CtrlBtn
          variant="min"
          type="button"
          title="最小化"
          onClick={() => runWindow((w) => w.minimize())}
        >
          <IconMin />
        </CtrlBtn>
        <CtrlBtn
          variant="max"
          type="button"
          title="最大化 / 还原"
          onClick={() => runWindow((w) => w.toggleMaximize())}
        >
          <IconMax />
        </CtrlBtn>
        <CtrlBtn
          variant="close"
          type="button"
          title="关闭"
          onClick={() => runWindow((w) => w.close())}
        >
          <IconClose />
        </CtrlBtn>
      </Controls>
    </Bar>
  );
}

export default Titlebar;

const Bar = styled.div`
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 calc(${t.unit} * 2);
  background: ${t.colorSurface};
  border-bottom: ${t.borderW} solid ${t.colorBorderStrong};
  user-select: none;
  font-weight: bold;
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: ${t.unit};
  font: ${t.textMd};
  letter-spacing: 1px;
  color: ${t.colorText};
`;

const Paw = styled.span`
  font-size: 14px;
`;

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: ${t.unit};
`;

/* 软萌像素方形按钮：切角 + 双层描边 + 柔影，悬停抬起、按下下沉 */
const baseBtn = styled.button`
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  color: ${t.btnIcon};
  border: 1px solid transparent;
  background:
    linear-gradient(${t.colorControl}, ${t.colorControl}) padding-box,
    linear-gradient(${t.colorBorder}, ${t.colorBorder}) border-box;
  clip-path: ${pixelCorners};
  filter: drop-shadow(0 1px 3px ${t.colorShadowSoft});
  transition: transform 0.08s ease, filter 0.12s ease, background 0.12s ease;

  &:hover {
    transform: translateY(-1px);
    filter: drop-shadow(0 3px 6px ${t.colorShadowSoft});
  }

  &:active {
    transform: translateY(1px);
    filter: drop-shadow(0 1px 2px ${t.colorShadowSoft});
  }
`;

const ThemeBtn = styled(baseBtn)`
  font-size: 16px;
  line-height: 1;
  margin-right: ${t.unit};

  &:hover {
    background: ${t.colorAccent};
    color: ${t.colorOnAccent};
  }
`;

const CtrlBtn = styled(baseBtn)<{ variant: "min" | "max" | "close" }>`
  &:hover {
    background: ${(p) =>
      p.variant === "min"
        ? t.btnMin
        : p.variant === "max"
        ? t.btnMax
        : t.btnClose};
    color: #1a1a1a;
  }
`;

/* CSS 绘制的锐利像素图标，跟随 currentColor */
const IconMin = styled.span`
  width: 10px;
  height: ${t.borderW};
  background: currentColor;
`;

const IconMax = styled.span`
  width: 10px;
  height: 10px;
  border: ${t.borderW} solid currentColor;
`;

const IconClose = styled.span`
  position: relative;
  width: 12px;
  height: 12px;

  &::before,
  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    width: 12px;
    height: ${t.borderW};
    background: currentColor;
  }

  &::before {
    transform: rotate(45deg);
  }

  &::after {
    transform: rotate(-45deg);
  }
`;
