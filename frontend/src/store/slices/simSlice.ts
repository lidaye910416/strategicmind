/**
 * simSlice — simulation rounds + market events + shocks + banner state.
 *
 * One of the 4 typed slices composing the pipeline store (G8).
 * Owns: simRounds, marketEvents, recentShocks, yearAdvanced,
 *       latestMarketEvent, activeShock, beliefShifts, roundStartedBanner,
 *       plus appendSimRound, pushMarketEvent, pushShock,
 *       appendRoundStartedBanner, setLatestMarketEvent, etc.
 *
 * Design note: appendSimRound 同时拍下 graph snapshot（feature2 GraphDiff
 * 依赖），所以 simSlice 与 graphSnapshots 有耦合。这里保留 graphSnapshots
 * 字段在 graphSlice 上，appendSimRound 走 composite set 同时写两个字段。
 */
import type {
  SimRound,
  MarketEvent,
  ShockEvent,
  YearAdvancedEvent,
  BeliefShiftEvent,
} from '../pipeline'
import { MAX_GRAPH_SNAPSHOTS } from './graphSlice'

export interface SimSliceState {
  // 字段
  simRounds: SimRound[]
  marketEvents: MarketEvent[]
  recentShocks: ShockEvent[]
  yearAdvanced: YearAdvancedEvent | null
  latestMarketEvent: MarketEvent | null
  activeShock: ShockEvent | null
  beliefShifts: BeliefShiftEvent[]
  roundStartedBanner: { round: number; total_rounds?: number; ts: number } | null

  // actions
  appendSimRound: (round: SimRound) => void
  appendMarketEvent: (event: MarketEvent) => void
  appendShock: (shock: ShockEvent) => void
  setYearAdvanced: (event: YearAdvancedEvent) => void
  clearYearAdvanced: () => void
  setLatestMarketEvent: (event: MarketEvent | null) => void
  setActiveShock: (shock: ShockEvent | null) => void
  clearActiveShock: () => void
  appendBeliefShift: (shift: BeliefShiftEvent) => void
  setRoundStartedBanner: (banner: { round: number; total_rounds?: number; ts: number } | null) => void
  clearRoundStartedBanner: () => void
  /** Reset sim slice state (called on run switch) */
  resetSimSlice: () => void
}

export type SimSliceCreator = (
  set: (partial: any) => void,
  get: () => any,
) => SimSliceState

export const simSlice: SimSliceCreator = (set, get) => ({
  simRounds: [],
  marketEvents: [],
  recentShocks: [],
  yearAdvanced: null,
  latestMarketEvent: null,
  activeShock: null,
  beliefShifts: [],
  roundStartedBanner: null,

  appendSimRound: (round) => {
    set((s: any) => {
      // F21 dedup: 保留先来 payload
      const existingIdx = s.simRounds.findIndex((r: SimRound) => r.round === round.round)
      let next: SimRound[]
      if (existingIdx >= 0) {
        next = s.simRounds
      } else {
        next = [...s.simRounds, round].sort((a, b) => a.round - b.round)
      }
      // feature2 GraphDiff: 同步拍 graph snapshot
      const snap = s.graphSnapshots
      let newSnaps = snap
      if (!snap[round.round]) {
        newSnaps = { ...snap, [round.round]: { nodes: [...s.graphNodes], edges: [...s.graphEdges] } }
        const keys = Object.keys(newSnaps).map(Number).sort((a, b) => a - b)
        while (keys.length > MAX_GRAPH_SNAPSHOTS) {
          const oldKey = keys.shift()!
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [oldKey]: _dropped, ...rest } = newSnaps
          newSnaps = rest
        }
      }
      return { simRounds: next, graphSnapshots: newSnaps }
    })
  },

  appendMarketEvent: (event) => {
    set((s: any) => {
      const next = [event, ...s.marketEvents].slice(0, 30)
      return { marketEvents: next }
    })
  },

  appendShock: (shock) => {
    set((s: any) => {
      const next = [shock, ...s.recentShocks].slice(0, 5)
      return { recentShocks: next }
    })
  },

  setYearAdvanced: (event) => set({ yearAdvanced: event }),
  clearYearAdvanced: () => set({ yearAdvanced: null }),

  setLatestMarketEvent: (event) => set({ latestMarketEvent: event }),

  setActiveShock: (shock) => {
    set({ activeShock: shock })
    if (shock && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        try {
          const cur = get().activeShock
          if (cur && cur.ts === shock.ts) {
            set({ activeShock: null })
          }
        } catch { /* ignore */ }
      }, 3000)
      const prev = (get() as any)._activeShockTimer
      if (prev) clearTimeout(prev)
      ;(set as any)({ _activeShockTimer: t } as any)
    }
  },
  clearActiveShock: () => set({ activeShock: null }),

  appendBeliefShift: (shift) => {
    set((s: any) => {
      const next = [shift, ...(s.beliefShifts ?? [])].slice(0, 30)
      return { beliefShifts: next }
    })
  },

  setRoundStartedBanner: (banner) => {
    set({ roundStartedBanner: banner })
    if (banner && typeof window !== 'undefined') {
      const t = setTimeout(() => {
        try {
          const cur = get().roundStartedBanner
          if (cur && cur.ts === banner.ts) {
            set({ roundStartedBanner: null })
          }
        } catch { /* ignore */ }
      }, 1000)
      const prev = (get() as any)._roundStartedTimer
      if (prev) clearTimeout(prev)
      ;(set as any)({ _roundStartedTimer: t } as any)
    }
  },
  clearRoundStartedBanner: () => set({ roundStartedBanner: null }),

  resetSimSlice: () => {
    set({
      simRounds: [],
      marketEvents: [],
      recentShocks: [],
      yearAdvanced: null,
      latestMarketEvent: null,
      activeShock: null,
      beliefShifts: [],
      roundStartedBanner: null,
    })
  },
})