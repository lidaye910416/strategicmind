/**
 * Step5 — Interaction: post-simulation agent interview.
 *
 * Agent sidebar + chat panel + transcript history. Polls the per-agent
 * trace every 2s (MiroFish parity) and subscribes to the SSE channel
 * for live "interview_done" frames.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StepHeader, { type StepStatus } from './StepHeader'
import { Loader2, Send, User2 } from 'lucide-react'

export interface Step5Props {
  runId: string
  testId?: string
  /** Optional injected fetch + EventSource factories (tests). */
  fetchImpl?: typeof fetch
  eventSourceImpl?: typeof EventSource
  /** Test-only override: skip the 2s poll cadence. */
  fastPolling?: boolean
}

interface TranscriptRow {
  role: 'user' | 'agent' | 'system'
  agent_id?: string | null
  agent_name?: string | null
  content: string
  timestamp?: string
  metadata?: Record<string, unknown>
}

const DEFAULT_AGENTS: Array<{
  agent_id: string
  name: string
  agent_kind: 'department' | 'competitor' | 'customer'
}> = [
  { agent_id: 'dept_product', name: '产品部', agent_kind: 'department' },
  { agent_id: 'dept_sales', name: '销售部', agent_kind: 'department' },
  { agent_id: 'comp_alpha', name: '竞品 A', agent_kind: 'competitor' },
]

function statusOf(status: string | undefined): StepStatus {
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'done'
  return 'active'
}

