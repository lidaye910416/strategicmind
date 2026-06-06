/**
 * SeedLoader - 一键加载默认示例种子文件（Hubei 数产十五五）。
 *
 * 该文件位于 frontend/public/default_seed.txt，由 Vite 静态托管。
 * 用户点击"使用示例"后，会：
 *  1. 拉取 /default_seed.txt（同时缓存到前端做预览）
 *  2. 解析 / 上传到后端 /api/graph/upload
 *  3. 通知父组件该 doc 已就绪
 *  4. 提供"查看完整内容"入口，让用户知道到底是什么文件
 *
 * Implements: US-100 默认种子 + US-100 透明化
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, Loader2, CheckCircle2, X, FileText, ExternalLink,
  ChevronDown, ChevronUp, AlertCircle,
} from 'lucide-react'
import api from '../services/api'
import { formatErrorMessage } from '../lib/formatError'

interface Props {
  /** 上传成功后回调，告知父组件 doc_id */
  onLoaded?: (doc: { id: string; docId: string; filename: string }) => void
}

const SEED_URL = '/default_seed.txt'
const SEED_FILENAME = 'hubei_plan_seed.txt'
const PREVIEW_LINES = 8

/**
 * 来源：C3 P0 #12
 *   - LoaderState 联合类型：每种 kind 只能有合法的字段组合
 *   - preview 改 ref + 派生，避免 string|null 状态机污染渲染
 *   - loadPreview 加 useCallback 稳定引用
 */
type LoaderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'uploaded'; docId: string }
  | { kind: 'error'; error: string }

