/**
 * Application routes.
 *
 * 来源：C3 P0 #8 + C1 C-71/72
 *   - 所有视图 React.lazy（首屏 bundle 减 200~300KB）
 *   - <Suspense fallback={<RouteSkeleton />}> 占位
 *   - <Workbench key={urlRunId}> 强制 remount，避免切换 run 残留旧状态
 */
import { Suspense, lazy } from 'react'
import { Routes, Route, useParams } from 'react-router-dom'
import { APP_ROUTES, COMMON } from '../i18n/zh'
import { Loader2 } from 'lucide-react'

// 懒加载视图（首屏只装 Dashboard 即可）
const Dashboard = lazy(() => import('../views/Dashboard'))
const Demo = lazy(() => import('../views/Demo'))
const Simulation = lazy(() => import('../views/Simulation'))
const Report = lazy(() => import('../views/Report'))
const Workbench = lazy(() => import('../views/Workbench'))
// PR-3 P2-1：多 run 横向对比页（featureFlags.compareRuns = false 时也加载但渲染提示）
const CompareRuns = lazy(() => import('../views/CompareRuns'))

/** 路由级 loading 占位（避免切换白屏） */
function RouteSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center text-ink-500 dark:text-ink-400">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="animate-spin" size={28} />
        <div className="text-sm">{COMMON.loading}</div>
      </div>
    </div>
  )
}

/** Workbench 按 runId 强制 remount（避免切 run 时旧 SSE/轮询残留） */
function WorkbenchRouteWithKey() {
  const { runId } = useParams<{ runId: string }>()
  return <Workbench key={runId} />
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteSkeleton />}>
      <Routes>
        <Route path={APP_ROUTES.home} element={<Dashboard />} />
        <Route path="/demo" element={<Demo />} />
        <Route path="/simulation/:runId" element={<Simulation />} />
        <Route path="/report/:reportId" element={<Report />} />
        <Route path="/workbench" element={<Workbench />} />
        {/* Workbench 强制 remount：切 run 时丢弃旧 store 订阅、SSE、轮询等 */}
        <Route path="/workbench/:runId" element={<WorkbenchRouteWithKey />} />
        {/* PR-3 P2-1：多 run 横向对比页（?runs=id1,id2,id3 最多 3 个） */}
        <Route path={APP_ROUTES.compare} element={<CompareRuns />} />
        <Route
          path="*"
          element={
            <div className="min-h-screen flex items-center justify-center px-6">
              <div className="card p-8 text-center max-w-md">
                <div className="text-5xl font-bold text-ink-300 dark:text-ink-700 mb-2">404</div>
                <div className="text-ink-700 dark:text-ink-200 mb-4">{APP_ROUTES.notFound}</div>
                <a href={APP_ROUTES.home} className="btn-primary inline-flex">
                  {COMMON.backToDashboard}
                </a>
              </div>
            </div>
          }
        />
      </Routes>
    </Suspense>
  )
}
