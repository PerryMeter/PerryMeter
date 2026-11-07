export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--';
  }
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(seconds: number, decimals = 1): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--';
  }
  return `${seconds.toFixed(decimals)} s`;
}

export function formatWholeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--';
  }
  return `${Math.round(seconds)} s`;
}

export function formatDurationAgo(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--';
  }
  if (seconds < 1) {
    return `${seconds.toFixed(1)} s ago`;
  }
  return `${Math.round(seconds)} s ago`;
}

export function formatClock(dateOrMs: Date | number): string {
  const date = typeof dateOrMs === 'number' ? new Date(dateOrMs) : dateOrMs;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function formatMessageRate(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) {
    return '0.0 msg/s';
  }
  return `${rate.toFixed(1)} msg/s`;
}
