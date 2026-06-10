/**
 * WorkbenchStateProvider — Workbench redesign (T2.6)
 *
 * Single source of truth for the Workbench's 9 explicit UI states.
 *
 * States:
 *   idle            — no runId, hero = rocket + "推演工作台就绪"
 *   configuring     — runId present but no round completed yet, hero = spinner
 *   running         — at least one round completed, status === 'running'
 *   paused          — status === 'paused' (banner + Resume)
 *   round-complete  — a round_completed event just arrived (1.5s flash)
 *   year-complete   — a year_advanced event just arrived (3s flash)
 *   completed       — terminal: success (status === 'completed', no further events)
 *   failed          — terminal: failure (status === 'failed', retry CTA)
 *   cancelled       — terminal: cancelled (status === 'cancelled')
 *
 * The provider exposes a single hook `useWorkbenchState()` that returns
 * `{ state, transitionTo, banners, clearBanner }`. Consumers do not have to
 * re-implement the state derivation; they just render per-state branches.
 *
 * Implements: loop-engine-v2-implementation.md §Phase 2 / T2.6
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import { useStatus, useRunId, useSimRounds, useYearAdvanced } from '../../store/pipeline'

export type WorkbenchState =
  | 'idle'
  | 'configuring'
  | 'running'
  | 'paused'
  | 'round-complete'
  | 'year-complete'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface BannerInfo {
  variant: 'info' | 'warn' | 'success' | 'error'
  title: string
  hint?: string
  /** ms before auto-dismiss; 0 = sticky */
  ttl: number
}

export interface WorkbenchStateApi {
  state: WorkbenchState
  banners: BannerInfo[]
  setBanner: (b: BannerInfo | null) => void
  clearBanner: () => void
  /** Manually transition (e.g. tests). Usually the provider derives the state. */
  transitionTo: (s: WorkbenchState) => void
}

const Ctx = createContext<WorkbenchStateApi | null>(null)

export interface WorkbenchStateProviderProps {
  children: ReactNode
  /** Optional: override derived state (used by tests) */
  overrideState?: WorkbenchState
  /** Optional: show round-completed / year-completed flashes */
  enableFlashes?: boolean
}

const ROUND_FLASH_TTL = 1500
const YEAR_FLASH_TTL = 3000

export function WorkbenchStateProvider({
  children,
  overrideState,
  enableFlashes = true,
}: WorkbenchStateProviderProps) {
  const runId = useRunId()
  const status = useStatus()
  const simRounds = useSimRounds()
  const yearAdvanced = useYearAdvanced()

  const [manualState, setManualState] = useState<WorkbenchState | null>(null)
  const [banner, setBannerRaw] = useState<BannerInfo | null>(null)
  const [lastRoundCount, setLastRoundCount] = useState<number>(simRounds.length)
  const [lastYearAdvancedTs, setLastYearAdvancedTs] = useState<number | null>(
    yearAdvanced?.ts ?? null,
  )

  // ---- Auto-dismiss banners ----
  useEffect(() => {
    if (!banner || banner.ttl <= 0) return
    const t = setTimeout(() => setBannerRaw(null), banner.ttl)
    return () => clearTimeout(t)
  }, [banner])

  // ---- Derive state ----
  const derived = useMemo<WorkbenchState>(() => {
    if (manualState) return manualState
    if (overrideState) return overrideState
    if (!runId) return 'idle'
    if (status === 'failed') return 'failed'
    if (status === 'cancelled') return 'cancelled'
    if (status === 'completed') return 'completed'
    if (status === 'paused') return 'paused'
    if (status === 'running') {
      // round-complete / year-complete are flashes layered on top
      if (enableFlashes) {
        if (yearAdvanced && yearAdvanced.ts && yearAdvanced.ts !== lastYearAdvancedTs) {
          return 'year-complete'
        }
        if (simRounds.length > lastRoundCount) {
          return 'round-complete'
        }
      }
      if (simRounds.length === 0) return 'configuring'
      return 'running'
    }
    return 'idle'
  }, [
    manualState, overrideState, runId, status, simRounds.length,
    lastRoundCount, yearAdvanced, lastYearAdvancedTs, enableFlashes,
  ])

  // ---- Detect flashes: when state resolves to round-complete / year-complete,
  //      fall back to running after the flash TTL ----
  useEffect(() => {
    if (derived === 'round-complete' && enableFlashes) {
      const t = setTimeout(() => {
        setLastRoundCount(simRounds.length)
      }, ROUND_FLASH_TTL)
      return () => clearTimeout(t)
    }
    if (derived === 'year-complete' && enableFlashes) {
      const t = setTimeout(() => {
        if (yearAdvanced?.ts) setLastYearAdvancedTs(yearAdvanced.ts)
      }, YEAR_FLASH_TTL)
      return () => clearTimeout(t)
    }
    // For other states, always sync the baseline so we don't loop flashes
    if (derived === 'running' || derived === 'configuring') {
      setLastRoundCount(simRounds.length)
    }
    return undefined
  }, [derived, simRounds.length, yearAdvanced, enableFlashes])

  const setBanner = useCallback((b: BannerInfo | null) => {
    setBannerRaw(b)
  }, [])
  const clearBanner = useCallback(() => setBannerRaw(null), [])
  const transitionTo = useCallback((s: WorkbenchState) => setManualState(s), [])

  // Manual override: if user forces a state, still clear manualState when runId changes
  useEffect(() => {
    if (manualState && runId == null) setManualState(null)
  }, [runId, manualState])

  const api = useMemo<WorkbenchStateApi>(() => ({
    state: derived,
    banners: banner ? [banner] : [],
    setBanner,
    clearBanner,
    transitionTo,
  }), [derived, banner, setBanner, clearBanner, transitionTo])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useWorkbenchState(): WorkbenchStateApi {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useWorkbenchState must be used inside <WorkbenchStateProvider>')
  }
  return ctx
}
