import { useMemo } from "react";
import { styled } from "@linaria/react";
import { t, type ThemeMode, pixelCorners } from "../../styles/theme";
import { PixelScrollArea } from "../../components/pixel/PixelScrollArea";
import { PixelFrame } from "../../components/pixel/PixelFrame";
import { PixelButton } from "../../components/pixel/PixelButton";
import { SIDEBAR_PANEL } from "../../components/pixel/palettes";
import { relativeDay, type Conversation } from "../types";

/**
 * 左侧历史会话栏：顶部「新建对话」按钮，下面按日期分组的会话列表。
 * 选中项有青色左脊 + 高亮底；每项显示标题 + 最近一条预览。
 *
 * 面板背景与主界面侧边栏同款：PixelFrame 分层边框 + 慢速动态底噪
 * （SIDEBAR_PANEL[theme]），让对话窗和主面板风格统一。
 * 纯 UI：选择 / 新建都通过回调交给父级。
 */

// ---- 面板底噪参数（对齐主侧边栏）----
const PANEL_PIXEL = 4;
const PANEL_NOISE = 0.08;
const PANEL_NOISE_GRAN = 3;
const PANEL_NOISE_SPEED = 1.0;

interface HistorySidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** 分组相对日期用的“现在”时间戳（父级传入，避免各处重复取时钟） */
  now: number;
  /** 主题：决定面板底噪调色（与主侧边栏一致） */
  theme: ThemeMode;
}

export function HistorySidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  now,
  theme,
}: HistorySidebarProps) {
  // 按 updatedAt 倒序后，按相对日期（今天/昨天/日期）分组保序
  const groups = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    const out: { label: string; items: Conversation[] }[] = [];
    for (const c of sorted) {
      const label = relativeDay(c.updatedAt, now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [conversations, now]);

  return (
    <Aside>
      {/* 面板背景：分层像素边框 + 慢速动态底噪（同主侧边栏） */}
      <PixelFrame
        palette={SIDEBAR_PANEL[theme]}
        variant="raised"
        pixel={PANEL_PIXEL}
        radius={0}
        noise={PANEL_NOISE}
        noiseGranularity={PANEL_NOISE_GRAN}
        noiseSpeed={PANEL_NOISE_SPEED}
      />
      <Inner>
        <Header>
          <Title>对话历史</Title>
          <PixelButton variant="primary" onClick={onNew}>
            ＋ 新建
          </PixelButton>
        </Header>

        <ListWrap>
          <PixelScrollArea contentStyle={{ padding: "4px 8px 10px" }}>
            {groups.map((g) => (
              <Group key={g.label}>
                <GroupLabel>{g.label}</GroupLabel>
                {g.items.map((c) => (
                  <Item
                    key={c.id}
                    type="button"
                    data-active={c.id === activeId || undefined}
                    onClick={() => onSelect(c.id)}
                  >
                    <ItemTitle>{c.title}</ItemTitle>
                    <ItemPreview>{c.preview}</ItemPreview>
                  </Item>
                ))}
              </Group>
            ))}
            {conversations.length === 0 && <EmptyHint>还没有历史对话喵</EmptyHint>}
          </PixelScrollArea>
        </ListWrap>
      </Inner>
    </Aside>
  );
}

const Aside = styled.aside`
  position: relative;
  flex: 0 0 auto;
  width: 224px;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

/* 内容层：浮在 PixelFrame 面板之上 */
const Inner = styled.div`
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const Header = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 12px 10px;
`;

const Title = styled.div`
  font: ${t.textMd};
  font-weight: bold;
  letter-spacing: 1px;
  color: ${t.colorText};
`;

const ListWrap = styled.div`
  flex: 1 1 auto;
  min-height: 0;
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
`;

const GroupLabel = styled.div`
  padding: 6px 8px 2px;
  font: ${t.textXs};
  letter-spacing: 1px;
  color: ${t.colorTextMuted};
`;

/* 会话项：hover 柔高亮，选中态青色左脊 + 高亮底 */
const Item = styled.button`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px 8px 12px;
  border: 0;
  background: transparent;
  clip-path: ${pixelCorners};
  cursor: pointer;
  text-align: left;
  transition: background-color 0.14s ease;

  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    background: transparent;
    transition: background-color 0.14s ease;
  }

  &:hover {
    background-color: ${t.colorAccentSoft};
  }
  &[data-active] {
    background-color: ${t.colorAccentSoft};
  }
  &[data-active]::before {
    background: ${t.colorAccent};
  }
`;

const ItemTitle = styled.div`
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 0.5px;
  color: ${t.colorText};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ItemPreview = styled.div`
  font: ${t.textXs};
  line-height: 1.5;
  color: ${t.colorTextMuted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EmptyHint = styled.div`
  padding: 20px 10px;
  text-align: center;
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;
