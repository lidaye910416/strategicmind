/**
 * Feature flags — 单点回滚开关。
 *
 * 来源：C4 §6.3 — 任一 flag 翻 false 即降级回旧行为，无需重新部署。
 *
 * 约定：
 *   - 任何默认值带"风险/未完成验证"的新功能，必须以 flag 包裹并默认关闭。
 *   - flag 读取应走 `flags.xxx`（树摇友好，避免业务代码 import 整个对象后误改）。
 *   - 注释里写明 PR 来源 + 验收口径，便于回滚时定位。
 */

export const flags = {
  // ---------- PR-1 P0 ----------
  /** P0-1 formatError 统一错误文案。 */
  formatError: true,
  /** P0-2/3 统一 SSE 入口（store 内部字段化 _sseRef）。 */
  unifiedSSE: true,
  /** P0-2 uploads 状态入 store。 */
  uploadsInStore: true,
  /** P0-9 启动反馈（Loader2 100ms 内出现）。 */
  isStartingFeedback: true,
  /** P0-10 统一 ErrorPanel。 */
  errorPanel: true,
  /** P0-11 并发上传（Promise.allSettled + 取消按钮）。 */
  concurrentUpload: true,
  /** P0-14 ProviderPicker 静态 Tailwind 映射。 */
  staticTailwind: true,

  // ---------- PR-2 P1 ----------
  /** P1-1 Workbench sticky 子导航 + scroll-spy。 */
  workbenchSubnav: true,
  /** P1-3 Simulation 高级视图默认展开。 */
  simulationExpanded: true,
  /** P1-6 ReportTOC 章节导航。 */
  reportToc: true,
  /** P1-12/13 决议卡 + 报告派生 CTA。 */
  resumeRunCard: true,
  /** P1-13 报告 → 派生新议题按钮。 */
  deriveTopicCTA: true,
  /** P1-15 RecentRuns 复制配置。 */
  cloneRunConfig: true,

  // ---------- PR-3 P2（默认关闭，灰度验证） ----------
  /** P2-1 Compare 多 run 横向对比视图。 */
  compareRuns: false,
  /** P2-4 StageCards 拆 7 个子文件。 */
  stageCardsSplit: false,
  /**
   * P2-2 RoundTimeline 顶部 recharts LineChart 趋势线。
   *   - X 轴：回合号
   *   - Y 轴：行动数 + 信念更新数
   * 验收口径：顶部新增趋势线（默认关闭，避免 bundle 体积上升 + 视觉拥挤）
   */
  timelineTrendline: false,
  /**
   * P2-3 RoundTimeline 底部 scrubber 重放控件。
   *   - input type=range min=0 max=currentRound
   *   - 拖到 R3 即显示 R1-R3 累计事件
   *   - 拖动期间禁用 SSE 轮询更新（避免抖动）
   * 验收口径：可重放 0..currentRound 区间内的事件
   */
  timelineScrubber: false,
} as const

export type FeatureFlag = keyof typeof flags
