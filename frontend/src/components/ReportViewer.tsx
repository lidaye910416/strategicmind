/**
 * ReportViewer - Display report with chat interface
 * Implements: US-065
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User, AlertCircle, Loader2, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import api from '../services/api'
import { REPORT, COMMON } from '../i18n/zh'

interface Message { role: 'user' | 'assistant'; content: string }
interface Props {
  reportId: string
  reportContent: string
  context: { runId: string; simulationId?: string; graphId?: string }
}

const SUGGESTIONS = [
  '执行摘要里最关键的风险是哪一条？',
  '如何缓解研发人才缺口？',
  '2030 年利润目标可达性的关键路径是什么？',
]

export default function ReportViewer({ reportId, context }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const sendMessage = async (text?: string) => {
    const t = (text ?? input).trim()
    if (!t || loading) return
    setMessages((p) => [...p, { role: 'user', content: t }])
    setInput('')
    setLoading(true)
    setError(null)
    try {
      const r = await api.post(`/report/${reportId}/chat`, { message: t, context })
      setMessages((p) => [...p, { role: 'assistant', content: r.data.response }])
    } catch (e: any) {
      setError(e?.response?.data?.response || REPORT.askError)
      setMessages((p) => [...p, {
        role: 'assistant',
        content: REPORT.askDefaultError,
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-accent-500
                        inline-flex items-center justify-center text-white">
          <Sparkles size={14} />
        </div>
        <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{REPORT.askTitle}</h3>
      </div>

      <div ref={scrollRef} className="space-y-3 mb-4 min-h-[120px] max-h-[420px] overflow-y-auto nice-scroll pr-1">
        {messages.length === 0 ? (
          <div>
            <p className="text-sm text-ink-400 dark:text-ink-500 text-center py-4">
              {REPORT.askEmpty}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-xs px-3 py-1.5 rounded-full
                             bg-ink-100/80 hover:bg-brand-100 dark:bg-ink-800/60 dark:hover:bg-brand-900/40
                             text-ink-700 dark:text-ink-200
                             border border-ink-200/60 dark:border-ink-700/60
                             transition-colors duration-150"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] rounded-2xl p-3 text-sm shadow-soft
                  ${m.role === 'user'
                    ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white rounded-tr-sm'
                    : 'bg-ink-50 dark:bg-ink-800/60 text-ink-900 dark:text-ink-100 rounded-tl-sm border border-ink-200/40 dark:border-ink-700/40'}`}>
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold opacity-70 mb-1">
                    {m.role === 'user' ? <User size={11} /> : <Bot size={11} />}
                    <span>{m.role === 'user' ? REPORT.userLabel : REPORT.assistantLabel}</span>
                  </div>
                  <div className={m.role === 'user' ? '' : 'prose prose-sm max-w-none'}>
                    {m.role === 'user' ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-sm text-ink-500 dark:text-ink-400"
          >
            <Loader2 size={14} className="animate-spin" /> {COMMON.thinking}
          </motion.div>
        )}
      </div>

      {error && (
        <div className="text-xs text-rose-600 dark:text-rose-400 mb-2 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          className="input flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder={REPORT.askPlaceholder}
          disabled={loading}
        />
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          className="btn-primary"
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
        >
          <Send size={14} /> {REPORT.askSend}
        </motion.button>
      </div>
      <p className="text-xs text-ink-400 dark:text-ink-500 mt-2.5">{REPORT.askHint}</p>
    </div>
  )
}
