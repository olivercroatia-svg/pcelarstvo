import { lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { BrandMark } from '@/components/BrandMark'
import { useAuth } from '@/auth/AuthContext'
import { ApiariesPage } from '@/pages/Apiaries'
import { ApiaryDetailPage } from '@/pages/ApiaryDetail'
import { ApiaryFormPage } from '@/pages/ApiaryForm'
import { BatchEntryPage } from '@/pages/BatchEntry'
import { DashboardPage } from '@/pages/Dashboard'
import { EntryPage } from '@/pages/Entry'
import { HiveDetailPage } from '@/pages/HiveDetail'
import { HiveLabelsPage } from '@/pages/HiveLabels'
import { HiveNewPage } from '@/pages/HiveNew'
import { HivesPage } from '@/pages/Hives'
import { InspectionPage } from '@/pages/Inspection'
import { LoginPage } from '@/pages/Login'
import { PlaceholderPage } from '@/pages/Placeholder'
import { ProfilePage } from '@/pages/Profile'
import { QueensPage } from '@/pages/Queens'
import { RegisterPage } from '@/pages/Register'
import { VisitPage } from '@/pages/Visit'
import { LazyRoute } from '@/components/lazy'

// ZXing is ~400 kB and only needed when the camera is actually opened.
const ScanPage = lazy(() => import('@/pages/Scan').then((m) => ({ default: m.ScanPage })))

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

          <Route path="/pcelinjaci" element={<ApiariesPage />} />
          <Route path="/pcelinjaci/novi" element={<ApiaryFormPage />} />
          <Route path="/pcelinjaci/:id" element={<ApiaryDetailPage />} />
          <Route path="/pcelinjaci/:id/uredi" element={<ApiaryFormPage />} />

          <Route path="/kosnice" element={<HivesPage />} />
          <Route path="/kosnice/nove" element={<HiveNewPage />} />
          <Route path="/kosnice/naljepnice" element={<HiveLabelsPage />} />
          <Route path="/kosnice/:id" element={<HiveDetailPage />} />

          <Route path="/matice" element={<QueensPage />} />

          <Route path="/unos" element={<EntryPage />} />
          <Route path="/unos/:hiveId" element={<InspectionPage />} />
          <Route path="/skupni-unos" element={<BatchEntryPage />} />
          <Route path="/obilazak/:id" element={<VisitPage />} />

          {/* Deep link from a phone's own camera app reading a hive label. */}
          <Route path="/skeniraj" element={<LazyRoute><ScanPage /></LazyRoute>} />
          <Route path="/skeniraj/:token" element={<LazyRoute><ScanPage /></LazyRoute>} />

          <Route path="/obveze" element={<PlaceholderPage title="Moje obveze" stage="etapi 2" />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
