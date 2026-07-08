import { useCallback, useEffect, useState } from "react";
import { styled } from "@linaria/react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../styles/theme";
import { PixelModal } from "./pixel/PixelModal";
import { PixelFrame } from "./pixel/PixelFrame";
import { PixelButton } from "./pixel/PixelButton";
import { PixelInput } from "./pixel/PixelInput";
import { PixelSelect, type PixelSelectOption } from "./pixel/PixelSelect";
import { PRIORITY_PAL } from "./pixel/palettes";
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

  // 输入框里正在敲的新模型名
  const [modelInput, setModelInput] = useState("");

  // 可选模型 = 协议预设 ∪ 用户自加（customModels），去重、保序（预设在前）
  const modelList = (() => {
    if (!draft) return [] as string[];
    const preset = protocolMeta(draft.protocol).presetModels;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of [...preset, ...(draft.customModels ?? [])]) {
      if (m && !seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  })();

  // 添加一个自定义模型：并入 customModels 并立即选中；输入框清空
  const addModel = useCallback(() => {
    const name = modelInput.trim();
    if (!name) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const preset = protocolMeta(prev.protocol).presetModels;
      // 已在预设或已加过 → 只选中，不重复加
      const custom = preset.includes(name) || (prev.customModels ?? []).includes(name)
        ? (prev.customModels ?? [])
        : [...(prev.customModels ?? []), name];
      return { ...prev, customModels: custom, model: name };
    });
    setModelInput("");
    setTest({ status: "idle" });
  }, [modelInput]);

  // 删除一个自定义模型（预设不可删）；若删的是当前选中，回退到列表首个
  const removeModel = useCallback((name: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const custom = (prev.customModels ?? []).filter((m) => m !== name);
      const preset = protocolMeta(prev.protocol).presetModels;
      const remain = [...preset, ...custom];
      const model = prev.model === name ? (remain[0] ?? "") : prev.model;
      return { ...prev, customModels: custom, model };
    });
  }, []);

  // 切协议：baseUrl / model 仍是旧协议默认时跟随，customModels 保留不清
  const handleProtocolChange = useCallback(
    (nextProto: string) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const oldMeta = protocolMeta(prev.protocol);
        const newMeta = protocolMeta(nextProto as ProtocolId);
        const next: ProviderProfile = { ...prev, protocol: nextProto as ProtocolId };
        if (prev.baseUrl === oldMeta.defaultBaseUrl) next.baseUrl = newMeta.defaultBaseUrl;
        // 切协议后若当前 model 不在新预设 + 自定义合并列表里，回到首个预设
        const available = [...newMeta.presetModels, ...(prev.customModels ?? [])];
        if (!available.includes(prev.model)) {
          next.model = newMeta.presetModels[0] ?? (prev.customModels ?? [])[0] ?? "";
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
          placeholder={
            draft.protocol === "openai-compatible"
              ? "填完整端点，如 https://xxx/v1/chat/completions"
              : "https://api.example.com"
          }
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

      <ModelField>
        <FieldLabel style={{ alignSelf: "flex-start", paddingTop: 6 }}>模型</FieldLabel>
        <ModelPanel>
          {/* 凹槽底：sunken 像素框，和主面板 Well 一致 */}
          <PixelFrame
            palette={PRIORITY_PAL.low}
            variant="sunken"
            pixel={3}
            radius={2}
            noise={0.05}
            noiseGranularity={2}
            liveResize
          />
          <ModelPanelInner>
          {/* 可选模型列表（预设 + 自定义，预设不可删） */}
          {modelList.length > 0 ? (
            <ModelList>
              {modelList.map((m) => {
                const isPreset = protocolMeta(draft.protocol).presetModels.includes(m);
                const isSelected = draft.model === m;
                return (
                  <ModelRow
                    key={m}
                    data-selected={isSelected || undefined}
                    onClick={() => { patch({ model: m }); }}
                  >
                    <ModelMark aria-hidden>{isSelected ? "▸" : ""}</ModelMark>
                    <ModelName>{m}</ModelName>
                    {!isPreset && (
                      <ModelDel
                        role="button"
                        tabIndex={0}
                        aria-label={`删除 ${m}`}
                        onClick={(e) => { e.stopPropagation(); removeModel(m); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            removeModel(m);
                          }
                        }}
                      >
                        ×
                      </ModelDel>
                    )}
                  </ModelRow>
                );
              })}
            </ModelList>
          ) : (
            <ModelEmpty>还没有模型，在下方输入后添加喵</ModelEmpty>
          )}

          {/* 固定输入行：始终显示，随时添加新模型 */}
          <ModelAdd>
            <PixelInput
              value={modelInput}
              placeholder="输入模型名后按 ＋ 添加"
              onChange={(e) => setModelInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
            />
            <PixelButton variant="primary" onClick={addModel} disabled={!modelInput.trim()}>
              ＋
            </PixelButton>
          </ModelAdd>
          </ModelPanelInner>
        </ModelPanel>
      </ModelField>

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
  width: 82px;
  font: ${t.textMd};
  letter-spacing: 1px;
  color: ${t.colorTextMuted};
`;

const Spacer = styled.span`
  flex: 1 1 auto;
`;

/* 模型区：整行（标签在上，面板在下），比其它单行字段高 */
const ModelField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

/* 模型展开面板：凹槽底 + 内容浮其上 */
const ModelPanel = styled.div`
  position: relative;
`;

const ModelPanelInner = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 2px;
`;

/* 模型列表：超高滚动 */
const ModelList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 150px;
  overflow-y: auto;
`;

/* 单个模型行：左键点选中，选中态高亮；自定义项右侧有 × 删除 */
const ModelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  color: ${t.colorText};
  transition: background-color 0.12s ease;

  &:hover {
    background-color: ${t.colorAccentSoft};
  }
  &[data-selected] {
    background-color: ${t.colorAccentSoft};
  }
`;

const ModelMark = styled.span`
  flex: 0 0 auto;
  width: 12px;
  color: ${t.colorAccent};
  font :${t.textLg};
  margin-top: -4px;
`;

const ModelName = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: ${t.textMd};
  letter-spacing: 0.5px;
`;

/* 删除 × 只对自定义模型显示 */
const ModelDel = styled.span`
  flex: 0 0 auto;
  padding: 0 4px;
  color: ${t.colorTextMuted};
  cursor: pointer;

  &:hover {
    color: ${t.btnClose};
  }
`;

const ModelEmpty = styled.div`
  padding: 8px;
  font: ${t.textXs};
  color: ${t.colorTextMuted};
`;

/* 固定输入行：始终保留在面板底部，随时加新模型 */
const ModelAdd = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px 2px;

  & > *:first-child {
    flex: 1 1 auto;
    min-width: 0;
  }
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
