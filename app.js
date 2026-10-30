// ====== PASTE YOUR API KEY HERE ======
const API_KEY = "AIzaSyClMSOxx9UeYnfyXN_9PFkw2qrJag2I-50";
// Optional: only needed for searching Spotify. Pasting Spotify links works without it.
const SPOTIFY_CLIENT_ID = "280510cb900e4e8abb9484525bf85d47";
// =====================================

const FADE_SECONDS = 45;        // volume fades out over the last N seconds
const MAX_PLAYLIST_INDEX = 200; // the embedded player only loads ~200 videos of a playlist
const MAX_SHORT_IDS = 100;
const MAX_DIM = 0.7;            // how dark the screen gets during the fade-out
const MOON_BASE_TOP = 62;       // moon height at the horizon (px)
const MOON_ARC = 56;            // how high the moon climbs (px)

const $ = (id) => document.getElementById(id);
const tabChannel = $("tabChannel");
const tabSong = $("tabSong");
const searchInput = $("searchInput");
const searchBtn = $("searchBtn");
const searchMsg = $("searchMsg");
const results = $("results");
const chosen = $("chosen");
const chosenImg = $("chosenImg");
const chosenName = $("chosenName");
const chosenKind = $("chosenKind");
const hoursInput = $("hours");
const minutesInput = $("minutes");
const secondsInput = $("seconds");
const channelOptions = $("channelOptions");
const shuffleBox = $("shuffle");
const contentType = $("contentType");
const startBtn = $("startBtn");
const pauseBtn = $("pauseBtn");
const stopBtn = $("stopBtn");
const statusEl = $("status");
const goodnightEl = $("goodnight");
const playerWrap = $("playerWrap");
const dimEl = $("dim");
const moon = $("moon");
const favBtn = $("favBtn");
const shareBtn = $("shareBtn");
const favSection = $("favSection");
const favsEl = $("favs");
const volEl = $("vol");
const fadeLen = $("fadeLen");
const nightBox = $("nightMode");
const skipBtn = $("skipBtn");
const plusBtn = $("plusBtn");
const historyEl = $("history");
const partyBox = $("party");
const tabPlaylist = $("tabPlaylist");
const tabSpotify = $("tabSpotify");
const queueSection = $("queueSection");
const queueEl = $("queue");
const playQueueBtn = $("playQueueBtn");
const clearQueueBtn = $("clearQueueBtn");

let apiReady = false;
let player = null;
let searchMode = "channel"; // "channel" or "song"
let selected = null;        // channel: { type, id, title, thumb, lists, shortIds, ready }
                            // song:    { type, id, title, sub, thumb, ready }
let sessionActive = false;
let paused = false;
let endTime = 0;
let remainingWhenPaused = 0;
let tickId = null;
let baseVolume = 100;
let totalMs = 0;
let usingIdList = false;
let errorCount = 0;
let partyRun = false;
let spotifyApi = null;
let singleMode = false;
let triedIds = new Set();
let lastErrorAt = 0;

// ---------- Stars ----------
function makeStars() {
  const box = $("stars");
  for (let i = 0; i < 70; i++) {
    const s = document.createElement("span");
    s.className = "star";
    const size = 1 + Math.random() * 1.8;
    s.style.left = Math.random() * 100 + "%";
    s.style.top = Math.random() * 100 + "%";
    s.style.width = size + "px";
    s.style.height = size + "px";
    s.style.animationDuration = 2 + Math.random() * 4 + "s";
    s.style.animationDelay = -Math.random() * 5 + "s";
    box.appendChild(s);
  }
}
makeStars();

// ---------- Moon and dimmer ----------
function updateMoon(p) {
  p = Math.min(1, Math.max(0, p));
  moon.classList.add("active");
  moon.style.left = p * 100 + "%";
  moon.style.top = MOON_BASE_TOP - Math.sin(Math.PI * p) * MOON_ARC + "px";
  moon.style.setProperty("--phase", (5 + p * 11).toFixed(1)); // moon wanes as time runs out
}

function resetMoon() {
  moon.classList.remove("active");
  moon.style.left = "";
  moon.style.top = "";
  moon.style.removeProperty("--phase");
}

function setDim(amount) {
  dimEl.style.opacity = String(amount);
}

// ---------- YouTube IFrame API ----------
window.onYouTubeIframeAPIReady = function () {
  apiReady = true;
  updateStartState();
};

const tag = document.createElement("script");
tag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(tag);

// Channel ID "UC..." maps to auto-made playlists:
// UULF = long-form videos (no Shorts), UUSH = Shorts only, UU = everything
const PLAYLIST_PREFIX = { long: "UULF", shorts: "UUSH", all: "UU" };

function playlistIdFor(channelId, kind) {
  return PLAYLIST_PREFIX[kind] + channelId.slice(2);
}

