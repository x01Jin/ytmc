/** Parse `MM:SS`, `HH:MM:SS`, or raw seconds into seconds. Returns null when invalid. */
export function parseTimeToSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const parts = trimmed.split(":").map((p) => p.trim());
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((p) => !/^\d+(\.\d+)?$/.test(p))
  )
    return null;
  const nums = parts.map(Number);
  const secs = nums[nums.length - 1];
  const mins = nums[nums.length - 2];
  const hours = nums.length === 3 ? nums[0] : 0;
  if (mins >= 60 || secs >= 60) return null;
  return hours * 3600 + mins * 60 + secs;
}

/** Format seconds as `M:SS`. */
export function formatSeconds(total: number): string {
  if (!Number.isFinite(total) || total < 0) return "0:00";
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}
