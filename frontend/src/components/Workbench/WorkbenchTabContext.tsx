/**
 * WorkbenchTabContext — Tab router context shared between
 * InnerWorkbenchContent (shell) and the 6 tab panels.
 *
 * InnerWorkbenchContent is now a thin shell that owns the active tab id;
 * each tab panel reads it via useWorkbenchTab(). The shell doesn't prop-drill
 * anymore; panels subscribe to their own slices.
 */
import {
  createContext, useContext, useState, type ReactNode,
} from 'react'

export type TabId = 'realtime' | 'departments' | 'debate' | 'interview' | 'analysis' | 'topics'

const Ctx = createContext<{
  activeTab: TabId
  setActiveTab: (id: TabId) => void
} | null>(null)

export interface WorkbenchTabProviderProps {
  children: ReactNode
  /** Optional: override active tab (used by tests + URL deep links) */
  initialTab?: TabId
}

export function WorkbenchTabProvider({ children, initialTab = 'realtime' }: WorkbenchTabProviderProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  return (
    <Ctx.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </Ctx.Provider>
  )
}

export function useWorkbenchTab() {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useWorkbenchTab must be used inside <WorkbenchTabProvider>')
  }
  return ctx
}