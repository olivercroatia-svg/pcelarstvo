import { lazy, type ComponentType } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { BrandMark } from '@/components/BrandMark'
import { useAuth } from '@/auth/AuthContext'
import { LazyRoute } from '@/components/lazy'

/** Every route owns a chunk; opening the dashboard no longer downloads the entire application. */
function lazyPage(loader: () => Promise<unknown>, exportName: string) {
  return lazy(async () => {
    const module = (await loader()) as Record<string, ComponentType>
    return { default: module[exportName]! }
  })
}

const AdminAiPage = lazyPage(() => import('@/pages/AdminAi'), 'AdminAiPage')
const AdminCommercePage = lazyPage(() => import('@/pages/AdminCommerce'), 'AdminCommercePage')
const AdminObligationsPage = lazyPage(() => import('@/pages/AdminObligations'), 'AdminObligationsPage')
const AdminProductionPage = lazyPage(() => import('@/pages/AdminProduction'), 'AdminProductionPage')
const AiUsagePage = lazyPage(() => import('@/pages/AiUsage'), 'AiUsagePage')
const AnalyticsPage = lazyPage(() => import('@/pages/Analytics'), 'AnalyticsPage')
const AnnualReportPage = lazyPage(() => import('@/pages/AnnualReport'), 'AnnualReportPage')
const ApiariesPage = lazyPage(() => import('@/pages/Apiaries'), 'ApiariesPage')
const ApiaryDetailPage = lazyPage(() => import('@/pages/ApiaryDetail'), 'ApiaryDetailPage')
const ApiaryFormPage = lazyPage(() => import('@/pages/ApiaryForm'), 'ApiaryFormPage')
const AssistantPage = lazyPage(() => import('@/pages/Assistant'), 'AssistantPage')
const BatchDetailPage = lazyPage(() => import('@/pages/BatchDetail'), 'BatchDetailPage')
const BatchEntryPage = lazyPage(() => import('@/pages/BatchEntry'), 'BatchEntryPage')
const BatchesPage = lazyPage(() => import('@/pages/Batches'), 'BatchesPage')
const CustomerDetailPage = lazyPage(() => import('@/pages/CustomerDetail'), 'CustomerDetailPage')
const CustomersPage = lazyPage(() => import('@/pages/Customers'), 'CustomersPage')
const DashboardPage = lazyPage(() => import('@/pages/Dashboard'), 'DashboardPage')
const DeclarationPage = lazyPage(() => import('@/pages/Declaration'), 'DeclarationPage')
const DocumentsPage = lazyPage(() => import('@/pages/Documents'), 'DocumentsPage')
const EconomicsPage = lazyPage(() => import('@/pages/Economics'), 'EconomicsPage')
const EntryPage = lazyPage(() => import('@/pages/Entry'), 'EntryPage')
const ExpensesPage = lazyPage(() => import('@/pages/Expenses'), 'ExpensesPage')
const FeedingPage = lazyPage(() => import('@/pages/Feeding'), 'FeedingPage')
const FormPreviewPage = lazyPage(() => import('@/pages/FormPreview'), 'FormPreviewPage')
const HarvestDetailPage = lazyPage(() => import('@/pages/HarvestDetail'), 'HarvestDetailPage')
const HarvestNewPage = lazyPage(() => import('@/pages/HarvestNew'), 'HarvestNewPage')
const HarvestsPage = lazyPage(() => import('@/pages/Harvests'), 'HarvestsPage')
const HealthPage = lazyPage(() => import('@/pages/Health'), 'HealthPage')
const HiveDetailPage = lazyPage(() => import('@/pages/HiveDetail'), 'HiveDetailPage')
const HiveLabelsPage = lazyPage(() => import('@/pages/HiveLabels'), 'HiveLabelsPage')
const HiveNewPage = lazyPage(() => import('@/pages/HiveNew'), 'HiveNewPage')
const HivesPage = lazyPage(() => import('@/pages/Hives'), 'HivesPage')
const InspectionModePage = lazyPage(() => import('@/pages/InspectionMode'), 'InspectionModePage')
const InspectionPage = lazyPage(() => import('@/pages/Inspection'), 'InspectionPage')
const InventoryItemPage = lazyPage(() => import('@/pages/InventoryItem'), 'InventoryItemPage')
const InventoryPage = lazyPage(() => import('@/pages/Inventory'), 'InventoryPage')
const LabTestDetailPage = lazyPage(() => import('@/pages/LabTestDetail'), 'LabTestDetailPage')
const LabTestNewPage = lazyPage(() => import('@/pages/LabTestNew'), 'LabTestNewPage')
const LandingPage = lazyPage(() => import('@/pages/Landing'), 'LandingPage')
const LoginPage = lazyPage(() => import('@/pages/Login'), 'LoginPage')
const MyDataPage = lazyPage(() => import('@/pages/MyData'), 'MyDataPage')
const NotificationsPage = lazyPage(() => import('@/pages/Notifications'), 'NotificationsPage')
const ObligationDetailPage = lazyPage(() => import('@/pages/ObligationDetail'), 'ObligationDetailPage')
const ObligationsPage = lazyPage(() => import('@/pages/Obligations'), 'ObligationsPage')
const PackagingDetailPage = lazyPage(() => import('@/pages/PackagingDetail'), 'PackagingDetailPage')
const PackagingNewPage = lazyPage(() => import('@/pages/PackagingNew'), 'PackagingNewPage')
const PasturesPage = lazyPage(() => import('@/pages/Pastures'), 'PasturesPage')
const PrivacyPage = lazyPage(() => import('@/pages/Privacy'), 'PrivacyPage')
const ProductsPage = lazyPage(() => import('@/pages/Products'), 'ProductsPage')
const ProfilePage = lazyPage(() => import('@/pages/Profile'), 'ProfilePage')
const PublicJarPage = lazyPage(() => import('@/pages/PublicJar'), 'PublicJarPage')
const QueensPage = lazyPage(() => import('@/pages/Queens'), 'QueensPage')
const ReadinessPage = lazyPage(() => import('@/pages/Readiness'), 'ReadinessPage')
const RegisterPage = lazyPage(() => import('@/pages/Register'), 'RegisterPage')
const RelocationDetailPage = lazyPage(() => import('@/pages/RelocationDetail'), 'RelocationDetailPage')
const RelocationsPage = lazyPage(() => import('@/pages/Relocations'), 'RelocationsPage')
const SaleDetailPage = lazyPage(() => import('@/pages/SaleDetail'), 'SaleDetailPage')
const SaleNewPage = lazyPage(() => import('@/pages/SaleNew'), 'SaleNewPage')
const SalesPage = lazyPage(() => import('@/pages/Sales'), 'SalesPage')
const ScanPage = lazyPage(() => import('@/pages/Scan'), 'ScanPage')
const SearchPage = lazyPage(() => import('@/pages/Search'), 'SearchPage')
const SeasonPage = lazyPage(() => import('@/pages/Season'), 'SeasonPage')
const SubsidiesPage = lazyPage(() => import('@/pages/Subsidies'), 'SubsidiesPage')
const SubsidyDetailPage = lazyPage(() => import('@/pages/SubsidyDetail'), 'SubsidyDetailPage')
const TimelinePage = lazyPage(() => import('@/pages/Timeline'), 'TimelinePage')
const TraceabilityPage = lazyPage(() => import('@/pages/Traceability'), 'TraceabilityPage')
const TreatmentDetailPage = lazyPage(() => import('@/pages/TreatmentDetail'), 'TreatmentDetailPage')
const TreatmentNewPage = lazyPage(() => import('@/pages/TreatmentNew'), 'TreatmentNewPage')
const TreatmentsPage = lazyPage(() => import('@/pages/Treatments'), 'TreatmentsPage')
const VarroaNewPage = lazyPage(() => import('@/pages/VarroaNew'), 'VarroaNewPage')
const VarroaPage = lazyPage(() => import('@/pages/Varroa'), 'VarroaPage')
const VisitPage = lazyPage(() => import('@/pages/Visit'), 'VisitPage')
const VmpProductsPage = lazyPage(() => import('@/pages/VmpProducts'), 'VmpProductsPage')
const VoiceEntryPage = lazyPage(() => import('@/pages/VoiceEntry'), 'VoiceEntryPage')

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
        <Route path="/prijava" element={<LazyRoute><LoginPage /></LazyRoute>} />
        <Route path="/registracija" element={<LazyRoute><RegisterPage /></LazyRoute>} />
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
