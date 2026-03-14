import { useCallback, useState } from 'react';

export function useConfirmDialog() {
  const [dialog, setDialog] = useState(null);

  const resolveDialog = useCallback((result) => {
    setDialog((current) => {
      if (current?.resolve) {
        current.resolve(result);
      }
      return null;
    });
  }, []);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setDialog({
        title: '확인이 필요합니다.',
        description: '',
        confirmLabel: '확인',
        cancelLabel: '취소',
        tone: 'danger',
        ...options,
        resolve
      });
    });
  }, []);

  return {
    confirm,
    dialogProps: dialog ? {
      open: true,
      title: dialog.title,
      description: dialog.description,
      confirmLabel: dialog.confirmLabel,
      cancelLabel: dialog.cancelLabel,
      tone: dialog.tone,
      onConfirm: () => resolveDialog(true),
      onCancel: () => resolveDialog(false)
    } : { open: false, onConfirm: () => {}, onCancel: () => {} }
  };
}
