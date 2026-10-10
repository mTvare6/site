class AudioComparison {
  constructor(root) {
    this.root = root;
    this.urls = {
      original: root.dataset.original,
      spatial: root.dataset.spatial,
    };
    this.buttons = [...root.querySelectorAll("[data-version]")];
    this.playButton = root.querySelector(".audio-comparison-play");
    this.seek = root.querySelector(".audio-comparison-seek");
    this.time = root.querySelector(".audio-comparison-time");
    this.status = root.querySelector(".audio-comparison-status");
    this.selected = "original";
    this.context = null;
    this.buffers = null;
    this.sources = null;
    this.gains = null;
    this.position = 0;
    this.startedAt = 0;
    this.duration = 10;
    this.frame = 0;
    this.playing = false;
    this.scrubbing = false;
    this.token = 0;

    this.buttons.forEach((button) => {
      button.addEventListener("click", () => this.select(button.dataset.version));
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const version = event.key === "ArrowLeft" ? "original" : "spatial";
        this.select(version);
        this.buttons.find((item) => item.dataset.version === version)?.focus();
      });
    });
    this.playButton.addEventListener("click", () => this.toggle());
    this.seek.addEventListener("pointerdown", () => {
      this.scrubbing = true;
    });
    this.seek.addEventListener("input", () => {
      this.scrubbing = true;
      this.paintTime((Number(this.seek.value) / 1000) * this.duration);
    });
    this.seek.addEventListener("change", () => this.commitSeek());
  }

  async ensureLoaded() {
    if (this.buffers) return;
    this.status.textContent = "Loading excerpt...";
    this.context ??= new AudioContext();
    const decode = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} while loading ${url}`);
      return this.context.decodeAudioData(await response.arrayBuffer());
    };
    const [original, spatial] = await Promise.all([
      decode(this.urls.original),
      decode(this.urls.spatial),
    ]);
    this.buffers = { original, spatial };
    this.duration = Math.min(original.duration, spatial.duration);
    this.status.textContent = "";
    this.paintTime(this.position);
  }

  select(version) {
    if (!(version in this.urls) || version === this.selected) return;
    const previous = this.selected;
    this.selected = version;
    this.buttons.forEach((button) => {
      const selected = button.dataset.version === version;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (!this.playing || !this.gains) return;
    const now = this.context.currentTime;
    const fade = 0.035;
    this.gains[previous].gain.cancelScheduledValues(now);
    this.gains[version].gain.cancelScheduledValues(now);
    this.gains[previous].gain.setValueAtTime(this.gains[previous].gain.value, now);
    this.gains[version].gain.setValueAtTime(this.gains[version].gain.value, now);
    this.gains[previous].gain.linearRampToValueAtTime(0, now + fade);
    this.gains[version].gain.linearRampToValueAtTime(1, now + fade);
  }

  async toggle() {
    if (this.playing) {
      this.pause();
      return;
    }
    try {
      await this.ensureLoaded();
      await this.context.resume();
      this.start();
    } catch (error) {
      this.status.textContent = `Could not load the comparison: ${error.message}`;
    }
  }

  start() {
    if (!this.buffers) return;
    if (this.position >= this.duration - 0.01) this.position = 0;
    this.stopOtherPlayers();
    this.stopSources();
    const now = this.context.currentTime;
    const token = ++this.token;
    this.sources = {};
    this.gains = {};
    for (const version of ["original", "spatial"]) {
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = this.buffers[version];
      gain.gain.setValueAtTime(version === this.selected ? 1 : 0, now);
      source.connect(gain).connect(this.context.destination);
      source.start(now, this.position);
      this.sources[version] = source;
      this.gains[version] = gain;
    }
    this.sources.original.onended = () => {
      if (this.token === token && this.playing) this.finish();
    };
    this.startedAt = now - this.position;
    this.playing = true;
    this.playButton.textContent = "Pause";
    this.tick();
  }

  pause() {
    if (!this.playing) return;
    this.position = Math.min(this.duration, this.context.currentTime - this.startedAt);
    this.playing = false;
    this.stopSources();
    cancelAnimationFrame(this.frame);
    this.playButton.textContent = this.position >= this.duration - 0.01 ? "Replay" : "Play";
    this.paintTime(this.position);
  }

  finish() {
    this.position = this.duration;
    this.playing = false;
    this.stopSources();
    cancelAnimationFrame(this.frame);
    this.seek.value = "1000";
    this.playButton.textContent = "Replay";
    this.paintTime(this.duration);
  }

  stopSources() {
    this.token += 1;
    if (this.sources) {
      Object.values(this.sources).forEach((source) => {
        source.onended = null;
        try {
          source.stop();
        } catch {}
        source.disconnect();
      });
    }
    if (this.gains) Object.values(this.gains).forEach((gain) => gain.disconnect());
    this.sources = null;
    this.gains = null;
  }

  commitSeek() {
    this.scrubbing = false;
    this.position = (Number(this.seek.value) / 1000) * this.duration;
    if (this.playing) this.start();
    else {
      this.playButton.textContent = this.position >= this.duration - 0.01 ? "Replay" : "Play";
      this.paintTime(this.position);
    }
  }

  tick() {
    if (!this.playing) return;
    this.position = Math.min(this.duration, this.context.currentTime - this.startedAt);
    if (!this.scrubbing) {
      this.seek.value = String(Math.round((this.position / this.duration) * 1000));
      this.paintTime(this.position);
    }
    this.frame = requestAnimationFrame(() => this.tick());
  }

  paintTime(position) {
    const format = (seconds) => {
      const whole = Math.max(0, Math.floor(seconds));
      return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
    };
    this.time.textContent = `${format(position)} / ${format(this.duration)}`;
  }

  stopOtherPlayers() {
    document.querySelectorAll("audio").forEach((player) => player.pause());
    document.querySelectorAll(".saqol-demo iframe").forEach((frame) => {
      frame.contentWindow?.postMessage({ type: "saqol-pause" }, "*");
    });
  }
}

const comparisons = [...document.querySelectorAll("[data-audio-comparison]")].map(
  (root) => new AudioComparison(root),
);

document.addEventListener("play", (event) => {
  if (!(event.target instanceof HTMLAudioElement)) return;
  comparisons.forEach((comparison) => comparison.pause());
  document.querySelectorAll("audio").forEach((player) => {
    if (player !== event.target) player.pause();
  });
  document.querySelectorAll(".saqol-demo iframe").forEach((frame) => {
    frame.contentWindow?.postMessage({ type: "saqol-pause" }, "*");
  });
}, true);

window.addEventListener("message", (event) => {
  if (event.data?.type !== "saqol-playback-started") return;
  comparisons.forEach((comparison) => comparison.pause());
  document.querySelectorAll("audio").forEach((player) => player.pause());
});
