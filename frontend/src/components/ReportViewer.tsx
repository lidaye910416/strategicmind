/**
 * ReportViewer - Display report with chat interface
 * Implements: US-065
 */
import { useState } from 'react'
import { Send, Bot, User, AlertCircle, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import api from '../services/api'

interface Message { role: 'user' | 'assistant'; content: string }
interface Props {
  reportId: string
  reportContent: string
  context: { runId: string; simulationId?: string; graphId?: string }
}

export default function ReportViewer({ reportId, context }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return
    setMessages((p) => [...p, { role: 'user', content: text }])
    setInput('')
    setLoading(true)
    setError(null)
    try {
      const r = await api.post(`/report/${reportId}/chat`, { message: text, context })
      setMessages((p) => [...p, { role: 'assistant', content: r.data.response }])
    } catch (e: any) {
      setError(e?.response?.data?.response || 'Failed to send message')
      setMessages((p) => [...p, {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your question.',
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1">
        <Bot size={16} /> Ask about this report
      </h3>

      <div className="space-y-2 mb-3 min-h-[100px] max-h-96 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            Ask follow-up questions about the report
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg p-3 text-sm ${
                m.role === 'user'
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}>
                <div className="flex items-center gap-1 text-xs opacity-70 mb-1">
                  {m.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                  <span>{m.role === 'user' ? 'You' : 'Assistant'}</span>
                </div>
                <div className={m.role === 'user' ? '' : 'prose prose-sm max-w-none'}>
                  {m.role === 'user' ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
                </div>
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={14} className="animate-spin" /> Assistant is thinking…
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 mb-2 flex items-center gap-1">
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
          placeholder="Ask a follow-up question..."
          disabled={loading}
        />
        <button
          className="btn-primary"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          <Send size={16} /> Send
        </button>
      </div>
    </div>
  )
}
