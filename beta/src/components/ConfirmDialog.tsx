'use client';

import { useLang } from '@/lib/i18n/provider';

export default function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Label for the confirm button. Defaults to the generic Delete label. */
  confirmLabel?: string;
}) {
  const { t } = useLang();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 fade-up"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xs rounded-2xl bg-card2 border border-line p-5 bloom"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <p className="mt-1.5 text-[14px] text-muted leading-snug">{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl bg-card border border-line py-2.5 text-[14px] font-medium transition-fast active:scale-95"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-ink transition-fast active:scale-95"
          >
            {confirmLabel ?? t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
