import {
  Boxes,
  CalendarCheck,
  Grid2x2,
  Home,
  LogOut,
  Menu,
  Moon,
  Plus,
  Sun,
  UserCog,
  X,
} from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { useConfirm } from '@/components/ui/confirm'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  primary?: boolean
}

// §3 — the five bottom-bar destinations. Everything else lives in the hamburger.
const BOTTOM_NAV: NavItem[] = [
  { to: '/', label: 'Početna', icon: Home },
  { to: '/pcelinjaci', label: 'Pčelinjaci', icon: Grid2x2 },
  { to: '/kosnice', label: 'Košnice', icon: Boxes },
  { to: '/unos', label: 'Unos', icon: Plus, primary: true },
  { to: '/obveze', label: 'Obveze', icon: CalendarCheck },
]

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { current, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const confirm = useConfirm()
  const { showError } = useToast()
  const navigate = useNavigate()

  async function handleLogout() {
    const ok = await confirm({
      title: 'Odjava',
      description: 'Želite li se odjaviti iz aplikacije?',
      confirmLabel: 'Odjavi se',
    })
    if (!ok) return
    try {
      await logout()
      navigate('/prijava', { replace: true })
    } catch {
      showError('Odjava nije uspjela. Pokušajte ponovno.')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <BrandMark className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            {current?.farm?.name ?? 'Moj Pčelinjak'}
          </p>
          {current?.farm?.eppNumber && (
            <p className="truncate text-xs text-muted-foreground">EPP {current.farm.eppNumber}</p>
          )}
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Uključi dnevni prikaz' : 'Uključi noćni prikaz'}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Otvori izbornik"
          aria-expanded={menuOpen}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {/* pb-28 clears the fixed bottom bar so the last card is never trapped underneath it. */}
      <main className="flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>

      <nav
        aria-label="Glavna navigacija"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-safe backdrop-blur"
      >
        <ul className="mx-auto flex max-w-lg items-stretch">
          {BOTTOM_NAV.map(({ to, label, icon: Icon, primary }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        'flex items-center justify-center rounded-full transition-colors',
                        primary
                          ? 'size-10 bg-primary text-primary-foreground'
                          : cn('size-8', isActive && 'bg-accent'),
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setMenuOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Izbornik"
            className="ml-auto flex h-full w-72 max-w-[85vw] flex-col border-l border-border bg-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <p className="font-semibold">Izbornik</p>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Zatvori izbornik"
                className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="border-b border-border p-4">
              <p className="text-sm font-medium">
                {current?.user.firstName} {current?.user.lastName}
              </p>
              <p className="truncate text-xs text-muted-foreground">{current?.user.email}</p>
              {current?.role === 'worker' && (
                <p className="mt-1 inline-block rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                  Suradnik
                </p>
              )}
            </div>

            <nav className="flex-1 overflow-y-auto p-2">
              <NavLink
                to="/profil"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent"
              >
                <UserCog className="size-4" />
                Profil i gospodarstvo
              </NavLink>
              {/* Etapa 2+ adds the rest of the drawer: dokumenti, skladište, prodaja, izvještaji. */}
            </nav>

            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-destructive hover:bg-accent"
              >
                <LogOut className="size-4" />
                Odjava
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
