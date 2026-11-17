export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn)

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
  })
  if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/public")) onUnauthorized()
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((data as { detail?: string }).detail || `HTTP ${res.status}`, res.status)
  return data as T
}

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) })

// ---------------------------------------------------------------- types
export interface Me { user: string; name: string; spotify: boolean; plex: boolean; admin: boolean }

export interface NdSong { id: string; title: string; artist: string; album: string; albumId?: string; coverArt?: string; duration?: number; year?: number }
export interface NdAlbum { id: string; name: string; artist: string; year?: number; coverArt?: string }
export interface Download {
  id: number; kind: "track" | "album"; spotify_id: string; title?: string; artist?: string; image?: string
  status: "queued" | "downloading" | "importing" | "done" | "failed"; message?: string; created: number
}
export interface SpTrack {
  spotify_id: string; name: string; artists: string; album_name?: string; images?: string; duration_ms?: number
  explicit?: boolean; in_library?: boolean; download?: Download | null
}
export interface SpAlbum {
  id: string; name: string; artists: string; release_date?: string; total_tracks?: number; images?: string
  in_library?: boolean; download?: Download | null
}
export interface SearchResult {
  library: { song?: NdSong[]; album?: NdAlbum[] }
  spotify: { tracks?: SpTrack[]; albums?: SpAlbum[] }
  spotify_error: string | null
  source?: "spotify" | "deezer"
}

export interface Ranked { name: string; artist?: string; plays: number; secs: number; album_id?: string; artist_id?: string; nd_id?: string }
export interface Stats {
  plays: number; minutes: number; songs: number; artists: number
  by_source: Record<string, { plays: number; secs: number }>
  top_artists: Ranked[]; top_tracks: Ranked[]; top_albums: Ranked[]; top_genres: Ranked[]
  hours: number[]; weekdays: number[]; daily: { day: string; minutes: number }[]
}
export interface Recent { source: string; ts: number; artist: string; title: string; album: string; album_id?: string }

export interface SoundtrackSong { title: string; artist: string; nd_id: string; duration?: number; album_id?: string }
export interface MusicalAge {
  age?: number; median_year?: number; era?: number; coverage?: number
  decades?: { decade: number; plays: number }[]
  oldest?: { title: string; artist: string; year: number; album_id?: string } | null
}
export interface Rewind {
  year: number; empty: boolean; user?: string
  minutes: number; plays: number; songs: number; artists: number; days_listened: number; streak: number
  top_artists: Ranked[]; top_tracks: Ranked[]; top_albums: Ranked[]; top_genres: Ranked[]
  persona: { name: string; blurb: string; peak_hour: number }
  hours: number[]; months: number[]; best_month: number
  busiest_day: { day: string; minutes: number } | null
  new_artists: { name: string; plays: number }[]
  by_source: Record<string, { plays: number; secs: number }>
  top_track_first_ts: number | null
  musical_age: MusicalAge
  soundtrack?: Record<string, SoundtrackSong>
}

export interface PlexAccount { account: string; name: string; nd_user: string | null; plays: number; last_ts: number | null }
export interface NdUser { userName: string; name: string; isAdmin: boolean; lastLogin: string | null; plays: number }
export interface Accounts { plex: PlexAccount[]; nd_users: NdUser[] }
