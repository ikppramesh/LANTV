const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { scanLibraries, cleanTitle } = require("./scanner");

const BASE_HLS_DIR = path.join(__dirname, "..", "hls");

// ffmpeg-full (brew) has zimg/zscale for proper HDR->SDR tonemapping;
// the plain "ffmpeg" formula does not.
const FFMPEG_FULL_BIN = "/opt/homebrew/opt/ffmpeg-full/bin";
const FFMPEG = fs.existsSync(`${FFMPEG_FULL_BIN}/ffmpeg`) ? `${FFMPEG_FULL_BIN}/ffmpeg` : "ffmpeg";
const FFPROBE = fs.existsSync(`${FFMPEG_FULL_BIN}/ffprobe`) ? `${FFMPEG_FULL_BIN}/ffprobe` : "ffprobe";
const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

function isHdrSource(file) {
  const result = spawnSync(FFPROBE, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=color_transfer",
    "-of", "csv=p=0",
    file,
  ]);
  if (result.status !== 0) return false;
  const transfer = result.stdout.toString().trim().split(",")[0];
  return HDR_TRANSFERS.has(transfer);
}

function buildVideoFilter(maxWidth, hdr) {
  const scale = `scale='min(${maxWidth},iw)':-2:flags=lanczos`;
  if (!hdr) return scale;
  return (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709," +
    "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p," +
    scale
  );
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Channel {
  constructor(id, name, libraries, sharedConfig) {
    this.id = id;
    this.name = name;
    this.libraries = libraries;
    this.config = sharedConfig;
    this.hlsDir = path.join(BASE_HLS_DIR, id);
    this.playlist = path.join(this.hlsDir, "stream.m3u8");

    this.queue = [];
    this.failCounts = new Map();
    this.current = null; // { file, title, startedAt }
    this.proc = null;
    this.stopped = false;
    this.running = false;
    this.lastTouch = 0;
  }

  resetHlsDir() {
    fs.rmSync(this.hlsDir, { recursive: true, force: true });
    fs.mkdirSync(this.hlsDir, { recursive: true });
  }

  refillQueue() {
    const { extensions, excludeDirNames } = this.config;
    const files = scanLibraries(this.libraries, extensions, excludeDirNames);
    if (files.length === 0) {
      console.warn(`[${this.id}] no video files found in configured libraries`);
      return;
    }
    this.queue = shuffle(files);
    console.log(`[${this.id}] queue refilled with ${this.queue.length} titles`);
  }

  nextFile() {
    if (this.queue.length === 0) this.refillQueue();
    return this.queue.shift();
  }

  // Marks the channel as recently requested by a viewer. Lazily starts
  // transcoding if it wasn't already running.
  touch() {
    this.lastTouch = Date.now();
    if (!this.running && !this.stopped) this.start();
  }

  idleFor() {
    return Date.now() - this.lastTouch;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.resetHlsDir();
    console.log(`[${this.id}] starting channel`);
    this.playNext();
  }

  // Stops transcoding (e.g. after no viewers for a while) but keeps the
  // shuffled queue position so it resumes into fresh content next time.
  pause() {
    if (!this.running) return;
    console.log(`[${this.id}] no viewers, pausing channel`);
    this.stopped = true;
    this.running = false;
    if (this.proc) this.proc.kill("SIGKILL");
    this.current = null;
  }

  stop() {
    this.stopped = true;
    this.running = false;
    if (this.proc) this.proc.kill("SIGKILL");
  }

  skip() {
    if (this.proc) this.proc.kill("SIGKILL");
  }

  playNext(attempt = 0) {
    if (this.stopped) return;
    if (attempt > 25) {
      console.error(`[${this.id}] too many consecutive failures, retrying in 10s`);
      setTimeout(() => this.playNext(0), 10000);
      return;
    }

    const file = this.nextFile();
    if (!file) {
      setTimeout(() => this.playNext(attempt + 1), 5000);
      return;
    }

    const fails = this.failCounts.get(file) || 0;
    if (fails >= 2) {
      // skip chronically broken file, try the next one
      this.playNext(attempt + 1);
      return;
    }

    if (!fs.existsSync(file)) {
      // volume may have been unmounted/renamed mid-scan
      this.playNext(attempt + 1);
      return;
    }

    const { video } = this.config;
    const hdr = isHdrSource(file);
    const args = [
      "-y",
      "-re",
      "-i", file,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-vf", buildVideoFilter(video.maxWidth, hdr),
      "-c:v", "h264_videotoolbox",
      "-b:v", video.videoBitrate,
      "-maxrate", video.videoBitrate,
      "-bufsize", "12000k",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-ac", "2",
      "-b:a", video.audioBitrate,
      "-ar", "48000",
      "-f", "hls",
      "-hls_time", String(video.hlsSegmentSeconds),
      "-hls_list_size", String(video.hlsListSize),
      "-hls_flags", "append_list+delete_segments+omit_endlist",
      this.playlist,
    ];

    console.log(`[${this.id}] now playing${hdr ? " (HDR tonemapped)" : ""}: ${file}`);
    this.current = { file, title: cleanTitle(file), startedAt: Date.now() };

    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    this.proc = proc;
    const startedAt = Date.now();
    let stderrTail = "";

    proc.stderr.on("data", (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    proc.on("exit", (code) => {
      const elapsed = Date.now() - startedAt;
      if (this.stopped) return;

      if (elapsed < 3000 && code !== 0) {
        this.failCounts.set(file, (this.failCounts.get(file) || 0) + 1);
        console.warn(`[${this.id}] failed fast on ${file} (code ${code}):\n${stderrTail}`);
        this.playNext(attempt + 1);
        return;
      }

      // normal end of file (or manual skip) -> advance
      this.playNext(0);
    });

    proc.on("error", (err) => {
      console.error(`[${this.id}] ffmpeg spawn error: ${err.message}`);
      this.failCounts.set(file, (this.failCounts.get(file) || 0) + 1);
      this.playNext(attempt + 1);
    });
  }

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      running: this.running,
      current: this.current
        ? { title: this.current.title, startedAt: this.current.startedAt }
        : null,
      upNext: this.queue.slice(0, 5).map(cleanTitle),
      queueRemaining: this.queue.length,
    };
  }
}

module.exports = { Channel, BASE_HLS_DIR };
