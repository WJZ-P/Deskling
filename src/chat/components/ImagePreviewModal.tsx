import { useEffect, useState } from "react";
import { styled } from "@linaria/react";
import { PixelModal } from "../../components/pixel/PixelModal";
import { t } from "../../styles/theme";

// PixelModal 外层/内层占用的空间。按这个预算先等比压缩图片，再让面板紧贴结果尺寸。
const OVERLAY_GUTTER_X = 48;
const PANEL_INSET_X = 40;
const PANEL_CHROME_Y = 104;
const PANEL_MIN_W = 140;
const PANEL_MAX_VH = 0.9;

interface ImagePreviewModalProps {
  open: boolean;
  src: string;
  path: string;
  onClose: () => void;
}

interface NaturalSize {
  src: string;
  width: number;
  height: number;
}

function imageName(path: string): string {
  return path.split(/[\\/]/).pop() || "图片预览";
}

/** 共用的大图预览：Esc、点击遮罩或右上关闭按钮均可退出。 */
export function ImagePreviewModal({ open, src, path, onClose }: ImagePreviewModalProps) {
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const probe = new Image();
    probe.onload = () => {
      if (!alive) return;
      setNatural({
        src,
        width: Math.max(1, probe.naturalWidth),
        height: Math.max(1, probe.naturalHeight),
      });
    };
    probe.src = src;
    return () => {
      alive = false;
    };
  }, [open, src]);

  useEffect(() => {
    if (!open) return;
    const syncViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, [open]);

  // PixelModal 为复用性能会在关闭后常驻；图片预览可能有很多实例，这里按需
  // 挂载，关闭即释放对应 portal，避免点过的每张图都留下隐藏弹窗。
  if (!open || natural?.src !== src) return null;

  const name = imageName(path);
  const maxPanelWidth = Math.max(PANEL_MIN_W, viewport.width - OVERLAY_GUTTER_X);
  const maxImageWidth = Math.max(1, maxPanelWidth - PANEL_INSET_X);
  const maxImageHeight = Math.max(1, viewport.height * PANEL_MAX_VH - PANEL_CHROME_Y);
  const scale = Math.min(1, maxImageWidth / natural.width, maxImageHeight / natural.height);
  const imageWidth = Math.max(1, Math.round(natural.width * scale));
  const imageHeight = Math.max(1, Math.round(natural.height * scale));
  const panelWidth = Math.min(maxPanelWidth, Math.max(PANEL_MIN_W, imageWidth + PANEL_INSET_X));

  return (
    <PixelModal open title={name} onClose={onClose} width={panelWidth}>
      <PreviewStage style={{ width: imageWidth, height: imageHeight }}>
        <PreviewImage src={src} alt={name} draggable={false} />
      </PreviewStage>
    </PixelModal>
  );
}

const PreviewStage = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-self: center;
  box-sizing: content-box;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: ${t.colorWell};
  border: 2px solid ${t.colorBorderStrong};
`;

const PreviewImage = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: auto;
  -webkit-user-drag: none;
  user-select: none;
`;