export default function SeedLoader({ onLoaded }: Props) {
  const [state, setState] = useState<LoaderState>({ kind: 'idle' })
  const [preview, setPreview] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const [showFull, setShowFull] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Eager-load the file content so user can preview without uploading
  const loadPreview = useCallback(async () => {
    if (previewRef.current !== null) return
    setLoadingPreview(true)
    try {
      const r = await fetch(SEED_URL)
      if (r.ok) {
        const text = await r.text()
        previewRef.current = text
        setPreview(text)
      }
    } catch {
      // best-effort
    } finally {
      setLoadingPreview(false)
    }
  }, [])

  useEffect(() => {
    // Auto-load preview on mount so the user can see what the seed is
    loadPreview()
  }, [loadPreview])

  const handleLoad = async () => {
    setState({ kind: 'loading' })
    try {
      // Use cached preview if available, otherwise fetch fresh
      let text = previewRef.current
      if (!text) {
        const r = await fetch(SEED_URL)
        if (!r.ok) throw new Error(`无法获取默认种子 (${r.status})`)
        text = await r.text()
        previewRef.current = text
        setPreview(text)
      }

      // Build FormData and upload
      const fd = new FormData()
      const blob = new Blob([text], { type: 'text/plain' })
      fd.append('file', blob, SEED_FILENAME)
      const up = await api.post('/graph/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const newDocId: string = up.data?.doc_id || ''
      if (!newDocId) throw new Error('上传成功但未返回 doc_id')

      setState({ kind: 'uploaded', docId: newDocId })
      onLoaded?.({ id: `seed_${Date.now()}`, docId: newDocId, filename: SEED_FILENAME })
    } catch (e: any) {
      setState({ kind: 'error', error: formatErrorMessage(e) })
    }
  }

  const handleRemove = () => {
    setState({ kind: 'idle' })
  }

  const previewLines = preview ? preview.split('\n') : []
  const displayedLines = showFull ? previewLines : previewLines.slice(0, PREVIEW_LINES)
  const lineCount = previewLines.length
  const charCount = preview?.length || 0

  return (
    <div className="space-y-2">
      {state.kind === 'uploaded' ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl
                     bg-emerald-50 dark:bg-emerald-950/30
                     border border-emerald-200/60 dark:border-emerald-800/60"
        >
          <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              示例种子已就绪
            </div>
            <div className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 font-mono truncate">
              {SEED_FILENAME} · {lineCount} 行 · {charCount} 字 · {state.docId.slice(0, 8)}
            </div>
          </div>
          <button
            onClick={handleRemove}
            className="text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-200 shrink-0"
            title="移除示例"
          >
            <X size={14} />
          </button>
        </motion.div>
      ) : (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleLoad}
          disabled={state.kind === 'loading'}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                     bg-gradient-to-br from-brand-50 to-accent-50/50
                     dark:from-brand-950/30 dark:to-accent-950/20
                     border border-brand-200/60 dark:border-brand-800/60
                     hover:border-brand-400 dark:hover:border-brand-600
                     transition-colors text-left group
                     disabled:opacity-50"
        >
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-accent-500
                          inline-flex items-center justify-center text-white shadow-soft
                          group-hover:scale-105 transition-transform shrink-0">
            {state.kind === 'loading' ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Sparkles size={18} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink-900 dark:text-white">
              {state.kind === 'loading' ? '正在加载示例…' : '使用内置示例推演'}
            </div>
            <div className="text-[11px] text-ink-500 dark:text-ink-400 truncate flex items-center gap-1">
              <FileText size={10} />
              {SEED_FILENAME}（湖北数产十五五战略规划）
            </div>
          </div>
        </motion.button>
      )}

      {/* 文件预览区 - 让用户看到内容 */}
      <AnimatePresence initial={false}>
        {preview !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-ink-200/60 dark:border-ink-800/60
                            bg-ink-50/60 dark:bg-ink-900/40">
              <div className="flex items-center justify-between px-3 py-1.5
                              border-b border-ink-200/60 dark:border-ink-800/60
                              bg-ink-100/40 dark:bg-ink-800/40">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider
                                text-ink-500 dark:text-ink-400 font-semibold">
                  <FileText size={10} />
                  {SEED_FILENAME}
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={SEED_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-ink-500 dark:text-ink-400
                               hover:text-brand-600 dark:hover:text-brand-400
                               inline-flex items-center gap-0.5"
                    title="在新窗口打开"
                  >
                    <ExternalLink size={9} /> 打开
                  </a>
                </div>
              </div>
              <pre className="px-3 py-2 text-[11px] font-mono text-ink-700 dark:text-ink-200
                              whitespace-pre-wrap break-words leading-relaxed
                              max-h-48 overflow-y-auto nice-scroll">
                {loadingPreview ? (
                  <span className="text-ink-400 dark:text-ink-500">加载预览…</span>
                ) : (
                  displayedLines.join('\n')
                )}
                {!showFull && lineCount > PREVIEW_LINES && (
                  <span className="text-ink-400 dark:text-ink-500">
                    {'\n'}… (还有 {lineCount - PREVIEW_LINES} 行)
                  </span>
                )}
              </pre>
              {lineCount > PREVIEW_LINES && (
                <button
                  onClick={() => setShowFull((v) => !v)}
                  className="w-full px-3 py-1.5 text-[11px] text-ink-500 dark:text-ink-400
                             hover:bg-ink-100/60 dark:hover:bg-ink-800/60
                             border-t border-ink-200/60 dark:border-ink-800/60
                             inline-flex items-center justify-center gap-1"
                >
                  {showFull ? (
                    <><ChevronUp size={11} /> 收起</>
                  ) : (
                    <><ChevronDown size={11} /> 展开全部 {lineCount} 行</>
                  )}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {state.kind === 'error' && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg
                        bg-rose-50 dark:bg-rose-950/30
                        border border-rose-200/60 dark:border-rose-800/60
                        text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          {state.error}
        </div>
      )}

      <p className="text-[11px] text-ink-400 dark:text-ink-500 leading-relaxed">
        一键加载湖北数产十五五战略规划作为种子，无需准备文件。
        <a
          href={SEED_URL}
          target="_blank"
          rel="noreferrer"
          className="ml-1 text-brand-600 dark:text-brand-400 hover:underline"
        >
          查看完整内容
        </a>
      </p>
    </div>
  )
}