// ---------- Search ----------
function decodeHtml(str) {
  const t = document.createElement("textarea");
  t.innerHTML = str;
  return t.value;
}

function setSearchMode(mode) {
  searchMode = mode;
  [["channel", tabChannel], ["song", tabSong], ["playlist", tabPlaylist], ["spotify", tabSpotify]].forEach(([m, t]) => {
    t.classList.toggle("active", mode === m);
    t.setAttribute("aria-selected", String(mode === m));
  });
  searchInput.placeholder = mode === "spotify" ? "Paste a Spotify link, or search" : "Search for a " + mode;
  results.innerHTML = "";
  searchMsg.textContent = "";
  searchInput.focus();
}

async function search() {
  const q = searchInput.value.trim();
  if (!q) return;
  if (searchMode === "spotify") return spotifySearch(q);

  if (API_KEY === "PASTE_YOUR_KEY_HERE") {
    searchMsg.textContent = "Add your API key at the top of app.js first.";
    return;
  }

  searchMsg.textContent = "Searching...";
  results.innerHTML = "";

  const typeParams =
    searchMode === "channel"
      ? "type=channel&maxResults=6"
      : searchMode === "playlist"
      ? "type=playlist&maxResults=8"
      : "type=video&videoCategoryId=10&videoEmbeddable=true&videoSyndicated=true&maxResults=15";

  try {
    const url =
      "https://www.googleapis.com/youtube/v3/search" +
      "?part=snippet&" + typeParams +
      "&q=" + encodeURIComponent(searchMode === "song" && !/lyric/i.test(q) ? q + " lyrics" : q) +
      "&key=" + API_KEY;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      const reason = data.error && data.error.message ? data.error.message : res.status;
      const quota = data.error && data.error.errors && data.error.errors[0] &&
        data.error.errors[0].reason === "quotaExceeded";
      searchMsg.textContent = quota
        ? "Daily search limit reached. Favorites still work, and search resets tomorrow."
        : "Search failed: " + reason;
      return;
    }

    // Keep only songs that are really allowed to play in an embedded player
    if (searchMode === "song" && data.items && data.items.length) {
      const okIds = new Set(await filterEmbeddable(data.items.map((i) => i.id.videoId)));
      const kept = data.items.filter((i) => okIds.has(i.id.videoId));
      if (kept.length) data.items = kept;

      // Official/VEVO uploads are the ones most often blocked, so list them last
      const isOfficial = (i) => /official|vevo/i.test(i.snippet.title + " " + (i.snippet.channelTitle || ""));
      const others = data.items.filter((i) => !isOfficial(i));
      data.items = (others.length >= 3 ? others : others.concat(data.items.filter(isOfficial))).slice(0, 8);
    }

    if (!data.items || data.items.length === 0) {
      searchMsg.textContent = "Nothing found. Try a different search.";
      return;
    }

    searchMsg.textContent = "";
    const songAlts = data.items.map((it) => ({ id: it.id.videoId, title: decodeHtml(it.snippet.title) }));
    data.items.forEach((item, i) => {
      const thumbs = item.snippet.thumbnails || {};
      const thumb = (thumbs.default || thumbs.medium || {}).url || "";
      const title = decodeHtml(item.snippet.title);

      const entry =
        searchMode === "channel"
          ? {
              type: "channel",
              id: item.snippet.channelId || item.id.channelId,
              title,
              thumb,
              lists: {},
              shortIds: [],
              ready: false,
            }
          : {
              type: searchMode === "playlist" ? "playlist" : "song",
              id: item.id.videoId || item.id.playlistId,
              title,
              sub: decodeHtml(item.snippet.channelTitle || ""),
              thumb,
              ready: searchMode !== "playlist",
              alts: songAlts,
            };

      const li = document.createElement("li");
      li.tabIndex = 0;
      li.style.animationDelay = i * 60 + "ms";

      const img = document.createElement("img");
      img.src = thumb;
      img.alt = "";

      const text = document.createElement("div");
      const name = document.createElement("div");
      name.textContent = title;
      text.appendChild(name);
      if (entry.sub) {
        const sub = document.createElement("div");
        sub.className = "result-sub";
        sub.textContent = entry.sub;
        text.appendChild(sub);
      }

      li.append(img, text);
      if (entry.type === "song") {
        const add = document.createElement("button");
        add.className = "secondary small";
        add.textContent = "+ Queue";
        add.addEventListener("click", (ev) => { ev.stopPropagation(); addToQueue(entry); });
        li.appendChild(add);
      }
      li.addEventListener("click", () => selectEntry(entry));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectEntry(entry);
        }
      });
      results.appendChild(li);
    });
  } catch (err) {
    searchMsg.textContent = "Network error. Check your connection and try again.";
  }
}

