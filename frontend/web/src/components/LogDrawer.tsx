import { useEffect } from 'react';
import type { DetectionEvent } from '../hooks/useDetectionStream';
import { EventList } from './EventList';

type LogDrawerProps = {
  open: boolean;
  onClose: () => void;
  events: DetectionEvent[];
};

/** The entry log, in a drawer that slides in from the right. */
export function LogDrawer({ open, onClose, events }: LogDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden="true" />}
      <aside
        aria-label="Log"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-y-0 right-0 z-40 w-[min(380px,100vw)] flex flex-col bg-surface border-l border-line-strong transition-transform duration-200 motion-reduce:transition-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <span className="text-[13px] font-medium text-text">Log</span>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-[6px] border border-line-strong bg-surface text-text text-xs hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-text"
          >
            Close
          </button>
        </div>
        <EventList events={events} bare className="flex-1 min-h-0 px-4 py-3" />
        <p className="px-4 py-3 border-t border-line text-[11px] text-faint shrink-0">
          Entries into the zone since this page opened, newest first. The last 8 are kept.
        </p>
      </aside>
    </>
  );
}
