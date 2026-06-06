/**
 * GraphBuildingContent - 阶段 2「构建知识图谱」内容。
 *
 * 展示：节点 / 关系 实时数（SSE 推送 graph_progress 事件时累加）。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 * 注意：组件内部仍使用 EventSource 直连 API（与 P0-2 unifiedSSE 目标有冲突，
 *       但本 P2-4 任务只做"拆文件"不改行为，保留 EventSource 后续单 PR 收敛）。
 */
import { useEffect, useState } from 'react'
import Stat from './Stat'

interface Props {
  artifact: any
  isActive: boolean
  runId?: string | null
}

export default function GraphBuildingContent({ artifact, isActive, runId }: Props) {
  const [liveNodes, setLiveNodes] = useState(artifact?.entities_created || 0)
  const [liveEdges, setLiveEdges] = useState(artifact?.relations_created || 0)

  // 订阅 SSE 拿实时数据
  useEffect(() => {
    if (!runId || !isActive) return
    const es = new EventSource(`/api/pipeline/${runId}/events`)
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.type === 'live_event' && d.event?.type === 'graph_progress') {
          setLiveNodes(d.event.data?.nodes ?? liveNodes)
          setLiveEdges(d.event.data?.edges ?? liveEdges)
        } else if (d.current_stage === 'GRAPH_BUILDING' && d.artifacts?.GRAPH_BUILDING) {
          setLiveNodes(d.artifacts.GRAPH_BUILDING.entities_created || 0)
          setLiveEdges(d.artifacts.GRAPH_BUILDING.relations_created || 0)
        }
      } catch {/* ignore */}
    }
    return () => es.close()
  }, [runId, isActive])

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="节点" value={
          <span className="flex items-center gap-1">
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            {liveNodes}
          </span>
        } accent />
        <Stat label="关系" value={
          <span className="flex items-center gap-1">
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />}
            {liveEdges}
          </span>
        } accent />
      </div>
      <div className="text-[10px] text-ink-500 italic">
        {isActive ? '图谱正在持续增长，节点涌现中…' : '图谱构建已完成'}
      </div>
    </div>
  )
}
