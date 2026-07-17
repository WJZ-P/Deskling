import { useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import { PixelSurface, type SurfaceState, type SurfaceTune } from "./pixel/PixelSurface";
import { PRIORITY_PAL } from "./pixel/palettes";
import { PixelIconButton } from "./pixel/PixelIconButton";
import { DeleteIcon } from "./pixel/icons";

/**
 * 记忆卡：设置页「长期记忆」浮窗里的一条记忆便签。
 * 与通用 PixelCard 刻意做出区分：
 *  - 像素粒度更细（3 vs 5）——记忆是"纸片"，比面板类卡片更轻薄细腻；
 *  - 头部是「青色像素角标 + 日期」的便签抬头（textSm，不再是眯眼小字），
 *    右上删除 icon（danger 色调，自行拦截冒泡）；
 *  - 正文正文号、最多三行截断——整卡可点，弹详情浮窗看全文；
 *  - hover 轻抬升 + 低噪缓流（比 PixelCard 更含蓄，一屏多卡不闹腾）。
 */

// ---- 顶层可调常量 ----
const MEM_PIXEL = 3; // 像素粒度：比 PixelCard(5) 细一档，纸片感
const MEM_RADIUS = 2; // 像素切角
const MEM_NOISE = 0.06; // 静态低噪强度
const MEM_CLAMP_LINES = 3; // 列表内正文最多行数（超出截断，点卡看全文）

/** 动画调参：关呼吸、hover 低噪缓流 + 轻抬升（幅度都比 PixelCard 收着） */
const MEM_TUNE: Partial<SurfaceTune> = {
  flickerAmp: 0,
  noiseGranularity: 2,
  noiseHoverAmp: 0.08,
  noiseHoverDelay: 1.1,
  hoverLiftRole: [0.08, 0.06, 0.06, 0.02],
  pressLiftRole: [0, 0, 0, 0],
  delayMax: 0.15,
  hoverTy: -2,
  pressTy: 0,
  elevRest: 2,
  elevHover: 4,
  elevPress: 4,
  liftMs: 200,
};

interface MemoryCardProps {
  /** 记忆正文 */
  content: string;
  /** 记录时间戳（ms） */
  ts: number;
  /** 点卡片：看全文详情 */
  onOpen: () => void;
  /** 右上删除 */
  onDelete: () => void;
}

export function MemoryCard({ content, ts, onOpen, onDelete }: MemoryCardProps) {
  const [hovered, setHovered] = useState(false);
  const state: SurfaceState = hovered ? "hover" : "rest";

  return (
    <Card
      onClick={onOpen}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <PixelSurface
        palette={PRIORITY_PAL.low}
        state={state}
        pixel={MEM_PIXEL}
        radius={MEM_RADIUS}
        noise={MEM_NOISE}
        tune={MEM_TUNE}
        rootStyle={{ display: "flex", width: "100%" }}
        contentStyle={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: "flex-start",
          width: "100%",
          gap: 6,
          padding: "10px 12px 12px 14px",
        }}
      >
        <Head>
          <DateWrap>
            <DateDot aria-hidden />
            {new Date(ts).toLocaleDateString()}
          </DateWrap>
          <PixelIconButton aria-label="删除这条记忆" tone="danger" onActivate={onDelete}>
            <DeleteIcon />
          </PixelIconButton>
        </Head>
        <Text>{content}</Text>
      </PixelSurface>
    </Card>
  );
}

const Card = styled.div`
  position: relative;
  display: flex;
  cursor: pointer;
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(${t.unit} * 2);
`;

/* 便签抬头：像素角标 + 日期（textSm——日期是可读信息，不做眯眼小字） */
const DateWrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 1px;
  color: ${t.colorTextMuted};
`;

/* 青色像素角标：两格错位的小方块，一眼「这是记忆钉在这」 */
const DateDot = styled.span`
  position: relative;
  width: 7px;
  height: 7px;
  background: ${t.colorAccent};
  box-shadow:
    3px 3px 0 0 ${t.colorAccent},
    0 2px 0 0 ${t.colorShadowPixel};
  margin-right: 3px;
`;

/* 记忆正文：正文号、最多三行截断（整卡可点看全文） */
const Text = styled.div`
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${MEM_CLAMP_LINES};
  overflow: hidden;
  font: ${t.textMd};
  line-height: 1.7;
  color: ${t.colorText};
  word-break: break-word;
`;
