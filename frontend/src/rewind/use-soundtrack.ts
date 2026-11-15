import { useCallback, useEffect, useRef, useState } from "react"

import type { SoundtrackSong } from "@/lib/api"

const FADE_MS = 1200
// a few ms of silence: playing it inside a tap "unlocks" an <audio> element on iOS/Android
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="

let players: HTMLAudioElement[] = []

/** Call synchronously inside the click that starts the story (before any await). */
export function unlockAudio() {
  if (!players.length) {
    players = [new Audio(), new Audio()]
    players.forEach((a) => {
      a.preload = "auto"
      a.loop = true // a held (paused) slide keeps its music going
      a.setAttribute("playsinline", "")
    })
  }
  players.forEach((a) => {
    a.src = SILENCE
    a.play().then(() => a.pause()).catch(() => {})
  })
}

/** iOS ignores element.volume (always 1): no crossfade there, a clean cut instead. */
function volumeWorks() {
  const a = new Audio()
  a.volume = 0.5
  return a.volume === 0.5
}

const clipUrl = (id: string) => `/api/clip/${encodeURIComponent(id)}`

/** Two players crossfading between short clips; the idle one preloads the next song. */
export function useSoundtrack(enabled: boolean) {
  const active = useRef(0)
  const currentId = useRef<string | null>(null)
  const fades = useRef<number[]>([])
  const canFade = useRef(true)
  const [muted, setMuted] = useState(false)
  const [nowPlaying, setNowPlaying] = useState<SoundtrackSong | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (!players.length) unlockAudio()
    canFade.current = volumeWorks()
    return () => {
      fades.current.forEach(cancelAnimationFrame)
      players.forEach((a) => {
        a.pause()
        a.removeAttribute("src")
        a.load()
      })
      currentId.current = null
    }
  }, [enabled])

  useEffect(() => players.forEach((a) => (a.muted = muted)), [muted])

  const ramp = (a: HTMLAudioElement, to: number, done?: () => void) => {
    if (!canFade.current) {
      a.volume = 1
      done?.()
      return
    }
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

  /** Switch to `song` (no-op if it is already playing) and preload `next`. */
  const play = useCallback((song?: SoundtrackSong | null, next?: SoundtrackSong | null) => {
    if (!enabled || !players.length) return
    if (song && song.nd_id !== currentId.current) {
      currentId.current = song.nd_id
      setNowPlaying(song)
      const prev = players[active.current]
      active.current = 1 - active.current
      const cur = players[active.current]
      const url = clipUrl(song.nd_id)
      if (!cur.src.endsWith(url)) cur.src = url
      cur.volume = canFade.current ? 0 : 1
      cur.currentTime = 0
      cur.play().then(() => ramp(cur, 0.9)).catch(() => {})
      if (canFade.current) ramp(prev, 0, () => prev.pause())
      else prev.pause()
    }
    // the idle player fetches the next slide's song in the background
    const idle = players[1 - active.current]
    if (next && next.nd_id !== currentId.current && idle.paused) {
      const url = clipUrl(next.nd_id)
      if (!idle.src.endsWith(url)) {
        idle.src = url
        idle.load()
      }
    }
  }, [enabled])

  const pause = useCallback(() => players.forEach((a) => a.pause()), [])
  const resume = useCallback(() => {
    const a = players[active.current]
    if (a?.src) a.play().catch(() => {})
  }, [])

  return { play, pause, resume, muted, setMuted, nowPlaying }
}
