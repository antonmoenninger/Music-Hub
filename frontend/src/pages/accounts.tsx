import { Check, Copy, KeyRound, Link2, Loader2, RefreshCw, ShieldCheck, UserPlus } from "lucide-react"
import { motion } from "motion/react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/app-shell"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, post, type Accounts, type PlexAccount } from "@/lib/api"
import { fmt } from "@/lib/format"

const NONE = "__none__"

function genPassword() {
  const words = ["Bass", "Beat", "Chor", "Disco", "Echo", "Funk", "Groove", "Hall", "Jazz", "Kanon", "Lied", "Melodie", "Oper", "Pop", "Rock", "Swing", "Takt", "Tango", "Vinyl", "Walzer"]
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n
  return `${words[r(words.length)]}-${words[r(words.length)]}-${1000 + r(9000)}`
}

const initials = (s: string) => s.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"
const ago = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–")
const slug = (s: string) => s.trim().replace(/[^\wäöüÄÖÜß.-]+/g, "").slice(0, 40)

function CreateDialog({ open, onOpenChange, forAccount, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; forAccount: PlexAccount | null; onCreated: () => void
}) {
  const [username, setUsername] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [adminPw, setAdminPw] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ userName: string; password: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setUsername(slug(forAccount?.name || ""))
    setName(forAccount?.name || "")
    setPassword(genPassword())
    setAdminPw("")
    setDone(null)
  }, [open, forAccount])

  const submit = async () => {
    setBusy(true)
    try {
      const r = await post<{ userName: string }>("/api/admin/nd-users", {
        username, name, password, admin_password: adminPw, link_account: forAccount?.account ?? null,
      })
      setDone({ userName: r.userName, password })
      onCreated()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast.success("Kopiert")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Check className="text-emerald-400" /> Konto erstellt</DialogTitle>
              <DialogDescription>Gib diese Zugangsdaten weiter. Das Passwort wird nur jetzt angezeigt.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 rounded-xl bg-muted p-4 font-mono text-sm">
              <div className="flex items-center justify-between gap-2"><span>Benutzer: <b>{done.userName}</b></span></div>
              <div className="flex items-center justify-between gap-2"><span>Passwort: <b>{done.password}</b></span></div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => copy(`Benutzer: ${done.userName}\nPasswort: ${done.password}\nAdresse: ${location.origin}`)}>
                <Copy /> Zugangsdaten kopieren
              </Button>
              <Button onClick={() => onOpenChange(false)}>Fertig</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Navidrome-Konto erstellen</DialogTitle>
              <DialogDescription>
                {forAccount ? <>Für das Plex-Konto <b>{forAccount.name}</b>. Es wird danach direkt verknüpft, samt {fmt(forAccount.plays)} Plex-Wiedergaben.</> : "Ein neues Konto ohne Admin-Rechte."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label htmlFor="nu">Benutzername</Label><Input id="nu" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
                <div className="grid gap-2"><Label htmlFor="nn">Anzeigename</Label><Input id="nn" value={name} onChange={(e) => setName(e.target.value)} /></div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="np">Passwort</Label>
                <div className="flex gap-2">
                  <Input id="np" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
                  <Button variant="secondary" size="icon" onClick={() => setPassword(genPassword())} aria-label="Neues Passwort"><RefreshCw /></Button>
                </div>
              </div>
              <div className="grid gap-2 rounded-xl border border-dashed p-3">
                <Label htmlFor="ap" className="flex items-center gap-1.5"><KeyRound className="size-3.5" /> Dein Admin-Passwort</Label>
                <Input id="ap" type="password" autoComplete="current-password" value={adminPw} onChange={(e) => setAdminPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && adminPw && submit()} />
                <p className="text-xs text-muted-foreground">Nur zur Bestätigung, wird nicht gespeichert.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
              <Button onClick={submit} disabled={busy || !adminPw || username.length < 2 || password.length < 6}>
                {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Erstellen
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function AccountsPage() {
  const [data, setData] = useState<Accounts | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ open: boolean; account: PlexAccount | null }>({ open: false, account: null })

  const load = useCallback(() => api<Accounts>("/api/admin/accounts").then(setData).catch((e) => toast.error(e.message)), [])
  useEffect(() => void load(), [load])

  const link = async (acc: PlexAccount, value: string) => {
    setSaving(acc.account)
    try {
      const nd = value === NONE ? null : value
      const r = await api<{ moved_plays: number }>(`/api/admin/accounts/${acc.account}`, { method: "PUT", body: JSON.stringify({ nd_user: nd }) })
      toast.success(nd ? `${acc.name} → ${nd}` : `${acc.name} getrennt`, { description: `${fmt(r.moved_plays)} Wiedergaben verschoben` })
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const linkedTo = (user: string) => data?.plex.filter((p) => p.nd_user === user).map((p) => p.name) || []

  return (
    <>
      <PageHeader title="Konten" sub="Verknüpfe Plex-Konten mit Navidrome, damit jede Person ihre eigene Statistik und ihr eigenes Rewind bekommt.">
        <Button onClick={() => setDialog({ open: true, account: null })}><UserPlus /> Neues Konto</Button>
      </PageHeader>

      {!data ? <Skeleton className="h-96 rounded-xl" /> : (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Plex-Konten</CardTitle>
              <CardDescription>Wer auf Plex Musik hört. Verknüpfte Wiedergaben zählen für das gewählte Navidrome-Konto.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plex</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Wiedergaben</TableHead>
                    <TableHead className="hidden md:table-cell">Zuletzt</TableHead>
                    <TableHead>Navidrome-Konto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.plex.map((p, i) => (
                    <motion.tr key={p.account} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                      className={`border-b transition-colors hover:bg-muted/40 ${p.plays ? "" : "opacity-60"}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9"><AvatarFallback className="bg-amber-400/15 text-xs font-bold text-amber-300">{initials(p.name)}</AvatarFallback></Avatar>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground sm:hidden">{fmt(p.plays)} Wiedergaben</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{fmt(p.plays)}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{ago(p.last_ts)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Select value={p.nd_user ?? NONE} onValueChange={(v) => link(p, v)} disabled={saving === p.account}>
                            <SelectTrigger className="w-32 sm:w-48">
                              {saving === p.account ? <Loader2 className="animate-spin" /> : p.nd_user ? <Link2 className="text-emerald-400" /> : null}
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}><span className="text-muted-foreground">Nicht verknüpft</span></SelectItem>
                              {data.nd_users.map((u) => <SelectItem key={u.userName} value={u.userName}>{u.name || u.userName}{u.name && u.name !== u.userName ? ` (${u.userName})` : ""}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {!p.nd_user && p.plays > 0 && (
                            <Button size="sm" variant="secondary" onClick={() => setDialog({ open: true, account: p })}><UserPlus /> <span className="hidden lg:inline">Konto anlegen</span></Button>
                          )}
                        </div>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Navidrome-Konten</CardTitle>
              <CardDescription>Mit diesen Konten melden sich alle hier im Hub an.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.nd_users.map((u) => (
                <div key={u.userName} className="flex items-center gap-3 rounded-xl border p-3">
                  <Avatar className="size-10"><AvatarFallback className="bg-sky-400/15 text-xs font-bold text-sky-300">{initials(u.name || u.userName)}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate font-medium">{u.name || u.userName}{u.isAdmin && <ShieldCheck className="size-3.5 text-brand" />}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {u.userName} · {fmt(u.plays)} Navidrome-Wiedergaben
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {linkedTo(u.userName).map((n) => <Badge key={n} variant="secondary" className="h-5 text-[11px]"><Link2 /> Plex: {n}</Badge>)}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
      <CreateDialog open={dialog.open} forAccount={dialog.account} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} onCreated={load} />
    </>
  )
}
