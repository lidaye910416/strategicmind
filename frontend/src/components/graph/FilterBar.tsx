/**
 * FilterBar.tsx — single-mode horizontal chip row + search.
 *
 * Spec (T3.7):
 *   - Horizontal chip row at top: [ All (N) ] [ TYPE1 (X) × ] ... [search]
 *   - Click chip = toggle (multi-select = union)
 *   - Search = fuzzy match on label
 *   - NO time slider, NO department dropdown (defer to post-launch)
 */
import { useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { getPalette } from './palette'
import type { ForceNode } from './useD3Force'

export interface FilterBarProps {
  nodes: ForceNode[]
  /** Currently selected types (empty = "All"). Multi-select = union. */
  selectedTypes: Set<string>
  onSelectedTypesChange: (next: Set<string>) => void
  /** Current search query (label match) */
  search: string
  onSearchChange: (next: string) => void
}

interface ChipProps {
  active: boolean
  count: number
  onClick: () => void
  color?: string
  label: string
  onClear?: () => void
}

function Chip({ active, count, onClick, color, label, onClear }: ChipProps) {
  return (
    <button
      onClick={onClick}
      onAuxClick={onClear ? (e) => { e.preventDefault(); onClear() } : undefined}
      data-testid={`chip-${label}`}
      data-active={active ? '1' : '0'}
      className={[
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold',
        'border transition-colors',
        active
          ? 'bg-fuchsia-500/20 border-fuchsia-400/60 text-fuchsia-100'
          : 'bg-slate-800/40 border-white/5 text-slate-300 hover:bg-slate-700/50',
      ].join(' ')}
    >
      {color && (
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: color }}
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
      <span className={active ? 'text-fuchsia-200 font-mono' : 'text-slate-500 font-mono'}>{count}</span>
      {active && onClear && (
        <X
          size={10}
          className="text-fuchsia-200 hover:text-white"
          onClick={(e) => { e.stopPropagation(); onClear() }}
          data-testid={`chip-${label}-clear`}
        />
      )}
    </button>
  )
}

/**
 * FilterBar — chip row + search. Emits type filters and search string.
 * Filtering itself is applied externally (parent decides what to render).
 */
export function FilterBar({
  nodes, selectedTypes, onSelectedTypesChange, search, onSearchChange,
}: FilterBarProps) {
  // Type counts
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of nodes) {
      const t = (n as any).type ?? 'DEFAULT'
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return m
  }, [nodes])

  // Sort types by count desc, then alphabetical
  const sortedTypes = useMemo(() => {
    return Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [typeCounts])

  const toggleType = (type: string) => {
    const next = new Set(selectedTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onSelectedTypesChange(next)
  }

  const clearAll = () => onSelectedTypesChange(new Set())

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-slate-900/40 backdrop-blur-sm border-b border-white/5"
      data-testid="filter-bar"
    >
      <Chip
        label="All"
        count={nodes.length}
        active={selectedTypes.size === 0}
        onClick={clearAll}
        data-testid="chip-all"
      />
      {selectedTypes.size > 0 && (
        <button
          onClick={clearAll}
          className="text-[10px] text-slate-500 hover:text-slate-200 px-1"
          data-testid="filter-clear-all"
        >
          clear
        </button>
      )}
      {sortedTypes.map(([type, count]) => (
        <Chip
          key={type}
          label={type}
          count={count}
          active={selectedTypes.has(type)}
          onClick={() => toggleType(type)}
          color={getPalette(type).base}
          onClear={() => {
            const next = new Set(selectedTypes)
            next.delete(type)
            onSelectedTypesChange(next)
          }}
        />
      ))}
      <div className="flex-1" />
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"
          aria-hidden="true"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search label…"
          className="bg-slate-800/60 border border-white/5 rounded-full pl-7 pr-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-fuchsia-400/40"
          data-testid="filter-search"
          aria-label="Search labels"
        />
      </div>
    </div>
  )
}

/**
 * Pure filter function — given nodes + types + search, return visible ids.
 * (UI sets opacity 1 / dim non-matching; we return matching set.)
 */
export function applyFilter(
  nodes: ForceNode[],
  selectedTypes: Set<string>,
  search: string,
): Set<string> {
  const q = search.trim().toLowerCase()
  const out = new Set<string>()
  for (const n of nodes) {
    const t = (n as any).type ?? 'DEFAULT'
    if (selectedTypes.size > 0 && !selectedTypes.has(t)) continue
    if (q) {
      const label = String((n as any).label ?? n.id).toLowerCase()
      // Fuzzy: every char of q in order in label
      let i = 0
      for (const ch of label) {
        if (ch === q[i]) i++
        if (i === q.length) break
      }
      if (i !== q.length) continue
    }
    out.add(n.id)
  }
  return out
}
