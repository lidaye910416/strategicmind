/**
 * ProviderPicker - Modal for switching the active LLM provider.
 *
 * Lists 4 supported providers (Ollama, MiniMax, Bailian, Mock) with
 * availability, current selection, and a switch action. Hot-swap is
 * server-side: subsequent pipeline runs use the new provider.
 *
 * Implements: US-100 模型切换 UI
 */
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Server, Cloud, FlaskConical, Key, Check, Loader2, AlertCircle,
  Sparkles, RotateCcw, ExternalLink,
} from 'lucide-react'
import api from '../services/api'
import { COMMON, PROVIDER } from '../i18n/zh'

interface ProviderInfo {
  provider: string
  label: string
  description: string
  model: string
  base_url: string
  is_local: boolean
  requires_api_key: boolean
  available: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  onChanged?: (provider: string) => void
}

const ICON_BY_PROVIDER: Record<string, any> = {
  ollama: Server,
  minimax: Sparkles,
  bailian: Cloud,
  mock: FlaskConical,
}

const ACCENT_BY_PROVIDER: Record<string, { ring: string; bg: string; text: string }> = {
  ollama:   { ring: 'ring-emerald-500', bg: 'bg-emerald-100 dark:bg-emerald-900/40',
              text: 'text-emerald-700 dark:text-emerald-300' },
  minimax:  { ring: 'ring-brand-500',   bg: 'bg-brand-100 dark:bg-brand-900/40',
              text: 'text-brand-700 dark:text-brand-300' },
  bailian:  { ring: 'ring-amber-500',   bg: 'bg-amber-100 dark:bg-amber-900/40',
              text: 'text-amber-700 dark:text-amber-300' },
  mock:     { ring: 'ring-purple-500',  bg: 'bg-purple-100 dark:bg-purple-900/40',
              text: 'text-purple-700 dark:text-purple-300' },
}

