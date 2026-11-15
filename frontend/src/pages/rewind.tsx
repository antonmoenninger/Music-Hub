import { Loader2, Music2, Play, Share2 } from "lucide-react"
import { motion } from "motion/react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, post, type Me, type Rewind } from "@/lib/api"
import { coverUrl } from "@/lib/format"
import { shareLink } from "@/rewind/share"
import { RewindStory } from "@/rewind/story"
import { THEMES } from "@/rewind/themes"

export function RewindHero({ year, children, sub }: { year: number; children?: React.ReactNode; sub?: string }) {
  const t = THEMES[0]
  return (
    <div className="relative isolate overflow-hidden rounded-3xl p-7 text-white sm:p-10" style={{ background: t.bg }}>
      <motion.div className="absolute -right-24 -top-32 -z-10 size-96 rounded-full blur-3xl" style={{ background: t.glow[0] }}
        animate={{ x: [0, -30, 0], y: [0, 20, 0] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div className="absolute -bottom-40 left-1/4 -z-10 size-96 rounded-full opacity-70 blur-3xl" style={{ background: t.glow[1] }}
        animate={{ x: [0, 40, 0] }} transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }} />
      <motion.h2 key={year} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="text-6xl font-black leading-[0.9] tracking-[-0.05em] sm:text-8xl">Rewind<br />{year}</motion.h2>
      <p className="mt-4 max-w-md text-white/85">{sub || "Deine Top-Künstler, Songs, Genres, dein musikalisches Alter und wie du dieses Jahr gehört hast."}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

export default function RewindPage({ me }: { me: Me }) {
  const [years, setYears] = useState<number[]>([])
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [data, setData] = useState<Rewind | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api<number[]>("/api/years").then((ys) => {
      setYears(ys)
      if (ys.length) setYear(ys[0])
    })
  }, [])

  const getShareUrl = async () => {
    const r = await post<{ path: string }>("/api/rewind/share", { year })
    return location.origin + r.path
  }

  const start = async () => {
    setLoading(true)
    try {
      const d = await api<Rewind>(`/api/rewind?year=${year}`)
      if (d.empty) return toast.info(`Für ${year} gibt es noch keine Wiedergaben.`)
      setData(d)
      setOpen(true)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageHeader title="Rewind" sub="Dein Musikjahr als Story, aus Navidrome und Plex, mit deiner Musik im Hintergrund." />
      <RewindHero year={year}>
        {years.length > 1 && (
          <ToggleGroup type="single" value={String(year)} onValueChange={(v) => v && setYear(+v)} className="rounded-full bg-black/20 p-1">
            {years.map((y) => (
              <ToggleGroupItem key={y} value={String(y)} className="rounded-full px-4 text-white data-[state=on]:bg-white data-[state=on]:text-black">{y}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <Button size="lg" onClick={start} disabled={loading} className="rounded-full bg-white px-6 text-black hover:bg-white/90">
          {loading ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />} Abspielen
        </Button>
        <Button size="lg" variant="ghost" className="rounded-full text-white hover:bg-white/15 hover:text-white"
          onClick={async () => {
            try {
              const url = await getShareUrl()
              if ((await shareLink(url, `Mein Rewind ${year}`)) === "copied") toast.success("Link kopiert", { description: url })
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}>
          <Share2 /> Link teilen
        </Button>
      </RewindHero>
      <div className="mt-4 flex flex-wrap gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary" className="gap-1"><Music2 /> Mit Musik aus deiner Bibliothek</Badge>
        <Badge variant="secondary">Hoch- und Querformat</Badge>
        <Badge variant="secondary">Tippen: weiter · Halten: Pause · M: Ton</Badge>
      </div>
      {open && data && (
        <RewindStory data={data} user={me.user} cover={coverUrl} music getShareUrl={getShareUrl} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
