import { Loader2 } from "lucide-react"
import { motion } from "motion/react"
import { useState } from "react"

import { Logo } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { post } from "@/lib/api"

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[34rem] rounded-full bg-[#ff7a45]/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -right-32 size-[34rem] rounded-full bg-[#7c3aed]/25 blur-3xl" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-sm">
        <Card className="border-white/10 bg-card/80 backdrop-blur-xl">
          <CardHeader>
            <Logo className="mb-3 size-10" />
            <CardTitle className="text-2xl">Anmelden</CardTitle>
            <CardDescription>Mit deinem Navidrome-Konto.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={async (e) => {
                e.preventDefault()
                setBusy(true)
                setError("")
                try {
                  await post("/api/login", { username: username.trim(), password })
                  onLogin()
                } catch (x) {
                  setError((x as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="u">Benutzername</Label>
                <Input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p">Passwort</Label>
                <Input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" disabled={busy} className="mt-1">
                {busy && <Loader2 className="animate-spin" />} Anmelden
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
