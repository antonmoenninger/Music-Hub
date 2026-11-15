import { Download, Link2, Loader2, Maximize, Minimize, Music2, Share2, Volume2, VolumeX, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Toaster } from "@/components/ui/sonner"
import type { Rewind } from "@/lib/api"

import { SHARE_SIZES, shareLink, shareNode, type ShareFormat } from "./share"
import { Backdrop, buildSlides, SlideBody, type SlideCtx } from "./slides"
import { THEMES } from "./themes"
import { useSoundtrack } from "./use-soundtrack"

const SLIDE_MS = 9000

interface Props {
  data: Rewind
  user: string
  cover: (id?: string | null, size?: number) => string
  music: boolean
  /** returns the public link for this Rewind */
  getShareUrl: () => Promise<string>
  onClose: () => void
}

function useLandscape(ref: React.RefObject<HTMLElement | null>) {
  const [landscape, setLandscape] = useState(() => innerWidth > innerHeight * 1.05)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setLandscape(e.contentRect.width > e.contentRect.height * 1.05))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return landscape
}

export function RewindStory({ data, user, cover, music, getShareUrl, onClose }: Props) {
  const slides = useMemo(() => buildSlides(data), [data])
  const root = useRef<HTMLDivElement>(null)
  const landscape = useLandscape(root)
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const [full, setFull] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [rendering, setRendering] = useState<ShareFormat | null>(null)
  const shareRef = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const elapsed = useRef(0)
  const holdTimer = useRef<number>(0)
  const sound = useSoundtrack(music && !!data.soundtrack)

  const theme = THEMES[i % THEMES.length]
  const slide = slides[i]
  const ctx: SlideCtx = { d: data, user, landscape, still: false, theme, cover }

  const close = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    onClose()
  }, [onClose])

  const go = useCallback((n: number) => {
    if (n >= slides.length) return close()
    elapsed.current = 0
    setI(Math.max(0, n))
  }, [slides.length, close])

  // music follows the story
  useEffect(() => {
    const key = slide.song
    sound.play((key && data.soundtrack?.[key]) || data.soundtrack?.top1)
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps

  // full screen + keyboard
  useEffect(() => {
    root.current?.requestFullscreen?.().catch(() => {})
    const onFs = () => setFull(!!document.fullscreenElement)
    const onKey = (e: KeyboardEvent) => {
      if (shareOpen) return
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(i + 1) }
      else if (e.key === "ArrowLeft") go(i - 1)
      else if (e.key === "Escape" && !document.fullscreenElement) close()
      else if (e.key.toLowerCase() === "m") sound.setMuted((m) => !m)
    }
    document.addEventListener("fullscreenchange", onFs)
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("fullscreenchange", onFs)
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [i, go, close, shareOpen, sound])

  // progress clock
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      if (!paused && !shareOpen) elapsed.current += now - last
      last = now
      if (bar.current) bar.current.style.width = `${Math.min(1, elapsed.current / SLIDE_MS) * 100}%`
      if (elapsed.current >= SLIDE_MS) go(i + 1)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [i, paused, shareOpen, go])

  const share = async (format: ShareFormat) => {
    setRendering(format)
    try {
      await new Promise((r) => setTimeout(r, 120)) // let the off-screen card mount
      const node = shareRef.current
      if (!node) throw new Error("nothing to render")
      const res = await shareNode(node, `rewind-${data.year}-${slide.id}-${format === "story" ? "story" : "quer"}.png`, `Mein Rewind ${data.year}`)
      if (res === "downloaded") toast.success("Bild gespeichert")
      setShareOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRendering(null)
    }
  }

  const shareUrl = async () => {
    try {
      const url = await getShareUrl()
      const res = await shareLink(url, `Mein Rewind ${data.year}`)
      if (res === "copied") toast.success("Link kopiert", { description: url })
      setShareOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const iconBtn = "grid size-10 place-items-center rounded-full bg-black/25 text-white backdrop-blur-md transition hover:bg-black/40"

  return createPortal(
    <div ref={root} className="fixed inset-0 z-50 h-dvh w-screen select-none overflow-hidden bg-black text-white">
      <div className="absolute inset-0 [container-type:size]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={i} className="absolute inset-0 [container-type:size]"
            initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.6, ease: [0.2, 0.9, 0.25, 1] }}>
            <Backdrop c={ctx} seed={i + 1} />
            <SlideBody slide={slide} c={ctx} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* progress */}
      <div className="absolute inset-x-3 top-3 z-10 flex gap-1 pt-[env(safe-area-inset-top)] sm:inset-x-6">
        {slides.map((_, k) => (
          <div key={k} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
            <div ref={k === i ? bar : undefined} className="h-full bg-white" style={{ width: k < i ? "100%" : "0%" }} />
          </div>
        ))}
      </div>

      {/* tap zones + hold to pause */}
      <div className="absolute inset-0 z-[5] flex"
        onPointerDown={() => { holdTimer.current = window.setTimeout(() => setPaused(true), 180) }}
        onPointerUp={() => clearTimeout(holdTimer.current)}
        onPointerLeave={() => { clearTimeout(holdTimer.current); setPaused(false) }}>
        {(["prev", "next"] as const).map((dir) => (
          <button key={dir} aria-label={dir === "prev" ? "Zurück" : "Weiter"} className={dir === "prev" ? "w-[30%]" : "flex-1"}
            onClick={() => { if (paused) return setPaused(false); go(dir === "prev" ? i - 1 : i + 1) }} />
        ))}
      </div>

      {/* controls */}
      <div className="absolute right-3 top-7 z-10 flex gap-2 pt-[env(safe-area-inset-top)] sm:right-6">
        {music && data.soundtrack && (
          <button className={iconBtn} onClick={() => sound.setMuted((m) => !m)} aria-label="Ton">{sound.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}</button>
        )}
        <button className={iconBtn} onClick={() => setShareOpen(true)} aria-label="Teilen"><Share2 className="size-5" /></button>
        {document.fullscreenEnabled && (
          <button className={`${iconBtn} hidden sm:grid`} aria-label="Vollbild"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())}>
            {full ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </button>
        )}
        <button className={iconBtn} onClick={close} aria-label="Schließen"><X className="size-5" /></button>
      </div>
      <div className="absolute left-4 top-8 z-10 pt-[env(safe-area-inset-top)] text-xs font-extrabold uppercase tracking-[0.18em] opacity-85 sm:left-6">
        Rewind {data.year}
      </div>

      {/* now playing */}
      <AnimatePresence>
        {sound.nowPlaying && !sound.muted && (
          <motion.div key={sound.nowPlaying.nd_id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            className="absolute bottom-4 left-1/2 z-10 flex max-w-[90vw] -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/30 py-1.5 pl-1.5 pr-4 text-sm backdrop-blur-md mb-[env(safe-area-inset-bottom)]">
            {sound.nowPlaying.album_id ? <img src={cover(sound.nowPlaying.album_id, 80)} alt="" className="size-7 rounded-full object-cover" /> : <Music2 className="size-5" />}
            <span className="truncate"><b>{sound.nowPlaying.title}</b> · {sound.nowPlaying.artist}</span>
            <span className="flex h-3 items-end gap-[2px]">
              {[0, 1, 2].map((k) => (
                <motion.span key={k} className="w-[3px] rounded-full bg-white" animate={{ height: ["30%", "100%", "45%"] }} transition={{ duration: 0.8 + k * 0.2, repeat: Infinity, repeatType: "mirror" }} />
              ))}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {paused && <div className="pointer-events-none absolute inset-0 z-[6] grid place-items-center bg-black/10 text-sm font-semibold">Pausiert</div>}

      {/* share dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent container={root.current} className="dark sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rewind teilen</DialogTitle>
            <DialogDescription>Diese Folie als Bild teilen, oder einen Link zu deinem ganzen Rewind (ohne Musik).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button size="lg" onClick={() => share("story")} disabled={!!rendering}>
              {rendering === "story" ? <Loader2 className="animate-spin" /> : <Download />} Story-Bild (9:16)
            </Button>
            <Button size="lg" variant="secondary" onClick={() => share("landscape")} disabled={!!rendering}>
              {rendering === "landscape" ? <Loader2 className="animate-spin" /> : <Download />} Querformat (16:9)
            </Button>
            <Button size="lg" variant="outline" onClick={shareUrl}><Link2 /> Link teilen</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* toasts outside the full-screen element would be invisible */}
      {full && <Toaster position="bottom-center" richColors />}

      {/* off-screen render target for share images */}
      {rendering && (
        <div className="pointer-events-none fixed left-[-99999px] top-0">
          <div ref={shareRef} className="relative overflow-hidden [container-type:size]" style={SHARE_SIZES[rendering]}>
            <Backdrop c={{ ...ctx, still: true, landscape: rendering === "landscape" }} seed={i + 1} />
            <SlideBody slide={slide} c={{ ...ctx, still: true, landscape: rendering === "landscape" }} />
            <div className="absolute bottom-[4cqmin] left-0 right-0 text-center text-[2.4cqmin] font-extrabold uppercase tracking-[0.2em] opacity-80">
              Rewind {data.year} · {user}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
