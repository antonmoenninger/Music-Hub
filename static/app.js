import { startRewind } from "/assets/rewind.js";

const $app = document.getElementById("app");
const state = { me: null, searchSeq: 0, pollTimer: null };

// ------------------------------------------------------------------ utils
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = (n) => Number(n || 0).toLocaleString("de-DE");
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
export const coverUrl = (id, size = 300) => (id ? `/api/cover?id=${encodeURIComponent(id)}&size=${size}` : "");
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M6 4v16l14-8z"/></svg>';

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
  });
  if (res.status === 401 && !path.startsWith("/api/login")) {
    state.me = null;
    renderLogin();
    throw new Error("signed out");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

function img(src, cls = "cov") {
  return src
    ? `<img class="${cls}" src="${esc(src)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">`
    : `<div class="${cls}"></div>`;
}

// ------------------------------------------------------------------ shell
function renderShell(active) {
  $app.innerHTML = `
    <header class="topbar"><div class="shell">
      <div class="brand"><div class="brand-mark">${ICON_PLAY}</div><span class="brand-name">${esc(state.me?.name || "Music Hub")}</span></div>
      <nav class="tabs">
        <a href="#/search" class="${active === "search" ? "on" : ""}">Suche</a>
        <a href="#/stats" class="${active === "stats" ? "on" : ""}">Statistik</a>
        <a href="#/rewind" class="${active === "rewind" ? "on" : ""}">Rewind</a>
      </nav>
      <div class="who"><span class="uname">${esc(state.me?.user)}</span> <button class="linkbtn" id="logout">Abmelden</button></div>
    </div></header>
    <main class="shell" id="view"></main>`;
  document.getElementById("logout").onclick = async () => {
    await api("/api/logout", { method: "POST" });
    state.me = null;
    renderLogin();
  };
  return document.getElementById("view");
}

function renderLogin() {
  clearInterval(state.pollTimer);
  $app.innerHTML = `
    <div class="login"><form class="card" id="lf">
      <div class="brand"><div class="brand-mark">${ICON_PLAY}</div>Music Hub</div>
      <h1>Anmelden</h1>
      <p class="sub" style="margin:0">Mit deinem Navidrome-Konto.</p>
      <label for="u">Benutzername</label><input id="u" autocomplete="username" required>
      <label for="p">Passwort</label><input id="p" type="password" autocomplete="current-password" required>
      <button class="btn" type="submit">Anmelden</button>
      <div class="err" id="le"></div>
    </form></div>`;
  document.getElementById("lf").onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById("le");
    err.textContent = "";
    try {
      const username = document.getElementById("u").value.trim();
      const password = document.getElementById("p").value;
      await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
      await boot();
    } catch (x) {
      err.textContent = x.message;
    }
  };
}

// ------------------------------------------------------------------ search
function dlStatus(d, inLib) {
  if (d) {
    const cls = d.status === "done" ? "ok" : d.status === "failed" ? "bad" : "busy";
    const label = { queued: "In Warteschlange", downloading: "Lädt…", importing: "Importiert…", done: "Geladen", failed: "Fehlgeschlagen" }[d.status] || d.status;
    return `<span class="status ${cls}" title="${esc(d.message || "")}">${label}</span>`;
  }
  return inLib ? `<span class="status ok">In Bibliothek</span>` : "";
}

