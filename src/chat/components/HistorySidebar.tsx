import { useEffect, useMemo, useState } from "react";
import { styled } from "@linaria/react";
import { t, type ThemeMode } from "../../styles/theme";
import { PixelScrollArea } from "../../components/pixel/PixelScrollArea";
import { PixelFrame } from "../../components/pixel/PixelFrame";
import { PixelActionRow } from "../../components/pixel/PixelActionRow";
import { SIDEBAR_PANEL, PX } from "../../components/pixel/palettes";
import {
  NewChatIcon,
  SearchIcon,
  ChevronLeftIcon,
} from "../../components/pixel/icons";
import { HistoryCard } from "./HistoryCard";
import { relativeDay, type Conversation } from "../types";

/**
 * 左侧历史会话栏：顶部一列功能行（PixelActionRow：发起新对话 / 搜索对话），
 * 下面按日期分组的会话列表，底部「收起侧栏」。支持收起成纯图标窄条。
 *
 *  - 功能行走 PixelActionRow（rest 静默、hover 浮像素板），与会话卡片差异化；
 *  - 搜索：点功能行展开内嵌输入框（sunken 凹槽），按标题/预览过滤列表，Esc 关闭；
 *    收起侧栏时点搜索会先展开再打开输入框；
 *  - 收起态：只剩功能行图标，列表隐藏；宽度过渡 + PixelFrame sizeKey 按态缓存。
 *
 * 面板背景与主界面侧边栏同款：PixelFrame 分层边框 + 慢速动态底噪
 * （SIDEBAR_PANEL[theme]），让对话窗和主面板风格统一。
 * 纯 UI：选择 / 新建 / 删除 / 收起都通过回调交给父级。
 */

// ---- 面板底噪参数（对齐主侧边栏）----
const PANEL_PIXEL = 4;
const PANEL_NOISE = 0.08;
const PANEL_NOISE_GRAN = 3;
const PANEL_NOISE_SPEED = 1.0;

/** 展开 / 收起宽度 px */
const WIDTH_EXPANDED = 224;
const WIDTH_COLLAPSED = 56;

interface HistorySidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** 删除某条会话（卡片浮层菜单里点删除并确认后触发） */
  onDelete: (id: string) => void;
  /** 分组相对日期用的“现在”时间戳（父级传入，避免各处重复取时钟） */
  now: number;
  /** 主题：决定面板底噪调色（与主侧边栏一致） */
  theme: ThemeMode;
  /** 收起态（父级持久化到 settings） */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function HistorySidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  now,
  theme,
  collapsed,
  onToggleCollapse,
}: HistorySidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
  };

  // 收起侧栏时搜索没有安放处：一并关闭并清空
  useEffect(() => {
    if (collapsed) {
      setSearchOpen(false);
      setQuery("");
    }
  }, [collapsed]);

  // 点「搜索对话」：收起态先展开侧栏再打开输入框；展开态则开/关切换
  const toggleSearch = () => {
    if (collapsed) {
      onToggleCollapse();
      setSearchOpen(true);
      return;
    }
    if (searchOpen) closeSearch();
    else setSearchOpen(true);
  };

  // 搜索过滤：标题 / 预览 命中即保留（大小写不敏感）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  // 按 updatedAt 倒序后，按相对日期（今天/昨天/日期）分组保序
  const groups = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
    const out: { label: string; items: Conversation[] }[] = [];
    for (const c of sorted) {
      const label = relativeDay(c.updatedAt, now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [filtered, now]);

  return (
    <Aside data-collapsed={collapsed || undefined}>
      {/* 面板背景：分层像素边框 + 慢速动态底噪（同主侧边栏）。
          宽度瞬切（无补间）：sizeKey 按态缓存目标尺寸、liveResize 兜住首次切换
          （突发首帧同步重建网格），任一态切换当帧即是清晰网格，无拉伸帧 */}
      <PixelFrame
        palette={SIDEBAR_PANEL[theme]}
        variant="raised"
        pixel={PANEL_PIXEL}
        radius={0}
        noise={PANEL_NOISE}
        noiseGranularity={PANEL_NOISE_GRAN}
        noiseSpeed={PANEL_NOISE_SPEED}
        sizeKey={collapsed ? "c" : "e"}
        liveResize
      />
      <Inner>
        <Actions>
          <PixelActionRow
            icon={<NewChatIcon />}
            label="发起新对话"
            collapsed={collapsed}
            onActivate={onNew}
          />
          <PixelActionRow
            icon={<SearchIcon />}
            label="搜索对话"
            collapsed={collapsed}
            active={searchOpen}
            onActivate={toggleSearch}
          />
        </Actions>

        {/* 内嵌搜索输入：sunken 凹槽像素框，Esc 关闭 */}
        {searchOpen && !collapsed && (
          <SearchWrap>
            <PixelFrame
              palette={PX.well}
              variant="sunken"
              pixel={3}
              radius={1}
              noise={0.05}
              noiseGranularity={2}
            />
            <SearchInput
              autoFocus
              value={query}
              placeholder="搜索标题 / 内容…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
            />
          </SearchWrap>
        )}

        {collapsed ? (
          <Spacer />
        ) : (
          <ListWrap>
            <PixelScrollArea contentStyle={{ padding: "4px 8px 10px" }}>
              {groups.map((g) => (
                <Group key={g.label}>
                  <GroupLabel>{g.label}</GroupLabel>
                  {g.items.map((c) => (
                    // 直接透传父级稳定回调（卡片按 id 回指）：不再每次渲染造新闭包，
                    // 否则 HistoryCard 的 memo 会被新函数引用击穿、每个 delta 全列表重渲染
                    <HistoryCard
                      key={c.id}
                      id={c.id}
                      title={c.title}
                      preview={c.preview}
                      active={c.id === activeId}
                      onSelect={onSelect}
                      onDelete={onDelete}
                    />
                  ))}
                </Group>
              ))}
              {conversations.length === 0 && (
                <EmptyHint>还没有历史对话喵</EmptyHint>
              )}
              {conversations.length > 0 && filtered.length === 0 && (
                <EmptyHint>没有匹配的对话喵</EmptyHint>
              )}
            </PixelScrollArea>
          </ListWrap>
        )}

        <CollapseSlot>
          <PixelActionRow
            icon={
              <FlipWrap data-flip={collapsed || undefined}>
                <ChevronLeftIcon width={18} height={18} />
              </FlipWrap>
            }
            label={collapsed ? "展开侧栏" : "收起侧栏"}
            collapsed={collapsed}
            onActivate={onToggleCollapse}
          />
        </CollapseSlot>
      </Inner>
    </Aside>
  );
}

