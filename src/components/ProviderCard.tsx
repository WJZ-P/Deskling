import { useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import { PixelFrame } from "./pixel/PixelFrame";
import { PixelIconButton } from "./pixel/PixelIconButton";
import { EditIcon, DeleteIcon } from "./pixel/icons";
import { PRIORITY_PAL } from "./pixel/palettes";
import { protocolMeta, type ProviderProfile } from "../settings";

/**
 * 已配置的 AI 服务卡片（设置页网格用）。
 *  - 左键点整卡 = 切换激活（onSelect）；激活态青 plate + 低噪流动，一眼可辨；
 *  - 右上角「编辑」、右下角「删除」两个 PixelIconButton（阻止冒泡，不触发切换）；
 *  - 显示名称 + 协议 + 模型；未填 Key 时给个红字提示。
 * 态驱动的静态 PixelFrame（rest/hover 不跑 rAF），hover/active 整卡上浮 + 抬投影，
 * 与按钮一致的手感。
 */

interface ProviderCardProps {
  profile: ProviderProfile;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProviderCard({ profile, active, onSelect, onEdit, onDelete }: ProviderCardProps) {
  const [hovered, setHovered] = useState(false);
  const stateName = active ? "active" : hovered ? "hover" : "rest";
  const palette = active ? PRIORITY_PAL.primary : PRIORITY_PAL.low;
  const meta = protocolMeta(profile.protocol);
  const hasKey = profile.apiKey.trim().length > 0;

  return (
    <Card
      role="button"
      tabIndex={0}
      data-state={stateName}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <PixelFrame
        palette={palette}
        variant="raised"
        pixel={3}
        radius={2}
        noise={active ? 0.07 : 0.05}
        noiseGranularity={2}
        noiseSpeed={active ? 1.1 : 0}
        elevation={active || hovered ? 4 : 2}
      />
      <Inner>
        <Name data-state={stateName}>{profile.name || "未命名"}</Name>
        <Meta data-state={stateName}>{meta.label}</Meta>
        <Model data-state={stateName}>{profile.model || "未选模型"}</Model>
        {!hasKey && <NoKey data-state={stateName}>· 未填 API Key</NoKey>}
      </Inner>

      {/* 右上编辑、右下删除，绝对定位到两个角 */}
      <CornerTR>
        <PixelIconButton aria-label="编辑" onActivate={onEdit}>
          <EditIcon />
        </PixelIconButton>
      </CornerTR>
      <CornerBR>
        <PixelIconButton aria-label="删除" tone="danger" onActivate={onDelete}>
          <DeleteIcon />
        </PixelIconButton>
      </CornerBR>
    </Card>
  );
}

/* 整卡：hover/active 上浮（同按钮手感），投影由内部 PixelFrame 的 elevation 承担 */
const Card = styled.div`
  position: relative;
  width: 100%;
  cursor: pointer;
  text-align: left;
  outline: none;
  transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1.3);

  &[data-state="hover"],
  &[data-state="active"] {
    transform: translateY(-2px);
  }
`;

const Inner = styled.span`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* 右侧留出图标按钮的空间，避免文字被压到 */
  padding: 10px 34px 10px 12px;
`;

/* 两个角的图标按钮容器：浮在内容之上 */
const CornerTR = styled.span`
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
`;

const CornerBR = styled.span`
  position: absolute;
  bottom: 6px;
  right: 6px;
  z-index: 2;
`;

const Name = styled.span`
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 0.5px;
  color: ${t.colorText};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${Card}[data-state="active"] & {
    color: ${t.colorTextOnBtnAccent};
  }
`;

const Meta = styled.span`
  font: ${t.textXs};
  color: ${t.colorTextMuted};

  ${Card}[data-state="active"] & {
    color: ${t.colorTextOnBtnAccent};
    opacity: 0.85;
  }
`;

const Model = styled.span`
  font: ${t.textXs};
  color: ${t.colorAccent};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${Card}[data-state="active"] & {
    color: ${t.colorTextOnBtnAccent};
  }
`;

const NoKey = styled.span`
  font: ${t.textXs};
  color: ${t.btnClose};

  ${Card}[data-state="active"] & {
    color: ${t.colorTextOnBtnAccent};
    opacity: 0.9;
  }
`;
