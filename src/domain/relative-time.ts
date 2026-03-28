export function formatRelativeTimestamp(now: Date, isoString: string): string {
  const targetMs = Date.parse(isoString);
  if (!Number.isFinite(targetMs)) {
    return isoString;
  }

  const diffMs = now.getTime() - targetMs;
  if (Math.abs(diffMs) < 5_000) {
    return "just now";
  }

  const future = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const minutes = Math.floor(absMs / 60_000);
  const hours = Math.floor(absMs / 3_600_000);
  const days = Math.floor(absMs / 86_400_000);

  if (minutes < 1) {
    const seconds = Math.max(1, Math.floor(absMs / 1_000));
    return formatRelativeUnit(seconds, "s", future);
  }

  if (hours < 1) {
    return formatRelativeUnit(minutes, "m", future);
  }

  if (days < 1) {
    return formatRelativeUnit(hours, "h", future);
  }

  if (days < 30) {
    return formatRelativeUnit(days, "d", future);
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return formatRelativeUnit(months, "mo", future);
  }

  const years = Math.floor(days / 365);
  return formatRelativeUnit(years, "y", future);
}

function formatRelativeUnit(value: number, unit: string, future: boolean): string {
  if (future) {
    return `in ${value}${unit}`;
  }
  return `${value}${unit} ago`;
}
