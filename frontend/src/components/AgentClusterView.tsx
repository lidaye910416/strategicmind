/**
 * AgentClusterView - DEPRECATION RE-EXPORT (N5 修复)。
 *
 * 之前: 独立 fetch /simulation/<id>/clusters, 跟 Workbench / Dashboard 的 agent list
 *        走 3 个不同数据源 — Bug #3。
 * 现在: 委托到 agent/AgentListView, 单一来源 useCurrentAgents(), 跟其它页面完全一致。
 */
export { default } from './agent/AgentListView'
