// Rewind: a full-screen, tap-through story of a listening year.
import { esc, fmt, coverUrl } from "/assets/app.js";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const DUR = 7500;

const css = `
.rw { position: fixed; inset: 0; z-index: 100; background: #08070b; color: #fff; display: grid; place-items: center; overflow: hidden;
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
.rw-stage { position: relative; width: min(100vw, calc(100dvh * 9 / 16)); height: min(100dvh, calc(100vw * 16 / 9)); overflow: hidden; border-radius: 0; }
@media (max-width: 699px) { .rw-stage { width: 100vw; height: 100dvh; } }
@media (min-width: 700px) { .rw-stage { border-radius: 22px; height: min(94dvh, 860px); width: calc(min(94dvh, 860px) * 9 / 16); } }
.rw-bars { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; gap: 4px; z-index: 5; }
.rw-bars i { flex: 1; height: 3px; border-radius: 3px; background: rgba(255,255,255,.28); overflow: hidden; }
.rw-bars i b { display: block; height: 100%; width: 0; background: #fff; }
.rw-close { position: absolute; top: 24px; right: 14px; z-index: 6; background: rgba(0,0,0,.25); border: 0; color: #fff; width: 34px; height: 34px; border-radius: 50%; font-size: 18px; cursor: pointer; }
.rw-tag { position: absolute; top: 28px; left: 18px; z-index: 6; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; opacity: .8; }
.rw-zone { position: absolute; top: 0; bottom: 0; z-index: 4; }
.rw-zone.l { left: 0; width: 32%; } .rw-zone.r { right: 0; width: 68%; }
.rw-slide { position: absolute; inset: 0; padding: 78px 26px 34px; display: flex; flex-direction: column; justify-content: center; gap: 14px; }
.rw-slide > * { min-width: 0; max-width: 100%; }
.rw-slide h1, .rw-slide h2 { overflow-wrap: break-word; }
.rw-slide h1 { font-size: clamp(34px, 9.5cqw, 64px); line-height: .95; letter-spacing: -.045em; margin: 0; font-weight: 900; }
.rw-slide h2 { font-size: clamp(22px, 6cqw, 34px); line-height: 1.02; letter-spacing: -.03em; margin: 0; font-weight: 850; }
.rw-slide p { margin: 0; font-size: 17px; line-height: 1.35; opacity: .9; max-width: 30ch; }
.rw-stage { container-type: inline-size; }
.rw-big { font-size: clamp(64px, 24cqw, 150px); font-weight: 950; letter-spacing: -.06em; line-height: .85; font-variant-numeric: tabular-nums; }
.rw-kicker { font-size: 13px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; opacity: .85; }
.rw-shape { position: absolute; border-radius: 50%; pointer-events: none; mix-blend-mode: screen; }
.rw-list { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.rw-li { display: grid; grid-template-columns: 34px 54px minmax(0, 1fr); gap: 12px; align-items: center; opacity: 0; transform: translateY(14px); animation: rwUp .5s forwards; }
.rw-li .n { font-size: 26px; font-weight: 950; letter-spacing: -.04em; }
.rw-li img, .rw-li .ph { width: 54px; height: 54px; border-radius: 10px; object-fit: cover; background: rgba(255,255,255,.18); }
.rw-li .t { font-weight: 800; font-size: 16.5px; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-li .s { font-size: 13px; opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-hero-img { width: 68%; aspect-ratio: 1; object-fit: cover; border-radius: 20px; box-shadow: 0 30px 60px rgba(0,0,0,.4); align-self: center; animation: rwPop .8s cubic-bezier(.2,1.4,.4,1) both; }
.rw-hero-img.round { border-radius: 50%; }
.rw-in { animation: rwUp .6s cubic-bezier(.2,.9,.3,1) both; }
.rw-d1 { animation-delay: .15s } .rw-d2 { animation-delay: .35s } .rw-d3 { animation-delay: .6s } .rw-d4 { animation-delay: .9s }
.rw-clock { width: 78%; align-self: center; }
.rw-months { display: flex; align-items: flex-end; gap: 4px; height: 150px; width: 100%; }
.rw-months div { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; justify-content: flex-end; }
.rw-months b { width: 100%; border-radius: 6px 6px 3px 3px; background: currentColor; transform-origin: bottom; animation: rwGrow .9s cubic-bezier(.2,.9,.3,1) both; }
.rw-months span { font-size: 10px; font-weight: 700; opacity: .8; }
.rw-split { display: flex; height: 64px; border-radius: 16px; overflow: hidden; }
.rw-split div { display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 20px; transform-origin: left; animation: rwGrowX 1s cubic-bezier(.2,.9,.3,1) both; }
.rw-card { background: rgba(255,255,255,.1); border-radius: 18px; padding: 14px 16px; backdrop-filter: blur(6px); }
.rw-summary { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px 16px; }
.rw-summary h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .75; }
.rw-summary ol { margin: 0; padding-left: 18px; font-weight: 750; font-size: 14px; line-height: 1.35; }
.rw-summary li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-summary .num { font-size: 30px; font-weight: 950; letter-spacing: -.04em; }
@keyframes rwUp { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: none } }
@keyframes rwPop { from { opacity: 0; transform: scale(.7) rotate(-6deg) } to { opacity: 1; transform: none } }
@keyframes rwGrow { from { transform: scaleY(0) } }
@keyframes rwGrowX { from { transform: scaleX(0) } }
@keyframes rwFloat { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(14px,-22px) scale(1.08) } }
@keyframes rwSpin { to { transform: rotate(360deg) } }
@media (prefers-reduced-motion: reduce) { .rw * { animation-duration: .01s !important; animation-delay: 0s !important; } }
`;