async function countPlaylist(playlistId) {
  try {
    const url =
      "https://www.googleapis.com/youtube/v3/playlistItems" +
      "?part=id&maxResults=1" +
      "&playlistId=" + playlistId +
      "&key=" + API_KEY;
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok && data.pageInfo) return data.pageInfo.totalResults || 0;
  } catch (err) {
    // treated as empty below
  }
  return 0;
}

// Gets video IDs from a playlist (50 per request). Used for Shorts, because the
// Shorts playlist itself won't play in the embedded player but the videos do.
async function fetchPlaylistVideoIds(playlistId, maxIds) {
  const ids = [];
  let pageToken = "";
  try {
    while (ids.length < maxIds) {
      const url =
        "https://www.googleapis.com/youtube/v3/playlistItems" +
        "?part=contentDetails&maxResults=50" +
        "&playlistId=" + playlistId +
        (pageToken ? "&pageToken=" + pageToken : "") +
        "&key=" + API_KEY;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.items) break;
      data.items.forEach((it) => ids.push(it.contentDetails.videoId));
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
  } catch (err) {
    // return whatever we have
  }
  return ids.slice(0, maxIds);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Counts the videos in each playlist type so shuffle can start on a random one
async function loadChannelPlaylist(channel) {
  const kinds = ["long", "shorts", "all"];
  const counts = await Promise.all(
    kinds.map((k) => countPlaylist(playlistIdFor(channel.id, k)))
  );
  kinds.forEach((k, i) => {
    channel.lists[k] = { id: playlistIdFor(channel.id, k), total: counts[i] };
  });

  if (channel.lists.shorts.total > 0) {
    channel.shortIds = await filterEmbeddable(
      await fetchPlaylistVideoIds(channel.lists.shorts.id, MAX_SHORT_IDS)
    );
  }
}

async function selectEntry(entry) {
  // Picking something new removes any player that's still on screen
  if (sessionActive) endSession();
  destroyPlayer();
  goodnightEl.hidden = true;
  setDim(0);
  statusEl.textContent = "";

  selected = entry;
  chosenImg.src = entry.thumb;
  chosenName.textContent = entry.title;
  chosenKind.textContent = entry.type === "channel" ? "Channel" : (entry.type === "playlist" ? "Playlist" : entry.type === "spotify" ? "Spotify " + entry.kind : "Song") + (entry.sub ? " \u00b7 " + entry.sub : "");
  chosen.hidden = false;
  chosen.classList.remove("pop");
  void chosen.offsetWidth; // restart the pop animation
  chosen.classList.add("pop");

  channelOptions.hidden = entry.type !== "channel" && entry.type !== "playlist";
  updateFavBtn();
  saveState();
  results.innerHTML = "";
  searchMsg.textContent = "";
  updateStartState();

  if (entry.type === "channel") {
    await loadChannelPlaylist(entry);
    entry.ready = true;
    if (selected === entry) updateStartState();
  } else if (entry.type === "playlist") {
    entry.total = await countPlaylist(entry.id);
    entry.ready = true;
    if (selected === entry) updateStartState();
  }
}

function updateStartState() {
  const engineReady = selected && selected.type === "spotify" ? !!spotifyApi : apiReady;
  startBtn.disabled = !(engineReady && selected && selected.ready);
}

// ---------- Player ----------
function destroyPlayer() {
  if (player) {
    try { player.destroy(); } catch (e) { /* already gone */ }
    player = null;
  }
  playerWrap.innerHTML = "";
  playerWrap.hidden = true;
  playerWrap.classList.remove("spotify");
  playerWrap.style.height = "";
}

function onPlayerReady(e) {
  e.target.setLoop(true);
  if (shuffleBox.checked && !usingIdList) e.target.setShuffle(true);
  baseVolume = Number(volEl.value) || 100;
  e.target.setVolume(baseVolume);
  e.target.playVideo();
}

function onPlayerStateChange(e) {
  if (e.data === 1) errorCount = 0; // a video is playing, so things are fine
}

// A video that can't play gets skipped. Several in a row stops the session.
function onPlayerError(e) {
  if (Date.now() - lastErrorAt < 800) return; // ignore repeat events for the same failure
  lastErrorAt = Date.now();
  if (singleMode) {
    // A blocked song falls back to the next song from the same search
    const next = selected && selected.type === "song" && selected.alts
      ? selected.alts.find((a) => !triedIds.has(a.id))
      : null;
    if (next) {
      triedIds.add(next.id);
      selected.id = next.id;
      selected.title = next.title;
      chosenName.textContent = next.title;
      e.target.loadPlaylist({ playlist: [next.id] });
      e.target.setLoop(true);
      return;
    }
    endSession();
    statusEl.textContent = `That video can't be played here (code ${e.data}). Pick another one.`;
    return;
  }
  errorCount += 1;
  if (errorCount >= 5) {
    endSession();
    statusEl.textContent = `Playback error (code ${e.data}). Try another channel or setting.`;
    return;
  }
  try { e.target.nextVideo(); } catch (err) { /* nothing to skip to */ }
}

// Pass a playlist ID + start index, or a list of video IDs (ids) instead
function createPlayer(playlistId, startIndex, ids) {
  destroyPlayer();
  playerWrap.hidden = false;
  playerWrap.innerHTML = '<div id="player"></div>';

  usingIdList = Array.isArray(ids);
  singleMode = usingIdList && ids.length === 1;

  const playerVars = { autoplay: 1, playsinline: 1, rel: 0 };
  const options = {
    width: "100%",
    height: "100%",
    playerVars,
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  };

  if (usingIdList) {
    options.videoId = ids[0];
    // A single video loops by listing itself as the playlist
    playerVars.playlist = ids.length > 1 ? ids.slice(1).join(",") : ids[0];
    playerVars.loop = 1;
  } else {
    playerVars.listType = "playlist";
    playerVars.list = playlistId;
    playerVars.index = startIndex;
  }

  player = new YT.Player("player", options);
}

// ---------- Timer ----------
function getDurationMs() {
  const h = Math.max(0, parseInt(hoursInput.value, 10) || 0);
  const m = Math.max(0, parseInt(minutesInput.value, 10) || 0);
  const s = Math.max(0, parseInt(secondsInput.value, 10) || 0);
  return (h * 3600 + m * 60 + s) * 1000;
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function startSession() {
  if (!selected || !(selected.type === "spotify" ? spotifyApi : apiReady)) return;

  partyRun = partyBox.checked;
  let duration = getDurationMs();
  if (duration <= 0) {
    if (!partyRun) {
      statusEl.textContent = "Choose a time longer than 0, or turn on Party mode.";
      return;
    }
    duration = Infinity;
  }

  if (selected.type === "spotify") {
    clearInterval(tickId);
    goodnightEl.hidden = true;
    setDim(0);
    errorCount = 0;
    playerWrap.classList.remove("vertical");
    createSpotifyPlayer(selected);
  } else if (selected.type === "playlist" || selected.type === "queue") {
    clearInterval(tickId);
    goodnightEl.hidden = true;
    setDim(0);
    errorCount = 0;
    playerWrap.classList.remove("vertical");
    if (selected.type === "queue") {
      createPlayer(null, 0, queue.map((q) => q.id));
    } else {
      const pool = Math.min(selected.total || 1, MAX_PLAYLIST_INDEX);
      createPlayer(selected.id, shuffleBox.checked ? Math.floor(Math.random() * pool) : 0, null);
    }
  } else if (selected.type === "song") {
    clearInterval(tickId);
    goodnightEl.hidden = true;
    setDim(0);
    errorCount = 0;
    playerWrap.classList.remove("vertical");
    triedIds = new Set([selected.id]);
    createPlayer(null, 0, [selected.id]);
  } else {
    const mode = contentType.value;
    let pick = selected.lists[mode];

    if (mode === "shorts" && selected.shortIds.length === 0) {
      statusEl.textContent = "This channel has no Shorts.";
      return;
    }
    if (mode === "long" && (!pick || pick.total === 0)) {
      pick = selected.lists.all; // fallback if the long-form list is missing
    }
    if (!pick || pick.total === 0) {
      statusEl.textContent = "No videos found for this channel.";
      return;
    }

    clearInterval(tickId);
    goodnightEl.hidden = true;
    setDim(0);
    errorCount = 0;

    // Random starting video when shuffle is on, so each run begins differently
    const pool = Math.min(pick.total, MAX_PLAYLIST_INDEX);
    const startIndex = shuffleBox.checked ? Math.floor(Math.random() * pool) : 0;

    playerWrap.classList.toggle("vertical", mode === "shorts");
    if (mode === "shorts") {
      const ids = selected.shortIds.slice();
      if (shuffleBox.checked) shuffleArray(ids);
      createPlayer(null, 0, ids);
    } else {
      createPlayer(pick.id, startIndex, null);
    }
  }

  sessionActive = true;
  paused = false;
  totalMs = duration;
  endTime = Date.now() + duration;

  startBtn.hidden = true;
  pauseBtn.hidden = false;
  pauseBtn.textContent = "Pause";
  stopBtn.hidden = false;
  skipBtn.hidden = false;
  plusBtn.hidden = false;
  statusEl.classList.add("live");
  saveState();

  updateMoon(0);
  tick();
  tickId = setInterval(tick, 1000);
}

function tick() {
  if (!isFinite(endTime)) {
    statusEl.textContent = `Playing ${selected.title}. No timer.`;
    return;
  }
  const remaining = endTime - Date.now();

  if (remaining <= 0) {
    finishSession();
    return;
  }

  statusEl.textContent = `Playing ${selected.title}. Stops in ${formatRemaining(remaining)}. Ends at ${endClock()}.`;
  updateMoon(1 - remaining / totalMs);

  // Fade the volume and the screen out over the last FADE_SECONDS
  const fadeMs = Math.min(Number(fadeLen.value) * 1000, totalMs / 2);
  if (remaining < fadeMs && !partyRun) {
    const left = remaining / fadeMs;
    setDim(MAX_DIM * (1 - left));
    if (player && typeof player.setVolume === "function") {
      player.setVolume(Math.max(0, Math.round(baseVolume * left)));
    }
  }
}

function togglePause() {
  if (!sessionActive || !player) return;

  if (!paused) {
    paused = true;
    remainingWhenPaused = endTime - Date.now();
    clearInterval(tickId);
    tickId = null;
    if (typeof player.pauseVideo === "function") player.pauseVideo();
    pauseBtn.textContent = "Resume";
    statusEl.textContent = `Paused. ${formatRemaining(remainingWhenPaused)} left.`;
  } else {
    paused = false;
    endTime = Date.now() + remainingWhenPaused;
    if (typeof player.playVideo === "function") player.playVideo();
    pauseBtn.textContent = "Pause";
    tick();
    tickId = setInterval(tick, 1000);
  }
}

// Clears the timer, removes the player, and resets the buttons
function endSession() {
  if (sessionActive) logListening();
  clearInterval(tickId);
  tickId = null;
  sessionActive = false;
  paused = false;
  destroyPlayer();
  resetMoon();
  startBtn.hidden = false;
  pauseBtn.hidden = true;
  stopBtn.hidden = true;
  skipBtn.hidden = true;
  plusBtn.hidden = true;
  statusEl.classList.remove("live");
}

function finishSession() {
  endSession();
  statusEl.textContent = "";
  goodnightEl.hidden = partyRun; // no goodnight screen in party mode
}

function stopSession() {
  endSession();
  setDim(0);
  statusEl.textContent = "Stopped.";
}

// Browsers throttle timers in background tabs, so re-check when the tab wakes up
document.addEventListener("visibilitychange", () => {
  if (sessionActive && !paused && Date.now() >= endTime) finishSession();
});

// ---------- Events ----------
tabChannel.addEventListener("click", () => setSearchMode("channel"));
tabSong.addEventListener("click", () => setSearchMode("song"));
searchBtn.addEventListener("click", search);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});
startBtn.addEventListener("click", startSession);
pauseBtn.addEventListener("click", togglePause);
stopBtn.addEventListener("click", stopSession);
goodnightEl.addEventListener("click", () => {
  goodnightEl.hidden = true;
  setDim(0);
});

