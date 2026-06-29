/**
 * CompanyContext — share company + companyId between Workbench and tab panels.
 *
 * Created in G8 so tab panels (DepartmentsTabPanel, DebateTabPanel,
 * InterviewTabPanel) can subscribe to the same company setup without
 * prop-drilling from InnerWorkbenchContent.
 */
import {
  createContext, useContext, type ReactNode,
} from 'react'
import type { CompanyContext } from '../../services/companyApi'

export interface CompanyContextValue {
  company: CompanyContext | null
  companyId: string | null
}

const Ctx = createContext<CompanyContextValue>({ company: null, companyId: null })

export interface CompanyProviderProps {
  value: CompanyContextValue
  children: ReactNode
}

export function CompanyProvider({ value, children }: CompanyProviderProps) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCompany(): CompanyContextValue {
  return useContext(Ctx)
}