import { useCallback, useEffect, useRef, useState } from "react"

import type { SoundtrackSong } from "@/lib/api"

const FADE_MS = 1400

/** Two <audio> elements that crossfade between library songs as the story moves on. */
export function useSoundtrack(enabled: boolean) {
  const players = useRef<HTMLAudioElement[]>([])
  const active = useRef(0)
  const currentId = useRef<string | null>(null)
  const fades = useRef<number[]>([])
  const [muted, setMuted] = useState(false)
  const [nowPlaying, setNowPlaying] = useState<SoundtrackSong | null>(null)

  useEffect(() => {
    if (!enabled) return
    players.current = [new Audio(), new Audio()]
    players.current.forEach((a) => {
      a.preload = "auto"
      a.volume = 0
    })
    return () => {
      fades.current.forEach(cancelAnimationFrame)
      players.current.forEach((a) => {
        a.pause()
        a.removeAttribute("src")
        a.load()
      })
    }
  }, [enabled])

  useEffect(() => players.current.forEach((a) => (a.muted = muted)), [muted])

  const ramp = (a: HTMLAudioElement, to: number, done?: () => void) => {
    const from = a.volume
    const start = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / FADE_MS)
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k))
      if (k < 1) fades.current.push(requestAnimationFrame(step))
      else done?.()
    }
    fades.current.push(requestAnimationFrame(step))
  }

  const play = useCallback((song?: SoundtrackSong | null) => {
    if (!enabled || !song || song.nd_id === currentId.current) return
    currentId.current = song.nd_id
    setNowPlaying(song)
    const prev = players.current[active.current]
    active.current = 1 - active.current
    const next = players.current[active.current]
    next.src = `/api/stream/${encodeURIComponent(song.nd_id)}`
    next.volume = 0
    // start near the chorus instead of the intro
    const d = song.duration || 0
    const offset = d > 90 ? Math.min(d * 0.3, 75) : 0
    const start = () => {
      if (offset) next.currentTime = offset
      next.play().then(() => ramp(next, 0.9)).catch(() => {})
    }
    if (next.readyState >= 1) start()
    else next.addEventListener("loadedmetadata", start, { once: true })
    ramp(prev, 0, () => prev.pause())
  }, [enabled])

  const pause = useCallback(() => players.current.forEach((a) => a.pause()), [])
  const resume = useCallback(() => {
    const a = players.current[active.current]
    if (a?.src) a.play().catch(() => {})
  }, [])

  return { play, pause, resume, muted, setMuted, nowPlaying }
}