// ---------- Saved settings, favorites, history, sharing ----------
const LS = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ }
  },
};

function endClock() {
  return new Date(endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function slim(e) {
  return { type: e.type, id: e.id, title: e.title, thumb: e.thumb, sub: e.sub || "", kind: e.kind, uri: e.uri };
}

function makeEntry(f) {
  return f.type === "channel"
    ? { ...f, lists: {}, shortIds: [], ready: false }
    : { ...f, ready: f.type !== "playlist" };
}

function setDuration(ms) {
  const sec = Math.round(ms / 1000);
  hoursInput.value = Math.floor(sec / 3600);
  minutesInput.value = Math.floor((sec % 3600) / 60);
  secondsInput.value = sec % 60;
}

function saveState() {
  LS.set("sc_state", {
    sel: selected && selected.type !== "queue" ? slim(selected) : null,
    h: hoursInput.value, m: minutesInput.value, s: secondsInput.value,
    content: contentType.value, shuffle: shuffleBox.checked,
    vol: volEl.value, fade: fadeLen.value, night: nightBox.checked,
  });
}

function applyNight() {
  document.body.classList.toggle("red", nightBox.checked);
}

// Favorites
function isFav(e) {
  return LS.get("sc_favs", []).some((f) => f.id === e.id && f.type === e.type);
}

function updateFavBtn() {
  favBtn.textContent = selected && isFav(selected) ? "\u2605 Saved" : "\u2606 Save";
}

function renderFavs() {
  const favs = LS.get("sc_favs", []);
  favSection.hidden = favs.length === 0;
  favsEl.innerHTML = "";
  favs.forEach((f) => {
    const li = document.createElement("li");
    li.tabIndex = 0;
    const img = document.createElement("img");
    img.src = f.thumb;
    img.alt = "";
    const text = document.createElement("div");
    const name = document.createElement("div");
    name.textContent = f.title;
    const kind = document.createElement("div");
    kind.className = "result-sub";
    kind.textContent = f.type === "channel" ? "Channel" : "Song";
    text.append(name, kind);
    li.append(img, text);
    li.addEventListener("click", () => selectEntry(makeEntry(f)));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectEntry(makeEntry(f)); }
    });
    favsEl.appendChild(li);
  });
  updateFavBtn();
}

