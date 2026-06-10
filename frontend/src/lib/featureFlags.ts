/**
 * featureFlags - 单点回滚开关集合。
 *
 * 用法：
 *   import { flags } from '@/lib/featureFlags'
 *   if (flags.stageCardsSplit) { <新行为> } else { <旧行为> }
 *
 * 设计原则：
 *   - 任何 PR 引入的可灰度改动都必须挂一个 flag
 *   - 翻 false = 立即降级到旧行为，无需重新部署
 *   - 默认值：P0 = true, P1 = true, P2 = false（灰度推荐）
 *   - 真值来源：localStorage 覆盖（key=`strategicmind:flag:${name}`，value=`'1'/'0'`）
 *
 * 来源：C4 评审书 §6.3 单点回滚开关
 * D5 集成最终版（合并 3 个 P2 分支）：
 *   - P2-1 (Compare)  引入 compareRuns
 *   - P2-2/3 (RT)     引入 timelineTrendline / timelineScrubber
 *   - P2-4/6/8 (Split) 引入 stageCardsSplit / dashboardSplit
 *   - 占位: reportChatStream (P2-5)
 */

/** 全部 flag 名称的类型安全联合 */
export type FlagName =
  // ---- P0 全集（PR-1，默认 ON）----
  | 'formatError'           // P0-1
  | 'unifiedSSE'            // P0-2/3
  | 'uploadsInStore'        // P0-2
  | 'isStartingFeedback'    // P0-9
  | 'errorPanel'            // P0-10
  | 'concurrentUpload'      // P0-11
  | 'staticTailwind'        // P0-14
  // ---- P1 全集（PR-2，默认 ON）----
  | 'workbenchSubnav'       // P1-1
  | 'simulationExpanded'    // P1-3
  | 'reportToc'             // P1-6
  | 'resumeRunCard'         // P1-12/13
  | 'deriveTopicCTA'        // P1-13
  | 'cloneRunConfig'        // P1-15
  // ---- P2 锦上添花（PR-3，默认 OFF）----
  | 'compareRuns'           // P2-1
  | 'timelineTrendline'     // P2-2
  | 'timelineScrubber'      // P2-3
  | 'stageCardsSplit'       // P2-4
  | 'dashboardSplit'        // P2-8
  | 'reportChatStream'      // P2-5（占位，未实现）

/** 单一来源的 flag 默认值 */
const DEFAULTS: Record<FlagName, boolean> = {
  // P0 默认全开
  formatError: true,
  unifiedSSE: true,
  uploadsInStore: true,
  isStartingFeedback: true,
  errorPanel: true,
  concurrentUpload: true,
  staticTailwind: true,
  // P1 默认全开
  workbenchSubnav: true,
  simulationExpanded: true,
  reportToc: true,
  resumeRunCard: true,
  deriveTopicCTA: true,
  cloneRunConfig: true,
  // P2 默认全关（opt-in）
  compareRuns: false,
  timelineTrendline: false,
  timelineScrubber: false,
  stageCardsSplit: false,
  dashboardSplit: false,
  reportChatStream: false,
}

/** 内部缓存（避免每次访问都读 localStorage） */
const cache = new Map<FlagName, boolean>()

/** 从 localStorage 读覆盖值（无 = 沿用 default） */
function readOverride(name: FlagName): boolean | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const v = window.localStorage.getItem(`strategicmind:flag:${name}`)
    if (v === '1') return true
    if (v === '0') return false
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 读一个 flag（合并 localStorage 覆盖）。
 * 建议用法：在组件外一次性解构到 const flags = { ... } 即可。
 */
export function getFlag(name: FlagName): boolean {
  if (cache.has(name)) return cache.get(name)!
  const v = readOverride(name)
  const final = v ?? DEFAULTS[name]
  cache.set(name, final)
  return final
}

/** 写覆盖值（用于调试：window.strategicmindFlag.set(...)） */
export function setFlag(name: FlagName, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(`strategicmind:flag:${name}`, value ? '1' : '0')
  } catch { /* ignore */ }
  cache.set(name, value)
  // 触发一个自定义事件，方便 UI 即时响应（如果它想监听）
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('strategicmind:flag-changed', { detail: { name, value } }))
  }
}

/** 便捷对象式访问（推荐用法） */
export const flags: Readonly<Record<FlagName, boolean>> = new Proxy({} as Record<FlagName, boolean>, {
  get(_t, prop: string) {
    return getFlag(prop as FlagName)
  },
})

/** 调试入口：浏览器 console 用 `strategicmindFlag.set('stageCardsSplit', true)` */
if (typeof window !== 'undefined') {
  ;(window as any).strategicmindFlag = { get: getFlag, set: setFlag }
}