export default function ProviderPicker({ open, onClose, onChanged }: Props) {
  const [current, setCurrent] = useState<string>('ollama')
  const [options, setOptions] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/provider/options')
      setCurrent(r.data.current)
      setOptions(r.data.options)
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleSwitch = async (provider: string) => {
    if (provider === current) {
      setInfo(PROVIDER.alreadyCurrent)
      setTimeout(() => setInfo(null), 2000)
      return
    }
    setSwitching(provider)
    setError(null)
    setInfo(null)
    try {
      const r = await api.post('/provider/switch', { provider })
      setCurrent(provider)
      setInfo(r.data.message)
      onChanged?.(provider)
      setTimeout(() => setInfo(null), 3000)
    } catch (e: any) {
      const data = e?.response?.data
      setError(
        (data?.error || e?.message || '切换失败') +
        (data?.hint ? ` · ${data.hint}` : '') +
        (data?.missing ? ` · 缺少：${data.missing}` : '')
      )
    } finally {
      setSwitching(null)
    }
  }

  const handleReset = async () => {
    setSwitching('__reset__')
    setError(null)
    try {
      const r = await api.post('/provider/reset')
      setCurrent(r.data.provider)
      setInfo(r.data.message)
      onChanged?.(r.data.provider)
      await load()
      setTimeout(() => setInfo(null), 3000)
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || '重置失败')
    } finally {
      setSwitching(null)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4
                     bg-ink-900/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto nice-scroll
                       rounded-2xl bg-white dark:bg-ink-900
                       border border-ink-200/60 dark:border-ink-800/60
                       shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 px-6 py-4
                            border-b border-ink-200/60 dark:border-ink-800/60
                            bg-white/95 dark:bg-ink-900/95 backdrop-blur
                            flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-accent-500
                              inline-flex items-center justify-center text-white shadow-soft">
                <Sparkles size={16} />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-semibold text-ink-900 dark:text-white">
                  {PROVIDER.title}
                </h2>
                <p className="text-xs text-ink-500 dark:text-ink-400">
                  {PROVIDER.subtitle}
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 p-1.5
                           rounded-lg hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {info && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg
                             bg-emerald-50 dark:bg-emerald-950/30
                             border border-emerald-200/60 dark:border-emerald-800/60
                             text-sm text-emerald-700 dark:text-emerald-300"
                >
                  <Check size={14} />
                  {info}
                </motion.div>
              )}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg
                             bg-rose-50 dark:bg-rose-950/30
                             border border-rose-200/60 dark:border-rose-800/60
                             text-sm text-rose-700 dark:text-rose-300"
                >
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <div>{error}</div>
                </motion.div>
              )}

              {loading ? (
                <div className="flex items-center gap-2 py-8 justify-center text-ink-500 dark:text-ink-400">
                  <Loader2 size={16} className="animate-spin" /> {COMMON.loading}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {options.map((p) => {
                    const Icon = ICON_BY_PROVIDER[p.provider] || Server
                    const accent = ACCENT_BY_PROVIDER[p.provider] || ACCENT_BY_PROVIDER.ollama
                    const isCurrent = p.provider === current
                    const isSwitching = switching === p.provider
                    return (
                      <motion.button
                        key={p.provider}
                        whileHover={p.available ? { y: -1 } : {}}
                        whileTap={p.available ? { scale: 0.99 } : {}}
                        onClick={() => p.available && handleSwitch(p.provider)}
                        disabled={!p.available || !!switching}
                        className={`text-left rounded-xl border p-4 transition-all duration-200
                                    ${isCurrent
                                      ? `border-${accent.ring.replace('ring-', '')} ring-2 ${accent.ring}/40
                                         bg-gradient-to-br from-${accent.ring.replace('ring-', '')}-50/40 to-white
                                         dark:from-${accent.ring.replace('ring-', '')}-950/20 dark:to-ink-900`
                                      : 'border-ink-200/60 dark:border-ink-800/60 hover:border-brand-300 dark:hover:border-brand-700 bg-white dark:bg-ink-900/40'}
                                    ${!p.available ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg ${accent.bg} flex items-center justify-center ${accent.text} shrink-0`}>
                            <Icon size={18} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="text-sm font-semibold text-ink-900 dark:text-white">
                                {p.label}
                              </div>
                              {isCurrent && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold
                                                 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                                  <Check size={9} /> {PROVIDER.current}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-ink-500 dark:text-ink-400 mt-0.5 leading-relaxed">
                              {p.description}
                            </div>
                            <div className="mt-2 space-y-0.5 text-[11px]">
                              <div className="flex items-center gap-1.5 text-ink-700 dark:text-ink-200">
                                <span className="font-mono text-ink-500 dark:text-ink-400">{PROVIDER.model}:</span>
                                <span className="font-mono">{p.model}</span>
                              </div>
                              {p.base_url && p.base_url !== '(in-process)' && (
                                <div className="flex items-center gap-1.5 text-ink-700 dark:text-ink-200">
                                  <span className="font-mono text-ink-500 dark:text-ink-400">{PROVIDER.endpoint}:</span>
                                  <span className="font-mono truncate">{p.base_url}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5">
                                {p.is_local ? (
                                  <span className="badge bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px]">
                                    {PROVIDER.local}
                                  </span>
                                ) : (
                                  <span className="badge bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 text-[10px]">
                                    {PROVIDER.cloud}
                                  </span>
                                )}
                                {p.requires_api_key && (
                                  <span className="badge bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[10px]">
                                    <Key size={9} className="mr-0.5" /> {PROVIDER.needsKey}
                                  </span>
                                )}
                                {p.available ? (
                                  <span className="badge-completed text-[10px]">{PROVIDER.configured}</span>
                                ) : (
                                  <span className="badge bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px]">
                                    {PROVIDER.notConfigured}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="mt-3 flex items-center gap-2">
                              {isSwitching ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
                                  <Loader2 size={12} className="animate-spin" /> {PROVIDER.switching}
                                </span>
                              ) : isCurrent ? (
                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                  ✓ {PROVIDER.inUse}
                                </span>
                              ) : p.available ? (
                                <span className="text-xs text-brand-600 dark:text-brand-400 font-medium">
                                  {PROVIDER.clickToSwitch} →
                                </span>
                              ) : (
                                <span className="text-xs text-ink-400 dark:text-ink-500">
                                  {PROVIDER.unavailable}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.button>
                    )
                  })}
                </div>
              )}

              <div className="pt-3 border-t border-ink-200/60 dark:border-ink-800/60
                              flex items-center gap-2 flex-wrap text-xs text-ink-500 dark:text-ink-400">
                <span>💡 {PROVIDER.tip}</span>
                <a
                  href="https://api.minimaxi.com/anthropic"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-brand-600 dark:text-brand-400
                             hover:underline"
                >
                  {PROVIDER.docs} <ExternalLink size={10} />
                </a>
                <button
                  onClick={handleReset}
                  disabled={!!switching}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md
                             hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors
                             disabled:opacity-50"
                >
                  {switching === '__reset__' ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <RotateCcw size={11} />
                  )}
                  {PROVIDER.reset}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
