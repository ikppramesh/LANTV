# LanTv

Turn your local movie/TV libraries into always-on, randomly shuffled **TV channels** that
any device on your LAN can watch by opening a link — no seeking, no "pick an episode," just
tune in and it's already playing something, like a real TV.

Point it at a handful of folders (say, `GOT`, `LOTR`, a "New releases" dump, and a big mixed
`IRMAX` library), and each one becomes its own channel with its own shuffled, infinite
playlist. Switch channels from a bar in the browser, a bookmarked link per device, or VLC's
own playlist view.

## Features

- **Multiple independent channels**, each backed by one or more folders you configure —
  no need to reorganize your media, just point at the folders you already have.
- **Infinite shuffle loop.** Each channel scans its folders recursively, shuffles everything
  into a queue, and reshuffles + rescans (picking up newly added files) whenever the queue
  empties — so it never "ends."
- **On-demand transcoding.** A channel only starts transcoding when someone actually opens
  it, and stops again after a configurable idle timeout with nobody watching — so you're not
  running four simultaneous encodes 24/7 for one viewer.
- **Real-time HLS output** via `ffmpeg`, using macOS VideoToolbox hardware encoding so even
  4K sources transcode faster than real time.
- **Proper HDR → SDR tonemapping** (not just a naive strip of HDR metadata) for HDR10/Dolby
  Vision sources, using `ffmpeg-full`'s `zscale`/`zimg` support.
- **Works in the browser** (built-in fullscreen player with a channel switcher, now-playing
  overlay, and a skip button) **and in VLC / any HLS-capable player** — either per-channel
  URLs or one combined `.m3u` playlist listing every channel.
- **Resilient by design:** corrupt/unreadable files are auto-skipped, disconnected network
  volumes are retried automatically without a restart, and the whole service can be set up
  to auto-start on login and auto-restart if it ever crashes.
- **A link that doesn't change.** Uses the machine's Bonjour/mDNS hostname (`<name>.local`)
  so the URL you bookmark keeps working across Wi-Fi switches, router reboots, and new DHCP
  leases — not just the current LAN IP.

## How it works

```
                        ┌─────────────────────────────────────────┐
                        │              config.json                 │
                        │  channels: [{ id, name, libraries[] }]   │
                        └───────────────────┬───────────────────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
              Channel "got"           Channel "lotr"          Channel "irmax"
           scan → shuffle queue    scan → shuffle queue    scan → shuffle queue
                    │                       │                       │
          (lazy-started on first request, paused after idleStopSeconds with no viewers)
                    │                       │                       │
                    ▼                       ▼                       ▼
              ffmpeg (per file, one at a time, hardware-encoded, HDR-tonemapped if needed)
                    │                       │                       │
                    ▼                       ▼                       ▼
        /hls/got/stream.m3u8      /hls/lotr/stream.m3u8     /hls/irmax/stream.m3u8
                    │                       │                       │
                    └──────────────┬────────┴──────────────┬────────┘
                                   ▼                        ▼
                         Browser player (/)          VLC / any HLS client
                       channel bar, skip button      direct URL, or channels.m3u
```

Each channel is an independent state machine (`src/channel.js`):

1. **Scan** — recursively walk the channel's configured folders (`src/scanner.js`), filtering
   by file extension and skipping excluded directory names (recycle bins, etc.).
2. **Shuffle** — Fisher-Yates shuffle the resulting file list into a queue.
3. **Play** — pop one file off the queue, detect if it's HDR (`ffprobe`), spawn `ffmpeg` to
   transcode it in real time into the channel's shared HLS output (`hls/<id>/stream.m3u8`),
   using `-hls_flags append_list` so segments accumulate into one continuous live stream
   across files rather than starting a new stream per file.
4. **Advance** — when `ffmpeg` exits (file ended, or it was skipped), immediately start the
   next file. When the queue empties, rescan + reshuffle and keep going. Forever.
