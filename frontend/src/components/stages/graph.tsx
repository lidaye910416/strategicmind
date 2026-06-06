/**
 * GraphBuildingContent - 阶段 2「构建知识图谱」内容。
 *
 * 展示：节点 / 关系 实时数（SSE 推送 graph_progress 事件时累加）。
 *
 * 来源：原 components/StageCards.tsx 内嵌组件，P2-4 拆出。
 * FE3 P3-C：EventSource 统一在 store，本组件用 useGraphNodes() / useGraphEdges() 订阅。
 */
import { useGraphNodes, useGraphEdges } from '../../store/pipeline'
import Stat from './Stat'

interface Props {
  artifact: any
  isActive: boolean
  runId?: string | null
}

export default function GraphBuildingContent({ artifact, isActive, runId }: Props) {
  // ---- FE3 P3-C：store selector 替代自建 SSE ----
  const graphNodes = useGraphNodes()
  const graphEdges = useGraphEdges()
  const liveNodes = graphNodes.length > 0 ? graphNodes.length : (artifact?.entities_created || 0)
  const liveEdges = graphEdges.length > 0 ? graphEdges.length : (artifact?.relations_created || 0)
  // 保留 runId 形参以兼容调用方
  void runId

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