function viewSearch() {
  const v = renderShell("search");
  v.innerHTML = `
    <h1 class="page">Suche</h1>
    <p class="sub">Deine Bibliothek und Spotify zusammen. Fehlt etwas, lade es mit einem Klick herunter.</p>
    <div class="searchbox"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" placeholder="Künstler, Song oder Album…" autofocus autocomplete="off"></div>
    <div id="spnote"></div>
    <div id="results"></div>
    <div class="section-title">Downloads</div>
    <div class="card"><div class="rows" id="dls"><div class="empty">Noch keine Downloads.</div></div></div>`;
  if (!state.me.spotify) {
    document.getElementById("spnote").innerHTML = `<div class="notice" style="margin-top:14px">Spotify-Suche ist noch nicht eingerichtet: In SpotBye fehlen Client ID und Secret (Einstellungen → Spotify). Die Suche in deiner Bibliothek funktioniert trotzdem.</div>`;
  }
  const q = document.getElementById("q");
  let t;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => runSearch(q.value), 350);
  };
  const initial = new URLSearchParams(location.hash.split("?")[1] || "").get("q");
  if (initial) {
    q.value = initial;
    runSearch(initial);
  }
  refreshDownloads();
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refreshDownloads, 3000);
}

async function runSearch(text) {
  const seq = ++state.searchSeq;
  const box = document.getElementById("results");
  if (text.trim().length < 2) {
    box.innerHTML = "";
    return;
  }
  history.replaceState(null, "", `#/search?q=${encodeURIComponent(text)}`);
  box.innerHTML = `<div class="empty">Suche…</div>`;
  let data;
  try {
    data = await api(`/api/search?q=${encodeURIComponent(text)}`);
  } catch (e) {
    box.innerHTML = `<div class="empty">Fehler: ${esc(e.message)}</div>`;
    return;
  }
  if (seq !== state.searchSeq) return;
  const lib = data.library || {};
  const sp = data.spotify || {};
  const libSongs = (lib.song || []).slice(0, 12);
  const libAlbums = (lib.album || []).slice(0, 8);
  const spTracks = sp.tracks || [];
  const spAlbums = sp.albums || [];
  box.innerHTML = `
    <div class="grid2" style="margin-top:22px">
      <div>
        <div class="section-title">In deiner Bibliothek</div>
        <div class="card"><div class="rows">${
          libSongs.length
            ? libSongs.map((s) => `
              <div class="row">${img(coverUrl(s.albumId || s.coverArt, 120))}
                <div style="min-width:0"><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)} · ${esc(s.album)}</div></div>
                <div class="meta"><span class="min">${mmss(s.duration)}</span></div></div>`).join("")
            : `<div class="empty">Nichts gefunden.</div>`
        }</div></div>
        ${libAlbums.length ? `<div class="section-title">Alben</div><div class="tiles">${libAlbums.map((a) => `
          <div class="tile">${img(coverUrl(a.id, 300), "")}<div><div class="t">${esc(a.name)}</div><div class="a">${esc(a.artist)}${a.year ? " · " + a.year : ""}</div></div></div>`).join("")}</div>` : ""}
      </div>
      <div>
        <div class="section-title">Von Spotify</div>
        <div class="card"><div class="rows">${
          data.spotify_error
            ? `<div class="empty">${esc(data.spotify_error)}</div>`
            : spTracks.length
              ? spTracks.map((t) => `
                <div class="row">${img(t.images)}
                  <div style="min-width:0"><div class="t">${esc(t.name)}${t.explicit ? ' <span class="status">E</span>' : ""}</div><div class="a">${esc(t.artists)} · ${esc(t.album_name)}</div></div>
                  <div class="meta">${dlStatus(t.download, t.in_library)}${!t.download ? `<button class="btn small ${t.in_library ? "ghost" : ""}" data-dl="track" data-id="${esc(t.spotify_id)}" data-title="${esc(t.name)}" data-artist="${esc(t.artists)}" data-image="${esc(t.images || "")}">Laden</button>` : ""}</div>
                </div>`).join("")
              : `<div class="empty">Keine Treffer.</div>`
        }</div></div>
        ${spAlbums.length ? `<div class="section-title">Spotify-Alben</div><div class="tiles">${spAlbums.slice(0, 8).map((a) => `
          <div class="tile">${img(a.images, "")}
            <div><div class="t">${esc(a.name)}</div><div class="a">${esc(a.artists)} · ${esc((a.release_date || "").slice(0, 4))} · ${a.total_tracks} Songs</div></div>
            <div class="meta" style="display:flex;gap:6px;align-items:center">${dlStatus(a.download, a.in_library)}${!a.download ? `<button class="btn small ${a.in_library ? "ghost" : ""}" data-dl="album" data-id="${esc(a.id)}" data-title="${esc(a.name)}" data-artist="${esc(a.artists)}" data-image="${esc(a.images || "")}">Album laden</button>` : ""}</div>
          </div>`).join("")}</div>` : ""}
      </div>
    </div>`;
  box.querySelectorAll("[data-dl]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = "…";
      try {
        const d = await api("/api/downloads", {
          method: "POST",
          body: JSON.stringify({ kind: b.dataset.dl, spotify_id: b.dataset.id, title: b.dataset.title, artist: b.dataset.artist, image: b.dataset.image }),
        });
        b.outerHTML = dlStatus(d, false);
        refreshDownloads();
      } catch (e) {
        b.disabled = false;
        b.textContent = "Erneut";
        alert(e.message);
      }
    };
  });
}

