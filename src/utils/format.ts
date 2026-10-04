export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  if (mb >= 1024) return `${formatted.format(mb / 1024)} GB`;
  return `${formatted.format(mb)} MB`;
}
