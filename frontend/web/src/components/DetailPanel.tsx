import { useEffect } from 'react';
import type { DetailContent } from '../lib/details';

type DetailPanelProps = {
  content: DetailContent | null;
  onClose: () => void;
  /** Opens the Settings panel at the given section. */
  onOpenSettings?: (section: 'sensitivity' | 'hub') => void;
  compact?: boolean;
};

/** A small card with the live numbers behind whatever was clicked, and one plain sentence. */
export function DetailPanel({ content, onClose, onOpenSettings, compact = false }: DetailPanelProps) {
  useEffect(() => {
    if (!content) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [content, onClose]);

  if (!content) return null;

  return (
    <div
      role="dialog"
      aria-label={content.title}
      className={`fixed z-40 flex flex-col rounded-[10px] border border-line-strong bg-surface text-text ${
        compact ? 'left-3 bottom-3 w-[min(420px,calc(100vw-24px))]' : 'right-4 bottom-4 w-[min(380px,calc(100vw-32px))]'
      }`}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-line">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{content.title}</div>
          {content.subtitle && <div className="text-[11px] text-muted truncate">{content.subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 px-2 py-0.5 rounded-[6px] border border-line-strong bg-surface text-text text-xs hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text"
        >
          Close
        </button>
      </div>
      <div className="px-4 py-3 space-y-2.5">
        {content.rows.length > 0 && (
          <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums ${compact ? 'max-h-[120px] overflow-y-auto' : ''}`}>
            {content.rows.map(([label, value], i) => (
              <div key={`${label}-${i}`} className="contents">
                <dt className="text-faint">{label}</dt>
                <dd className="text-text text-right break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-xs text-muted leading-relaxed">{content.sentence}</p>
        {content.settingsSection && onOpenSettings && (
          <button
            type="button"
            onClick={() => onOpenSettings(content.settingsSection as 'sensitivity' | 'hub')}
            className="text-xs text-text underline underline-offset-2 hover:text-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-text"
          >
            {content.settingsSection === 'sensitivity' ? 'Adjust sensitivity in Settings' : 'Hub settings'}
          </button>
        )}
      </div>
    </div>
  );
}