const THEMES = [
  { bg: "linear-gradient(160deg,#ff5e3a 0%,#ff2a68 55%,#6a0dad 100%)", a: "#ffd166", b: "#3a86ff" },
  { bg: "linear-gradient(200deg,#0b3d2e 0%,#0f766e 50%,#a3e635 130%)", a: "#bef264", b: "#22d3ee" },
  { bg: "linear-gradient(170deg,#1e1b4b 0%,#4338ca 55%,#f472b6 120%)", a: "#f9a8d4", b: "#818cf8" },
  { bg: "linear-gradient(150deg,#f59e0b 0%,#ef4444 60%,#7f1d1d 110%)", a: "#fde68a", b: "#fb7185" },
  { bg: "linear-gradient(190deg,#020617 0%,#1e3a8a 60%,#38bdf8 130%)", a: "#7dd3fc", b: "#c084fc" },
  { bg: "linear-gradient(160deg,#3b0764 0%,#9d174d 60%,#fb923c 120%)", a: "#fdba74", b: "#f0abfc" },
  { bg: "linear-gradient(170deg,#052e16 0%,#15803d 55%,#fde047 130%)", a: "#fef08a", b: "#86efac" },
];

function shapes(th, seed) {
  const r = (n) => ((Math.sin(seed * 999 + n * 77) + 1) / 2);
  return `
    <div class="rw-shape" style="width:${60 + r(1) * 40}%;aspect-ratio:1;left:${-20 + r(2) * 40}%;top:${-15 + r(3) * 20}%;background:radial-gradient(circle,${th.a}aa,transparent 65%);animation:rwFloat ${9 + r(4) * 5}s ease-in-out infinite"></div>
    <div class="rw-shape" style="width:${50 + r(5) * 40}%;aspect-ratio:1;right:${-25 + r(6) * 20}%;bottom:${-20 + r(7) * 25}%;background:radial-gradient(circle,${th.b}99,transparent 65%);animation:rwFloat ${11 + r(8) * 6}s ease-in-out infinite reverse"></div>`;
}

const pic = (src, cls = "") => (src ? `<img class="${cls}" src="${esc(src)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph ${cls}'}))">` : `<div class="ph ${cls}"></div>`);
const artistPic = (a, size = 120) => coverUrl(a?.artist_id ? "ar-" + a.artist_id : "", size);
const dateDE = (ts) => new Date(ts * 1000).toLocaleDateString("de-DE", { day: "numeric", month: "long" });
const dayDE = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

