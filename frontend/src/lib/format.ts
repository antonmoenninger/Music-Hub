export const fmt = (n: number | undefined | null) => Number(n || 0).toLocaleString("de-DE")

export const mmss = (s?: number) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`

export const coverUrl = (id?: string | null, size = 300) =>
  id ? `/api/cover?id=${encodeURIComponent(id)}&size=${size}` : ""

export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
export const MONTHS_SHORT = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"]
export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

export const dateDE = (ts: number) => new Date(ts * 1000).toLocaleDateString("de-DE", { day: "numeric", month: "long" })
export const dayDE = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })
