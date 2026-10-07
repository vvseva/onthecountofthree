# onthecountofthree

A zero-backend, client-side video synchronization web application built with TypeScript and Vite. It allows two users (e.g., across Sweden and Russia) to synchronize playback of identical local video files over censorship-resistant, decentralized channels without sending video files or identifiable metadata over the wire.

---

## 1. Architectural Guardrails & Security Model

- **Zero Server Backend:** Pure static client-side bundle. No Node/Python servers, databases, or cookies.
- **Data Minimization:** Never transmits file names, paths, full file sizes, or user IPs. Nostr relays only receive an opaque 64-character SHA-256 hash of the Room ID (`#d` tag).
- **Censorship-Resilient Transport:** Decentralized Nostr relays connected simultaneously via secure WebSockets (WSS on port 443):
  - `wss://relay.damus.io`
  - `wss://nos.lol`
  - `wss://relay.primal.net`
  - Plus local `BroadcastChannel` companion for zero-delay local multi-tab testing.
- **End-to-End Encryption (E2EE):** All sync and chat packets are encrypted client-side using Web Crypto **AES-GCM-256** with fresh 12-byte initialization vectors (IVs) prepended to each message.
- **Key Storage in URL Hash Fragment:** Keys reside solely in `https://<domain>/#room=<roomId>&key=<base64Key>`. Hash fragments are never sent over HTTP network requests.
- **Utilitarian / System 7 Aesthetic:** High-contrast borders, button bevels (`outset`/`inset`), neutral palettes, monospace status readouts, and zero layout shift.

---

## 2. Core Modules & UX Features

### Module A: Local Video Ingestion & Fuzzy Fingerprinting (`src/fingerprint/`)
- Ingest local video files using `<input type="file">` and drag-and-drop onto the window via `URL.createObjectURL(file)`.
- Generates an 8-character verification code (`XXXX-XXXX`) without hashing gigabytes of data:
  1. Reads the first 4 MB.
  2. Reads the final 1 MB.
  3. Records `HTMLMediaElement.duration`.
  4. Computes SHA-256 over this combined buffer using `crypto.subtle.digest('SHA-256', ...)`.
  5. Truncates to 8 characters (e.g. `AD42-4362`).
- Prominently displays the match status: `[VERIFIED]`, `[MISMATCH]`, or `[WAITING FOR PEER]`.
- Built-in **"Generate Test Pattern (60s)"** generator (SMPTE color bars + timecode + audio pulse) for instant testing without needing external video files.

### Module B: End-to-End Encryption & Key Exchange (`src/crypto/`)
- Room creation generates an exportable 256-bit AES-GCM key and a random 16-byte Room ID.
- Wire buffer: `[12-byte IV][Ciphertext + 16-byte GCM Tag]`.

### Module C: Nostr Ephemeral Transport & Local Channel (`src/network/`)
- Connects concurrently to 3 public Nostr relays over WSS (port 443).
- Local `BroadcastChannel` transport companion for instant localhost testing.
- In-memory throwaway Nostr keypair (`nsec`/`npub`) generated for each session.
- Publishes and subscribes to Nostr Ephemeral Events (NIP-01, Kind `20033`).
- Automatic multi-relay deduplication based on event IDs and sequence numbers.

### Module D: Synchronization & "On The Count Of Three" Countdown Engine (`src/sync/`)
- **"On The Count Of Three" Countdown:** Pressing Play triggers a synchronized 3-second countdown (`COUNTDOWN_START`) with a target wall-clock time $T_{\text{target}} = Date.now() + 3000\text{ms}$. Both video players start simultaneously at the exact millisecond mark!
- **Instant Play Option:** Toggle checkbox in player bar allows skipping countdown for instant playback if preferred.
- **Pause Notifications:** Shows a clear banner overlay: `[ ⏸ Paused by Peer A4F9 at 01:23:45 ]`.
- **Soft/Hard Drift Correction:**
  - `|Drift| < 100ms`: Do nothing (human perceptual threshold).
  - `100ms <= |Drift| <= 1200ms`: Nudge playback rate between `0.97x` and `1.03x` softly without audio pitch jumps.
  - `|Drift| > 1200ms`: Hard seek to the target timestamp and sync play/pause state.
- **Manual offset slider (`-2.0s` to `+2.0s`)**: For files with different intro bumpers or subtitle sync offsets.

### Module E: Accessible Utilitarian Interface & Chat (`src/ui/`)
- **De-cluttered Layout:** System diagnostics are collapsed and hidden by default, accessible on demand via the `[📊 Diag]` button.
- **Peer Join Pop-Up:** Transient retro window toast appears when a peer joins or leaves (auto-dismisses after 4 seconds).
- **Encrypted Side-Chat Window:** Minimizable/collapsible retro side window with AES-GCM E2EE, quick emoji reaction buttons (`🍿`, `😂`, `🔥`, `👏`), and unread message counter badge.
- **Subtitles & Multi-Audio:** Drag-and-drop or load `.srt` / `.vtt` subtitle files, client-side WebVTT converter, subtitle timing offset slider (`-5.0s` to `+5.0s`), and audio track switcher.
- **Keyboard navigation:**
  - `Space`: Play / Pause (triggers 3s countdown or abort)
  - `Left / Right Arrows`: ±5s Seek
  - `Up / Down Arrows`: Volume ±5%
  - `F`: Fullscreen
  - `M`: Mute / Unmute
- `aria-live="polite"` dynamic screen reader announcements.

---

## 3. Running & Testing Locally

```bash
# Install dependencies
npm install

# Start Vite dev server
npm run dev

# Run unit tests
npm test

# Build production bundle
npm run build
```