function clockSvg(hours, color) {
  const max = Math.max(1, ...hours), cx = 120, cy = 120;
  const bars = hours.map((v, h) => {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2, r0 = 46, r1 = r0 + (v / max) * 66;
    return `<line x1="${cx + Math.cos(a) * r0}" y1="${cy + Math.sin(a) * r0}" x2="${cx + Math.cos(a) * r1}" y2="${cy + Math.sin(a) * r1}" stroke="${color}" stroke-width="7" stroke-linecap="round"/>`;
  }).join("");
  const labels = [0, 6, 12, 18].map((h) => {
    const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
    return `<text x="${cx + Math.cos(a) * 30}" y="${cy + Math.sin(a) * 30 + 4}" text-anchor="middle" fill="#fff" font-size="11" font-weight="800" opacity=".8">${h}</text>`;
  }).join("");
  return `<svg class="rw-clock rw-in rw-d2" viewBox="0 0 240 240"><circle cx="120" cy="120" r="44" fill="rgba(255,255,255,.12)"/>${bars}${labels}</svg>`;
}

function buildSlides(d, user) {
  const S = [];
  const A = d.top_artists || [], T = d.top_tracks || [], G = d.top_genres || [];
  const topA = A[0], topT = T[0];
  const days = Math.round(d.minutes / 1440);

  S.push(() => `
    <div class="rw-kicker rw-in">${esc(user)}</div>
    <h1 class="rw-in rw-d1">Dein ${d.year},<br>zurückgespult.</h1>
    <p class="rw-in rw-d2">${fmt(d.plays)} Wiedergaben. ${fmt(d.artists)} Künstler. Eine Menge Gefühle. Tippe, um weiterzugehen.</p>`);

  S.push(() => `
    <div class="rw-kicker rw-in">Deine Hörzeit</div>
    <div class="rw-big rw-in rw-d1" data-count="${d.minutes}">0</div>
    <h2 class="rw-in rw-d2">Minuten Musik</h2>
    <p class="rw-in rw-d3">${days >= 1 ? `Das sind ${fmt(days)} volle Tage am Stück.` : `Das sind ${fmt(Math.round(d.minutes / 60))} Stunden.`} An ${fmt(d.days_listened)} Tagen hast du Musik gehört${d.streak > 2 ? `, ${d.streak} Tage davon in Folge` : ""}.</p>`);

  if (G.length) S.push(() => `
    <div class="rw-kicker rw-in">Dein Sound</div>
    <h1 class="rw-in rw-d1">${esc(G[0].name)}</h1>
    <p class="rw-in rw-d2">war dein Genre des Jahres.</p>
    <div class="rw-list">${G.slice(1, 5).map((g, i) => `<div class="rw-li" style="grid-template-columns:34px minmax(0,1fr);animation-delay:${0.6 + i * 0.12}s"><div class="n">${i + 2}</div><div><div class="t">${esc(g.name)}</div><div class="s">${fmt(g.plays)} Wiedergaben</div></div></div>`).join("")}</div>`);

  if (topA) S.push(() => `
    <div class="rw-kicker rw-in">Dein Künstler Nr. 1</div>
    ${pic(artistPic(topA, 600), "rw-hero-img round")}
    <h1 class="rw-in rw-d2" style="text-align:center">${esc(topA.name)}</h1>
    <p class="rw-in rw-d3" style="text-align:center;align-self:center">${fmt(topA.plays)} Wiedergaben, ${fmt(Math.round(topA.secs / 60))} Minuten zusammen.</p>`);

  if (A.length > 1) S.push(() => `
    <div class="rw-kicker rw-in">Deine Top-Künstler</div>
    <h2 class="rw-in rw-d1">Die üblichen Verdächtigen</h2>
    <div class="rw-list">${A.map((a, i) => `<div class="rw-li" style="animation-delay:${0.3 + i * 0.14}s"><div class="n">${i + 1}</div>${pic(artistPic(a), "")}<div style="min-width:0"><div class="t">${esc(a.name)}</div><div class="s">${fmt(a.plays)} Wiedergaben</div></div></div>`).join("")}</div>`);

  if (topT) S.push(() => `
    <div class="rw-kicker rw-in">Dein Song des Jahres</div>
    ${pic(coverUrl(topT.album_id, 600), "rw-hero-img")}
    <h2 class="rw-in rw-d2">${esc(topT.name)}</h2>
    <p class="rw-in rw-d3">${esc(topT.artist)} · ${fmt(topT.plays)}× gehört${d.top_track_first_ts ? `, zum ersten Mal am ${dateDE(d.top_track_first_ts)}` : ""}.</p>`);

  if (T.length > 1) S.push(() => `
    <div class="rw-kicker rw-in">Deine Top-Songs</div>
    <h2 class="rw-in rw-d1">Auf Dauerschleife</h2>
    <div class="rw-list">${T.map((t, i) => `<div class="rw-li" style="animation-delay:${0.3 + i * 0.14}s"><div class="n">${i + 1}</div>${pic(coverUrl(t.album_id, 120), "")}<div style="min-width:0"><div class="t">${esc(t.name)}</div><div class="s">${esc(t.artist)} · ${fmt(t.plays)}×</div></div></div>`).join("")}</div>`);

  S.push((th) => `
    <div class="rw-kicker rw-in">Dein Hörtyp</div>
    <h1 class="rw-in rw-d1">${esc(d.persona.name)}</h1>
    ${clockSvg(d.hours, th.a)}
    <p class="rw-in rw-d3">${esc(d.persona.blurb)} Am meisten hörst du gegen ${d.persona.peak_hour} Uhr.</p>`);

  const maxM = Math.max(1, ...d.months);
  const bestM = d.months.indexOf(Math.max(...d.months));
  S.push((th) => `
    <div class="rw-kicker rw-in">Dein Jahr in Monaten</div>
    <h2 class="rw-in rw-d1">Im ${MONTHS[bestM]} warst du kaum zu stoppen.</h2>
    <div class="rw-months rw-in rw-d2" style="color:${th.a}">${d.months.map((m, i) => `<div><b style="height:${Math.max(2, (m / maxM) * 100)}%;animation-delay:${0.3 + i * 0.05}s"></b><span>${MONTHS[i].slice(0, 1)}</span></div>`).join("")}</div>
    ${d.busiest_day ? `<p class="rw-in rw-d3">Dein Rekordtag: ${dayDE(d.busiest_day.day)} mit ${fmt(d.busiest_day.minutes)} Minuten.</p>` : ""}`);

  if ((d.new_artists || []).length) S.push(() => `
    <div class="rw-kicker rw-in">Neu entdeckt</div>
    <h2 class="rw-in rw-d1">${d.new_artists.length > 1 ? "Diese Künstler hast du dieses Jahr kennengelernt" : "Neu in deinem Leben"}</h2>
    <div class="rw-list">${d.new_artists.map((a, i) => `<div class="rw-li" style="grid-template-columns:34px minmax(0,1fr);animation-delay:${0.4 + i * 0.14}s"><div class="n">✦</div><div><div class="t">${esc(a.name)}</div><div class="s">${fmt(a.plays)} Wiedergaben</div></div></div>`).join("")}</div>`);

  const nd = d.by_source.navidrome?.secs || 0, px = d.by_source.plex?.secs || 0, tot = nd + px;
  if (nd && px) S.push(() => `
    <div class="rw-kicker rw-in">Zwei Server, eine Sammlung</div>
    <h2 class="rw-in rw-d1">So hast du gehört</h2>
    <div class="rw-split rw-in rw-d2"><div style="width:${(nd / tot) * 100}%;background:#6fa8ff;color:#06142e">${Math.round((nd / tot) * 100)}%</div><div style="width:${(px / tot) * 100}%;background:#f5b83d;color:#2b1a00;animation-delay:.3s">${Math.round((px / tot) * 100)}%</div></div>
    <p class="rw-in rw-d3">Navidrome: ${fmt(Math.round(nd / 60))} Minuten. Plex: ${fmt(Math.round(px / 60))} Minuten.</p>`);

  S.push(() => `
    <div class="rw-kicker rw-in">Rewind ${d.year} · ${esc(user)}</div>
    <div class="rw-card rw-in rw-d1"><div class="rw-summary">
      <div><h3>Top-Künstler</h3><ol>${A.slice(0, 5).map((a) => `<li>${esc(a.name)}</li>`).join("")}</ol></div>
      <div><h3>Top-Songs</h3><ol>${T.slice(0, 5).map((t) => `<li>${esc(t.name)}</li>`).join("")}</ol></div>
      <div><h3>Minuten</h3><div class="num">${fmt(d.minutes)}</div></div>
      <div><h3>Genre</h3><div class="num" style="font-size:22px">${esc(G[0]?.name || "–")}</div></div>
    </div></div>
    <p class="rw-in rw-d2">Danke fürs Zuhören. Bis nächstes Jahr.</p>`);
  return S;
}

