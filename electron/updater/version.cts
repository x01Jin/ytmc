export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

const VERSION_PATTERN = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;

export function parseVersion(input: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) return false;
  return compareVersions(next, now) > 0;
}
