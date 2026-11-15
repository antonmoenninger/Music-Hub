import { BarChart3, LogOut, Search, Sparkles } from "lucide-react"
import type { ReactNode } from "react"
import { NavLink } from "react-router-dom"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { post, type Me } from "@/lib/api"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/search", label: "Suche", icon: Search },
  { to: "/stats", label: "Statistik", icon: BarChart3 },
  { to: "/rewind", label: "Rewind", icon: Sparkles },
]

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-xl bg-gradient-to-br from-[#ff7a45] to-[#e0306f] shadow-lg shadow-rose-500/20", className)}>
      <svg viewBox="0 0 24 24" className="size-3.5 fill-white"><path d="M7 4.5v15L19.5 12z" /></svg>
    </span>
  )
}

export function AppShell({ me, onLogout, children }: { me: Me; onLogout: () => void; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <div className="flex items-center gap-2.5 font-display text-lg font-bold">
            <Logo />
            <span className="hidden sm:inline">{me.name}</span>
          </div>
          <nav className="ml-1 flex gap-1 sm:ml-4">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "bg-secondary text-foreground",
                  )
                }
              >
                <Icon className="size-4" />
                <span className="hidden min-[420px]:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <DropdownMenu>
            <DropdownMenuTrigger className="ml-auto rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="size-8">
                <AvatarFallback className="bg-secondary text-xs font-semibold">{me.user.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{me.user}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await post("/api/logout")
                  onLogout()
                }}
              >
                <LogOut /> Abmelden
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">{children}</main>
    </div>
  )
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4 [&>*]:min-w-0">
      <div>
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {sub && <p className="mt-1.5 text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

export function Cover({ src, className, rounded = "rounded-md" }: { src?: string | null; className?: string; rounded?: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className={cn("aspect-square bg-muted object-cover", rounded, className)}
      onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")} />
  ) : (
    <div className={cn("aspect-square bg-muted", rounded, className)} />
  )
}
