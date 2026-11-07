import type { Mode } from '../lib/settings';

type ModeSwitchProps = {
  mode: Mode;
  onChange: (mode: Mode) => void;
};

export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-[6px] border border-line bg-surface">
      <button
        type="button"
        aria-pressed={mode === 'demo'}
        onClick={() => onChange('demo')}
        className={`px-3 py-1 rounded-[4px] text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-accent ${
          mode === 'demo'
            ? 'bg-surface-2 text-text'
            : 'text-muted hover:text-text'
        }`}
      >
        Demo
      </button>
      <button
        type="button"
        aria-pressed={mode === 'live'}
        onClick={() => onChange('live')}
        className={`px-3 py-1 rounded-[4px] text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-accent ${
          mode === 'live'
            ? 'bg-surface-2 text-text'
            : 'text-muted hover:text-text'
        }`}
      >
        Live
      </button>
    </div>
  );
}
