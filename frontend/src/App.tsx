import { lazy } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { BrandMark } from '@/components/BrandMark'
import { useAuth } from '@/auth/AuthContext'
import { AdminAiPage } from '@/pages/AdminAi'
import { AdminCommercePage } from '@/pages/AdminCommerce'
import { AdminObligationsPage } from '@/pages/AdminObligations'
import { AdminProductionPage } from '@/pages/AdminProduction'
import { AiUsagePage } from '@/pages/AiUsage'
import { AnalyticsPage } from '@/pages/Analytics'
import { AssistantPage } from '@/pages/Assistant'
import { ApiariesPage } from '@/pages/Apiaries'
import { ApiaryDetailPage } from '@/pages/ApiaryDetail'
import { ApiaryFormPage } from '@/pages/ApiaryForm'
import { BatchDetailPage } from '@/pages/BatchDetail'
import { BatchEntryPage } from '@/pages/BatchEntry'
import { BatchesPage } from '@/pages/Batches'
import { CustomerDetailPage } from '@/pages/CustomerDetail'
import { CustomersPage } from '@/pages/Customers'
import { DashboardPage } from '@/pages/Dashboard'
import { DocumentsPage } from '@/pages/Documents'
import { EconomicsPage } from '@/pages/Economics'
import { EntryPage } from '@/pages/Entry'
import { ExpensesPage } from '@/pages/Expenses'
import { FeedingPage } from '@/pages/Feeding'
import { HarvestDetailPage } from '@/pages/HarvestDetail'
import { HarvestNewPage } from '@/pages/HarvestNew'
import { HarvestsPage } from '@/pages/Harvests'
import { HealthPage } from '@/pages/Health'
import { HiveDetailPage } from '@/pages/HiveDetail'
import { HiveLabelsPage } from '@/pages/HiveLabels'
import { HiveNewPage } from '@/pages/HiveNew'
import { HivesPage } from '@/pages/Hives'
import { InspectionPage } from '@/pages/Inspection'
import { InspectionModePage } from '@/pages/InspectionMode'
import { InventoryPage } from '@/pages/Inventory'
import { InventoryItemPage } from '@/pages/InventoryItem'
import { LabTestDetailPage } from '@/pages/LabTestDetail'
import { LabTestNewPage } from '@/pages/LabTestNew'
import { LoginPage } from '@/pages/Login'
import { MyDataPage } from '@/pages/MyData'
import { NotificationsPage } from '@/pages/Notifications'
import { ObligationDetailPage } from '@/pages/ObligationDetail'
import { ObligationsPage } from '@/pages/Obligations'
import { PackagingDetailPage } from '@/pages/PackagingDetail'
import { PackagingNewPage } from '@/pages/PackagingNew'
import { PasturesPage } from '@/pages/Pastures'
import { ProductsPage } from '@/pages/Products'
// PlaceholderPage is gone from the routes now that /obveze is real; the file itself is left in
// place for the modules still to come.
import { ProfilePage } from '@/pages/Profile'
import { QueensPage } from '@/pages/Queens'
import { ReadinessPage } from '@/pages/Readiness'
import { RegisterPage } from '@/pages/Register'
import { RelocationDetailPage } from '@/pages/RelocationDetail'
import { RelocationsPage } from '@/pages/Relocations'
import { SaleDetailPage } from '@/pages/SaleDetail'
import { SaleNewPage } from '@/pages/SaleNew'
import { SalesPage } from '@/pages/Sales'
import { SearchPage } from '@/pages/Search'
import { SeasonPage } from '@/pages/Season'
import { SubsidiesPage } from '@/pages/Subsidies'
import { SubsidyDetailPage } from '@/pages/SubsidyDetail'
import { TimelinePage } from '@/pages/Timeline'
import { TraceabilityPage } from '@/pages/Traceability'
import { TreatmentDetailPage } from '@/pages/TreatmentDetail'
import { TreatmentNewPage } from '@/pages/TreatmentNew'
import { TreatmentsPage } from '@/pages/Treatments'
import { VarroaPage } from '@/pages/Varroa'
import { VarroaNewPage } from '@/pages/VarroaNew'
import { VisitPage } from '@/pages/Visit'
import { VmpProductsPage } from '@/pages/VmpProducts'
import { VoiceEntryPage } from '@/pages/VoiceEntry'
import { LazyRoute } from '@/components/lazy'

