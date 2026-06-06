/**
 * 智能体采访组件 - 参考 MiroFish Step5Interaction.vue
 *
 * 用户可选择"采访"任一 Agent（部门/竞品/客户），
 * Agent 基于自己的角色（部门 KPI / 经营模式 / 立场）回答。
 *
 * Implements: US-230 前端集成
 */
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageCircle, Send, Loader2, Users, Building2, UserCircle, Sparkles,
  ChevronDown, ArrowRight,
} from 'lucide-react'
import api from '../services/api'
import { AGENT_INTERVIEW } from '../i18n/zh'


interface InterviewableAgent {
  agent_id: string
  name: string
  agent_kind: 'department' | 'competitor' | 'customer'
  agent_type: string
  display_name_cn: string
  description: string
}

interface Message {
  role: 'user' | 'agent'
  content: string
  agent_name?: string
  timestamp: string
}

interface Props {
  companyId: string
}

const AGENT_KIND_ICON = {
  department: Building2,
  competitor: Users,
  customer: UserCircle,
}

export default function AgentInterview({ companyId }: Props) {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<InterviewableAgent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<InterviewableAgent | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 加载可采访 Agent 列表
  useEffect(() => {
    if (!companyId) return
    setLoadingAgents(true)
    api.get(`/company/${companyId}/interview/agents`)
      .then((r) => {
        setAgents(r.data.interviewable_agents || [])
        // 默认选中第一个部门
        const firstDept = (r.data.interviewable_agents || []).find(
          (a: InterviewableAgent) => a.agent_kind === 'department'
        )
        if (firstDept) {
          setSelectedAgent(firstDept)
          loadHistory(firstDept.agent_id)
        }
      })
      .catch((e) => console.error('加载 Agent 列表失败', e))
      .finally(() => setLoadingAgents(false))
  }, [companyId])

  // 加载对话历史
  const loadHistory = async (agentId: string) => {
    try {
      const r = await api.get(`/company/${companyId}/interview/${agentId}/history`)
      setMessages(r.data.history || [])
    } catch (e) {
      setMessages([])
    }
  }

  // 切换 Agent
  const selectAgent = (agent: InterviewableAgent) => {
    setSelectedAgent(agent)
    setShowPicker(false)
    loadHistory(agent.agent_id)
  }

  // 发送问题
  const sendQuestion = async () => {
    if (!selectedAgent || !input.trim() || loading) return
    const question = input.trim()
    setInput('')

    // 立即显示用户消息
    const userMsg: Message = {
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
    }
    setMessages((m) => [...m, userMsg])
    setLoading(true)

    try {
      const r = await api.post(`/company/${companyId}/interview`, {
        agent_id: selectedAgent.agent_id,
        question,
      })
      const agentMsg: Message = {
        role: 'agent',
        content: r.data.message.content,
        agent_name: r.data.message.agent_name,
        timestamp: r.data.message.timestamp,
      }
      setMessages((m) => [...m, agentMsg])
    } catch (e: any) {
      const errMsg: Message = {
        role: 'agent',
        content: AGENT_INTERVIEW.interviewFailed(e.message || String(e)),
        timestamp: new Date().toISOString(),
      }
      setMessages((m) => [...m, errMsg])
    } finally {
      setLoading(false)
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendQuestion()
    }
  }

  // P1-17: 把单条回答提炼成议题，写入 sessionStorage + 跳到 Workbench
  // sessionStorage 用于跨页传 topic，Workbench 端会读取后清空
  const setAsTopic = (text: string) => {
    // 截取首句或前 80 字作为议题
    const topic = (text.split(/[。\n!?]/)[0] || text).slice(0, 80).trim()
    if (!topic) return
    try {
      sessionStorage.setItem('pendingTopic', topic)
    } catch {
      // 隐私模式/SSR — 用 URL ?prefill= 兜底
    }
    navigate(`/workbench?prefill=${encodeURIComponent(topic)}`)
  }

  if (loadingAgents) {
    return (
      <div className="card p-8 text-center">
        <Loader2 className="animate-spin mx-auto text-ink-400" size={20} />
        <div className="text-xs text-ink-500 mt-2">加载 Agent 列表…</div>
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div className="card p-8 text-center">
        <MessageCircle size={32} className="mx-auto text-ink-300 mb-2" />
        <div className="text-sm text-ink-500">请先搭建一个公司</div>
      </div>
    )
  }

  return (
    <div className="card p-0 overflow-hidden flex flex-col h-[600px]">
      {/* 头部 - 当前选中 Agent */}
      <div className="p-4 border-b border-ink-200/60 dark:border-ink-700/60 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 inline-flex items-center justify-center text-white">
          <MessageCircle size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
            智能体采访
          </div>
          {selectedAgent ? (
            <div>
              <div className="text-sm font-semibold text-ink-900 dark:text-white truncate">
                {selectedAgent.name}
              </div>
              <div className="text-[10px] text-ink-500 truncate">
                {selectedAgent.description}
              </div>
            </div>
          ) : (
            <div className="text-sm text-ink-500">选择 Agent 开始采访</div>
          )}
        </div>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="btn-ghost h-8 text-xs"
        >
          切换 Agent
          <ChevronDown size={12} className={`ml-1 transition-transform ${showPicker ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Agent 选择面板（折叠） */}
      <AnimatePresence>
        {showPicker && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-ink-200/60 dark:border-ink-700/60 overflow-hidden"
          >
            <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto">
              {agents.map((agent) => {
                const Icon = AGENT_KIND_ICON[agent.agent_kind] || UserCircle
                const isSelected = selectedAgent?.agent_id === agent.agent_id
                return (
                  <button
                    key={agent.agent_id}
                    onClick={() => selectAgent(agent)}
                    className={`p-2 rounded-lg text-left transition-colors ${
                      isSelected
                        ? 'bg-brand-100 dark:bg-brand-900/40 border border-brand-300'
                        : 'bg-ink-50 dark:bg-ink-900/50 border border-ink-200/60 dark:border-ink-800/60 hover:border-brand-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon size={12} className={isSelected ? 'text-brand-600' : 'text-ink-500'} />
                      <span className="text-[11px] font-semibold text-ink-900 dark:text-white truncate flex-1">
                        {agent.name}
                      </span>
                    </div>
                    <div className="text-[10px] text-ink-500 line-clamp-1">
                      {agent.description}
                    </div>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 对话消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-br from-ink-50/30 to-ink-100/30 dark:from-ink-900/30 dark:to-ink-800/30">
        {messages.length === 0 && (
          <div className="text-center text-ink-400 py-12">
            <Sparkles size={28} className="mx-auto mb-2 opacity-50" />
            <div className="text-xs">开始一段采访吧</div>
            <div className="text-[10px] text-ink-400 mt-1">
              试试：&quot;你对这个战略决策有什么看法？&quot;
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}
          >
            {msg.role === 'agent' && selectedAgent && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-white inline-flex items-center justify-center text-[10px] font-bold mr-2 shrink-0">
                {selectedAgent.display_name_cn[0] || 'A'}
              </div>
            )}
            <div
              className={`max-w-[80%] p-3 rounded-2xl ${
                msg.role === 'user'
                  ? 'bg-gradient-to-br from-brand-500 to-accent-500 text-white rounded-tr-sm'
                  : 'bg-white dark:bg-ink-800 border border-ink-200/60 dark:border-ink-700/60 text-ink-900 dark:text-white rounded-tl-sm'
              }`}
            >
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                {msg.content}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className={`text-[10px] ${msg.role === 'user' ? 'text-white/70' : 'text-ink-400'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </div>
                {/* P1-17: 把 Agent 回答提炼为议题，跳工作台预填 */}
                {msg.role === 'agent' && !msg.content.startsWith(AGENT_INTERVIEW.interviewFailedPrefix) && (
                  <button
                    onClick={() => setAsTopic(msg.content)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity
                               inline-flex items-center gap-1 text-[10px]
                               text-brand-600 dark:text-brand-300
                               hover:text-brand-700 px-1.5 py-0.5
                               rounded hover:bg-brand-50 dark:hover:bg-brand-950/30"
                    title="把这条回答提炼为议题，跳到工作台预填"
                  >
                    <ArrowRight size={10} /> {AGENT_INTERVIEW.setAsTopic}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-white inline-flex items-center justify-center text-[10px] font-bold mr-2">
              {selectedAgent?.display_name_cn[0] || 'A'}
            </div>
            <div className="bg-white dark:bg-ink-800 border border-ink-200/60 dark:border-ink-700/60 px-4 py-3 rounded-2xl rounded-tl-sm">
              <Loader2 className="animate-spin text-ink-400" size={14} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="p-3 border-t border-ink-200/60 dark:border-ink-700/60 bg-white/50 dark:bg-ink-900/50">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              selectedAgent
                ? `向 ${selectedAgent.name} 提问…`
                : '选择 Agent 后提问'
            }
            disabled={!selectedAgent || loading}
            rows={1}
            className="input flex-1 resize-none max-h-24"
            style={{ minHeight: 40 }}
          />
          <button
            onClick={sendQuestion}
            disabled={!selectedAgent || !input.trim() || loading}
            className="btn-primary h-10 px-4"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <div className="text-[10px] text-ink-400 mt-1.5 px-1">
          按 Enter 发送 · Shift+Enter 换行 · Agent 基于其角色和 KPI 回答
        </div>
      </div>
    </div>
  )
}
