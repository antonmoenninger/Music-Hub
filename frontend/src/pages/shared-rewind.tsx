import { Loader2, Play } from "lucide-react"
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"

import { Logo } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { api, type Rewind } from "@/lib/api"
import { RewindStory } from "@/rewind/story"

import { RewindHero } from "./rewind"

/** Public, read-only Rewind behind a share link (no login, no music). */
export default function SharedRewindPage() {
  const { token = "" } = useParams()
  const [data, setData] = useState<Rewind | null>(null)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    api<Rewind>(`/api/public/rewind/${encodeURIComponent(token)}`).then(setData).catch((e) => setError(e.message))
  }, [token])

  const cover = (id?: string | null, size = 300) =>
    id ? `/api/public/cover/${encodeURIComponent(token)}?id=${encodeURIComponent(id)}&size=${size}` : ""

  return (
    <div className="mx-auto grid min-h-dvh max-w-3xl content-center gap-6 p-4">
      <div className="flex items-center gap-2.5 font-display text-lg font-bold"><Logo /> Rewind</div>
      {error ? (
        <p className="text-muted-foreground">{error}</p>
      ) : !data ? (
        <Loader2 className="animate-spin text-muted-foreground" />
      ) : (
        <RewindHero year={data.year} sub={`${data.user} teilt das Musikjahr ${data.year} mit dir.`}>
          <Button size="lg" onClick={() => setOpen(true)} className="rounded-full bg-white px-6 text-black hover:bg-white/90">
            <Play className="fill-current" /> Ansehen
          </Button>
        </RewindHero>
      )}
      {open && data && (
        <RewindStory data={data} user={data.user || ""} cover={cover} music={false} getShareUrl={async () => location.href} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
