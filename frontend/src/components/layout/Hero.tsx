/**
 * Page-level hero with brand mark, title, subtitle, and decorative orb.
 *
 * Implements: US-100 设计系统升级
 */
import { motion } from 'framer-motion'
import { ReactNode } from 'react'

interface Props {
  eyebrow?: string
  title: string
  subtitle?: string
  rightSlot?: ReactNode
  variant?: 'gradient' | 'plain'
}

export default function Hero({ eyebrow, title, subtitle, rightSlot, variant = 'gradient' }: Props) {
  return (
    <div className="relative overflow-hidden">
      {variant === 'gradient' && (
        <>
          <div
            aria-hidden
            className="absolute -top-20 -right-24 w-[420px] h-[420px] rounded-full
                       bg-gradient-to-br from-brand-400/30 to-accent-500/20 blur-3xl
                       dark:from-brand-500/25 dark:to-accent-500/15 animate-float"
          />
          <div
            aria-hidden
            className="absolute -top-10 -left-20 w-[280px] h-[280px] rounded-full
                       bg-gradient-to-tr from-teal-400/20 to-brand-300/20 blur-3xl
                       dark:from-teal-500/15 dark:to-brand-500/15"
          />
        </>
      )}
      <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-4 px-6 md:px-10 pt-10 pb-6">
        <div className="max-w-2xl">
          {eyebrow && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full
                         text-[11px] font-semibold tracking-wider uppercase
                         bg-brand-100/80 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300
                         border border-brand-200/60 dark:border-brand-800/40"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse-soft" />
              {eyebrow}
            </motion.div>
          )}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mt-3 text-3xl md:text-4xl font-bold tracking-tight
                       text-ink-900 dark:text-white"
          >
            {title}
          </motion.h1>
          {subtitle && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className="mt-2 text-sm md:text-base text-ink-500 dark:text-ink-300 leading-relaxed"
            >
              {subtitle}
            </motion.p>
          )}
        </div>
        {rightSlot && (
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex-shrink-0"
          >
            {rightSlot}
          </motion.div>
        )}
      </div>
    </div>
  )
}
