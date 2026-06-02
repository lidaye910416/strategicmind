/**
 * ReportViewer - Display report with chat interface
 * Implements: US-065
 */
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import api from '../services/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  reportId: string
  reportContent: string
  context: {
    runId: string
    simulationId?: string
    graphId?: string
  }
}

export default function ReportViewer({ reportId, reportContent, context }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    
    const userMessage: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    
    try {
      const response = await api.post(`/report/${reportId}/chat`, {
        message: input,
        context,
      })
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.data.response,
      }])
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your question.',
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="report-viewer">
      <div className="report-content">
        <ReactMarkdown>{reportContent}</ReactMarkdown>
      </div>
      
      <div className="chat-section">
        <div className="chat-history">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <strong>{msg.role === 'user' ? 'You' : 'Assistant'}:</strong>
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          ))}
        </div>
        
        <div className="chat-input">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask a follow-up question..."
            disabled={loading}
          />
          <button onClick={sendMessage} disabled={loading}>
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
