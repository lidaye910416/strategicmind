/**
 * App-wide layout: brand sidebar + content area with animated transitions.
 *
 * Implements: US-100 设计系统升级
 */
import { ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Home, Sparkles, Sun, Moon, Zap } from 'lucide-react'

interface Props { children: ReactNode }

function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const saved = localStorage.getItem('sm:theme')
    if (saved === 'dark') return true
    if (saved === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    const root = document.documentElement
    if (dark) root.classList.add('dark')
    else root.classList.remove('dark')
    try { localStorage.setItem('sm:theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])
  return [dark, () => setDark((v) => !v)]
}

function NavItem({
  to, icon: Icon, label, active,
}: { to: string; icon: any; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`relative flex items-center gap-3 px-3 h-10 rounded-xl text-sm font-medium
                  transition-colors duration-150
                  ${active
                    ? 'text-brand-700 dark:text-brand-300'
                    : 'text-ink-500 dark:text-ink-300 hover:text-ink-900 dark:hover:text-white'}`}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl bg-brand-100 dark:bg-brand-900/40"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative flex items-center gap-3">
        <Icon size={16} />
        <span>{label}</span>
      </span>
    </Link>
  )
}

export default function Layout({ children }: Props) {
  const [dark, toggleDark] = useDarkMode()
  const location = useLocation()
  const isActive = (p: string) =>
    p === '/' ? location.pathname === '/' : location.pathname === p
  const isDemo = location.pathname === '/demo'

  return (
    <div className="min-h-screen flex bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-100">
      {/* Decorative mesh background */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none
                   bg-mesh-hero dark:bg-mesh-hero-dark"
      />
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none opacity-[0.35]
                   bg-grid-light dark:bg-grid-dark [background-size:32px_32px]"
      />

      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-ink-200/60
                        dark:border-ink-800/60 glass-strong">
        <Link to="/" className="px-5 h-16 flex items-center gap-3 border-b border-ink-200/60 dark:border-ink-800/60">
          <div className="relative w-9 h-9 rounded-xl brand-mark" />
          <div className="leading-none">
            <div className="text-base font-bold tracking-tight">战略智脑</div>
            <div className="text-[11px] text-ink-500 dark:text-ink-400 mt-1">StrategicMind</div>
          </div>
        </Link>

        <nav className="flex-1 px-3 py-4 overflow-y-auto nice-scroll">
          <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wider text-ink-400 dark:text-ink-500">
            导航
          </div>
          <NavItem to="/" icon={Home} label="工作台" active={isActive('/')} />
        </nav>

        <div className="px-3 py-3 border-t border-ink-200/60 dark:border-ink-800/60 flex items-center gap-2">
          <Link
            to="/demo"
            className={`btn-ghost h-9 px-2 text-xs ${isDemo ? 'text-brand-600 dark:text-brand-300' : ''}`}
            title="查看案例示范（辅助功能）"
          >
            <Sparkles size={14} />
          </Link>
          <button
            onClick={toggleDark}
            className="btn-ghost h-9 px-3 text-xs flex-1"
            title="切换主题"
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            {dark ? '浅色模式' : '深色模式'}
          </button>
          <a
            href="https://greensock.com/gsap/"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost h-9 px-2 text-xs"
            title="设计灵感"
          >
            <Zap size={14} />
          </a>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-14 glass-strong border-b border-ink-200/60 dark:border-ink-800/60 flex items-center px-4 gap-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="relative w-8 h-8 rounded-lg brand-mark" />
          <div className="text-sm font-bold">战略智脑</div>
        </Link>
        <div className="flex-1" />
        <Link to="/demo" className="btn-ghost h-9 px-2 text-xs">
          <Sparkles size={14} />
        </Link>
        <button onClick={toggleDark} className="btn-ghost h-9 px-2 text-xs">
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      {/* Main content with route transition */}
      <main className="flex-1 min-w-0 md:px-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="md:pt-0 pt-14"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
