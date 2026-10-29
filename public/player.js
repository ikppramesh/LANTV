  const video = document.getElementById("video");
  const unmuteBtn = document.getElementById("unmute");
  const titleEl = document.getElementById("title");
  const nextEl = document.getElementById("next");
  const channelsEl = document.getElementById("channels");
  const skipBtn = document.getElementById("skip");

  let hls = null;
  let currentChannel = null;
  let allChannels = [];

  unmuteBtn.addEventListener("click", () => {
    video.muted = false;
    unmuteBtn.classList.add("hidden");
  });

  function attach(channelId) {
    if (hls) { hls.destroy(); hls = null; }
    const src = `/hls/${channelId}/stream.m3u8`;

    if (Hls.isSupported()) {
      hls = new Hls({ liveSyncDurationCount: 3 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            setTimeout(() => hls.startLoad(), 2000);
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            setTimeout(() => attach(channelId), 3000);
            break;
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    }
    video.play().catch(() => {});
  }

  function selectChannel(id, opts = {}) {
    currentChannel = id;
    attach(id);
    renderChannelBar();
    titleEl.textContent = "Loading channel...";
    nextEl.textContent = "";
    if (!opts.skipHistory) {
      const url = new URL(window.location);
      url.searchParams.set("ch", id);
      history.replaceState(null, "", url);
    }
  }

  function renderChannelBar() {
    channelsEl.innerHTML = "";
    for (const c of allChannels) {
      const btn = document.createElement("button");
      btn.className = "chbtn" + (c.id === currentChannel ? " active" : "");
      btn.textContent = c.name;
      btn.addEventListener("click", () => selectChannel(c.id));
      channelsEl.appendChild(btn);
    }
  }

  async function pollStatus() {
    if (!currentChannel) return;
    try {
      const res = await fetch(`/api/status/${currentChannel}`);
      const data = await res.json();
      titleEl.textContent = data.current ? "▶ " + data.current.title : "Starting channel...";
      nextEl.textContent = data.upNext && data.upNext.length
        ? "Up next: " + data.upNext.slice(0, 3).join("  •  ")
        : "";
    } catch (e) { /* server not ready yet */ }
  }

  skipBtn.addEventListener("click", () => {
    if (currentChannel) fetch(`/api/skip/${currentChannel}`, { method: "POST" });
  });

  async function init() {
    const res = await fetch("/api/channels");
    allChannels = await res.json();
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("ch");
    const initial = allChannels.find((c) => c.id === requested)
      ? requested
      : (allChannels[0] && allChannels[0].id);
    if (initial) selectChannel(initial, { skipHistory: !!requested && requested === initial });
    pollStatus();
    setInterval(pollStatus, 5000);
  }
  init();