/* 收起/展开为「瞬切」而非宽度补间：补间的 160ms 里整个对话区会连续 reflow
   （气泡换行重排 + 虚拟列表重测高 + 像素帧重建），必然掉帧；且中间宽度会把
   SVG 像素帧拉伸出粗边框。瞬切只有一次干净重排，配合 liveResize 当帧重建网格，
   全程无拉伸帧。折叠箭头的翻转动画（FlipWrap）保留，提供状态反馈。 */
const Aside = styled.aside`
  position: relative;
  flex: 0 0 auto;
  width: ${WIDTH_EXPANDED}px;
  display: flex;
  flex-direction: column;
  min-height: 0;

  &[data-collapsed] {
    width: ${WIDTH_COLLAPSED}px;
  }
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

/* 顶部功能行组：新建 / 搜索 */
const Actions = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px 6px;
`;

/* 内嵌搜索框：凹槽像素底 + 透明输入 */
const SearchWrap = styled.div`
  position: relative;
  flex: 0 0 auto;
  height: 32px;
  margin: 0 10px 8px;
`;

const SearchInput = styled.input`
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  padding: 0 10px;
  border: 0;
  background: transparent;
  font: ${t.textSm};
  color: ${t.colorText};
  outline: none;

  &::placeholder {
    color: ${t.colorTextMuted};
  }
`;

const ListWrap = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 4px;
`;

/* 收起态占位：把底部「展开侧栏」推到底 */
const Spacer = styled.div`
  flex: 1 1 auto;
`;

const CollapseSlot = styled.div`
  flex: 0 0 auto;
  padding: 6px 8px 10px;
`;

/* 折叠箭头翻转：收起时 180° 变 ">"（指向展开方向） */
const FlipWrap = styled.span`
  display: inline-flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  transition: transform 0.16s ease;

  &[data-flip] {
    transform: rotate(180deg);
  }
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
`;

const GroupLabel = styled.div`
  padding: 6px 8px 2px;
  font: ${t.textXs};
  letter-spacing: 1px;
  color: ${t.colorTextMuted};
`;

const EmptyHint = styled.div`
  padding: 20px 10px;
  text-align: center;
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;