favBtn.addEventListener("click", () => {
  if (!selected || selected.type === "queue") return;
  let favs = LS.get("sc_favs", []);
  favs = isFav(selected)
    ? favs.filter((f) => !(f.id === selected.id && f.type === selected.type))
    : favs.concat(slim(selected));
  LS.set("sc_favs", favs);
  renderFavs();
});

// Listening history
function dayKey(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m";
}

function logListening() {
  if (!isFinite(totalMs)) return;
  const left = paused ? remainingWhenPaused : Math.max(0, endTime - Date.now());
  const ms = Math.max(0, totalMs - left);
  if (ms < 5000) return;
  const hist = LS.get("sc_hist", {});
  hist[dayKey()] = (hist[dayKey()] || 0) + ms;
  LS.set("sc_hist", hist);
  renderHistory();
}

function renderHistory() {
  const hist = LS.get("sc_hist", {});
  let week = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    week += hist[dayKey(d)] || 0;
  }
  historyEl.textContent = week
    ? `Tonight: ${fmtDur(hist[dayKey()] || 0)}. Last 7 days: ${fmtDur(week)}.`
    : "";
}

// Presets, +15, skip, share
document.querySelectorAll(".presets button").forEach((b) => {
  b.addEventListener("click", () => {
    setDuration(Number(b.dataset.min) * 60000);
    saveState();
  });
});

