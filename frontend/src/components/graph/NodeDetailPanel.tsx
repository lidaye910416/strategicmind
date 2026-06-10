/**
 * NodeDetailPanel.tsx — 280px slide-over detail panel.
 *
 * Spec (T3.5):
 *   - Properties table
 *   - Summary block
 *   - Labels list
 *   - Episodes list (top 5)
 *   - Related-edges accordion
 *   - bg-slate-900/85 backdrop-blur-xl ring-1 ring-white/10
 *   - Width 280px (NOT 360px)
 *   - Slide-over from right
 *   - 220ms slide-in
 */
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronDown, ChevronUp, Layers, Tag, MessageCircle, Network } from 'lucide-react'
import { getPalette, LABEL_HALO_STYLE } from './palette'
import type { ForceNode, ForceEdge } from './useD3Force'

export interface Episode {
  id: string
  text: string
  round?: number
  ts?: number
}

export interface NodeDetailPanelProps {
  node: ForceNode | null
  edges: ForceEdge[]
  /** Optional async episode lookup (top 5 for this node) */
  episodes?: Episode[]
  onClose: () => void
  onRelatedNodeClick?: (nodeId: string) => void
}

const SLIDE_DURATION = 0.22  // seconds = 220ms

export function NodeDetailPanel({ node, edges, episodes = [], onClose, onRelatedNodeClick }: NodeDetailPanelProps) {
  const [edgesOpen, setEdgesOpen] = useState(false)
  const palette = useMemo(() => getPalette((node as any)?.type), [node])

  // Properties from the node (excluding d3 internal fields and standard fields)
  const properties = useMemo(() => {
    if (!node) return []
    const skip = new Set(['x', 'y', 'vx', 'vy', 'fx', 'fy', 'index', 'birth', 'isNew', 'id'])
    const out: [string, string][] = []
    // First, add entries from node.properties if it exists
    const props = (node as any).properties
    if (props && typeof props === 'object') {
      for (const [k, v] of Object.entries(props)) {
        if (v == null) continue
        if (typeof v === 'object') continue
        out.push([k, String(v)])
      }
    }
    // Then, add direct fields not in skip
    for (const [k, v] of Object.entries(node)) {
      if (skip.has(k)) continue
      if (k === 'label' || k === 'type' || k === 'properties') continue  // shown above
      if (v == null) continue
      if (typeof v === 'object') continue
      out.push([k, String(v)])
    }
    return out
  }, [node])

  // Labels
  const labels = useMemo(() => {
    if (!node) return []
    const out: string[] = []
    const t = (node as any).type
    if (t) out.push(String(t))
    if ((node as any).source) out.push(`source:${(node as any).source}`)
    if ((node as any).round != null) out.push(`round:${(node as any).round}`)
    return out
  }, [node])

  // Related edges
  const relatedEdges = useMemo(() => {
    if (!node) return []
    return edges.filter((e) => {
      const sid = typeof e.source === 'object' ? (e.source as ForceNode).id : (e.source as string)
      const tid = typeof e.target === 'object' ? (e.target as ForceNode).id : (e.target as string)
      return sid === node.id || tid === node.id
    })
  }, [edges, node])

  // Top 5 episodes
  const topEpisodes = episodes.slice(0, 5)

  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          key={node.id}
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ duration: SLIDE_DURATION, ease: 'easeOut' }}
          data-testid="node-detail-panel"
          data-node-id={node.id}
          className="absolute top-0 right-0 h-full z-20 bg-slate-900/85 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl flex flex-col"
          style={{ width: 280 }}
        >
          {/* Header */}
          <header className="flex items-start justify-between p-4 border-b border-white/5 flex-shrink-0">
            <div className="min-w-0 flex-1">
              <span
                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase text-white"
                style={{ background: palette.ring }}
              >
                {(node as any).type ?? 'NODE'}
              </span>
              <h3
                className="mt-1 text-sm font-semibold text-slate-100 truncate"
                style={LABEL_HALO_STYLE}
              >
                {(node as any).label ?? node.id}
              </h3>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5 break-all">ID: {node.id}</p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-100 ml-2 flex-shrink-0"
              aria-label="Close detail panel"
              data-testid="detail-close"
            >
              <X size={14} />
            </button>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-slate-300">
            {/* Summary block */}
            <section>
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-500 mb-1.5">
                <Tag size={10} />
                Summary
              </div>
              <div className="bg-slate-800/40 rounded p-2.5 leading-relaxed">
                {((node as any).summary as string)
                  ?? (properties.find(([k]) => k === 'description')?.[1])
                  ?? `Node of type ${(node as any).type ?? 'UNKNOWN'} with ${relatedEdges.length} related edges.`}
              </div>
            </section>

            {/* Properties table */}
            <section>
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-500 mb-1.5">
                <Layers size={10} />
                Properties
              </div>
              {properties.length === 0 ? (
                <div className="text-slate-500 italic text-[10px]">No additional properties.</div>
              ) : (
                <table className="w-full text-[11px]" data-testid="properties-table">
                  <tbody>
                    {properties.map(([k, v]) => (
                      <tr key={k} className="border-b border-white/5 last:border-0">
                        <td className="py-1 pr-2 text-slate-500 font-mono align-top w-1/3">{k}</td>
                        <td className="py-1 text-slate-200 break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Labels list */}
            <section>
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-500 mb-1.5">
                <Tag size={10} />
                Labels
              </div>
              <div className="flex flex-wrap gap-1" data-testid="labels-list">
                {labels.length === 0 ? (
                  <span className="text-slate-500 italic text-[10px]">No labels.</span>
                ) : (
                  labels.map((l) => (
                    <span
                      key={l}
                      className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-300 text-[10px]"
                    >
                      {l}
                    </span>
                  ))
                )}
              </div>
            </section>

            {/* Episodes (top 5) */}
            <section>
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-500 mb-1.5">
                <MessageCircle size={10} />
                Episodes <span className="text-slate-600">({Math.min(5, episodes.length)})</span>
              </div>
              {topEpisodes.length === 0 ? (
                <div className="text-slate-500 italic text-[10px]" data-testid="episodes-empty">
                  No episodes for this node yet.
                </div>
              ) : (
                <ul className="space-y-1.5" data-testid="episodes-list">
                  {topEpisodes.map((ep) => (
                    <li
                      key={ep.id}
                      className="bg-slate-800/40 rounded p-2 text-[11px] leading-relaxed text-slate-200"
                    >
                      <div className="text-slate-500 text-[9px] font-mono mb-0.5">
                        {ep.round != null ? `R${ep.round}` : 'pre'}
                        {ep.ts ? ` · ${new Date(ep.ts).toLocaleTimeString()}` : ''}
                      </div>
                      {ep.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Related edges (accordion) */}
            <section>
              <button
                onClick={() => setEdgesOpen((v) => !v)}
                className="flex items-center justify-between w-full text-[10px] uppercase font-bold text-slate-500 hover:text-slate-300"
                data-testid="related-edges-toggle"
                aria-expanded={edgesOpen}
              >
                <span className="flex items-center gap-1.5">
                  <Network size={10} />
                  Related Edges ({relatedEdges.length})
                </span>
                {edgesOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {edgesOpen && (
                <ul className="mt-2 space-y-1" data-testid="related-edges-list">
                  {relatedEdges.length === 0 ? (
                    <li className="text-slate-500 italic text-[10px]">No related edges.</li>
                  ) : (
                    relatedEdges.map((e) => {
                      const sid = typeof e.source === 'object' ? (e.source as ForceNode).id : (e.source as string)
                      const tid = typeof e.target === 'object' ? (e.target as ForceNode).id : (e.target as string)
                      const otherId = sid === node!.id ? tid : sid
                      return (
                        <li
                          key={e.id}
                          className="flex items-center gap-1.5 text-[10px] font-mono bg-slate-800/40 rounded px-2 py-1"
                        >
                          <span className="text-slate-500">{(e as any).type ?? 'RELATED_TO'}</span>
                          <button
                            onClick={() => onRelatedNodeClick?.(otherId)}
                            className="text-slate-200 hover:text-fuchsia-300 truncate text-left flex-1"
                          >
                            {otherId}
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>
              )}
            </section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
