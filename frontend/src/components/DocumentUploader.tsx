/**
 * DocumentUploader - Drag-and-drop file upload with onUploaded callback.
 *
 * 来源：C3 P0 #11 + C1 C-53/54
 *   - Promise.allSettled 并发上传（一次 RTT 完成 N 文件）
 *   - 用 Map<id, File> 存 File 引用，不按 name 回查（更安全）
 *   - AbortController 取消按钮
 *
 * Implements: US-060
 */
import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, X, CheckCircle2, XCircle, Loader2, StopCircle } from 'lucide-react'
import api from '../services/api'
import { UPLOADER } from '../i18n/zh'
import { formatErrorMessage } from '../lib/formatError'

interface UploadedFile {
  id: string
  docId: string
  filename: string
  size: number
  status: 'uploading' | 'completed' | 'error'
  /** 按文件去重保存的 raw File 引用 */
  file: File
}

interface Props {
  onUploaded?: (doc: { id: string; docId: string; filename: string }) => void
}

export default function DocumentUploader({ onUploaded }: Props) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 用 ref 保存 AbortController 句柄，组件外不触发 re-render
  const controllersRef = useRef<Map<string, AbortController>>(new Map())

  const handleFiles = useCallback(async (fileList: FileList) => {
    setError(null)
    const newFiles: UploadedFile[] = Array.from(fileList).map((f) => ({
      id: `f_${Date.now()}_${f.name}_${Math.random().toString(36).slice(2, 6)}`,
      docId: '',
      filename: f.name,
      size: f.size,
      status: 'uploading',
      file: f,
    }))
    setFiles((prev) => [...prev, ...newFiles])

    // 并发上传（Promise.allSettled）：N 文件 = 1×RTT 而非 N×RTT
    const tasks = newFiles.map(async (fd) => {
      const formData = new FormData()
      formData.append('file', fd.file)
      const controller = new AbortController()
      controllersRef.current.set(fd.id, controller)
      try {
        const r = await api.post('/graph/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          signal: controller.signal,
        })
        const docId: string = r.data?.doc_id || ''
        setFiles((prev) => prev.map((f) =>
          f.id === fd.id ? { ...f, status: 'completed', docId } : f
        ))
        onUploaded?.({ id: fd.id, docId, filename: fd.filename })
      } catch (e: any) {
        // 用户主动取消：不报错
        if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') {
          setFiles((prev) => prev.map((f) =>
            f.id === fd.id ? { ...f, status: 'error' } : f
          ))
          return
        }
        setFiles((prev) => prev.map((f) =>
          f.id === fd.id ? { ...f, status: 'error' } : f
        ))
        setError(UPLOADER.failed(fd.filename, formatErrorMessage(e)))
      } finally {
        controllersRef.current.delete(fd.id)
      }
    })
    await Promise.allSettled(tasks)
  }, [onUploaded])

  const handleCancel = useCallback((id: string) => {
    const controller = controllersRef.current.get(id)
    if (controller) {
      controller.abort()
    }
  }, [])

  return (
    <div className="space-y-3">
      <motion.div
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer
                    transition-colors duration-200
                    ${dragActive
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                      : 'border-ink-300/60 dark:border-ink-700/60 bg-ink-50/40 dark:bg-ink-900/30 hover:border-brand-400 hover:bg-brand-50/40 dark:hover:border-brand-600 dark:hover:bg-brand-950/20'}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files) handleFiles(e.dataTransfer.files) }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <div className="flex flex-col items-center gap-2 text-ink-500 dark:text-ink-400">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-accent-500
                          inline-flex items-center justify-center text-white shadow-soft">
            <Upload size={22} />
          </div>
          <p className="font-medium text-ink-800 dark:text-ink-100 mt-1">{UPLOADER.dropOrClick}</p>
          <p className="text-xs text-ink-500 dark:text-ink-400">{UPLOADER.supports}</p>
        </div>
        <input
          id="file-input" type="file" multiple accept=".txt,.md,.pdf"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="card border-rose-200/60 dark:border-rose-900/50
                       bg-rose-50/80 dark:bg-rose-950/30
                       text-rose-700 dark:text-rose-300 text-sm"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {files.length > 0 && (
        <motion.ul
          initial="hidden" animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
          className="space-y-1.5"
        >
          {files.map((f) => (
            <motion.li
              key={f.id}
              variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0 } }}
              className="flex items-center justify-between gap-2 px-3 py-2
                         bg-white dark:bg-ink-900/60 border border-ink-200/60 dark:border-ink-800/60
                         rounded-xl text-sm shadow-soft"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon name={f.filename} />
                <span className="truncate text-ink-800 dark:text-ink-100">{f.filename}</span>
                <span className="text-xs text-ink-400 dark:text-ink-500 flex-shrink-0">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {f.status === 'uploading' && (
                  <button
                    onClick={() => handleCancel(f.id)}
                    className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-300"
                    title="取消上传"
                    aria-label="取消上传"
                  >
                    <StopCircle size={14} />
                  </button>
                )}
                {f.status === 'uploading' && <Loader2 size={14} className="animate-spin text-brand-500" />}
                {f.status === 'completed' && <CheckCircle2 size={14} className="text-emerald-500" />}
                {f.status === 'error' && <XCircle size={14} className="text-rose-500" />}
                <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}
                        className="text-ink-400 hover:text-ink-600 dark:hover:text-ink-200">
                  <X size={14} />
                </button>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  )
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    pdf: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    md: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    txt: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  }
  const color = map[ext || ''] || 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300'
  return <span className={`${color} font-mono text-[10px] uppercase font-bold px-1.5 py-0.5 rounded`}>
    {ext || '?'}
  </span>
}