plusBtn.addEventListener("click", () => {
  if (!sessionActive || !isFinite(endTime)) return;
  const add = 15 * 60 * 1000;
  totalMs += add;
  if (paused) remainingWhenPaused += add;
  else endTime += add;
  setDim(0);
  if (player && typeof player.setVolume === "function") player.setVolume(baseVolume);
  if (!paused) tick();
});

skipBtn.addEventListener("click", () => {
  if (player && typeof player.nextVideo === "function") player.nextVideo();
});

shareBtn.addEventListener("click", () => {
  if (!selected) return;
  const p = new URLSearchParams({
    type: selected.type, id: selected.id, title: selected.title,
    thumb: selected.thumb, sub: selected.sub || "",
    t: String(Math.round(getDurationMs() / 1000)),
  });
  const link = location.href.split("#")[0] + "#" + p.toString();
  const done = () => {
    shareBtn.textContent = "Copied!";
    setTimeout(() => { shareBtn.textContent = "Copy link"; }, 1500);
  };
  if (navigator.clipboard) navigator.clipboard.writeText(link).then(done).catch(() => prompt("Copy this link:", link));
  else prompt("Copy this link:", link);
});

// Settings
volEl.addEventListener("input", () => {
  paintVol();
  baseVolume = Number(volEl.value);
  if (player && typeof player.setVolume === "function") player.setVolume(baseVolume);
  saveState();
});
nightBox.addEventListener("change", () => { applyNight(); saveState(); });
[hoursInput, minutesInput, secondsInput, contentType, shuffleBox, fadeLen].forEach((el) =>
  el.addEventListener("change", saveState)
);

// Shooting stars
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function shootingStar() {
  const s = document.createElement("span");
  s.className = "shooting";
  s.style.top = Math.random() * 40 + "%";
  s.style.left = 30 + Math.random() * 60 + "%";
  document.body.appendChild(s);
  s.addEventListener("animationend", () => s.remove());
}
if (!reduceMotion) {
  setInterval(() => { if (!document.hidden && Math.random() < 0.6) shootingStar(); }, 7000);
}

// Restore last session, or open a shared link
function restore() {
  const st = LS.get("sc_state", null);
  if (st) {
    hoursInput.value = st.h; minutesInput.value = st.m; secondsInput.value = st.s;
    contentType.value = st.content || "long";
    shuffleBox.checked = st.shuffle !== false;
    volEl.value = st.vol || 100;
    fadeLen.value = st.fade || "45";
    nightBox.checked = !!st.night;
  }
  applyNight();
  baseVolume = Number(volEl.value) || 100;

  const p = new URLSearchParams(location.hash.slice(1));
  let entry = null;
  if (/^[\w-]{6,40}$/.test(p.get("id") || "")) {
    entry = makeEntry({
      type: p.get("type") === "song" ? "song" : "channel",
      id: p.get("id"), title: p.get("title") || "", thumb: p.get("thumb") || "", sub: p.get("sub") || "",
    });
    const t = parseInt(p.get("t"), 10);
    if (t > 0) setDuration(t * 1000);
  } else if (st && st.sel) {
    entry = makeEntry(st.sel);
  }

  renderFavs();
  renderHistory();
  if (entry) selectEntry(entry);
}
restore();

// Fills the volume slider track up to the thumb
function paintVol() {
  const pct = ((volEl.value - volEl.min) / (volEl.max - volEl.min)) * 100;
  volEl.style.setProperty("--fill", pct + "%");
}
paintVol();

