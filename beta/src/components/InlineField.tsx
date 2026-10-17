'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Inline editing where the text IS the input: always rendered as a
 * borderless input/textarea with inherited font — zero layout shift.
 * Empty string → empty (no "Optional" placeholders anywhere).
 * Save on blur/Enter (single-line) or Cmd+Enter / blur (multiline); Escape cancels.
 */
export default function InlineField({
  value,
  onSave,
  multiline = false,
  className = '',
  ariaLabel,
}: {
  value: string | null;
  onSave: (v: string | null) => Promise<void> | void;
  multiline?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const baseline = useRef(value ?? '');

  useEffect(() => {
    baseline.current = value ?? '';
    setDraft(value ?? '');
  }, [value]);

  const commit = async () => {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : trimmed;
    const prev = baseline.current === '' ? null : baseline.current;
    if (next === prev) return;
    setSaving(true);
    try {
      await onSave(next);
      baseline.current = next ?? '';
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(baseline.current);
    (ref.current as HTMLElement | null)?.blur();
  };

  const common = {
    ref: ref as React.RefObject<HTMLInputElement & HTMLTextAreaElement>,
    className: `inline-field ${className}`,
    value: draft,
    'aria-label': ariaLabel,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        (ref.current as HTMLElement | null)?.blur();
      }
    },
  };

  return (
    <span className={`relative block ${saving ? 'opacity-60' : ''}`}>
      {multiline ? (
        <textarea rows={1} {...(common as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input type="text" {...(common as React.InputHTMLAttributes<HTMLInputElement>)} />
      )}
    </span>
  );
}
