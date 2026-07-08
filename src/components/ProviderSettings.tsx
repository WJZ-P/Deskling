import { useCallback, useState } from "react";
import { styled } from "@linaria/react";
import { t } from "../styles/theme";
import { PixelButton } from "./pixel/PixelButton";
import { ProviderCard } from "./ProviderCard";
import { ProviderModal } from "./ProviderModal";
import { blankProfile, type ProviderProfile } from "../settings";

/**
 * AI 模型服务设置（编排层）：
 *  - 卡片网格：每个已配置服务一张卡，左键点切换激活，卡上「编辑」开配置浮窗；
 *  - ＋新建：开一个空白草稿浮窗；
 *  - 完整配置表单（名称/协议/baseUrl/key/模型 + 测试/删除）都在 ProviderModal 里，
 *    设置页只留卡片，省面积、更清爽。
 *
 * 纯编排：档位数据由父级（Settings）持有，保存/删除/切换通过回调落盘。
 */

interface ProviderSettingsProps {
  profiles: ProviderProfile[];
  activeId: string | null;
  onSave: (profile: ProviderProfile) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}

export function ProviderSettings({
  profiles,
  activeId,
  onSave,
  onDelete,
  onSelect,
}: ProviderSettingsProps) {
  // 浮窗：editing 存当前编辑的草稿（新建=空白档，编辑=已有档的副本）
  const [editing, setEditing] = useState<ProviderProfile | null>(null);
  // 是否是「新建」（决定保存时激活它 + 浮窗标题）
  const [isNew, setIsNew] = useState(false);

  const openCreate = useCallback(() => {
    setEditing(blankProfile("anthropic"));
    setIsNew(true);
  }, []);

  const openEdit = useCallback((p: ProviderProfile) => {
    setEditing({ ...p });
    setIsNew(false);
  }, []);

  const close = useCallback(() => setEditing(null), []);

  const handleSave = useCallback(
    (profile: ProviderProfile) => {
      onSave(profile);
      // 新建的档保存后自动激活
      if (isNew) onSelect(profile.id);
      setEditing(null);
    },
    [onSave, onSelect, isNew],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
      setEditing(null);
    },
    [onDelete],
  );

  return (
    <Wrap>
      <Bar>
        <BarLabel>已配置服务</BarLabel>
        <Spacer />
        <PixelButton variant="primary" onClick={openCreate}>
          ＋ 新建
        </PixelButton>
      </Bar>

      {profiles.length > 0 ? (
        <Grid>
          {profiles.map((p) => (
            <ProviderCard
              key={p.id}
              profile={p}
              active={p.id === activeId}
              onSelect={() => onSelect(p.id)}
              onEdit={() => openEdit(p)}
              onDelete={() => onDelete(p.id)}
            />
          ))}
        </Grid>
      ) : (
        <Empty>还没有配置任何服务喵，点「＋新建」加一个吧～</Empty>
      )}

      <ProviderModal
        open={editing != null}
        isNew={isNew}
        profile={editing}
        onClose={close}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const BarLabel = styled.span`
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 1px;
  color: ${t.colorText};
`;

const Spacer = styled.span`
  flex: 1 1 auto;
`;

const Empty = styled.div`
  padding: 16px 12px;
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

/* 卡片网格：自适应列宽，最少 180px 一列 */
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
`;
