# Session Authentication & Cookie Management

This document describes how YouTube session authentication, visitor cookies, PO tokens, and JavaScript bot challenge solvers are managed to ensure continuous audio extraction.

---

## 1. Authentication Architecture

YouTube protects video audio streams with layered verification mechanisms:
1. **Visitor Sessions & Cookies**: Required to obtain valid player configuration contexts.
2. **JavaScript Player Challenges**: Dynamic cryptographic challenges embedded in YouTube's `player.js` scripts that require a JavaScript runtime to solve.
3. **Proof-of-Origin (PO) Tokens**: Botguard and GVS integrity tokens validating request legitimacy.
4. **Account Authentication (Optional)**: Required only for private or age-restricted (18+) tracks.

The converter addresses these challenges through a unified multi-layer engine:
- **Automatic Guest Session Provisioning**: Fetches fresh visitor cookies directly from YouTube's edge API upon application initialization or user request.
- **Node.js JavaScript Challenge Solver**: Executes player challenges natively using Node.js (`--js-runtimes node`).
- **PO Token Provider Sidecar**: Automatically provides GVS and player PO tokens via the `bgutil-pot` HTTP sidecar service.
- **Account Cookie Storage**: Allows pasting or uploading user account cookies for age-restricted content.

---

## 2. Automatic Session Provisioning

Users do not need to install browser extensions or extract cookies for standard conversion:
1. **Initial Mount**: If no session cookie exists on the server, the application automatically requests fresh guest session tokens from YouTube.
2. **On-Demand Refresh**: Clicking **Auto-Fetch Guest Session** in the Session Settings modal requests new session cookies and reloads the engine.
3. **API Endpoint**: `POST /api/cookies/auto-fetch` triggers the guest cookie provisioning routine.

---

## 3. Live Session Verification

The system provides an integrated connectivity testing tool to verify that the active session and JavaScript solver can access YouTube audio streams:
- **Trigger**: Click **Test Live Connection** in the Session Settings modal or call `POST /api/cookies/test`.
- **Validation**: Executes `yt-dlp` in simulation mode with the Node.js runtime against a reference YouTube stream, using the exact same extraction path as real conversions: PO Token sidecar args when the sidecar is installed and reachable, otherwise the no-POT player-client fallback (`default,web_embedded,android_vr`) with cookies when present.
- **Feedback**: Returns stream availability, track title, duration, session verification status, the strategy exercised (`pot` or `fallback`), whether the sidecar answered its `/ping`, whether cookies were sent, and raw `errorDetails` on failure (also rendered in the modal under Technical details).

---

## 4. PO Token sidecar (optional, for strictly-checked uploads)

YouTube's web clients increasingly require a Proof-of-Origin token for format URLs. The app is sidecar-optional by design (`server/services/potService.ts` is the single choke point):

- **Installed + reachable** (`bin/bgutil-pot` present, `/ping` on `127.0.0.1:4416` answers): extraction runs in `pot` mode — bgutil-http args, **no cookies** (anonymous PO tokens do not validate against cookie sessions server-side).
- **Otherwise**: extraction runs in `fallback` mode — no POT args, cookies sent when present, player clients pinned to `default,web_embedded,android_vr`. This covers embeddable / non-kid-targeted content with zero setup.
- Boot logs which mode is active and warns loudly when the binary is missing. `POST /api/cookies/test` reports the live strategy.

To install the sidecar (pinned, security-checked): use `bgutil-ytdlp-pot-provider` **2.0.0+** (binds to localhost by default; the server already passes `--host 127.0.0.1`), place the server binary at `bin/bgutil-pot`, and restart the app. It ships inside the installer automatically via the existing `bin/` extraResources. Note the upstream release only publishes a plugin zip plus a Docker image — there is no official standalone Windows server exe, so building/obtaining the server binary is currently a manual packaging step (tracked in `web-app-plan.md` §12).

---

## 4. Custom User Account Cookies

For age-restricted (18+) or private content, users can import their personal YouTube account cookies:

### Supported Formats
- **Netscape HTTP Cookie Format**:
  ```
  # Netscape HTTP Cookie File
  .youtube.com	TRUE	/	TRUE	1789325080	VISITOR_INFO1_LIVE	...
  .youtube.com	TRUE	/	TRUE	1789325080	LOGIN_INFO	...
  .youtube.com	TRUE	/	TRUE	1789325080	SAPISID	...
  ```
- **JSON Format**: Exported directly from browser extensions such as *Cookie-Editor* or *EditThisCookie*.

### Exporting Steps
1. Install a cookie exporter extension (e.g., *Cookie-Editor* or *Get cookies.txt locally*).
2. Open and sign in to [YouTube.com](https://youtube.com) in your browser.
3. Open the extension and click **Export** (or **Copy**).
4. In the app, open **Session Settings**, paste the content or drag & drop `cookies.txt`, and click **Save Cookies**.

---

## 5. Storage & Privacy Policies

- **File Path**: User cookies are stored in `data/cookies.txt`, while guest session cookies reside in `data/guest_cookies.txt`.
- **Exclusion**: The `data/` directory is ignored in `.gitignore` to prevent credentials from being stored in version control.
- **Reset**: Clicking **Reset** in Session Settings immediately unlinks and purges all saved cookies from disk (`DELETE /api/cookies`).
