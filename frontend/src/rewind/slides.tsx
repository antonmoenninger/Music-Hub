// Rewind slides. All sizes use container-query units (cqmin / cqw / cqh), so one slide renders
// full screen in portrait, in landscape, and into fixed-size share images.
import { animate, motion, useMotionValue, useTransform } from "motion/react"
import { useEffect, type CSSProperties, type ReactNode } from "react"

import type { Rewind } from "@/lib/api"
import { dateDE, dayDE, fmt, MONTHS, MONTHS_SHORT } from "@/lib/format"

import type { Theme } from "./themes"

export interface SlideCtx {
  d: Rewind
  user: string
  landscape: boolean
  still: boolean // share images: no motion, final state
  theme: Theme
  cover: (id?: string | null, size?: number) => string
}

export interface SlideDef {
  id: string
  song?: string // soundtrack key
  visual?: (c: SlideCtx) => ReactNode
  text: (c: SlideCtx) => ReactNode
  /** landscape: put the visual first (left) */
  visualFirst?: boolean
}

const EASE = [0.2, 0.9, 0.25, 1] as const

// ------------------------------------------------------------------ building blocks
export function Rise({ c, delay = 0, children, className, style }: { c: SlideCtx; delay?: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  if (c.still) return <div className={className} style={style}>{children}</div>
  return (
    <motion.div className={className} style={style}
      initial={{ opacity: 0, y: "5cqmin", filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.8, delay, ease: EASE }}>
      {children}
    </motion.div>
  )
}

function Count({ to, c, className }: { to: number; c: SlideCtx; className?: string }) {
  const v = useMotionValue(c.still ? to : 0)
  const text = useTransform(v, (x) => fmt(Math.round(x)))
  useEffect(() => {
    if (c.still) return
    const a = animate(v, to, { duration: 2.2, ease: [0.16, 1, 0.3, 1], delay: 0.3 })
    return () => a.stop()
  }, [to, c.still, v])
  return <motion.span className={className}>{text}</motion.span>
}

const Kicker = ({ c, children, delay = 0 }: { c: SlideCtx; children: ReactNode; delay?: number }) => (
  <Rise c={c} delay={delay} className="text-[2.7cqmin] font-extrabold uppercase tracking-[0.18em] opacity-85">{children}</Rise>
)
const H1 = ({ c, children, delay = 0.12 }: { c: SlideCtx; children: ReactNode; delay?: number }) => (
  <Rise c={c} delay={delay}><h1 lang="de" className="font-display text-[10.5cqmin] font-extrabold leading-[0.95] tracking-[-0.045em] [overflow-wrap:break-word] [hyphens:auto] [text-wrap:balance]">{children}</h1></Rise>
)
const H2 = ({ c, children, delay = 0.12 }: { c: SlideCtx; children: ReactNode; delay?: number }) => (
  <Rise c={c} delay={delay}><h2 lang="de" className="font-display text-[6.6cqmin] font-extrabold leading-[1.02] tracking-[-0.035em] [overflow-wrap:break-word] [text-wrap:balance]">{children}</h2></Rise>
)
const P = ({ c, children, delay = 0.35 }: { c: SlideCtx; children: ReactNode; delay?: number }) => (
  <Rise c={c} delay={delay}><p className="max-w-[34ch] text-[3.5cqmin] leading-snug opacity-90">{children}</p></Rise>
)

function Img({ src, round, className, style }: { src: string; round?: boolean; className?: string; style?: CSSProperties }) {
  return src ? (
    <img src={src} alt="" className={`object-cover ${round ? "rounded-full" : "rounded-[2.4cqmin]"} ${className || ""}`} style={style}
      onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0")} />
  ) : (
    <div className={`bg-white/15 ${round ? "rounded-full" : "rounded-[2.4cqmin]"} ${className || ""}`} style={style} />
  )
}

function List({ c, items, round }: { c: SlideCtx; items: { title: string; sub: string; img?: string; mark?: string }[]; round?: boolean }) {
  return (
    <div className="flex flex-col gap-[2.2cqmin]">
      {items.map((it, i) => (
        <Rise key={i} c={c} delay={0.35 + i * 0.12} className="grid grid-cols-[6cqmin_minmax(0,1fr)] items-center gap-[2.6cqmin]"
          style={it.img !== undefined ? { gridTemplateColumns: "6cqmin 10cqmin minmax(0,1fr)" } : undefined}>
          <span className="font-display text-[6cqmin] font-black leading-none tracking-tighter">{it.mark ?? i + 1}</span>
          {it.img !== undefined && <Img src={it.img} round={round} className="size-[10cqmin] shadow-lg" />}
          <div className="min-w-0">
            <div className="truncate text-[3.9cqmin] font-bold leading-tight">{it.title}</div>
            <div className="truncate text-[2.8cqmin] opacity-80">{it.sub}</div>
          </div>
        </Rise>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ visuals
function CoverOrbit({ c, ids }: { c: SlideCtx; ids: string[] }) {
  const n = Math.max(ids.length, 1)
  return (
    <div className="relative mx-auto aspect-square w-[78cqmin]">
      <motion.div className="absolute inset-0" animate={c.still ? undefined : { rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: "linear" }}>
        {ids.map((id, i) => {
          const a = (i / n) * Math.PI * 2
          return (
            <motion.div key={id} className="absolute size-[22cqmin]"
              style={{ left: `calc(50% + ${Math.cos(a) * 30}cqmin - 11cqmin)`, top: `calc(50% + ${Math.sin(a) * 30}cqmin - 11cqmin)` }}
              initial={c.still ? false : { scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 + i * 0.1, type: "spring", bounce: 0.4 }}>
              <Img src={c.cover(id, 400)} className="size-full shadow-2xl" />
            </motion.div>
          )
        })}
      </motion.div>
      <motion.div className="absolute left-1/2 top-1/2 grid size-[24cqmin] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/15 backdrop-blur-md"
        initial={c.still ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: "spring" }}>
        <span className="font-display text-[8cqmin] font-black tracking-tighter">{c.d.year}</span>
      </motion.div>
    </div>
  )
}

function Pulse({ c, children }: { c: SlideCtx; children: ReactNode }) {
  return (
    <div className="relative mx-auto grid aspect-square w-[62cqmin] place-items-center">
      {[0, 1, 2].map((i) => (
        <motion.div key={i} className="absolute inset-0 rounded-full border-[0.5cqmin]" style={{ borderColor: c.theme.accent }}
          initial={{ scale: 0.8, opacity: 0.6 }} animate={c.still ? { scale: 1 + i * 0.12, opacity: 0.35 - i * 0.1 } : { scale: [0.8, 1.35], opacity: [0.6, 0] }}
          transition={{ duration: 3, delay: i, repeat: Infinity, ease: "easeOut" }} />
      ))}
      <motion.div className="relative size-[82%]" initial={c.still ? false : { scale: 0.6, rotate: -8, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", bounce: 0.35, duration: 1.1 }}>
        {children}
      </motion.div>
    </div>
  )
}

function Vinyl({ c, src }: { c: SlideCtx; src: string }) {
  return (
    <div className="relative mx-auto aspect-square w-[64cqmin]">
      <motion.div className="absolute inset-y-[4%] right-0 aspect-square rounded-full shadow-2xl"
        style={{ background: "repeating-radial-gradient(circle, #111 0 0.6cqmin, #1d1d1d 0.6cqmin 1.1cqmin)" }}
        initial={c.still ? { x: "26%" } : { x: 0 }} animate={{ x: "26%", rotate: c.still ? 0 : 360 }}
        transition={{ x: { delay: 0.6, duration: 1, ease: EASE }, rotate: { duration: 4, repeat: Infinity, ease: "linear" } }}>
        <div className="absolute inset-[34%] rounded-full" style={{ background: c.theme.accent }} />
      </motion.div>
      <motion.div className="absolute inset-y-0 left-0 aspect-square w-[92%]" initial={c.still ? false : { rotate: -10, scale: 0.7, opacity: 0 }}
        animate={{ rotate: -3, scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.3, duration: 1 }}>
        <Img src={src} className="size-full shadow-[0_4cqmin_8cqmin_rgba(0,0,0,.45)]" />
      </motion.div>
    </div>
  )
}

function Bubbles({ c, items }: { c: SlideCtx; items: { name: string; plays: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.plays))
  const spots = [[50, 46], [22, 26], [78, 22], [24, 76], [78, 74]]
  return (
    <div className="relative mx-auto aspect-square w-[78cqmin]">
      {items.slice(0, 5).map((g, i) => {
        const size = 18 + (g.plays / max) * 26
        // shrink the label so the longest word fits inside the bubble
        const longest = Math.max(...g.name.split(/\s+/).map((w) => w.length), 1)
        const font = Math.min(2.4 + size / 14, (size * 1.45) / longest)
        return (
          <motion.div key={g.name} className="absolute grid place-items-center rounded-full p-[1.5cqmin] text-center font-bold leading-tight"
            style={{ width: `${size}cqmin`, height: `${size}cqmin`, left: `calc(${spots[i][0]}% - ${size / 2}cqmin)`, top: `calc(${spots[i][1]}% - ${size / 2}cqmin)`,
              background: i === 0 ? c.theme.accent : "rgba(255,255,255,.16)", color: i === 0 ? "#111" : undefined, fontSize: `${font}cqmin` }}
            initial={c.still ? false : { scale: 0 }} animate={c.still ? undefined : { scale: 1, y: [0, -6, 0] }}
            transition={{ scale: { delay: 0.2 + i * 0.12, type: "spring", bounce: 0.5 }, y: { duration: 4 + i, repeat: Infinity, ease: "easeInOut" } }}>
            <span className="line-clamp-3">{g.name}</span>
          </motion.div>
        )
      })}
    </div>
  )
}

function Clock({ c }: { c: SlideCtx }) {
  const h = c.d.hours
  const max = Math.max(1, ...h)
  return (
    <svg viewBox="0 0 240 240" className="mx-auto w-[66cqmin]">
      <circle cx="120" cy="120" r="44" fill="rgba(255,255,255,.14)" />
      {h.map((v, i) => {
        const a = (i / 24) * Math.PI * 2 - Math.PI / 2
        const r1 = 48 + (v / max) * 66
        return (
          <motion.line key={i} x1={120 + Math.cos(a) * 48} y1={120 + Math.sin(a) * 48} x2={120 + Math.cos(a) * r1} y2={120 + Math.sin(a) * r1}
            stroke={i === c.d.persona.peak_hour ? "#fff" : c.theme.accent} strokeWidth="7" strokeLinecap="round"
            initial={c.still ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ delay: 0.3 + i * 0.03, duration: 0.6 }} />
        )
      })}
      {[0, 6, 12, 18].map((hh) => {
        const a = (hh / 24) * Math.PI * 2 - Math.PI / 2
        return <text key={hh} x={120 + Math.cos(a) * 30} y={120 + Math.sin(a) * 30 + 4} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="800" opacity=".85">{hh}</text>
      })}
    </svg>
  )
}

function ColumnChart({ c, values, labels, highlight }: { c: SlideCtx; values: number[]; labels: string[]; highlight?: number }) {
  const max = Math.max(1, ...values)
  return (
    <div className="mx-auto flex h-[46cqmin] w-full max-w-[80cqmin] items-end gap-[1.2cqmin]">
      {values.map((v, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-[1.2cqmin]">
          <motion.div className="w-full rounded-t-[1.4cqmin]" style={{ height: `${Math.max(1.5, (v / max) * 100)}%`, background: i === highlight ? "#fff" : c.theme.accent, transformOrigin: "bottom" }}
            initial={c.still ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.3 + i * 0.05, duration: 0.9, ease: EASE }} />
          <span className="text-[2.2cqmin] font-bold opacity-85">{labels[i]}</span>
        </div>
      ))}
    </div>
  )
}

function SplitBar({ c }: { c: SlideCtx }) {
  const nd = c.d.by_source.navidrome?.secs || 0, px = c.d.by_source.plex?.secs || 0, tot = nd + px || 1
  return (
    <div className="mx-auto flex h-[16cqmin] w-full max-w-[80cqmin] overflow-hidden rounded-[3cqmin] text-[4.5cqmin] font-black">
      <motion.div className="grid place-items-center bg-sky-300 text-sky-950" initial={c.still ? false : { width: 0 }} animate={{ width: `${(nd / tot) * 100}%` }} transition={{ delay: 0.3, duration: 1.1, ease: EASE }}>{Math.round((nd / tot) * 100)}%</motion.div>
      <motion.div className="grid place-items-center bg-amber-300 text-amber-950" initial={c.still ? false : { width: 0 }} animate={{ width: `${(px / tot) * 100}%` }} transition={{ delay: 0.5, duration: 1.1, ease: EASE }}>{Math.round((px / tot) * 100)}%</motion.div>
    </div>
  )
}

// ------------------------------------------------------------------ the story
export function buildSlides(d: Rewind): SlideDef[] {
  const A = d.top_artists || [], T = d.top_tracks || [], G = d.top_genres || []
  const age = d.musical_age || {}
  const S: SlideDef[] = []

  S.push({
    id: "intro", song: "top1",
    visual: (c) => <CoverOrbit c={c} ids={[...new Set([...T, ...d.top_albums].map((t) => t.album_id).filter(Boolean) as string[])].slice(0, 6)} />,
    text: (c) => (<>
      <Kicker c={c}>{c.user}</Kicker>
      <H1 c={c}>Dein {d.year}, zurückgespult.</H1>
      <P c={c}>{fmt(d.plays)} Wiedergaben. {fmt(d.artists)} Künstler. Eine Menge Gefühle.</P>
    </>),
  })

  S.push({
    id: "minutes", song: "top2",
    text: (c) => (<>
      <Kicker c={c}>Deine Hörzeit</Kicker>
      <Rise c={c} delay={0.1}><Count c={c} to={d.minutes} className="block font-display text-[22cqmin] font-black leading-[0.85] tracking-[-0.06em] tabular-nums" /></Rise>
      <H2 c={c} delay={0.25}>Minuten Musik</H2>
      <P c={c} delay={0.5}>
        {d.minutes >= 1440 ? `Das sind ${fmt(Math.round(d.minutes / 1440))} volle Tage am Stück.` : `Das sind ${fmt(Math.round(d.minutes / 60))} Stunden.`} An {fmt(d.days_listened)} Tagen lief Musik{d.streak > 2 ? `, ${d.streak} Tage davon in Folge` : ""}.
      </P>
    </>),
  })

  if (G.length) S.push({
    id: "genre", song: "genre",
    visual: (c) => <Bubbles c={c} items={G} />,
    text: (c) => (<>
      <Kicker c={c}>Dein Sound</Kicker>
      <H1 c={c}>{G[0].name}</H1>
      <P c={c}>war dein Genre des Jahres, mit {fmt(G[0].plays)} Wiedergaben.</P>
    </>),
  })

  if (A[0]) S.push({
    id: "top-artist", song: "top_artist", visualFirst: true,
    visual: (c) => <Pulse c={c}><Img src={c.cover(A[0].artist_id ? "ar-" + A[0].artist_id : "", 800)} round className="size-full shadow-2xl" /></Pulse>,
    text: (c) => (<>
      <Kicker c={c}>Dein Künstler Nr. 1</Kicker>
      <H1 c={c}>{A[0].name}</H1>
      <P c={c}>{fmt(A[0].plays)} Wiedergaben, {fmt(Math.round(A[0].secs / 60))} Minuten zusammen.</P>
    </>),
  })

  if (A.length > 1) S.push({
    id: "top-artists", song: "top3",
    text: (c) => (<>
      <Kicker c={c}>Deine Top-Künstler</Kicker>
      <H2 c={c}>Die üblichen Verdächtigen</H2>
      <List c={c} round items={A.map((a) => ({ title: a.name, sub: `${fmt(a.plays)} Wiedergaben`, img: c.cover(a.artist_id ? "ar-" + a.artist_id : "", 200) }))} />
    </>),
  })

  if (T[0]) S.push({
    id: "top-song", song: "top1", visualFirst: true,
    visual: (c) => <Vinyl c={c} src={c.cover(T[0].album_id, 800)} />,
    text: (c) => (<>
      <Kicker c={c}>Dein Song des Jahres</Kicker>
      <H1 c={c}>{T[0].name}</H1>
      <P c={c}>{T[0].artist} · {fmt(T[0].plays)}× gehört{d.top_track_first_ts ? `, zum ersten Mal am ${dateDE(d.top_track_first_ts)}` : ""}.</P>
    </>),
  })

  if (T.length > 1) S.push({
    id: "top-songs", song: "top2",
    text: (c) => (<>
      <Kicker c={c}>Deine Top-Songs</Kicker>
      <H2 c={c}>Auf Dauerschleife</H2>
      <List c={c} items={T.map((t) => ({ title: t.name, sub: `${t.artist} · ${fmt(t.plays)}×`, img: c.cover(t.album_id, 200) }))} />
    </>),
  })

  S.push({
    id: "persona", song: "peak_hour",
    visual: (c) => <Clock c={c} />,
    text: (c) => (<>
      <Kicker c={c}>Dein Hörtyp</Kicker>
      <H1 c={c}>{d.persona.name}</H1>
      <P c={c}>{d.persona.blurb} Am meisten hörst du gegen {d.persona.peak_hour} Uhr.</P>
    </>),
  })

  S.push({
    id: "months", song: "best_month",
    visual: (c) => <ColumnChart c={c} values={d.months} labels={MONTHS_SHORT} highlight={d.best_month} />,
    text: (c) => (<>
      <Kicker c={c}>Dein Jahr in Monaten</Kicker>
      <H2 c={c}>Im {MONTHS[d.best_month]} warst du kaum zu stoppen.</H2>
      {d.busiest_day && <P c={c}>Dein Rekordtag: {dayDE(d.busiest_day.day)} mit {fmt(d.busiest_day.minutes)} Minuten.</P>}
    </>),
  })

  if (age.age) S.push({
    id: "musical-age", song: "era",
    visual: (c) => <ColumnChart c={c} values={(age.decades || []).map((x) => x.plays)} labels={(age.decades || []).map((x) => `${String(x.decade).slice(2)}er`)}
      highlight={(age.decades || []).findIndex((x) => x.decade === age.era)} />,
    text: (c) => (<>
      <Kicker c={c}>Dein musikalisches Alter</Kicker>
      <Rise c={c} delay={0.1} className="flex items-baseline gap-[2cqmin]">
        <Count c={c} to={age.age!} className="font-display text-[26cqmin] font-black leading-[0.85] tracking-[-0.06em]" />
        <span className="font-display text-[6cqmin] font-extrabold">Jahre</span>
      </Rise>
      <P c={c} delay={0.4}>
        Dein Geschmack klingt nach den {String(age.era).slice(2)}ern: Die Hälfte deiner Musik erschien vor {age.median_year}.
        {age.oldest ? ` Dein ältester Song: „${age.oldest.title}“ von ${age.oldest.artist} (${age.oldest.year}).` : ""}
      </P>
    </>),
  })

  if (d.new_artists?.length) S.push({
    id: "discoveries", song: "new_artist",
    text: (c) => (<>
      <Kicker c={c}>Neu entdeckt</Kicker>
      <H2 c={c}>{d.new_artists.length > 1 ? "Diese Künstler hast du dieses Jahr kennengelernt" : "Neu in deinem Leben"}</H2>
      <List c={c} items={d.new_artists.map((a) => ({ title: a.name, sub: `${fmt(a.plays)} Wiedergaben`, mark: "✦" }))} />
    </>),
  })

  if ((d.by_source.navidrome?.secs || 0) && (d.by_source.plex?.secs || 0)) S.push({
    id: "sources", song: "top3",
    visual: (c) => <SplitBar c={c} />,
    text: (c) => (<>
      <Kicker c={c}>Zwei Server, eine Sammlung</Kicker>
      <H2 c={c}>So hast du gehört</H2>
      <P c={c}>Navidrome: {fmt(Math.round((d.by_source.navidrome?.secs || 0) / 60))} Minuten. Plex: {fmt(Math.round((d.by_source.plex?.secs || 0) / 60))} Minuten.</P>
    </>),
  })

  S.push({
    id: "summary", song: "top1",
    text: (c) => (<>
      <Kicker c={c}>Rewind {d.year} · {c.user}</Kicker>
      <Rise c={c} delay={0.1} className="rounded-[4cqmin] bg-black/20 p-[4.5cqmin] backdrop-blur-md">
        <div className={`grid gap-[3.5cqmin] ${c.landscape ? "grid-cols-[1fr_1fr_0.8fr]" : "grid-cols-2"}`}>
          {[["Top-Künstler", A], ["Top-Songs", T]].map(([label, list]) => (
            <div key={label as string} className="min-w-0">
              <div className="mb-[1.4cqmin] text-[2.2cqmin] font-extrabold uppercase tracking-[0.16em] opacity-75">{label as string}</div>
              <ol className="grid gap-[0.6cqmin] text-[3.2cqmin] font-bold">
                {(list as typeof A).slice(0, 5).map((x, i) => <li key={i} className="truncate"><span className="opacity-60">{i + 1}</span> {x.name}</li>)}
              </ol>
            </div>
          ))}
          <div className={`grid gap-[2.5cqmin] ${c.landscape ? "" : "col-span-2 grid-cols-3"}`}>
            {[["Minuten", fmt(d.minutes)], ["Genre", G[0]?.name || "–"], ["Alter", age.age ? `${age.age}` : "–"]].map(([l, v]) => (
              <div key={l} className="min-w-0">
                <div className="text-[2.2cqmin] font-extrabold uppercase tracking-[0.16em] opacity-75">{l}</div>
                <div className="truncate font-display text-[5.4cqmin] font-black tracking-tight">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </Rise>
      <P c={c} delay={0.4}>Danke fürs Zuhören. Bis nächstes Jahr.</P>
    </>),
  })
  return S
}

// ------------------------------------------------------------------ frame
export function Backdrop({ c, seed }: { c: SlideCtx; seed: number }) {
  const r = (n: number) => (Math.sin(seed * 999 + n * 77) + 1) / 2
  const blob = (n: number, color: string, side: "a" | "b") => (
    <motion.div className="absolute aspect-square rounded-full blur-[6cqmin]"
      style={{ width: `${70 + r(n) * 40}cqmin`, background: `radial-gradient(circle, ${color}cc, transparent 66%)`,
        ...(side === "a" ? { left: `${-30 + r(n + 1) * 30}cqw`, top: `${-25 + r(n + 2) * 25}cqh` } : { right: `${-30 + r(n + 1) * 30}cqw`, bottom: `${-25 + r(n + 2) * 25}cqh` }) }}
      animate={c.still ? undefined : { x: [0, side === "a" ? 40 : -40, 0], y: [0, side === "a" ? 30 : -30, 0], scale: [1, 1.12, 1] }}
      transition={{ duration: 10 + r(n + 3) * 6, repeat: Infinity, ease: "easeInOut" }} />
  )
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: c.theme.bg }}>
      {blob(1, c.theme.glow[0], "a")}
      {blob(5, c.theme.glow[1], "b")}
      <div className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
    </div>
  )
}

export function SlideBody({ slide, c }: { slide: SlideDef; c: SlideCtx }) {
  const visual = slide.visual?.(c)
  if (c.landscape) {
    return (
      <div className={`relative grid h-full items-center gap-[6cqmin] px-[9cqw] py-[12cqh] ${visual ? "grid-cols-2" : "grid-cols-1"}`} style={{ color: c.theme.ink }}>
        {visual && slide.visualFirst && <div className="min-w-0">{visual}</div>}
        <div className={`flex min-w-0 flex-col gap-[2.6cqmin] ${visual ? "" : "mx-auto w-full max-w-[110cqmin]"}`}>{slide.text(c)}</div>
        {visual && !slide.visualFirst && <div className="min-w-0">{visual}</div>}
      </div>
    )
  }
  return (
    <div className="relative flex h-full flex-col justify-center gap-[5cqmin] px-[7cqw] pb-[9cqh] pt-[13cqh]" style={{ color: c.theme.ink }}>
      {visual && <div className="min-w-0 shrink">{visual}</div>}
      <div className="flex min-w-0 flex-col gap-[2.6cqmin]">{slide.text(c)}</div>
    </div>
  )
}
