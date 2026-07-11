import type { ReactNode } from "react";
import { styled } from "@linaria/react";
import { t } from "../../styles/theme";
import { PixelModal } from "./PixelModal";
import { PixelButton } from "./PixelButton";

/**
 * 像素风确认弹窗（PixelModal 的薄包装）。
 *  - message：弹窗正文（可以是字符串或节点）；
 *  - tone：语义标记（default / danger）。破坏性操作传 danger，但确认按钮一律
 *    走普通 primary（青）—— 危险性由标题/正文文案表达，不靠红字。
 *  - onConfirm / onCancel：确认 / 取消回调（取消也会触发 onClose）。
 * 用法：把 open 状态和 target 放到调用方，confirm 后执行真实操作。
 */

interface PixelConfirmModalProps {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

export function PixelConfirmModal({
  open,
  title = "确认操作",
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  // tone 仍是公开语义标记（调用方传 danger），但不再驱动样式：不解构以免未用告警
  onConfirm,
  onCancel,
}: PixelConfirmModalProps) {
  return (
    <PixelModal
      open={open}
      title={title}
      onClose={onCancel}
      width={360}
      footer={
        <>
          <PixelButton variant="low" onClick={onCancel}>
            {cancelLabel}
          </PixelButton>
          <PixelButton variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </PixelButton>
        </>
      }
    >
      <Message>{message}</Message>
    </PixelModal>
  );
}

const Message = styled.p`
  margin: 0;
  font: ${t.textMd};
  line-height: 1.7;
  color: ${t.colorText};
`;
