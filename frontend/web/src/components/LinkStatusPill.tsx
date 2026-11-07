import type { LinkStatus } from '../hooks/useDetectionStream';

type LinkStatusPillProps = {
  status: LinkStatus;
  retryInS: number | null;
  lastMessageAt: number | null;
  now: number;
};

export function LinkStatusPill({
  status,
  retryInS,
  lastMessageAt,
  now,
}: LinkStatusPillProps) {
  let dotColor = 'bg-accent';
  let shouldPulse = false;
  let text = '';

  switch (status) {
    case 'demo':
      dotColor = 'bg-accent';
      text = 'Demo feed';
      break;
    case 'demo-paused':
      dotColor = 'bg-warn';
      text = 'Demo feed paused';
      break;
    case 'connecting':
      dotColor = 'bg-warn';
      shouldPulse = true;
      text = 'Connecting';
      break;
    case 'waiting':
      dotColor = 'bg-warn';
      text = 'Waiting for data';
      break;
    case 'live':
      dotColor = 'bg-accent';
      text = 'Connected';
      break;
    case 'stale': {
      dotColor = 'bg-warn';
      const gapSeconds = lastMessageAt !== null ? Math.round((now - lastMessageAt) / 1000) : 0;
      text = `No data for ${gapSeconds} s`;
      break;
    }
    case 'disconnected':
      dotColor = 'bg-error';
      shouldPulse = true;
      text =
        retryInS !== null
          ? `Disconnected, retrying in ${retryInS} s`
          : 'Disconnected';
      break;
    case 'invalid-url':
      dotColor = 'bg-error';
      text = 'Invalid address';
      break;
  }

  return (
    <div className="flex items-center gap-2 font-mono text-xs text-muted">
      <span
        className={`w-2 h-2 rounded-full ${dotColor} ${
          shouldPulse ? 'animate-pulse' : ''
        }`}
      />
      <span>{text}</span>
    </div>
  );
}
