import { Check, Download as DownloadIcon, Loader2, RotateCcw, Search as SearchIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { Cover, PageHeader } from "@/components/app-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api, post, type Download, type Me, type SearchResult } from "@/lib/api"
import { coverUrl, mmss } from "@/lib/format"

const STATUS: Record<Download["status"], string> = {
  queued: "In Warteschlange", downloading: "Lädt…", importing: "Importiert…", done: "Geladen", failed: "Fehlgeschlagen",
}

function DownloadState({ d, inLibrary }: { d?: Download | null; inLibrary?: boolean }) {
  if (d) {
    const variant = d.status === "failed" ? "destructive" : d.status === "done" ? "secondary" : "outline"
    return (
      <Badge variant={variant} title={d.message || ""} className="gap-1">
        {d.status === "done" ? <Check /> : d.status !== "failed" ? <Loader2 className="animate-spin" /> : null}
        {STATUS[d.status]}
      </Badge>
    )
  }
  return inLibrary ? <Badge variant="secondary"><Check /> In Bibliothek</Badge> : null
}

function DownloadButton(props: { kind: "track" | "album"; id: string; title: string; artist: string; image?: string; ghost?: boolean; onQueued: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant={props.ghost ? "secondary" : "default"}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await post("/api/downloads", { kind: props.kind, spotify_id: props.id, title: props.title, artist: props.artist, image: props.image || "" })
          toast.success(`„${props.title}“ wird geladen`)
          props.onQueued()
        } catch (e) {
          toast.error((e as Error).message)
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <DownloadIcon />}
      {props.kind === "album" ? "Album" : "Laden"}
    </Button>
  )
}

export default function SearchPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get("q") || "")
  const [res, setRes] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloads, setDownloads] = useState<Download[]>([])
  const seq = useRef(0)

  const refreshDownloads = useCallback(() => api<Download[]>("/api/downloads").then(setDownloads).catch(() => {}), [])

  const run = useCallback(async (text: string) => {
    const my = ++seq.current
    if (text.trim().length < 2) return setRes(null)
    setLoading(true)
    try {
      const r = await api<SearchResult>(`/api/search?q=${encodeURIComponent(text)}`)
      if (my === seq.current) setRes(r)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      run(q)
      setParams(q ? { q } : {}, { replace: true })
    }, 350)
    return () => clearTimeout(t)
  }, [q, run, setParams])

  useEffect(() => {
    refreshDownloads()
    const t = setInterval(refreshDownloads, 3000)
    return () => clearInterval(t)
  }, [refreshDownloads])

  const requeue = () => {
    refreshDownloads()
    run(q)
  }
  const songs = res?.library.song?.slice(0, 12) || []
  const albums = res?.library.album?.slice(0, 6) || []
  const tracks = res?.spotify.tracks || []
  const spAlbums = res?.spotify.albums?.slice(0, 6) || []

  return (
    <>
      <PageHeader title="Suche" sub="Deine Bibliothek und Spotify zusammen. Fehlt etwas, lade es mit einem Klick herunter." />
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Künstler, Song oder Album…"
          className="h-14 rounded-2xl pl-12 text-base md:text-lg" />
        {loading && <Loader2 className="absolute right-4 top-1/2 size-5 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {!me.spotify && (
        <Alert className="mt-4">
          <AlertTitle>Spotify-Suche ist noch nicht eingerichtet</AlertTitle>
          <AlertDescription>In SpotBye fehlen Client ID und Secret (Einstellungen → Spotify). Die Suche in deiner Bibliothek funktioniert trotzdem.</AlertDescription>
        </Alert>
      )}

      {res && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>In deiner Bibliothek</CardTitle></CardHeader>
            <CardContent className="grid gap-1">
              {songs.length ? songs.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-muted/50">
                  <Cover src={coverUrl(s.albumId || s.coverArt, 120)} className="size-11 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.title}</div>
                    <div className="truncate text-sm text-muted-foreground">{s.artist} · {s.album}</div>
                  </div>
                  <span className="tabular text-sm text-muted-foreground">{mmss(s.duration)}</span>
                </div>
              )) : <p className="py-6 text-center text-muted-foreground">Nichts gefunden.</p>}
              {albums.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {albums.map((a) => (
                    <div key={a.id} className="min-w-0">
                      <Cover src={coverUrl(a.id, 300)} rounded="rounded-xl" className="w-full" />
                      <div className="mt-1.5 truncate text-sm font-medium">{a.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{a.artist}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2">Von Spotify <Badge variant="outline">SpotBye</Badge></CardTitle></CardHeader>
            <CardContent className="grid gap-1">
              {res.spotify_error ? <p className="py-6 text-center text-muted-foreground">{res.spotify_error}</p> :
                tracks.length ? tracks.map((t) => (
                  <div key={t.spotify_id} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-muted/50">
                    <Cover src={t.images} className="size-11 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate font-medium">{t.name}{t.explicit && <Badge variant="outline" className="h-4 px-1 text-[10px]">E</Badge>}</div>
                      <div className="truncate text-sm text-muted-foreground">{t.artists} · {t.album_name}</div>
                    </div>
                    <DownloadState d={t.download} inLibrary={t.in_library} />
                    {!t.download && <DownloadButton kind="track" id={t.spotify_id} title={t.name} artist={t.artists} image={t.images} ghost={t.in_library} onQueued={requeue} />}
                  </div>
                )) : <p className="py-6 text-center text-muted-foreground">Keine Treffer.</p>}
              {spAlbums.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {spAlbums.map((a) => (
                    <div key={a.id} className="min-w-0">
                      <Cover src={a.images} rounded="rounded-xl" className="w-full" />
                      <div className="mt-1.5 truncate text-sm font-medium">{a.name}</div>
                      <div className="mb-2 truncate text-xs text-muted-foreground">{a.artists} · {(a.release_date || "").slice(0, 4)} · {a.total_tracks} Songs</div>
                      <DownloadState d={a.download} inLibrary={a.in_library} />
                      {!a.download && <DownloadButton kind="album" id={a.id} title={a.name} artist={a.artists} image={a.images} ghost={a.in_library} onQueued={requeue} />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {loading && !res && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-96 rounded-xl" />)}
        </div>
      )}

      <h2 className="mb-3 mt-10 text-xl font-semibold">Downloads</h2>
      <Card>
        <CardContent className="grid gap-1">
          <AnimatePresence initial={false}>
            {downloads.length ? downloads.slice(0, 25).map((d) => (
              <motion.div key={d.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded-lg p-1.5">
                <Cover src={d.image} className="size-11 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.title || d.spotify_id}</div>
                  <div className="truncate text-sm text-muted-foreground">{d.artist}{d.message ? ` · ${d.message}` : ""}</div>
                </div>
                <DownloadState d={d} />
                {d.status === "failed" && (
                  <Button size="sm" variant="secondary" onClick={() => post(`/api/downloads/${d.id}/retry`).then(refreshDownloads)}>
                    <RotateCcw /> Nochmal
                  </Button>
                )}
              </motion.div>
            )) : <p className="py-6 text-center text-muted-foreground">Noch keine Downloads.</p>}
          </AnimatePresence>
        </CardContent>
      </Card>
    </>
  )
}
