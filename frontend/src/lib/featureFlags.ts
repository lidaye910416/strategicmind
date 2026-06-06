/**
 * Feature flags - 单点回滚开关。
 *
 * 来源：C4 §6.3
 *   - 每项 PR 默认值由评审决定
 *   - 任意 flag 翻 false 即降级回旧行为，无需重新部署
 *   - 当前值用 const 写死（不接 remote config），简化部署
 *
 * 用法：
 *   import { flags } from '../lib/featureFlags'
 *   if (flags.compareRuns) { ... }
 */

export const flags = {
  // PR-1 P0（默认 ON — 已全量上线）
  formatError: true,
  unifiedSSE: true,
  uploadsInStore: true,
  isStartingFeedback: true,
  errorPanel: true,
  concurrentUpload: true,
  staticTailwind: true,

  // PR-2 P1（默认 ON — 已全量上线）
  workbenchSubnav: true,
  simulationExpanded: true,
  reportToc: true,
  resumeRunCard: true,
  deriveTopicCTA: true,
  cloneRunConfig: true,

  // PR-3 P2（默认 OFF — 灰度中）
  compareRuns: false,        // P2-1: 多 run 横向对比页（默认关闭）
  roundTimelineTrend: false, // P2-2: RoundTimeline 趋势线（占位）
  roundTimelineScrubber: false, // P2-3: RoundTimeline 重放 scrubber（占位）
  stageCardsSplit: false,    // P2-4: StageCards 拆 7 子文件（占位）
  reportChatStream: false,   // P2-5: /report/:id/chat SSE 流式（占位）
} as const

export type FeatureFlag = keyof typeof flags

/** 安全读取：未知 key 一律返回 false（防止 typo 默默开启） */
export function isFeatureOn(key: string): boolean {
  return key in flags ? !!(flags as Record<string, unknown>)[key] : false
}