async function refreshDownloads() {
  const el = document.getElementById("dls");
  if (!el) return clearInterval(state.pollTimer);
  let rows;
  try {
    rows = await api("/api/downloads");
  } catch {
    return;
  }
  if (!rows.length) return;
  el.innerHTML = rows.slice(0, 25).map((d) => `
    <div class="row">${img(d.image)}
      <div style="min-width:0"><div class="t">${esc(d.title || d.spotify_id)}</div>
        <div class="a">${esc(d.artist || "")}${d.message ? " · " + esc(d.message) : ""}</div></div>
      <div class="meta">${dlStatus(d)}${d.status === "failed" ? `<button class="btn small ghost" data-retry="${d.id}">Nochmal</button>` : ""}</div>
    </div>`).join("");
  el.querySelectorAll("[data-retry]").forEach((b) => (b.onclick = async () => {
    await api(`/api/downloads/${b.dataset.retry}/retry`, { method: "POST" });
    refreshDownloads();
  }));
}

// ------------------------------------------------------------------ stats
const PERIODS = [["week", "7 Tage"], ["month", "30 Tage"], ["quarter", "90 Tage"], ["year", "Dieses Jahr"], ["all", "Gesamt"]];
const SOURCES = [["all", "Alle"], ["navidrome", "Navidrome"], ["plex", "Plex"]];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function barChart(values, labels, { height = 160, every = 1 } = {}) {
  const max = Math.max(1, ...values);
  const w = 1000, gap = values.length > 60 ? 1 : 4, bw = (w - gap * (values.length - 1)) / values.length;
  const bars = values.map((v, i) => {
    const h = Math.max(v ? 2 : 0, (v / max) * (height - 22));
    return `<rect x="${i * (bw + gap)}" y="${height - 18 - h}" width="${bw}" height="${h}" rx="${Math.min(4, bw / 2)}"><title>${esc(labels[i])}: ${fmt(v)} min</title></rect>`;
  }).join("");
  const axis = labels.map((l, i) => (i % every === 0 ? `<text class="axis" x="${i * (bw + gap) + bw / 2}" y="${height - 4}" text-anchor="middle">${esc(l)}</text>` : "")).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" style="height:${height}px">${bars}${axis}</svg>`;
}

function hbars(items, key = "name", val = "plays") {
  if (!items.length) return `<div class="empty">Keine Daten.</div>`;
  const max = Math.max(...items.map((i) => i[val]));
  return `<div class="bars">${items.map((i) => `
    <div class="bar"><div class="lbl">${esc(i[key] || "–")}</div><div class="track"><div class="fill" style="width:${(i[val] / max) * 100}%"></div></div><div class="num">${fmt(i[val])}</div></div>`).join("")}</div>`;
}