// ---------- Queue ----------
let queue = LS.get("sc_queue", []);

function addToQueue(entry) {
  queue.push(slim(entry));
  LS.set("sc_queue", queue);
  renderQueue();
}

function renderQueue() {
  queueSection.hidden = queue.length === 0;
  queueEl.innerHTML = "";
  queue.forEach((q, i) => {
    const li = document.createElement("li");
    const img = document.createElement("img");
    img.src = q.thumb;
    img.alt = "";
    const name = document.createElement("span");
    name.textContent = q.title;
    const rm = document.createElement("button");
    rm.className = "secondary small";
    rm.textContent = "\u00d7";
    rm.setAttribute("aria-label", "Remove from queue");
    rm.addEventListener("click", () => {
      queue.splice(i, 1);
      LS.set("sc_queue", queue);
      renderQueue();
    });
    li.append(img, name, rm);
    queueEl.appendChild(li);
  });
}

playQueueBtn.addEventListener("click", () => {
  if (!queue.length || !apiReady) return;
  if (sessionActive) endSession();
  destroyPlayer();
  selected = { type: "queue", id: "queue", title: "Your queue", thumb: "", ready: true };
  startSession();
});

clearQueueBtn.addEventListener("click", () => {
  queue = [];
  LS.set("sc_queue", queue);
  renderQueue();
});

// ---------- Number steppers ----------
document.querySelectorAll('input[type="number"]').forEach((inp) => {
  const wrap = document.createElement("div");
  wrap.className = "stepper";
  const mk = (text, d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secondary step";
    b.textContent = text;
    b.setAttribute("aria-label", d > 0 ? "Increase" : "Decrease");
    b.addEventListener("click", () => {
      const min = Number(inp.min) || 0;
      const max = Number(inp.max) || 99;
      inp.value = Math.min(max, Math.max(min, (parseInt(inp.value, 10) || 0) + d));
      inp.dispatchEvent(new Event("change"));
    });
    return b;
  };
  inp.parentNode.insertBefore(wrap, inp);
  wrap.append(mk("\u2212", -1), inp, mk("+", 1));
});

// ---------- Recommendations ----------
const RECS = [
  ["channel", "Lofi Girl"], ["channel", "Relaxing nature sounds"], ["channel", "Sleep stories"],
  ["song", "Rain sounds"], ["song", "Soft piano for sleeping"], ["song", "Ocean waves"],
  ["song", "Party hits"], ["playlist", "Sleep music"], ["playlist", "Party mix"],
];

RECS.forEach(([mode, q]) => {
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = q;
  b.title = "Search " + mode + "s for " + q;
  b.addEventListener("click", () => {
    setSearchMode(mode);
    searchInput.value = q;
    search();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("recs").appendChild(b);
});

renderQueue();

// Drops videos the owner has blocked from embedding (they show "Watch on YouTube")
async function filterEmbeddable(ids) {
  const ok = [];
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const url =
        "https://www.googleapis.com/youtube/v3/videos?part=status&id=" +
        ids.slice(i, i + 50).join(",") + "&key=" + API_KEY;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.items) return ids;
      data.items.forEach((v) => { if (v.status && v.status.embeddable) ok.push(v.id); });
    }
  } catch (err) {
    return ids;
  }
  return ok.length ? ok : ids;
}

// ---------- Spotify ----------
const SPOTIFY_ICON =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 44'><circle cx='22' cy='22' r='22' fill='%231db954'/><path d='M10 16c8-3 17-2 24 2M11 23c7-2 14-1 20 2M12 29c6-2 11-1 16 1' stroke='%23000' stroke-width='3' fill='none' stroke-linecap='round'/></svg>";

window.onSpotifyIframeApiReady = (api) => {
  spotifyApi = api;
  updateStartState();
};
const spTag = document.createElement("script");
spTag.src = "https://open.spotify.com/embed/iframe-api/v1";
spTag.async = true;
document.head.appendChild(spTag);

function parseSpotifyLink(text) {
  const m =
    text.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/) ||
    text.match(/spotify:(track|album|playlist|episode|show):([A-Za-z0-9]+)/);
  return m ? { kind: m[1], id: m[2] } : null;
}

function spotifyEntry(kind, id, extra) {
  return Object.assign(
    { type: "spotify", kind, id, uri: `spotify:${kind}:${id}`, title: "Spotify " + kind, thumb: SPOTIFY_ICON, sub: "", ready: true },
    extra || {}
  );
}

