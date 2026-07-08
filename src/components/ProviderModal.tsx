import { useCallback, useEffect, useMemo, useState } from "react";
import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../styles/theme";
import { PixelModal } from "./pixel/PixelModal";
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
 * AI 服务配置浮窗：一个 provider 档的完整表单（新建 / 编辑共用）。
 *  - 草稿式编辑：进来先把传入 profile 拷成本地草稿，改动只动草稿，
 *    「保存」才交给父级 upsert 落盘；「取消 / Esc / 点遮罩」丢弃草稿。
 *  - 表单：名称 / 协议 / Base URL / API Key / 模型（协议决定默认端点与模型候选）；
 *  - 「测试连接」直接拿当前草稿探活，不必先保存；
 *  - 编辑态（非新建）底部多一个「删除」。
 */

const PROTOCOL_OPTIONS: PixelSelectOption[] = PROTOCOLS.map((p) => ({
  value: p.id,
  label: p.label,
}));

type TestState = { status: "idle" | "testing" | "ok" | "fail"; msg?: string };

interface ProviderModalProps {
  open: boolean;
  /** 要编辑的档；新建时传入一个 blankProfile 草稿 */
  profile: ProviderProfile | null;
  /** 是否新建（决定标题与是否显示删除） */
  isNew: boolean;
  onClose: () => void;
  onSave: (profile: ProviderProfile) => void;
  onDelete: (id: string) => void;
}

export function ProviderModal({
  open,
  profile,
  isNew,
  onClose,
  onSave,
  onDelete,
}: ProviderModalProps) {
  const [draft, setDraft] = useState<ProviderProfile | null>(profile);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  // 每次打开 / 换档：重置草稿与测试态
  useEffect(() => {
    if (open) {
      setDraft(profile);
      setTest({ status: "idle" });
    }
  }, [open, profile]);

  const patch = useCallback((p: Partial<ProviderProfile>) => {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
    setTest({ status: "idle" });
  }, []);

  // 当前协议的模型候选（有预设给下拉，无预设留给手填）
  const modelOptions = useMemo<PixelSelectOption[]>(() => {
    if (!draft) return [];
    const meta = protocolMeta(draft.protocol);
    const preset = meta.presetModels.map((m) => ({ value: m, label: m }));
    if (draft.model && !meta.presetModels.includes(draft.model)) {
      preset.unshift({ value: draft.model, label: draft.model });
    }
    return preset;
  }, [draft]);

  // 切协议：baseUrl / model 仍是旧协议默认（用户没改过）时跟随切到新协议默认
  const handleProtocolChange = useCallback(
    (nextProto: string) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const oldMeta = protocolMeta(prev.protocol);
        const newMeta = protocolMeta(nextProto as ProtocolId);
        const next: ProviderProfile = { ...prev, protocol: nextProto as ProtocolId };
        if (prev.baseUrl === oldMeta.defaultBaseUrl) next.baseUrl = newMeta.defaultBaseUrl;
        if (!newMeta.presetModels.includes(prev.model)) {
          next.model = newMeta.presetModels[0] ?? "";
        }
        return next;
      });
      setTest({ status: "idle" });
    },
    [],
  );

  const handleTest = useCallback(async () => {
    if (!draft) return;
    setTest({ status: "testing" });
    try {
      const res = await invoke<{ ok: boolean; message: string }>("provider_test", {
        profile: draft,
      });
      setTest({ status: res.ok ? "ok" : "fail", msg: res.message });
    } catch (err) {
      setTest({ status: "fail", msg: String(err) });
    }
  }, [draft]);

  const handleSave = useCallback(() => {
    if (!draft) return;
    // 名称留空回退到协议默认名
    const meta = protocolMeta(draft.protocol);
    onSave({ ...draft, name: draft.name.trim() || meta.label });
  }, [draft, onSave]);

  if (!draft) return null;

  return (
    <PixelModal
      open={open}
      title={isNew ? "新建 AI 服务" : "编辑 AI 服务"}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <PixelButton variant="low" onClick={() => onDelete(draft.id)}>
              删除
            </PixelButton>
          )}
          <PixelButton
            variant="low"
            onClick={handleTest}
            disabled={test.status === "testing" || !draft.apiKey}
          >
            测试连接
          </PixelButton>
          <Spacer />
          <PixelButton variant="low" onClick={onClose}>
            取消
          </PixelButton>
          <PixelButton variant="primary" onClick={handleSave}>
            保存
          </PixelButton>
        </>
      }
    >
      <FieldRow>
        <FieldLabel>名称</FieldLabel>
        <PixelInput
          value={draft.name}
          placeholder={protocolMeta(draft.protocol).label}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </FieldRow>

      <FieldRow>
        <FieldLabel>协议</FieldLabel>
        <PixelSelect
          options={PROTOCOL_OPTIONS}
          value={draft.protocol}
          onChange={handleProtocolChange}
          variant="normal"
        />
      </FieldRow>

      <FieldRow>
        <FieldLabel>Base URL</FieldLabel>
        <PixelInput
          value={draft.baseUrl}
          placeholder="https://api.example.com"
          onChange={(e) => patch({ baseUrl: e.target.value })}
        />
      </FieldRow>

      <FieldRow>
        <FieldLabel>API Key</FieldLabel>
        <PixelInput
          type="password"
          value={draft.apiKey}
          placeholder="sk-..."
          autoComplete="off"
          onChange={(e) => patch({ apiKey: e.target.value })}
        />
      </FieldRow>

      <FieldRow>
        <FieldLabel>模型</FieldLabel>
        {modelOptions.length > 0 ? (
          <PixelSelect
            options={modelOptions}
            value={draft.model || undefined}
            onChange={(m) => patch({ model: m })}
            variant="normal"
          />
        ) : (
          <PixelInput
            value={draft.model}
            placeholder="填入模型名，如 gpt-4o"
            onChange={(e) => patch({ model: e.target.value })}
          />
        )}
      </FieldRow>

      {test.status !== "idle" && (
        <TestMsg data-status={test.status}>
          {test.status === "testing" && "测试中…"}
          {test.status === "ok" && `✓ ${test.msg ?? "连接成功"}`}
          {test.status === "fail" && `✗ ${test.msg ?? "连接失败"}`}
        </TestMsg>
      )}
    </PixelModal>
  );
}

const FieldRow = styled.label`
  display: flex;
  align-items: center;
  gap: 12px;

  /* 让输入控件占满标签右侧剩余宽度 */
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

const Spacer = styled.span`
  flex: 1 1 auto;
`;

const TestMsg = styled.div`
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
