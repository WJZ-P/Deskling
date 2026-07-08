import { useCallback, useMemo, useState } from "react";
import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../styles/theme";
import { PixelButton } from "./pixel/PixelButton";
import { PixelInput } from "./pixel/PixelInput";
import { PixelSelect, type PixelSelectOption } from "./pixel/PixelSelect";
import {
  PROTOCOLS,
  protocolMeta,
  type ProtocolId,
  type ProviderProfile,
} from "../settings";

/**
 * AI 模型服务设置：多档位可切换。
 *  - 顶部：档位选择 + 新建；
 *  - 表单：名称 / 协议 / Base URL / API Key / 模型（协议决定默认端点与模型候选）；
 *  - 底部：删除 · 测试连接。
 *
 * 纯受控组件：所有档位数据由父级（Settings）持有，增删改通过回调交给
 * settings.ts 的 provider 操作落盘；本组件只管表单交互与「测试连接」的即时反馈。
 */

interface ProviderSettingsProps {
  profiles: ProviderProfile[];
  activeId: string | null;
  onCreate: (protocol: ProtocolId) => void;
  onUpdate: (id: string, patch: Partial<Omit<ProviderProfile, "id">>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}

const PROTOCOL_OPTIONS: PixelSelectOption[] = PROTOCOLS.map((p) => ({
  value: p.id,
  label: p.label,
}));

type TestState = { status: "idle" | "testing" | "ok" | "fail"; msg?: string };

export function ProviderSettings({
  profiles,
  activeId,
  onCreate,
  onUpdate,
  onDelete,
  onSelect,
}: ProviderSettingsProps) {
  const active = profiles.find((p) => p.id === activeId) ?? null;
  const [test, setTest] = useState<TestState>({ status: "idle" });

  // 档位下拉候选
  const profileOptions = useMemo<PixelSelectOption[]>(
    () => profiles.map((p) => ({ value: p.id, label: p.name || "未命名" })),
    [profiles],
  );

  // 当前协议的模型候选（有预设给下拉，无预设留给手填）
  const modelOptions = useMemo<PixelSelectOption[]>(() => {
    if (!active) return [];
    const meta = protocolMeta(active.protocol);
    const preset = meta.presetModels.map((m) => ({ value: m, label: m }));
    // 当前 model 不在预设里时，补一个当前值，避免下拉显示空
    if (active.model && !meta.presetModels.includes(active.model)) {
      preset.unshift({ value: active.model, label: active.model });
    }
    return preset;
  }, [active]);

  // 切协议：同步把 baseUrl / model 重置为该协议默认（仅当当前是旧协议默认时才覆盖，避免踩掉用户自定义）
  const handleProtocolChange = useCallback(
    (nextProto: string) => {
      if (!active) return;
      const oldMeta = protocolMeta(active.protocol);
      const newMeta = protocolMeta(nextProto as ProtocolId);
      const patch: Partial<ProviderProfile> = { protocol: nextProto as ProtocolId };
      // baseUrl 仍是旧协议默认（用户没改过）→ 跟随切到新协议默认
      if (active.baseUrl === oldMeta.defaultBaseUrl) patch.baseUrl = newMeta.defaultBaseUrl;
      // 模型不在新协议预设里 → 切到新协议首个预设
      if (!newMeta.presetModels.includes(active.model)) {
        patch.model = newMeta.presetModels[0] ?? "";
      }
      onUpdate(active.id, patch);
      setTest({ status: "idle" });
    },
    [active, onUpdate],
  );

  const handleTest = useCallback(async () => {
    if (!active) return;
    setTest({ status: "testing" });
    try {
      // Rust 侧命令：按 profile 发一个最小探测请求，返回 { ok, message }
      const res = await invoke<{ ok: boolean; message: string }>("provider_test", {
        profile: active,
      });
      setTest({ status: res.ok ? "ok" : "fail", msg: res.message });
    } catch (err) {
      setTest({ status: "fail", msg: String(err) });
    }
  }, [active]);

  return (
    <Wrap>
      {/* 档位选择行 */}
      <ProfileBar>
        <BarLabel>当前服务</BarLabel>
        {profiles.length > 0 ? (
          <PixelSelect
            options={profileOptions}
            value={activeId ?? undefined}
            onChange={onSelect}
            variant="normal"
          />
        ) : (
          <Empty>还没有配置任何服务喵</Empty>
        )}
        <Spacer />
        <PixelSelect
          options={PROTOCOL_OPTIONS}
          value={undefined}
          placeholder="＋ 新建"
          onChange={(proto) => onCreate(proto as ProtocolId)}
          variant="primary"
        />
      </ProfileBar>

      {active && (
        <Form>
          <FieldRow>
            <FieldLabel>名称</FieldLabel>
            <PixelInput
              value={active.name}
              placeholder="给这个服务起个名字"
              onChange={(e) => onUpdate(active.id, { name: e.target.value })}
            />
          </FieldRow>

          <FieldRow>
            <FieldLabel>协议</FieldLabel>
            <PixelSelect
              options={PROTOCOL_OPTIONS}
              value={active.protocol}
              onChange={handleProtocolChange}
              variant="normal"
            />
          </FieldRow>

          <FieldRow>
            <FieldLabel>Base URL</FieldLabel>
            <PixelInput
              value={active.baseUrl}
              placeholder="https://api.example.com"
              onChange={(e) => onUpdate(active.id, { baseUrl: e.target.value })}
            />
          </FieldRow>

          <FieldRow>
            <FieldLabel>API Key</FieldLabel>
            <PixelInput
              type="password"
              value={active.apiKey}
              placeholder="sk-..."
              autoComplete="off"
              onChange={(e) => onUpdate(active.id, { apiKey: e.target.value })}
            />
          </FieldRow>

          <FieldRow>
            <FieldLabel>模型</FieldLabel>
            {modelOptions.length > 0 ? (
              <PixelSelect
                options={modelOptions}
                value={active.model || undefined}
                onChange={(m) => onUpdate(active.id, { model: m })}
                variant="normal"
              />
            ) : (
              <PixelInput
                value={active.model}
                placeholder="填入模型名，如 gpt-4o"
                onChange={(e) => onUpdate(active.id, { model: e.target.value })}
              />
            )}
          </FieldRow>

          <Actions>
            {test.status !== "idle" && (
              <TestMsg data-status={test.status}>
                {test.status === "testing" && "测试中…"}
                {test.status === "ok" && `✓ ${test.msg ?? "连接成功"}`}
                {test.status === "fail" && `✗ ${test.msg ?? "连接失败"}`}
              </TestMsg>
            )}
            <Spacer />
            <PixelButton variant="low" onClick={() => onDelete(active.id)}>
              删除
            </PixelButton>
            <PixelButton
              variant="primary"
              onClick={handleTest}
              disabled={test.status === "testing" || !active.apiKey}
            >
              测试连接
            </PixelButton>
          </Actions>
        </Form>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const ProfileBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const BarLabel = styled.span`
  font: ${t.textSm};
  font-weight: bold;
  letter-spacing: 1px;
  color: ${t.colorText};
`;

const Empty = styled.span`
  font: ${t.textSm};
  color: ${t.colorTextMuted};
`;

const Spacer = styled.span`
  flex: 1 1 auto;
`;

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const FieldRow = styled.label`
  display: flex;
  align-items: center;
  gap: 12px;

  /* 让输入控件（PixelInput / PixelSelect）占满标签右侧剩余宽度 */
  & > *:last-child {
    flex: 1 1 auto;
    min-width: 0;
  }
`;

const FieldLabel = styled.span`
  flex: 0 0 auto;
  width: 72px;
  font: ${t.textSm};
  letter-spacing: 1px;
  color: ${t.colorTextMuted};
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
`;

const TestMsg = styled.span`
  font: ${t.textSm};
  letter-spacing: 0.5px;

  &[data-status="testing"] {
    color: ${t.colorTextMuted};
  }
  &[data-status="ok"] {
    color: ${t.btnMax};
  }
  &[data-status="fail"] {
    color: ${t.btnClose};
  }
`;
