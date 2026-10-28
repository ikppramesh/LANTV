const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { spawn } = require("child_process");
const { Channel } = require("./channel");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"));

const app = express();

const channels = new Map();
for (const c of config.channels) {
  channels.set(c.id, new Channel(c.id, c.name, c.libraries, config));
}

// Keep the Mac awake so channels keep streaming even if idle.
const caffeinate = spawn("caffeinate", ["-dimsu"], { stdio: "ignore" });
process.on("exit", () => caffeinate.kill());

app.disable("x-powered-by");

// Security headers. The CSP allows exactly what the player page loads: its own
// inline script/style, hls.js from jsDelivr, same-origin API/HLS requests, and
// blob: URLs that hls.js uses for MediaSource playback and its worker.
const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "font-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
};
app.use((req, res, next) => {
  res.set(securityHeaders);
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/channels", (req, res) => {
  res.json(config.channels.map((c) => ({ id: c.id, name: c.name })));
});

app.get("/api/status/:id", (req, res) => {
  const channel = channels.get(req.params.id);
  if (!channel) return res.status(404).json({ error: "unknown channel" });
  res.json(channel.getStatus());
});

app.post("/api/skip/:id", (req, res) => {
  const channel = channels.get(req.params.id);
  if (!channel) return res.status(404).json({ error: "unknown channel" });
  channel.skip();
  res.json({ ok: true });
});

// A combined M3U playlist listing every channel's HLS URL, so VLC (or any
// IPTV-style player) can open one link and get all channels in its own
// playlist/channel list, instead of typing each stream URL by hand.
function sendPlaylist(req, res) {
  const base = `${req.protocol}://${req.get("host")}`;
  const lines = ["#EXTM3U"];
  for (const c of config.channels) {
    lines.push(`#EXTINF:-1,${c.name}`);
    lines.push(`${base}/hls/${c.id}/stream.m3u8`);
  }
  res.set("Content-Type", "audio/x-mpegurl");
  res.set("Content-Disposition", 'inline; filename="lantv.m3u"');
  res.send(lines.join("\n") + "\n");
}
app.get("/channels.m3u", sendPlaylist);
app.get("/playlist.m3u", sendPlaylist);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Requesting a channel's HLS files marks it as watched (lazy-starts it if
// it wasn't already running) and serves its segments/playlist. If a viewer
// (e.g. VLC, which won't retry like the in-page player does) hits the
// playlist right as the channel is cold-starting, hold the response until
// the first segment exists instead of handing back a 404.
for (const channel of channels.values()) {
  const prefix = `/hls/${channel.id}`;
  app.use(prefix, async (req, res, next) => {
    channel.touch();
    if (req.path.endsWith(".m3u8")) {
      res.set("Cache-Control", "no-cache");
      const filePath = path.join(channel.hlsDir, path.basename(req.path));
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(filePath) && Date.now() < deadline) {
        await sleep(250);
      }
    }
    next();
  });
  app.use(prefix, express.static(channel.hlsDir));
}

function lanUrls(port) {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}

app.listen(config.port, "0.0.0.0", () => {
  console.log(`LanTv listening on port ${config.port}`);

  const hostname = os.hostname(); // e.g. "Rameshs-MacBook-Pro-2.local", stable via Bonjour/mDNS
  const stableUrl = `http://${hostname}:${config.port}`;
  console.log(`\nStable link (survives WiFi/IP changes, use this one):`);
  for (const c of config.channels) console.log(`  -> ${stableUrl}/?ch=${c.id}  (${c.name})`);
  console.log(`  -> ${stableUrl}/channels.m3u  (VLC playlist, all channels)`);

  console.log(`\nCurrent IP-based links (change if the Mac gets a new IP):`);
  for (const url of lanUrls(config.port)) {
    for (const c of config.channels) console.log(`  -> ${url}/?ch=${c.id}  (${c.name})`);
    console.log(`  -> ${url}/channels.m3u  (VLC playlist, all channels)`);
  }
});

// Stop transcoding channels nobody is currently watching, to avoid
// running every channel's ffmpeg 24/7 for no reason.
setInterval(() => {
  const idleLimitMs = (config.idleStopSeconds || 90) * 1000;
  for (const channel of channels.values()) {
    if (channel.running && channel.idleFor() > idleLimitMs) channel.pause();
  }
}, 15000);

function shutdown() {
  for (const channel of channels.values()) channel.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
