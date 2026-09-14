import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { COOKIES_FILE, DATA_DIR, GUEST_COOKIES_FILE, PLUGINS_DIR, YTDLP_PATH } from '../config.js';

export interface CookieStatus {
  configured: boolean;
  isAccountSession: boolean;
  isGuestSession: boolean;
  sizeBytes: number;
  lineCount: number;
  lastModified: string | null;
  sampleDomains: string[];
}

export interface SessionTestResult {
  success: boolean;
  message: string;
  isAccountSession: boolean;
  title?: string;
  duration?: string;
  errorDetails?: string;
}

export class CookieService {
  private static ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  public static hasCookies(): boolean {
    return fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 10;
  }

  public static hasGuestCookies(): boolean {
    return fs.existsSync(GUEST_COOKIES_FILE) && fs.statSync(GUEST_COOKIES_FILE).size > 10;
  }

  public static getCookiesPath(): string | null {
    if (this.hasCookies()) {
      return COOKIES_FILE;
    }
    if (this.hasGuestCookies()) {
      return GUEST_COOKIES_FILE;
    }
    return null;
  }

  public static getStatus(): CookieStatus {
    const activePath = this.hasCookies() ? COOKIES_FILE : (this.hasGuestCookies() ? GUEST_COOKIES_FILE : null);

    if (!activePath) {
      return {
        configured: false,
        isAccountSession: false,
        isGuestSession: false,
        sizeBytes: 0,
        lineCount: 0,
        lastModified: null,
        sampleDomains: []
      };
    }

    try {
      const stats = fs.statSync(activePath);
      const content = fs.readFileSync(activePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      
      const isAccount = content.includes('SAPISID') ||
                        content.includes('LOGIN_INFO') ||
                        content.includes('SSID') ||
                        content.includes('__Secure-3PAPISID');

      const isGuest = !isAccount && (content.includes('VISITOR_INFO1_LIVE') || content.includes('YSC'));

      const domains = new Set<string>();
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts[0]) {
          domains.add(parts[0].replace(/^\./, ''));
        }
      }

      return {
        configured: true,
        isAccountSession: isAccount,
        isGuestSession: isGuest,
        sizeBytes: stats.size,
        lineCount: lines.length,
        lastModified: stats.mtime.toISOString(),
        sampleDomains: Array.from(domains).slice(0, 5)
      };
    } catch {
      return {
        configured: false,
        isAccountSession: false,
        isGuestSession: false,
        sizeBytes: 0,
        lineCount: 0,
        lastModified: null,
        sampleDomains: []
      };
    }
  }

  /**
   * Automatically fetches fresh guest session visitor cookies directly from YouTube.
   */
  public static async autoFetchGuestSession(): Promise<{ success: boolean; message: string; count: number }> {
    this.ensureDataDir();

    try {
      const response = await fetch('https://www.youtube.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      const rawCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      if (!rawCookies || rawCookies.length === 0) {
        throw new Error('YouTube did not return any session cookies.');
      }

      const lines: string[] = [
        '# Netscape HTTP Cookie File',
        '# https://curl.se/docs/http-cookies.html',
        '# Auto-generated guest session for YouTube to Music Converter',
        ''
      ];

      for (const raw of rawCookies) {
        const parts = raw.split(';').map(p => p.trim());
        const first = parts[0];
        const eqIdx = first.indexOf('=');
        if (eqIdx === -1) continue;

        const name = first.substring(0, eqIdx);
        const value = first.substring(eqIdx + 1);
        if (!value) continue;

        let domain = '.youtube.com';
        let pathStr = '/';
        let secure = 'TRUE';
        let expires = Math.floor(Date.now() / 1000) + 86400 * 180; // 180 days default

        for (let i = 1; i < parts.length; i++) {
          const p = parts[i];
          const lower = p.toLowerCase();
          if (lower.startsWith('domain=')) {
            domain = p.substring(7);
            if (!domain.startsWith('.')) domain = '.' + domain;
          } else if (lower.startsWith('path=')) {
            pathStr = p.substring(5);
          } else if (lower.startsWith('expires=')) {
            const parsedDate = Date.parse(p.substring(8));
            if (!isNaN(parsedDate)) {
              expires = Math.floor(parsedDate / 1000);
            }
          }
        }

        const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
        lines.push(`${domain}\t${flag}\t${pathStr}\t${secure}\t${expires}\t${name}\t${value}`);
      }

      const content = lines.join('\n');
      fs.writeFileSync(GUEST_COOKIES_FILE, content, 'utf-8');

      // If user has no personal cookies yet, also write to COOKIES_FILE so yt-dlp uses it by default
      if (!this.hasCookies()) {
        fs.writeFileSync(COOKIES_FILE, content, 'utf-8');
      }

      const status = this.getStatus();
      return {
        success: true,
        message: `Successfully provisioned fresh YouTube guest session (${status.lineCount} cookies)!`,
        count: status.lineCount
      };
    } catch (err: any) {
      throw new Error(`Auto-fetch guest cookies failed: ${err.message || err}`);
    }
  }

  /**
   * Tests whether the current session cookies work against YouTube.
   */
  public static async testSession(): Promise<SessionTestResult> {
    const cookiesPath = this.getCookiesPath();
    const status = this.getStatus();

    const args = [
      '--js-runtimes', `node:${process.execPath}`,
      '--simulate',
      '--dump-json',
      '--no-playlist',
      '--no-warnings'
    ];

    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }

    // Use a standard public video to test extraction
    args.push('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    return new Promise((resolve) => {
      execFile(
        YTDLP_PATH,
        args,
        {
          timeout: 15000,
          env: {
            ...process.env,
            PYTHONPATH: PLUGINS_DIR
          }
        },
        (error, stdout, stderr) => {
          if (error) {
            const isBot = stderr.includes("Sign in to confirm you're not a bot") ||
                          stderr.includes('bot') ||
                          stderr.includes('LOGIN_REQUIRED');
            
            resolve({
              success: false,
              isAccountSession: status.isAccountSession,
              message: isBot
                ? 'YouTube session test failed: Bot protection active. Please export fresh user cookies or click Auto-Fetch Guest Session.'
                : 'YouTube session test failed to reach video streams.',
              errorDetails: stderr.split('\n').filter(l => l.includes('ERROR:'))[0] || stderr.slice(0, 300)
            });
            return;
          }

          try {
            const data = JSON.parse(stdout.trim());
            resolve({
              success: true,
              isAccountSession: status.isAccountSession,
              title: data.title,
              duration: data.duration_string,
              message: status.isAccountSession
                ? 'Verified! Your authenticated YouTube account session is working.'
                : 'Verified! YouTube connection and JavaScript challenge solver are active.'
            });
          } catch {
            resolve({
              success: true,
              isAccountSession: status.isAccountSession,
              message: 'Verified! YouTube responded successfully.'
            });
          }
        }
      );
    });
  }

  public static saveCookies(rawText: string): { success: boolean; message: string; count: number } {
    this.ensureDataDir();
    if (!rawText || !rawText.trim()) {
      throw new Error('Cookie content cannot be empty');
    }

    const trimmed = rawText.trim();
    let netscapeFormat = '';

    // Check if user pasted JSON format (e.g. from EditThisCookie / Cookie-Editor)
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const jsonList = JSON.parse(trimmed);
        if (Array.isArray(jsonList)) {
          const lines: string[] = [
            '# Netscape HTTP Cookie File',
            '# Generated by YouTube to Music Converter',
            '# https://curl.haxx.se/rfc/cookie_spec.html',
            ''
          ];
          for (const item of jsonList) {
            if (item.domain && item.name && item.value !== undefined) {
              const domain = item.domain.startsWith('.') ? item.domain : `.${item.domain}`;
              const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
              const pathStr = item.path || '/';
              const secure = item.secure ? 'TRUE' : 'FALSE';
              const expiration = item.expirationDate ? Math.floor(item.expirationDate) : Math.floor(Date.now() / 1000) + 86400 * 30;
              lines.push(`${domain}\t${flag}\t${pathStr}\t${secure}\t${expiration}\t${item.name}\t${item.value}`);
            }
          }
          netscapeFormat = lines.join('\n');
        }
      } catch {
        // Fallback to treat as plain text if JSON parsing fails
      }
    }

    if (!netscapeFormat) {
      // Treat as Netscape format directly
      const lines = trimmed.split('\n');
      const validLines = lines.filter(l => l.includes('\t') || l.startsWith('#'));
      if (validLines.length === 0) {
        throw new Error('Invalid cookie format. Please paste cookies in Netscape format or JSON format.');
      }
      netscapeFormat = trimmed;
    }

    fs.writeFileSync(COOKIES_FILE, netscapeFormat, 'utf-8');

    const status = this.getStatus();
    return {
      success: true,
      message: `Successfully saved ${status.lineCount} cookies! ${status.isAccountSession ? '(Account Session detected)' : '(Session cookies loaded)'}`,
      count: status.lineCount
    };
  }

  public static clearCookies(): { success: boolean } {
    if (fs.existsSync(COOKIES_FILE)) {
      try {
        fs.unlinkSync(COOKIES_FILE);
      } catch {
        // Ignore deletion error
      }
    }
    if (fs.existsSync(GUEST_COOKIES_FILE)) {
      try {
        fs.unlinkSync(GUEST_COOKIES_FILE);
      } catch {
        // Ignore deletion error
      }
    }
    return { success: true };
  }
}
