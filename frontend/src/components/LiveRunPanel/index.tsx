/**
 * frontend/src/components/LiveRunPanel/index.ts
 *
 * LiveRunPanel 拆分后的统一导出入口 (Bug #3 修复)。
 *
 * 设计:
 *   - LiveRunPanel 是函数式 root, 直接渲染 <Graph /> <Network /> <Stages />
 *   - 用 named sub-components 替换 compact flag
 *   - 旧 LiveRunPanel.tsx 文件保留 1 release 作 deprecation shim (4.4)
 */
import Graph from './Graph'
import Network from './Network'
import Stages from './Stages'

/** Workbench 主视图 — 全 3 sub-components */
function LiveRunPanelRoot() {
  return (
    <div className="space-y-3">
      <Graph />
      <Network />
      <Stages />
    </div>
  )
}

// 用 named sub-components 附加为静态属性, 便于 `import LiveRunPanel from '...';
// LiveRunPanel.Graph` 这种调用法兼容。
const LiveRunPanel = Object.assign(LiveRunPanelRoot, {
  Graph,
  Network,
  Stages,
})

export { Graph, Network, Stages }
export default LiveRunPanel