5. **Idle-pause** — a background timer (`src/server.js`) stops a channel's `ffmpeg` process if
   nobody has requested its stream in `idleStopSeconds`; the next request lazily restarts it.

## Requirements

- macOS (uses `caffeinate` to prevent sleep and VideoToolbox for hardware encoding — the
  transcoding approach is macOS-specific; the rest is portable Node.js).
- [Homebrew](https://brew.sh)
- Node.js
- `ffmpeg-full` (Homebrew, **not** the regular `ffmpeg` formula) for HDR tonemapping support:

  ```bash
  brew install ffmpeg-full
  ```

  This installs keg-only alongside a regular `ffmpeg` if you already have one — no conflict.
  If `ffmpeg-full` isn't present, LanTv still works but falls back to plain `ffmpeg` without
  HDR tonemapping (HDR sources will look washed out).

## Setup

```bash
git clone https://github.com/ikppramesh/LANTV.git
cd LANTV
npm install
```

Edit `config.json` to point at your own folders (see [Configuration](#configuration) below),
then:

```bash
npm start
```

The console prints two sets of links:

```
Stable link (survives WiFi/IP changes, use this one):
  -> http://<your-mac-name>.local:8000/?ch=got  (GOT TV)
  -> http://<your-mac-name>.local:8000/?ch=lotr  (LOTR TV)
  -> http://<your-mac-name>.local:8000/?ch=new  (New TV)
  -> http://<your-mac-name>.local:8000/?ch=irmax  (IRMAX TV)
  -> http://<your-mac-name>.local:8000/channels.m3u  (VLC playlist, all channels)

Current IP-based links (change if the Mac gets a new IP):
  -> http://192.168.x.x:8000/?ch=got  (GOT TV)
  ...
```

**Use the `.local` links.** They use the Mac's Bonjour/mDNS hostname, which stays the same no
matter what IP the Mac is assigned on whatever Wi-Fi it's on — so a bookmark on a phone or a
saved channel on a smart TV keeps working across router reboots, network switches, or a new
DHCP lease. The plain-IP links are a fallback for clients that don't support mDNS.

Open any of those links from a phone/tablet/smart TV browser/laptop on the same network, or
open the base link and use the channel bar at the top to switch between channels. Tap once
to enable sound — browsers block autoplay-with-sound until a user gesture.

## Watching in VLC (or any HLS player)

- **One channel:** *Media → Open Network Stream* → paste
  `http://<host>:8000/hls/<channelId>/stream.m3u8` (e.g. `.../hls/got/stream.m3u8`).
- **All channels at once:** open `http://<host>:8000/channels.m3u` — VLC loads it as a
  playlist with every configured channel listed by name, so you can flip between them from
  VLC's own playlist/sidebar instead of typing URLs.

If a channel is cold (nobody's watched it recently, so it's paused), the very first request
to its playlist is held server-side for a few seconds until the first HLS segment actually
exists, rather than returning a 404 that VLC won't retry on its own.

## Configuration

Everything lives in `config.json`:

```json
{
  "channels": [
    { "id": "got", "name": "GOT TV", "libraries": ["/Volumes/IR_Movies/GOT"] }
  ],
  "extensions": [".mkv", ".mp4", ".m4v", ".avi", ".mov", ".ts", ".wmv"],
  "excludeDirNames": ["$RECYCLE.BIN", "System Volume Information", "@eaDir"],
  "port": 8000,
  "idleStopSeconds": 90,
  "video": {
    "maxWidth": 1920,
    "videoBitrate": "6000k",
    "audioBitrate": "192k",
    "hlsSegmentSeconds": 6,
    "hlsListSize": 8
  }
}
```

| Field | Meaning |
|---|---|
| `channels[].id` | Used in the URL (`?ch=<id>`) and the HLS path (`/hls/<id>/...`). Keep it short, no spaces. |
| `channels[].name` | Shown in the browser's channel bar and in the VLC playlist. |
| `channels[].libraries` | One or more folders this channel draws from. Scanned recursively, so subfolders are included automatically. Add multiple entries to combine several folders into one channel. |
| `extensions` | File extensions treated as playable video. |
| `excludeDirNames` | Directory names skipped anywhere in the scanned tree (recycle bins, hidden system folders, etc.). |
| `port` | HTTP port the server listens on. |
| `idleStopSeconds` | How long a channel keeps transcoding with no viewers before it pauses to save CPU/GPU. Next viewer request restarts it. |
| `video.maxWidth` | Caps output width (1920 = 1080p) so real-time transcoding stays smooth even for 4K sources. |
| `video.videoBitrate` / `audioBitrate` | Output quality vs. bandwidth tradeoff. |
| `video.hlsSegmentSeconds` / `hlsListSize` | HLS segment length and how many segments stay in the live window before older ones are deleted. |

Restart the server after editing `config.json`. To add a new channel, just add another entry
to `channels` — e.g. splitting a large library into `IRMAX 4K TV` and `IRMAX 1080P TV` by
pointing two channels at different subfolders.

## Running it 24/7 (auto-start + auto-restart)

A LaunchAgent template (`com.lantv.channel.plist`) is included so macOS keeps LanTv running
permanently instead of only while a terminal window is open:

```bash
# edit the paths inside the plist first if you cloned to a different location / user
cp com.lantv.channel.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.lantv.channel.plist
```

This gives you:

- **Auto-start on login** (`RunAtLoad`) — survives a full system restart.
- **Auto-restart on crash** (`KeepAlive`) — if the process ever dies, launchd brings it back
  within seconds.
- The server binds to all network interfaces, so a Wi-Fi reconnect or a new DHCP-assigned IP
  doesn't require restarting anything — it just keeps listening.
- The Mac is kept from sleeping (`caffeinate`, spawned by the server itself) so an idle
  machine doesn't drop the stream.

Combined with the `.local` link, this means: reboot, switch Wi-Fi networks, let the machine
sleep and wake, or have the process crash — LanTv comes back on its own and the link you
bookmarked keeps working.

Useful commands:

```bash
launchctl unload ~/Library/LaunchAgents/com.lantv.channel.plist   # stop
launchctl load ~/Library/LaunchAgents/com.lantv.channel.plist     # start
launchctl list | grep lantv                                       # check it's running
```

Logs go to `lantv.log` in the project folder.

## Project layout

```
LANTV/
├── config.json               # channels, folders, encoding settings
├── com.lantv.channel.plist   # optional macOS LaunchAgent for 24/7 operation
├── src/
│   ├── server.js             # Express app: routes, per-channel HLS serving, idle-pause loop
│   ├── channel.js            # per-channel state machine: queue, ffmpeg lifecycle, HDR detection
│   └── scanner.js            # recursive folder walk + filename cleanup for display titles
└── public/
    └── index.html            # fullscreen HLS player, channel bar, now-playing overlay
```

## Notes & troubleshooting

- **HDR looks washed out:** make sure `ffmpeg-full` is installed (`brew install ffmpeg-full`).
  LanTv auto-detects it at `/opt/homebrew/opt/ffmpeg-full/bin` and falls back to plain
  `ffmpeg` (no tonemapping) if it's not there.
  - `channels.m3u` uses `application/vnd.apple.mpegurl` and pulls its own hostname from the
  requesting device, so the same link works whether you access it via `.local` or by IP.
- A corrupt or unreadable file is retried once; after 2 failures it's permanently skipped for
  that run (rescans will try it again from scratch).
- If a network/FTP-mounted volume disconnects, the affected channel keeps retrying every 10s
  and resumes automatically once the volume is back — no restart needed.
- Multiple people can watch different channels at the same time; each is transcoded
  independently. Watching more channels at once uses proportionally more CPU/GPU for
  encoding — `idleStopSeconds` keeps unwatched channels from running for nothing.