export function startRewind(data, user) {
  if (!document.getElementById("rw-css")) {
    const st = document.createElement("style");
    st.id = "rw-css";
    st.textContent = css;
    document.head.appendChild(st);
  }
  const slides = buildSlides(data, user);
  const root = document.createElement("div");
  root.className = "rw";
  root.innerHTML = `<div class="rw-stage">
      <div class="rw-bars">${slides.map(() => "<i><b></b></i>").join("")}</div>
      <div class="rw-tag">Rewind ${data.year}</div>
      <button class="rw-close" aria-label="Schließen">✕</button>
      <div class="rw-body"></div>
      <div class="rw-zone l"></div><div class="rw-zone r"></div>
    </div>`;
  document.body.appendChild(root);
  const stage = root.querySelector(".rw-stage");
  const body = root.querySelector(".rw-body");
  const bars = [...root.querySelectorAll(".rw-bars b")];
  let i = 0, t0 = 0, raf = 0, paused = false, pausedAt = 0;

  function countUp(el) {
    const target = +el.dataset.count, start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / 1600);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function show(n) {
    if (n < 0) n = 0;
    if (n >= slides.length) return close();
    i = n;
    const th = THEMES[i % THEMES.length];
    stage.style.background = th.bg;
    body.innerHTML = `${shapes(th, i + 1)}<div class="rw-slide">${slides[i](th)}</div>`;
    body.querySelectorAll("[data-count]").forEach(countUp);
    bars.forEach((b, k) => (b.style.width = k < i ? "100%" : "0"));
    t0 = performance.now();
  }

  function tick(now) {
    if (!paused) {
      const k = (now - t0) / DUR;
      bars[i].style.width = `${Math.min(1, k) * 100}%`;
      if (k >= 1) show(i + 1);
    }
    raf = requestAnimationFrame(tick);
  }

  function close() {
    cancelAnimationFrame(raf);
    document.removeEventListener("keydown", onKey);
    root.remove();
  }
  function onKey(e) {
    if (e.key === "ArrowRight" || e.key === " ") show(i + 1);
    else if (e.key === "ArrowLeft") show(i - 1);
    else if (e.key === "Escape") close();
  }
  const hold = (on) => {
    if (on) { paused = true; pausedAt = performance.now(); }
    else if (paused) { paused = false; t0 += performance.now() - pausedAt; }
  };
  root.querySelector(".rw-zone.l").onclick = () => show(i - 1);
  root.querySelector(".rw-zone.r").onclick = () => show(i + 1);
  root.querySelector(".rw-close").onclick = close;
  stage.addEventListener("pointerdown", () => hold(true));
  stage.addEventListener("pointerup", () => hold(false));
  stage.addEventListener("pointerleave", () => hold(false));
  document.addEventListener("keydown", onKey);
  show(0);
  raf = requestAnimationFrame(tick);
}
