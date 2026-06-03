/**
 * DocumentUploader - Drag-and-drop file upload with onUploaded callback.
 *
 * Implements: US-060
 */
import { useState, useCallback } from 'react'
import { Upload, X, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import api from '../services/api'

interface UploadedFile {
  id: string
  docId: string
  filename: string
  size: number
  status: 'uploading' | 'completed' | 'error'
}

interface Props {
  onUploaded?: (doc: { id: string; docId: string; filename: string }) => void
}

export default function DocumentUploader({ onUploaded }: Props) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFiles = useCallback(async (fileList: FileList) => {
    setError(null)
    const newFiles: UploadedFile[] = Array.from(fileList).map((f) => ({
      id: `f_${Date.now()}_${f.name}_${Math.random().toString(36).slice(2, 6)}`,
      docId: '',
      filename: f.name,
      size: f.size,
      status: 'uploading',
    }))
    setFiles((prev) => [...prev, ...newFiles])

    for (const fd of newFiles) {
      const file = Array.from(fileList).find((f) => f.name === fd.filename)
      if (!file) continue
      const formData = new FormData()
      formData.append('file', file)
      try {
        const r = await api.post('/graph/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        const docId: string = r.data?.doc_id || ''
        setFiles((prev) => prev.map((f) =>
          f.id === fd.id ? { ...f, status: 'completed', docId } : f
        ))
        onUploaded?.({ id: fd.id, docId, filename: fd.filename })
      } catch (e: any) {
        setFiles((prev) => prev.map((f) =>
          f.id === fd.id ? { ...f, status: 'error' } : f
        ))
        setError(`Failed to upload ${fd.filename}: ${e?.message || 'unknown error'}`)
      }
    }
  }, [onUploaded])

  return (
    <div className="space-y-3">
      <div
        className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${dragActive ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files) handleFiles(e.dataTransfer.files) }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <div className="flex flex-col items-center gap-2 text-gray-500">
          <Upload size={40} className="text-gray-400" />
          <p className="font-medium text-gray-700">Drag &amp; drop files here, or click to browse</p>
          <p className="text-xs">Supports: .txt, .md, .pdf</p>
        </div>
        <input
          id="file-input" type="file" multiple accept=".txt,.md,.pdf"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-gray-200 rounded text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon name={f.filename} />
                <span className="truncate text-gray-700">{f.filename}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{(f.size / 1024).toFixed(1)}KB</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {f.status === 'uploading' && <Loader2 size={14} className="animate-spin text-brand-600" />}
                {f.status === 'completed' && <CheckCircle2 size={14} className="text-green-500" />}
                {f.status === 'error' && <XCircle size={14} className="text-red-500" />}
                <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} className="text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase()
  const color = ext === 'pdf' ? 'text-red-500' : ext === 'md' ? 'text-purple-500' : 'text-blue-500'
  return <span className={`${color} font-mono text-xs uppercase`}>{ext || '?'}</span>
}
