/**
 * UploadCard - 上传种子文档区（SeedLoader + DocumentUploader + 已选清单）。
 *
 * 来源：原 views/Dashboard.tsx 行 217-324 区块，P2-8 拆出。
 */
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { FileText, Sparkles, Upload, CheckCircle2 } from 'lucide-react'
import DocumentUploader from '../DocumentUploader'
import SeedLoader from '../SeedLoader'

export interface UploadItem {
  id: string
  docId: string
  filename: string
}

interface Props {
  uploads: UploadItem[]
  onAddUpload: (doc: UploadItem) => void
}

export default function UploadCard({ uploads, onAddUpload }: Props) {
  return (
    <motion.section
      className="card p-6 md:p-8 bg-gradient-to-br from-brand-50/40 to-accent-50/20
                 dark:from-brand-950/20 dark:to-accent-950/10
                 border-2 border-brand-200/40 dark:border-brand-800/40"
    >
      <div className="flex items-start gap-4 mb-5">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-accent-500
                        inline-flex items-center justify-center text-white shadow-glow shrink-0">
          <FileText size={22} />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-ink-900 dark:text-white">
            上传种子文档 · 开启战略推演
          </h2>
          <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 leading-relaxed">
            上传你的战略规划 / 行业报告 / 内部资料，系统将自动抽取实体、构建知识图谱、生成多部门 Agent 画像
          </p>
        </div>
        <Link
          to="/demo"
          className="text-[11px] text-ink-400 hover:text-brand-600 dark:hover:text-brand-300
                     transition-colors flex items-center gap-1 px-2 py-1
                     rounded hover:bg-white/60 dark:hover:bg-ink-900/40 shrink-0"
        >
          没文档？
          <span className="text-brand-600 dark:text-brand-300 font-medium">看个示例 →</span>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 快速开始（场景） */}
        <div className="p-4 rounded-xl bg-white/70 dark:bg-ink-900/40
                        border-2 border-dashed border-brand-300/60 dark:border-brand-700/60
                        hover:border-brand-400 dark:hover:border-brand-500
                        transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-brand-600" />
            <span className="text-[11px] uppercase tracking-wider text-brand-700 dark:text-brand-300 font-bold">
              快速开始
            </span>
          </div>
          <div className="text-sm font-semibold text-ink-900 dark:text-white mb-1">
            一键加载内置场景
          </div>
          <p className="text-[11px] text-ink-500 dark:text-ink-400 mb-3 leading-relaxed">
            4 个真实战略场景（湖北数产 / 城商行 / 制造业 / SaaS）
          </p>
          <SeedLoader onLoaded={onAddUpload} />
        </div>
        {/* 上传自己 */}
        <div className="p-4 rounded-xl bg-white/70 dark:bg-ink-900/40
                        border-2 border-dashed border-accent-300/60 dark:border-accent-700/60
                        hover:border-accent-400 dark:hover:border-accent-500
                        transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <Upload size={14} className="text-accent-600" />
            <span className="text-[11px] uppercase tracking-wider text-accent-700 dark:text-accent-300 font-bold">
              自定义
            </span>
          </div>
          <div className="text-sm font-semibold text-ink-900 dark:text-white mb-1">
            上传你自己的文档
          </div>
          <p className="text-[11px] text-ink-500 dark:text-ink-400 mb-3 leading-relaxed">
            支持 .txt / .md / .pdf · 拖拽文件到下方或点击
          </p>
          <DocumentUploader onUploaded={onAddUpload} />
        </div>
      </div>

      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20
                       border border-emerald-200/60 dark:border-emerald-800/40"
          >
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={14} className="text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                已选择 {uploads.length} 份文档
              </span>
            </div>
            <ul className="space-y-1">
              {uploads.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300
                             px-2 py-1"
                >
                  <span className="w-1 h-1 rounded-full bg-emerald-500" />
                  <span className="truncate">{u.filename}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