// Plays a Spotify item. The adapter lets pause/resume/stop use the same code as YouTube.
function createSpotifyPlayer(entry) {
  destroyPlayer();
  usingIdList = false;
  singleMode = false;
  const height = entry.kind === "track" || entry.kind === "episode" ? 152 : 352;
  playerWrap.hidden = false;
  playerWrap.classList.add("spotify");
  playerWrap.style.height = height + "px";
  playerWrap.innerHTML = '<div id="player"></div>';

  let ctrl = null;
  player = {
    pauseVideo: () => ctrl && ctrl.pause(),
    playVideo: () => ctrl && ctrl.resume(),
    destroy: () => { if (ctrl) ctrl.destroy(); },
  };
  spotifyApi.createController(
    document.getElementById("player"),
    { uri: entry.uri, width: "100%", height },
    (c) => {
      ctrl = c;
      c.addListener("ready", () => c.play()); // if the browser blocks autoplay, tap play once
    }
  );
}

// Login (PKCE, no secret needed) so search works
const SPOTIFY_REDIRECT = location.href.split(/[?#]/)[0];

function randomString(n) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => chars[b % 62]).join("");
}

async function sha256b64url(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(d)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function spotifyLogin(query) {
  const verifier = randomString(64);
  sessionStorage.setItem("sp_verifier", verifier);
  sessionStorage.setItem("sp_query", query || "");
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT,
    code_challenge_method: "S256",
    code_challenge: await sha256b64url(verifier),
  });
  location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}

function spotifyToken() {
  const t = sessionStorage.getItem("sp_token");
  const exp = Number(sessionStorage.getItem("sp_exp") || 0);
  return t && Date.now() < exp ? t : null;
}

async function spotifySearch(q) {
  const link = parseSpotifyLink(q);
  if (link) {
    searchInput.value = "";
    results.innerHTML = "";
    searchMsg.textContent = "";
    selectEntry(spotifyEntry(link.kind, link.id));
    return;
  }

  if (SPOTIFY_CLIENT_ID === "PASTE_SPOTIFY_CLIENT_ID_HERE") {
    searchMsg.textContent = "Paste a Spotify link, or add your Spotify Client ID at the top of app.js to turn on search.";
    return;
  }

  const token = spotifyToken();
  results.innerHTML = "";
  if (!token) {
    searchMsg.textContent = "Log in to Spotify to search.";
    const b = document.createElement("button");
    b.textContent = "Log in with Spotify";
    b.addEventListener("click", () => spotifyLogin(q));
    results.appendChild(b);
    return;
  }

  searchMsg.textContent = "Searching...";
  try {
    const res = await fetch(
      "https://api.spotify.com/v1/search?type=track,playlist&limit=8&q=" + encodeURIComponent(q),
      { headers: { Authorization: "Bearer " + token } }
    );
    if (res.status === 401) {
      sessionStorage.removeItem("sp_token");
      return spotifySearch(q);
    }
    const data = await res.json();
    if (!res.ok) {
      searchMsg.textContent = "Spotify search failed: " + ((data.error && data.error.message) || res.status);
      return;
    }
    const last = (imgs) => ((imgs || []).slice(-1)[0] || {}).url || SPOTIFY_ICON;
    const items = []
      .concat(((data.tracks && data.tracks.items) || []).filter(Boolean).map((t) =>
        spotifyEntry("track", t.id, { title: t.name, sub: t.artists.map((a) => a.name).join(", "), thumb: last(t.album && t.album.images) })))
      .concat(((data.playlists && data.playlists.items) || []).filter(Boolean).map((p) =>
        spotifyEntry("playlist", p.id, { title: p.name, sub: "Playlist", thumb: last(p.images) })));

    if (!items.length) {
      searchMsg.textContent = "Nothing found. Try a different search.";
      return;
    }
    searchMsg.textContent = "";
    items.forEach((entry, i) => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.style.animationDelay = i * 60 + "ms";
      const img = document.createElement("img");
      img.src = entry.thumb;
      img.alt = "";
      const text = document.createElement("div");
      const name = document.createElement("div");
      name.textContent = entry.title;
      const sub = document.createElement("div");
      sub.className = "result-sub";
      sub.textContent = entry.sub;
      text.append(name, sub);
      li.append(img, text);
      li.addEventListener("click", () => selectEntry(entry));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectEntry(entry); }
      });
      results.appendChild(li);
    });
  } catch (err) {
    searchMsg.textContent = "Network error. Check your connection and try again.";
  }
}

// Back from Spotify's login page: swap the code for a token, then run the pending search
(async function spotifyFinishLogin() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return;
  history.replaceState(null, "", SPOTIFY_REDIRECT + location.hash);
  setSearchMode("spotify");
  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT,
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: sessionStorage.getItem("sp_verifier") || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || res.status);
    sessionStorage.setItem("sp_token", data.access_token);
    sessionStorage.setItem("sp_exp", String(Date.now() + (data.expires_in - 60) * 1000));
    const q = sessionStorage.getItem("sp_query");
    if (q) { searchInput.value = q; spotifySearch(q); }
  } catch (err) {
    searchMsg.textContent = "Spotify login failed: " + err.message;
  }
})();
