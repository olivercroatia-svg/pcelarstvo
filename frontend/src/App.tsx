import { lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { BrandMark } from '@/components/BrandMark'
import { useAuth } from '@/auth/AuthContext'
import { AdminObligationsPage } from '@/pages/AdminObligations'
import { ApiariesPage } from '@/pages/Apiaries'
import { ApiaryDetailPage } from '@/pages/ApiaryDetail'
import { ApiaryFormPage } from '@/pages/ApiaryForm'
import { BatchEntryPage } from '@/pages/BatchEntry'
import { DashboardPage } from '@/pages/Dashboard'
import { DocumentsPage } from '@/pages/Documents'
import { EntryPage } from '@/pages/Entry'
import { FeedingPage } from '@/pages/Feeding'
import { HealthPage } from '@/pages/Health'
import { HiveDetailPage } from '@/pages/HiveDetail'
import { HiveLabelsPage } from '@/pages/HiveLabels'
import { HiveNewPage } from '@/pages/HiveNew'
import { HivesPage } from '@/pages/Hives'
import { InspectionPage } from '@/pages/Inspection'
import { InspectionModePage } from '@/pages/InspectionMode'
import { LoginPage } from '@/pages/Login'
import { NotificationsPage } from '@/pages/Notifications'
import { ObligationDetailPage } from '@/pages/ObligationDetail'
import { ObligationsPage } from '@/pages/Obligations'
// PlaceholderPage is gone from the routes now that /obveze is real; the file itself is left in
// place for the modules still to come.
import { ProfilePage } from '@/pages/Profile'
import { QueensPage } from '@/pages/Queens'
import { ReadinessPage } from '@/pages/Readiness'
import { RegisterPage } from '@/pages/Register'
import { TreatmentDetailPage } from '@/pages/TreatmentDetail'
import { TreatmentNewPage } from '@/pages/TreatmentNew'
import { TreatmentsPage } from '@/pages/Treatments'
import { VarroaPage } from '@/pages/Varroa'
import { VarroaNewPage } from '@/pages/VarroaNew'
import { VisitPage } from '@/pages/Visit'
import { VmpProductsPage } from '@/pages/VmpProducts'
import { LazyRoute } from '@/components/lazy'

// ZXing is ~400 kB and only needed when the camera is actually opened.
const ScanPage = lazy(() => import('@/pages/Scan').then((m) => ({ default: m.ScanPage })))
// The printable data sheet is opened once or twice a year; no reason for it to sit in the bundle
// a beekeeper downloads to record an inspection.
const FormPreviewPage = lazy(() =>
  import('@/pages/FormPreview').then((m) => ({ default: m.FormPreviewPage })),
)

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

          {/* Zdravlje (§15–§17) */}
          <Route path="/zdravlje" element={<HealthPage />} />
          <Route path="/varroa" element={<VarroaPage />} />
          <Route path="/varroa/nova" element={<VarroaNewPage />} />
          <Route path="/tretmani" element={<TreatmentsPage />} />
          <Route path="/tretmani/novi" element={<TreatmentNewPage />} />
          <Route path="/tretmani/:id" element={<TreatmentDetailPage />} />
          <Route path="/vmp" element={<VmpProductsPage />} />
          <Route path="/prihrana" element={<FeedingPage />} />

          {/* Zakon i papiri (§22–§27, §53) */}
          <Route path="/obveze" element={<ObligationsPage />} />
          <Route path="/obveze/:id" element={<ObligationDetailPage />} />
          <Route path="/obrasci/:code" element={<LazyRoute><FormPreviewPage /></LazyRoute>} />
          <Route path="/dokumenti" element={<DocumentsPage />} />
          <Route path="/obavijesti" element={<NotificationsPage />} />
          <Route path="/inspekcija" element={<InspectionModePage />} />
          <Route path="/inspekcija/spremnost" element={<ReadinessPage />} />

          {/* §54 — the admin route is guarded on the server; this only hides the link. */}
          <Route path="/admin/obveze" element={<AdminObligationsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
