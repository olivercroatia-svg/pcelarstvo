import {
  BarChart3,
  Bell,
  Boxes,
  Bug,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  CloudOff,
  Crown,
  Droplet,
  Droplets,
  FileText,
  Flower2,
  FolderOpen,
  GitBranch,
  Grid2x2,
  HandCoins,
  HeartPulse,
  Home,
  Layers,
  LogOut,
  Menu,
  Moon,
  NotebookPen,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  Gauge,
  Settings2,
  ShoppingCart,
  Sun,
  Syringe,
  Tag,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Warehouse,
  X,
} from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { useConfirm } from '@/components/ui/confirm'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { useOutbox } from '@/lib/outbox'
import { useTheme } from '@/lib/theme'
import type { AppNotification } from '@/lib/types'
import { useResource } from '@/lib/useResource'
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

/**
 * The modules that live in the drawer rather than the bottom bar, grouped the way a beekeeper
 * thinks about them: the colonies, their health, the honey, and the paperwork.
 */
const DRAWER_GROUPS: {
  title: string
  links: { to: string; label: string; icon: ComponentType<{ className?: string }> }[]
}[] = [
  {
    title: 'Pčelinjak',
    links: [
      { to: '/matice', label: 'Matice', icon: Crown },
      { to: '/kosnice/naljepnice', label: 'QR naljepnice', icon: Boxes },
    ],
  },
  {
    title: 'Zdravlje',
    links: [
      { to: '/varroa', label: 'Kontrola varoe', icon: Bug },
      { to: '/tretmani', label: 'VMP i tretmani', icon: Syringe },
      { to: '/zdravlje', label: 'Zdravstveni karton', icon: HeartPulse },
      { to: '/prihrana', label: 'Prihrana', icon: Droplet },
    ],
  },
  {
    title: 'Proizvodnja',
    links: [
      { to: '/vrcanja', label: 'Vrcanje', icon: Droplets },
      { to: '/serije', label: 'Serije meda', icon: Layers },
      { to: '/skladiste', label: 'Skladište', icon: Warehouse },
      { to: '/proizvodi', label: 'Proizvodi', icon: Tag },
      { to: '/sljedivost', label: 'Sljedivost', icon: GitBranch },
    ],
  },
  {
    title: 'Sezona i teren',
    links: [
      { to: '/kalendar', label: 'Sezonski kalendar', icon: CalendarDays },
      { to: '/pase', label: 'Paše', icon: Flower2 },
      { to: '/selidbe', label: 'Selidbe', icon: Truck },
      { to: '/dnevnik', label: 'Dnevnik', icon: NotebookPen },
      { to: '/analitika', label: 'Analitika', icon: BarChart3 },
      // §45 — grouped with the other reading tools rather than given a header icon: the header
      // already carries five things at 390 px, and a sixth pushes the farm name to an ellipsis.
      { to: '/asistent', label: 'AI asistent', icon: Sparkles },
    ],
  },
  {
    title: 'Zakon i papiri',
    links: [
      { to: '/dokumenti', label: 'Dokumenti', icon: FolderOpen },
      { to: '/inspekcija', label: 'Inspekcija', icon: ClipboardCheck },
      { to: '/izvjestaj', label: 'Godišnji izvještaj', icon: FileText },
      { to: '/profil', label: 'Profil i gospodarstvo', icon: UserCog },
      // §56 — export and account deletion. In the drawer rather than buried in the profile form,
      // because a right nobody can find is a right on paper only.
      { to: '/moji-podaci', label: 'Moji podaci', icon: ShieldCheck },
    ],
  },
]

/**
 * §4 — the money. Shown only to an owner.
 *
 * Hiding the links is a courtesy, not the control: every one of these routes answers 403 for a
 * worker before a byte of data leaves the server. What this prevents is a worker tapping "Prodaja"
 * and being told off for it.
 */
const OWNER_GROUP: (typeof DRAWER_GROUPS)[number] = {
  title: 'Komercijala',
  links: [
    { to: '/prodaja', label: 'Prodaja', icon: ShoppingCart },
    { to: '/kupci', label: 'Kupci', icon: Users },
    { to: '/troskovi', label: 'Troškovi', icon: Receipt },
    { to: '/ekonomika', label: 'Ekonomika', icon: TrendingUp },
    { to: '/potpore', label: 'Potpore', icon: HandCoins },
    // §4 — the AI meter is a cost report, so it belongs in the owner's group with the rest.
    { to: '/ai-potrosnja', label: 'Potrošnja AI', icon: Gauge },
  ],
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { current, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { pending, online } = useOutbox()
  const confirm = useConfirm()
  const { showError } = useToast()
  const navigate = useNavigate()

  // Only the count is needed, so ask for the shortest list the API will return. Skipped entirely
  // for a user without a farm — a system administrator, typically — because every farm-scoped
  // route answers 404 for them and this one fires on every single screen.
  const { data: notificationData } = useResource<{ notifications: AppNotification[]; unreadCount: number }>(
    current?.farm ? '/notifications?unread=1&limit=1' : null,
  )
  const unread = notificationData?.unreadCount ?? 0

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
        {(!online || pending.length > 0) && (
          <NavLink
            to="/unos"
            aria-label={`${pending.length} zapisa čeka slanje`}
            className="flex items-center gap-1 rounded-lg bg-caution/15 px-2 py-1.5 text-xs font-medium text-caution"
          >
            <CloudOff className="size-4" />
            {pending.length > 0 && <span className="tabular">{pending.length}</span>}
          </NavLink>
        )}
        {/* §52 — the global search. In the header rather than the drawer because it is the thing
            most often reached for, and because a search two taps deep does not get used. */}
        <NavLink
          to="/trazi"
          aria-label="Traži"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Search className="size-5" />
        </NavLink>
        {/* §53 — the badge is the only place the notification centre announces itself. */}
        <NavLink
          to="/obavijesti"
          aria-label={unread > 0 ? `Obavijesti, ${unread} nepročitanih` : 'Obavijesti'}
          className="relative rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="tabular absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </NavLink>
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
              {[...DRAWER_GROUPS, ...(current?.role === 'owner' ? [OWNER_GROUP] : [])].map((group) => (
                <div key={group.title} className="mb-2">
                  <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </p>
                  {group.links.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent"
                    >
                      <Icon className="size-4" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              ))}
              {/* §54 — only system administrators; the server enforces it regardless. */}
              {current?.user.isAdmin && (
                <div className="mt-1 border-t border-border pt-2">
                  <NavLink
                    to="/admin/obveze"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent"
                  >
                    <Settings2 className="size-4" />
                    Administracija propisa
                  </NavLink>
                  <NavLink
                    to="/admin/proizvodnja"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent"
                  >
                    <Settings2 className="size-4" />
                    Proizvodnja — propisi
                  </NavLink>
                  <NavLink
                    to="/admin/sezona"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent"
                  >
                    <Settings2 className="size-4" />
                    Sezona i potpore
                  </NavLink>
                </div>
              )}
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
