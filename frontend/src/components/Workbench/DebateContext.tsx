/**
 * DebateContext — share topic-input + simulation results between
 * Workbench and the DebateTabPanel. P1-14 supports ?prefill= URL param.
 */
import {
  createContext, useContext, type ReactNode,
} from 'react'
import type { TopicResolution } from '../../services/companyApi'

export interface DebateContextValue {
  topicInput: string
  setTopicInput: (s: string) => void
  resolution: TopicResolution | null
  resolving: boolean
  resolveTopic: () => Promise<void> | void
  runCompanySimulation: () => Promise<void> | void
  simResult: any
  simulating: boolean
  simulatingRound: number
  simulatingPct: number
  downloadCompanyReport: () => void
  handleStartPipeline: () => Promise<void> | void
}

const Ctx = createContext<DebateContextValue | null>(null)

export interface DebateProviderProps {
  value: DebateContextValue
  children: ReactNode
}

export function DebateProvider({ value, children }: DebateProviderProps) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDebate(): DebateContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useDebate must be used inside <DebateProvider>')
  }
  return ctx
}