function rankList(items, kind) {
  if (!items.length) return `<div class="empty">Keine Daten.</div>`;
  return `<div class="rows">${items.map((it, i) => {
    const cov = kind === "artist" ? coverUrl(it.artist_id ? "ar-" + it.artist_id : "", 120) : coverUrl(it.album_id, 120);
    return `<div class="row rank"><div class="n">${i + 1}</div>${img(cov)}
      <div style="min-width:0"><div class="t">${esc(it.name || "–")}</div>${it.artist ? `<div class="a">${esc(it.artist)}</div>` : ""}</div>
      <div class="min">${fmt(it.plays)}×</div></div>`;
  }).join("")}</div>`;
}

async function viewStats() {
  const v = renderShell("stats");
  const sel = { period: localStorage.getItem("mh.period") || "month", source: localStorage.getItem("mh.source") || "all" };
  v.innerHTML = `
    <h1 class="page">Statistik</h1>
    <p class="sub">Navidrome und Plex zusammengerechnet.</p>
    <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:space-between">
      <div class="chips" id="pchips">${PERIODS.map(([k, l]) => `<button class="chip" data-p="${k}">${l}</button>`).join("")}</div>
      <div class="chips" id="schips">${SOURCES.map(([k, l]) => `<button class="chip" data-s="${k}">${l}</button>`).join("")}</div>
    </div>
    <div id="sbody"><div class="empty">Lade…</div></div>`;
  const paint = () => {
    v.querySelectorAll("[data-p]").forEach((b) => b.classList.toggle("on", b.dataset.p === sel.period));
    v.querySelectorAll("[data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === sel.source));
  };
  v.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { sel.period = b.dataset.p; localStorage.setItem("mh.period", sel.period); paint(); load(); }));
  v.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { sel.source = b.dataset.s; localStorage.setItem("mh.source", sel.source); paint(); load(); }));
  paint();

  async function load() {
    const body = document.getElementById("sbody");
    const [s, recent, sync] = await Promise.all([
      api(`/api/stats?period=${sel.period}&source=${sel.source}`),
      api("/api/recent"),
      api("/api/sync-status"),
    ]);
    const nd = s.by_source.navidrome?.secs || 0, px = s.by_source.plex?.secs || 0, tot = nd + px || 1;
    const daily = s.daily.slice(-90);
    body.innerHTML = `
      <div class="kpis" style="margin-top:20px">
        <div class="card kpi"><div class="v">${fmt(s.minutes)}</div><div class="l">Minuten gehört</div></div>
        <div class="card kpi"><div class="v">${fmt(s.plays)}</div><div class="l">Wiedergaben</div></div>
        <div class="card kpi"><div class="v">${fmt(s.songs)}</div><div class="l">verschiedene Songs</div></div>
        <div class="card kpi"><div class="v">${fmt(s.artists)}</div><div class="l">Künstler</div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><b>Quelle</b><span class="min" style="color:var(--muted);font-size:13px">${fmt(Math.round(tot / 60))} min</span></div>
        <div class="splitbar"><span style="width:${(nd / tot) * 100}%;background:var(--nd)"></span><span style="width:${(px / tot) * 100}%;background:var(--plex)"></span></div>
        <div class="legend"><span><span class="src-dot navidrome"></span> Navidrome <b>${Math.round((nd / tot) * 100)}%</b></span><span><span class="src-dot plex"></span> Plex <b>${Math.round((px / tot) * 100)}%</b></span></div>
      </div>
      <div class="section-title">Minuten pro Tag</div>
      <div class="card">${daily.length ? barChart(daily.map((d) => d.minutes), daily.map((d) => d.day.slice(5)), { every: Math.ceil(daily.length / 12) }) : `<div class="empty">Keine Daten.</div>`}</div>
      <div class="grid2">
        <div><div class="section-title">Tageszeit</div><div class="card">${barChart(s.hours, s.hours.map((_, i) => String(i)), { height: 140, every: 3 })}</div></div>
        <div><div class="section-title">Wochentag</div><div class="card">${barChart(s.weekdays, WEEKDAYS, { height: 140 })}</div></div>
      </div>
      <div class="grid3">
        <div><div class="section-title">Top-Künstler</div><div class="card">${rankList(s.top_artists, "artist")}</div></div>
        <div><div class="section-title">Top-Songs</div><div class="card">${rankList(s.top_tracks, "track")}</div></div>
        <div><div class="section-title">Top-Alben</div><div class="card">${rankList(s.top_albums, "album")}</div></div>
      </div>
      <div class="grid2">
        <div><div class="section-title">Genres</div><div class="card">${hbars(s.top_genres.filter((g) => g.name))}</div></div>
        <div><div class="section-title">Zuletzt gehört</div><div class="card"><div class="rows">${recent.slice(0, 10).map((r) => `
          <div class="row">${img(coverUrl(r.album_id, 120))}<div style="min-width:0"><div class="t">${esc(r.title)}</div><div class="a"><span class="src-dot ${r.source}"></span> ${esc(r.artist)}</div></div>
          <div class="min">${new Date(r.ts * 1000).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div></div>`).join("") || `<div class="empty">Noch nichts.</div>`}</div></div></div>
      </div>
      <p class="sub" style="margin-top:22px;font-size:12.5px">Synchronisiert: ${fmt(sync.plays.navidrome || 0)} Navidrome- und ${fmt(sync.plays.plex || 0)} Plex-Wiedergaben.
        ${sync.tracks.todo ? `Ordne noch ${fmt(sync.tracks.todo)} Songs deiner Bibliothek zu (Cover, Genres)…` : ""}</p>`;
  }
  load().catch((e) => (document.getElementById("sbody").innerHTML = `<div class="empty">Fehler: ${esc(e.message)}</div>`));
}