export default function Step5Interaction({
  runId,
  testId,
  fetchImpl,
  eventSourceImpl,
  fastPolling,
}: Step5Props) {
  const [activeAgent, setActiveAgent] = useState<string>(DEFAULT_AGENTS[0].agent_id)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptRow[]>([])
  const [runStatus, setRunStatus] = useState<string>('completed')
  const lastPollRef = useRef<number>(0)

  const pollMs = fastPolling ? 50 : 2000

  // Lazy resolve fetch + EventSource once.
  const doFetch = useCallback(
    (input: RequestInfo, init?: RequestInit) =>
      (fetchImpl ?? ((globalThis as any).fetch as typeof fetch))(input, init),
    [fetchImpl]
  )
  const doES = useCallback(
    (url: string) => {
      const Ctor = (eventSourceImpl ?? (globalThis as any).EventSource) as typeof EventSource
      return new Ctor(url)
    },
    [eventSourceImpl]
  )

  // Poll the per-agent trace every 2s (MiroFish parity).
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      lastPollRef.current = Date.now()
      try {
        const resp = await doFetch(
          `/api/interview/${encodeURIComponent(runId)}/trace?agent_id=${encodeURIComponent(activeAgent)}&limit=50`
        )
        if (!resp.ok) {
          // Unknown run / no transcript yet — keep transcript empty.
          return
        }
        const data = (await resp.json()) as TranscriptRow[]
        if (!cancelled) setTranscript(Array.isArray(data) ? data : [])
      } catch {
        /* ignore — polling is best-effort */
      }
    }
    void tick()
    const handle = setInterval(tick, pollMs)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [runId, activeAgent, pollMs, doFetch])

  // SSE channel — listen for interview_done and round_appended.
  useEffect(() => {
    if (!runId || typeof doES !== 'function') return
    let es: EventSource | null = null
    try {
      es = doES(`/api/interview/${encodeURIComponent(runId)}/events`)
    } catch {
      return
    }
    const onMsg = (evt: MessageEvent) => {
      try {
        const payload = JSON.parse(evt.data) as { type: string; message?: TranscriptRow }
        if (payload?.type === 'interview_done' && payload.message) {
          setTranscript((prev) => [...prev, payload.message as TranscriptRow])
        }
      } catch {
        /* ignore malformed frames */
      }
    }
    es.addEventListener?.('interview_done', onMsg as any)
    es.onmessage = onMsg
    return () => {
      try {
        es?.close()
      } catch {
        /* noop */
      }
      es = null
    }
  }, [runId, doES])

  // Best-effort status pull so we can color the header pill.
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const pull = async () => {
      try {
        const resp = await doFetch(`/api/pipeline/${encodeURIComponent(runId)}/status`)
        if (!resp.ok) return
        const data = (await resp.json()) as { status?: string }
        if (!cancelled && data?.status) setRunStatus(String(data.status))
      } catch {
        /* ignore */
      }
    }
    void pull()
  }, [runId, doFetch])

  const onSend = useCallback(async () => {
    const q = input.trim()
    if (!q || !runId) return
    setSending(true)
    setInput('')
    // Optimistic user row.
    setTranscript((prev) => [
      ...prev,
      {
        role: 'user',
        agent_id: activeAgent,
        content: q,
        timestamp: new Date().toISOString(),
        metadata: { question: q },
      },
    ])
    try {
      const resp = await doFetch(
        `/api/interview/${encodeURIComponent(runId)}/agents/${encodeURIComponent(activeAgent)}/message`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: q }),
        }
      )
      if (resp.ok) {
        const data = (await resp.json()) as TranscriptRow
        setTranscript((prev) => [...prev, data])
      }
    } catch {
      /* ignore — chat is best-effort */
    } finally {
      setSending(false)
    }
  }, [input, runId, activeAgent, doFetch])

  const headerStatus = useMemo(() => statusOf(runStatus), [runStatus])

  return (
    <div data-testid={testId ?? 'step-5'}>
      <StepHeader
        step={5}
        title="Agent 采访"
        subtitle="与部门 / 竞品 / 客户 Agent 实时对话"
        status={headerStatus}
        testId="step-5-header"
      />
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
        <aside
          data-testid="step-5-sidebar"
          className="rounded-lg border border-ink-200 dark:border-ink-700 p-2 space-y-1"
        >
          {DEFAULT_AGENTS.map((a) => (
            <button
              key={a.agent_id}
              type="button"
              data-testid={`step-5-agent-${a.agent_id}`}
              data-active={a.agent_id === activeAgent ? 'true' : 'false'}
              onClick={() => setActiveAgent(a.agent_id)}
              className={[
                'w-full text-left px-2 py-1.5 rounded-md text-sm',
                a.agent_id === activeAgent
                  ? 'bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900'
                  : 'hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-700 dark:text-ink-200',
              ].join(' ')}
            >
              <span className="inline-flex items-center gap-1">
                <User2 size={12} /> {a.name}
              </span>
            </button>
          ))}
        </aside>
        <div className="flex flex-col gap-3">
          <div
            data-testid="step-5-transcript"
            className="rounded-lg border border-ink-200 dark:border-ink-700 p-3 min-h-[260px] max-h-[360px] overflow-y-auto space-y-2"
          >
            {transcript.length === 0 ? (
              <div className="text-sm text-ink-500">尚未开始对话。</div>
            ) : (
              transcript.map((row, i) => (
                <div
                  key={`${row.timestamp ?? i}-${i}`}
                  data-testid={`step-5-row-${row.role}`}
                  className={[
                    'rounded-md px-2 py-1.5 text-sm',
                    row.role === 'user'
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'bg-ink-100 dark:bg-ink-800',
                  ].join(' ')}
                >
                  <div className="text-xs text-ink-500 mb-0.5">
                    {row.role === 'user' ? '你' : row.agent_name ?? row.agent_id ?? 'agent'}
                    {row.timestamp ? ` · ${row.timestamp}` : ''}
                  </div>
                  <div className="whitespace-pre-wrap">{row.content}</div>
                </div>
              ))
            )}
          </div>
          <form
            data-testid="step-5-form"
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void onSend()
            }}
          >
            <input
              data-testid="step-5-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`问 ${activeAgent} …`}
              className="flex-1 rounded-md border border-ink-200 dark:border-ink-700 bg-white/80 dark:bg-ink-900/60 px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              data-testid="step-5-send"
              disabled={sending || !input.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-900 disabled:opacity-40"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              发送
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
