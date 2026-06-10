/**
 * Workbench barrel exports (T2.2)
 *
 * Re-exports the redesigned Workbench subcomponents so callers can do
 *
 *   import { WorkbenchLayout, RoundTimeline, RightRail, ExecSummary }
 *     from '../components/Workbench'
 *
 * Each subcomponent is a top-level export of its own file. The legacy
 * `Workbench` view (src/views/Workbench.tsx) composes them.
 */
export { default as WorkbenchLayout } from './WorkbenchLayout'
export { default as RoundTimeline } from './RoundTimeline'
export { default as RightRail } from './RightRail'
export { default as ExecSummary } from './ExecSummary'
export { default as StateHero } from './StateHero'
export {
  WorkbenchStateProvider,
  useWorkbenchState,
  type WorkbenchState,
  type WorkbenchStateApi,
  type BannerInfo,
} from './WorkbenchStateProvider'
export { default as DeeperSimCta } from './DeeperSimCta'
export { default as DeptMini } from './DeptMini'
export { default as EmergedTopicsTimeline } from './EmergedTopicsTimeline'
export { default as GraphRoundDiff } from './GraphRoundDiff'
export { default as Stat } from './Stat'