// ------------------------------------------------------------------ rewind launcher
async function viewRewind() {
  const v = renderShell("rewind");
  const years = await api("/api/years");
  const now = new Date().getFullYear();
  const list = years.length ? years : [now];
  v.innerHTML = `
    <h1 class="page">Rewind</h1>
    <p class="sub">Dein Musikjahr als Story, aus Navidrome und Plex.</p>
    <div class="rw-hero">
      <div class="orb" style="width:340px;height:340px;right:-80px;top:-120px;background:#ffd166"></div>
      <div class="orb" style="width:220px;height:220px;right:160px;bottom:-110px;background:#3a86ff"></div>
      <h2 id="rwh">Rewind<br>${list[0]}</h2>
      <p>Deine Top-Künstler, Songs, Genres und wie du dieses Jahr gehört hast.</p>
      <div class="chips" id="ych">${list.map((y, i) => `<button class="chip ${i === 0 ? "on" : ""}" data-y="${y}" style="color:#fff;border-color:rgba(255,255,255,.4)">${y}</button>`).join("")}</div>
      <button class="btn" id="go">Abspielen ▶</button>
    </div>`;
  let year = list[0];
  v.querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => {
    year = +b.dataset.y;
    v.querySelectorAll("[data-y]").forEach((x) => x.classList.toggle("on", x === b));
    document.getElementById("rwh").innerHTML = `Rewind<br>${year}`;
  }));
  document.getElementById("go").onclick = async () => {
    const data = await api(`/api/rewind?year=${year}`);
    if (data.empty) return alert(`Für ${year} gibt es noch keine Wiedergaben.`);
    startRewind(data, state.me.user);
  };
}

// ------------------------------------------------------------------ router
function route() {
  if (!state.me) return;
  const page = (location.hash.replace(/^#\//, "").split("?")[0] || "search");
  clearInterval(state.pollTimer);
  ({ search: viewSearch, stats: viewStats, rewind: viewRewind }[page] || viewSearch)();
}

async function boot() {
  try {
    state.me = await api("/api/me");
  } catch {
    return renderLogin();
  }
  document.title = state.me.name;
  route();
}

window.addEventListener("hashchange", route);
boot();
