import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { BrandMark } from '@/components/BrandMark'
import { useAuth } from '@/auth/AuthContext'
import { DashboardPage } from '@/pages/Dashboard'
import { LoginPage } from '@/pages/Login'
import { PlaceholderPage } from '@/pages/Placeholder'
import { ProfilePage } from '@/pages/Profile'
import { RegisterPage } from '@/pages/Register'

function BootSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-honeycomb">
      <BrandMark className="size-12 animate-pulse" />
      <span className="sr-only">Učitavanje…</span>
    </div>
  )
}

/** Blocks the app shell until the session is known, so a signed-in reload never flashes /prijava. */
function RequireAuth() {
  const { current, loading } = useAuth()
  if (loading) return <BootSplash />
  if (!current) return <Navigate to="/prijava" replace />
  return <Outlet />
}

/** Keeps a signed-in user out of the login and registration screens. */
function RequireAnonymous() {
  const { current, loading } = useAuth()
  if (loading) return <BootSplash />
  if (current) return <Navigate to="/" replace />
  return <Outlet />
}

export function App() {
  return (
    <Routes>
      <Route element={<RequireAnonymous />}>
        <Route path="/prijava" element={<LoginPage />} />
        <Route path="/registracija" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/profil" element={<ProfilePage />} />
          <Route path="/pcelinjaci" element={<PlaceholderPage title="Pčelinjaci" stage="etapi 1" />} />
          <Route path="/kosnice" element={<PlaceholderPage title="Košnice" stage="etapi 1" />} />
          <Route path="/unos" element={<PlaceholderPage title="Brzi unos" stage="etapi 1" />} />
          <Route path="/obveze" element={<PlaceholderPage title="Moje obveze" stage="etapi 2" />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
