/**
 * DocumentUploader - Drag-and-drop file upload
 * Implements: US-060
 */
import { useState, useCallback } from 'react'
import { Upload, X } from 'lucide-react'
import api from '../services/api'

interface UploadedFile {
  id: string
  filename: string
  size: number
  status: 'uploading' | 'completed' | 'error'
  progress: number
}

export default function DocumentUploader() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [dragActive, setDragActive] = useState(false)

  const handleFiles = useCallback(async (fileList: FileList) => {
    const newFiles = Array.from(fileList).map(f => ({
      id: `file_${Date.now()}_${f.name}`,
      filename: f.name,
      size: f.size,
      status: 'uploading' as const,
      progress: 0,
    }))
    setFiles(prev => [...prev, ...newFiles])
    
    // Upload each file
    for (const fileData of newFiles) {
      const file = Array.from(fileList).find(f => f.name === fileData.filename)
      if (!file) continue
      
      const formData = new FormData()
      formData.append('file', file)
      
      try {
        await api.post('/graph/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        setFiles(prev => prev.map(f => 
          f.id === fileData.id 
            ? { ...f, status: 'completed' as const, progress: 100 }
            : f
        ))
      } catch (error) {
        setFiles(prev => prev.map(f => 
          f.id === fileData.id ? { ...f, status: 'error' as const } : f
        ))
      }
    }
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files)
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  return (
    <div className="document-uploader">
      <div
        className={`drop-zone ${dragActive ? 'active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <Upload size={48} />
        <p>Drag & drop files here, or click to browse</p>
        <p className="hint">Supports: .txt, .md, .pdf</p>
        <input
          id="file-input"
          type="file"
          multiple
          accept=".txt,.md,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="file-list">
          {files.map(file => (
            <div key={file.id} className="file-item">
              <div className="file-info">
                <span className="filename">{file.filename}</span>
                <span className="filesize">{(file.size / 1024).toFixed(1)}KB</span>
              </div>
              <div className="file-status">
                {file.status === 'uploading' && <span>Uploading...</span>}
                {file.status === 'completed' && <span>✅</span>}
                {file.status === 'error' && <span>❌</span>}
                <button onClick={() => removeFile(file.id)}>
                  <X size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
