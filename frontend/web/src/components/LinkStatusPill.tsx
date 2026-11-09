import type { LinkStatus } from '../hooks/useDetectionStream';

type LinkStatusPillProps = {
  status: LinkStatus;
  retryInS: number | null;
  lastMessageAt: number | null;
  now: number;
};

/** Connection state as a dot and short text. Neutral colours: connection problems are not alerts. */
export function LinkStatusPill({ status, retryInS, lastMessageAt, now }: LinkStatusPillProps) {
  let dot = 'bg-accent';
  let text = '';

  switch (status) {
    case 'demo':
      text = 'Demo feed';
      break;
    case 'demo-paused':
      dot = 'bg-warn';
      text = 'Demo feed paused';
      break;
    case 'connecting':
      dot = 'bg-warn';
      text = 'Connecting';
      break;
    case 'waiting':
      dot = 'bg-warn';
      text = 'Waiting for data';
      break;
    case 'live':
      text = 'Connected';
      break;
    case 'stale': {
      dot = 'bg-warn';
      const gapSeconds = lastMessageAt !== null ? Math.round((now - lastMessageAt) / 1000) : 0;
      text = `No data for ${gapSeconds} s`;
      break;
    }
    case 'disconnected':
      dot = 'border border-muted';
      text = retryInS !== null ? `Disconnected, retrying in ${retryInS} s` : 'Disconnected';
      break;
    case 'invalid-url':
      dot = 'border border-muted';
      text = 'Invalid address';
      break;
  }

  return (
    <div className="flex items-center gap-2 font-mono text-xs text-muted">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span>{text}</span>
    </div>
  );
}
