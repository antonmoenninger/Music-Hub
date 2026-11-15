import { useCallback, useEffect, useState } from "react"
import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/app-shell"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, setUnauthorizedHandler, type Me } from "@/lib/api"
import LoginPage from "@/pages/login"
import RewindPage from "@/pages/rewind"
import SearchPage from "@/pages/search"
import SharedRewindPage from "@/pages/shared-rewind"
import StatsPage from "@/pages/stats"

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined)

  const load = useCallback(() => {
    api<Me>("/api/me").then(setMe).catch(() => setMe(null))
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null))
    load()
  }, [load])

  return (
    <TooltipProvider delayDuration={300}>
      <Routes>
        {/* public share links work without an account */}
        <Route path="/r/:token" element={<SharedRewindPage />} />
        <Route
          path="*"
          element={
            me === undefined ? null : me === null ? (
              <LoginPage onLogin={load} />
            ) : (
              <AppShell me={me} onLogout={() => setMe(null)}>
                <Routes>
                  <Route path="/" element={<Navigate to="/search" replace />} />
                  <Route path="/search" element={<SearchPage me={me} />} />
                  <Route path="/stats" element={<StatsPage />} />
                  <Route path="/rewind" element={<RewindPage me={me} />} />
                  <Route path="*" element={<Navigate to="/search" replace />} />
                </Routes>
              </AppShell>
            )
          }
        />
      </Routes>
      <Toaster position="bottom-center" richColors />
    </TooltipProvider>
  )
}
