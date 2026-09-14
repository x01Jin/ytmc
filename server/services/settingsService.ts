import fs from 'fs';
import path from 'path';
import { DATA_DIR, DOWNLOADS_DIR } from '../config.js';

export interface AppSettings {
  downloadsDir: string;
  filenameTemplate: string;
  revealAfterConvert: boolean;
}

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS: AppSettings = {
  downloadsDir: process.env.APP_DOWNLOADS_DIR || DOWNLOADS_DIR,
  filenameTemplate: '{artist} - {title}.{ext}',
  revealAfterConvert: false,
};

const SEGMENT_ILLEGAL = /[<>:"|?*\x00-\x1F]/;
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function validateDownloadsDir(dir: string): string | null {
  if (!dir || !dir.trim()) return 'Library folder path is required.';
  const normalized = path.normalize(dir.trim());
  if (!path.isAbsolute(normalized)) return 'Library folder must be an absolute path.';
  const segments = normalized.split(path.sep).filter(Boolean);
  const startIndex = /^[a-zA-Z]:$/.test(segments[0] ?? '') ? 1 : 0;
  for (const seg of segments.slice(startIndex)) {
    if (SEGMENT_ILLEGAL.test(seg)) return `Folder name "${seg}" contains a character Windows forbids: < > : " | ? *`;
    if (/[. ]$/.test(seg)) return `Folder name "${seg}" cannot end with a dot or space.`;
    if (RESERVED.has(seg.toUpperCase().split('.')[0])) return `Folder name "${seg}" is reserved by Windows.`;
  }
  if (normalized.length >= 260) return 'Path is at or beyond the 260 character Windows limit. Choose a shorter folder.';
  return null;
}

function readStored(): Partial<AppSettings> {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.part`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export class SettingsService {
  public static getSettings(): AppSettings {
    return { ...DEFAULTS, ...readStored() };
  }

  public static updateSettings(patch: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const next: AppSettings = {
      downloadsDir: (patch.downloadsDir ?? current.downloadsDir).trim(),
      filenameTemplate: (patch.filenameTemplate ?? current.filenameTemplate).trim() || DEFAULTS.filenameTemplate,
      revealAfterConvert: patch.revealAfterConvert ?? current.revealAfterConvert,
    };
    const error = validateDownloadsDir(next.downloadsDir);
    if (error) throw new Error(error);
    fs.mkdirSync(next.downloadsDir, { recursive: true });
    const probe = path.join(next.downloadsDir, '.writetest');
    try {
      fs.writeFileSync(probe, 'ok', 'utf8');
      fs.unlinkSync(probe);
    } catch {
      throw new Error('Folder is not writable. Pick a folder you can write to.');
    }
    atomicWriteJson(SETTINGS_FILE, next);
    return next;
  }

  public static resetSettings(): AppSettings {
    atomicWriteJson(SETTINGS_FILE, DEFAULTS);
    fs.mkdirSync(DEFAULTS.downloadsDir, { recursive: true });
    return { ...DEFAULTS };
  }
}
