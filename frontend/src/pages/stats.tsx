import { motion } from "motion/react"
import { useEffect, useState } from "react"

import { Cover, PageHeader } from "@/components/app-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Ranked, type Recent, type Stats } from "@/lib/api"
import { coverUrl, fmt, WEEKDAYS } from "@/lib/format"

const PERIODS = [["week", "7 Tage"], ["month", "30 Tage"], ["quarter", "90 Tage"], ["year", "Dieses Jahr"], ["all", "Gesamt"]] as const
const SOURCES = [["all", "Alle"], ["navidrome", "Navidrome"], ["plex", "Plex"]] as const

function Bars({ values, labels, every = 1, height = 150 }: { values: number[]; labels: string[]; every?: number; height?: number }) {
  const max = Math.max(1, ...values)
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <motion.div
                initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.008, duration: 0.5, ease: [0.2, 0.9, 0.3, 1] }}
                className="flex-1 origin-bottom rounded-t-[4px] bg-gradient-to-t from-brand/70 to-brand hover:from-brand hover:to-brand"
                style={{ height: `${Math.max(v ? 2 : 0, (v / max) * 100)}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>{labels[i]}: {fmt(v)} min</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[10px] text-muted-foreground">
        {labels.map((l, i) => <span key={i} className="flex-1 text-center">{i % every === 0 ? l : ""}</span>)}
      </div>
    </div>
  )
}

function RankList({ items, kind }: { items: Ranked[]; kind: "artist" | "track" | "album" }) {
  if (!items.length) return <p className="py-6 text-center text-muted-foreground">Keine Daten.</p>
  return (
    <ol className="grid gap-1">
      {items.map((it, i) => (
        <motion.li key={it.name + i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
          className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-muted/50">
          <span className="tabular w-5 text-right text-sm font-bold text-muted-foreground">{i + 1}</span>
          <Cover src={coverUrl(kind === "artist" ? (it.artist_id ? "ar-" + it.artist_id : "") : it.album_id, 120)}
            rounded={kind === "artist" ? "rounded-full" : "rounded-md"} className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{it.name || "–"}</div>
            {it.artist && <div className="truncate text-sm text-muted-foreground">{it.artist}</div>}
          </div>
          <span className="tabular text-sm text-muted-foreground">{fmt(it.plays)}×</span>
        </motion.li>
      ))}
    </ol>
  )
}

export default function StatsPage() {
  const [period, setPeriod] = useState(localStorage.getItem("mh.period") || "month")
  const [source, setSource] = useState(localStorage.getItem("mh.source") || "all")
  const [s, setS] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])

  useEffect(() => {
    localStorage.setItem("mh.period", period)
    localStorage.setItem("mh.source", source)
    setS(null)
    api<Stats>(`/api/stats?period=${period}&source=${source}`).then(setS).catch(() => {})
  }, [period, source])
  useEffect(() => void api<Recent[]>("/api/recent").then(setRecent).catch(() => {}), [])

  const nd = s?.by_source.navidrome?.secs || 0
  const px = s?.by_source.plex?.secs || 0
  const tot = nd + px || 1
  const daily = s?.daily.slice(-90) || []

  return (
    <>
      <PageHeader title="Statistik" sub="Navidrome und Plex zusammengerechnet.">
        <div className="flex max-w-full flex-wrap gap-2 [&>*]:max-w-full [&>*]:overflow-x-auto">
          <ToggleGroup type="single" variant="outline" size="sm" value={period} onValueChange={(v) => v && setPeriod(v)}>
            {PERIODS.map(([k, l]) => <ToggleGroupItem key={k} value={k} className="px-3">{l}</ToggleGroupItem>)}
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" size="sm" value={source} onValueChange={(v) => v && setSource(v)}>
            {SOURCES.map(([k, l]) => <ToggleGroupItem key={k} value={k} className="px-3">{l}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      </PageHeader>

      {!s ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[[s.minutes, "Minuten gehört"], [s.plays, "Wiedergaben"], [s.songs, "verschiedene Songs"], [s.artists, "Künstler"]].map(([v, l], i) => (
              <motion.div key={l} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="gap-1 py-5">
                  <CardContent>
                    <div className="tabular font-display text-3xl font-bold">{fmt(v as number)}</div>
                    <div className="text-sm text-muted-foreground">{l}</div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Quelle</CardTitle>
              <span className="text-sm text-muted-foreground">{fmt(Math.round(tot / 60))} min</span>
            </CardHeader>
            <CardContent>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                <motion.div initial={{ width: 0 }} animate={{ width: `${(nd / tot) * 100}%` }} className="bg-sky-400" />
                <motion.div initial={{ width: 0 }} animate={{ width: `${(px / tot) * 100}%` }} className="bg-amber-400" />
              </div>
              <div className="mt-2 flex gap-5 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-sky-400" /> Navidrome <b className="text-foreground">{Math.round((nd / tot) * 100)}%</b></span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" /> Plex <b className="text-foreground">{Math.round((px / tot) * 100)}%</b></span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Minuten pro Tag</CardTitle></CardHeader>
            <CardContent>{daily.length ? <Bars values={daily.map((d) => d.minutes)} labels={daily.map((d) => d.day.slice(5).split("-").reverse().join("."))} every={Math.ceil(daily.length / 10)} /> : <p className="text-muted-foreground">Keine Daten.</p>}</CardContent>
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <Card><CardHeader><CardTitle>Tageszeit</CardTitle></CardHeader><CardContent><Bars values={s.hours} labels={s.hours.map((_, i) => `${i}`)} every={3} height={120} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Wochentag</CardTitle></CardHeader><CardContent><Bars values={s.weekdays} labels={WEEKDAYS} height={120} /></CardContent></Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card><CardHeader><CardTitle>Top-Künstler</CardTitle></CardHeader><CardContent><RankList items={s.top_artists} kind="artist" /></CardContent></Card>
            <Card><CardHeader><CardTitle>Top-Songs</CardTitle></CardHeader><CardContent><RankList items={s.top_tracks} kind="track" /></CardContent></Card>
            <Card><CardHeader><CardTitle>Top-Alben</CardTitle></CardHeader><CardContent><RankList items={s.top_albums} kind="album" /></CardContent></Card>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Genres</CardTitle></CardHeader>
              <CardContent className="grid gap-2.5">
                {s.top_genres.filter((g) => g.name).map((g, i, arr) => (
                  <div key={g.name} className="grid grid-cols-[minmax(0,8rem)_1fr_3rem] items-center gap-3 text-sm">
                    <span className="truncate">{g.name}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${(g.plays / arr[0].plays) * 100}%` }} transition={{ delay: i * 0.05 }} className="h-full rounded-full bg-brand" />
                    </div>
                    <span className="tabular text-right text-muted-foreground">{fmt(g.plays)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Zuletzt gehört</CardTitle></CardHeader>
              <CardContent className="grid gap-1">
                {recent.slice(0, 8).map((r) => (
                  <div key={r.ts + r.title} className="flex items-center gap-3 rounded-lg p-1.5">
                    <Cover src={coverUrl(r.album_id, 120)} className="size-10 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.title}</div>
                      <div className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                        <span className={`size-1.5 shrink-0 rounded-full ${r.source === "plex" ? "bg-amber-400" : "bg-sky-400"}`} />{r.artist}
                      </div>
                    </div>
                    <span className="tabular text-xs text-muted-foreground">{new Date(r.ts * 1000).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