// ZXing is ~400 kB and only needed when the camera is actually opened.
const ScanPage = lazy(() => import('@/pages/Scan').then((m) => ({ default: m.ScanPage })))
// The printable data sheet is opened once or twice a year; no reason for it to sit in the bundle
// a beekeeper downloads to record an inspection.
const FormPreviewPage = lazy(() =>
  import('@/pages/FormPreview').then((m) => ({ default: m.FormPreviewPage })),
)
// Printed when a batch is jarred, a handful of times a season.
const DeclarationPage = lazy(() =>
  import('@/pages/Declaration').then((m) => ({ default: m.DeclarationPage })),
)
// §35 — reached by strangers with a phone camera, never from inside the application. Kept out of
// the main chunk so a customer scanning a jar downloads a page, not a beekeeping app.
const PublicJarPage = lazy(() => import('@/pages/PublicJar').then((m) => ({ default: m.PublicJarPage })))
// §49 — fourteen sections and a print stylesheet, opened once a year. Same reasoning as the forms
// and the declaration: it has no business in the bundle a beekeeper downloads on a hillside.
const AnnualReportPage = lazy(() =>
  import('@/pages/AnnualReport').then((m) => ({ default: m.AnnualReportPage })),
)
// §65, §66 — written for someone who does not have the app yet. A beekeeper opening the installed
// PWA to record a visit should not download the sales pitch on the way to the dashboard.
const LandingPage = lazy(() => import('@/pages/Landing').then((m) => ({ default: m.LandingPage })))
// §56 — read before signing up, and reachable from the footer without an account.
const PrivacyPage = lazy(() => import('@/pages/Privacy').then((m) => ({ default: m.PrivacyPage })))

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
  const { pathname } = useLocation()

  if (loading) return <BootSplash />
  if (!current) {
    // §65 — the root address belongs to whoever asks for it. A stranger typing the domain is
    // reading about the application and gets the landing page; a beekeeper who asked for
    // /kosnice/12 wanted that specific screen and gets the login form, because that is where the
    // journey continues after signing in.
    if (pathname === '/') {
      return (
        <LazyRoute>
          <LandingPage />
        </LazyRoute>
      )
    }
    return <Navigate to="/prijava" replace />
  }
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
      {/* §35 — outside both guards on purpose. A customer scanning a jar has no account, and this
          page must never redirect them to a login screen or show them anything of the beekeeper's
          beyond what the public endpoint returns. */}
      <Route path="/staklenka/:token" element={<LazyRoute><PublicJarPage /></LazyRoute>} />

      {/* §56 — outside both guards for the same reason: someone deciding whether to open an
          account has to be able to read what happens to their data first, and a signed-in
          beekeeper reaches the same page from the drawer. */}
      <Route path="/privatnost" element={<LazyRoute><PrivacyPage /></LazyRoute>} />

      <Route element={<RequireAnonymous />}>
        <Route path="/prijava" element={<LoginPage />} />
        <Route path="/registracija" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/profil" element={<ProfilePage />} />
          {/* §56 — GDPR čl. 15, 17 and 20, as two buttons. */}
          <Route path="/moji-podaci" element={<MyDataPage />} />

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

          {/* Proizvodnja i sljedivost (§28–§36) */}
          <Route path="/vrcanja" element={<HarvestsPage />} />
          <Route path="/vrcanja/novo" element={<HarvestNewPage />} />
          <Route path="/vrcanja/:id" element={<HarvestDetailPage />} />

          <Route path="/serije" element={<BatchesPage />} />
          <Route path="/serije/:id" element={<BatchDetailPage />} />
          <Route path="/serije/:id/nalaz" element={<LabTestNewPage />} />
          <Route path="/serije/:id/pakiranje" element={<PackagingNewPage />} />
          <Route path="/nalazi/:id" element={<LabTestDetailPage />} />

          <Route path="/pakiranja/:id" element={<PackagingDetailPage />} />
          <Route path="/pakiranja/:id/deklaracija" element={<LazyRoute><DeclarationPage /></LazyRoute>} />
          <Route path="/proizvodi" element={<ProductsPage />} />

          <Route path="/skladiste" element={<InventoryPage />} />
          <Route path="/skladiste/:id" element={<InventoryItemPage />} />

          <Route path="/sljedivost" element={<TraceabilityPage />} />
          <Route path="/sljedivost/:key" element={<TraceabilityPage />} />

          {/* Sezona i teren (§19–§21). Not financial, so a worker reaches these too. */}
          <Route path="/kalendar" element={<SeasonPage />} />
          <Route path="/pase" element={<PasturesPage />} />
          <Route path="/selidbe" element={<RelocationsPage />} />
          <Route path="/selidbe/:id" element={<RelocationDetailPage />} />

          {/* Čitanje kroz sve module (§41–§43, §48, §49, §52). */}
          <Route path="/analitika" element={<AnalyticsPage />} />
          <Route path="/dnevnik" element={<TimelinePage />} />
          <Route path="/trazi" element={<SearchPage />} />
          {/* AI sloj (§13, §45). The screens check /api/ai/status themselves and explain
              their own absence, so the routes exist even where no key is configured — a 404
              on a link the drawer just showed is worse than a page that says why. */}
          <Route path="/asistent" element={<AssistantPage />} />
          <Route path="/glasovni-unos" element={<VoiceEntryPage />} />
          <Route path="/ai-potrosnja" element={<AiUsagePage />} />
          <Route path="/izvjestaj" element={<LazyRoute><AnnualReportPage /></LazyRoute>} />

          {/* Komercijala (§37–§40, §50). The API answers 403 for a worker; these routes exist for
              everyone because a hidden route is not an access control and the server is. */}
          <Route path="/prodaja" element={<SalesPage />} />
          <Route path="/prodaja/nova" element={<SaleNewPage />} />
          <Route path="/prodaja/:id" element={<SaleDetailPage />} />
          <Route path="/kupci" element={<CustomersPage />} />
          <Route path="/kupci/:id" element={<CustomerDetailPage />} />
          <Route path="/troskovi" element={<ExpensesPage />} />
          <Route path="/ekonomika" element={<EconomicsPage />} />
          <Route path="/potpore" element={<SubsidiesPage />} />
          <Route path="/potpore/:id" element={<SubsidyDetailPage />} />

          {/* §54 — the admin routes are guarded on the server; this only hides the links. */}
          <Route path="/admin/obveze" element={<AdminObligationsPage />} />
          <Route path="/admin/proizvodnja" element={<AdminProductionPage />} />
          <Route path="/admin/sezona" element={<AdminCommercePage />} />
          <Route path="/admin/ai" element={<AdminAiPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
