/**
 * palette.ts — 10-type Cosmic Observatory palette.
 *
 * Design:
 *   - Dark base #0B1020 (deep cosmic indigo)
 *   - 10 distinct hues, each with WCAG-AA contrast against the dark base
 *   - Each type has: base (node fill), glow (radial gradient stop), labelHalo (text shadow)
 *
 * All 10 colors achieve >= 4.5:1 contrast on #0B1020 (measured at 14px text).
 *
 * Mirrors the GraphPanel.vue color philosophy (warm + cool split):
 *   - Warm: COMPANY, PERSON, COMPETITOR, CUSTOMER (emotional/relational)
 *   - Cool: PRODUCT, BUSINESS, GOVERNMENT, REGULATION, TECH, CAPITAL, MARKET
 */

export const COSMIC_BASE = '#0B1020'
export const COSMIC_GRID = 'rgba(148, 163, 184, 0.08)'  // slate-400 @ 8%
export const COSMIC_LABEL_HALO = 'rgba(11, 16, 32, 0.95)'

/** 10-type palette. Hex codes with measured WCAG contrast >= 4.5:1 on COSMIC_BASE. */
export const PALETTE: Record<string, { base: string; glow: string; ring: string; label: string }> = {
  COMPANY:    { base: '#FF8A5B', glow: '#FFB088', ring: '#FF6B35', label: '#FFD7C2' },
  PERSON:     { base: '#F472B6', glow: '#F9A8D4', ring: '#E91E63', label: '#FBCFE8' },
  PRODUCT:    { base: '#A78BFA', glow: '#C4B5FD', ring: '#7C3AED', label: '#DDD6FE' },
  BUSINESS:   { base: '#60A5FA', glow: '#93C5FD', ring: '#2563EB', label: '#BFDBFE' },
  GOVERNMENT: { base: '#F87171', glow: '#FCA5A5', ring: '#DC2626', label: '#FECACA' },
  REGULATION: { base: '#94A3B8', glow: '#CBD5E1', ring: '#475569', label: '#E2E8F0' },
  TECH:       { base: '#22D3EE', glow: '#67E8F9', ring: '#0891B2', label: '#A5F3FC' },
  CAPITAL:    { base: '#34D399', glow: '#6EE7B7', ring: '#059669', label: '#A7F3D0' },
  COMPETITOR: { base: '#FBBF24', glow: '#FCD34D', ring: '#D97706', label: '#FDE68A' },
  MARKET:     { base: '#E879F9', glow: '#F0ABFC', ring: '#C026D3', label: '#F5D0FE' },
  CUSTOMER:   { base: '#818CF8', glow: '#A5B4FC', ring: '#4F46E5', label: '#C7D2FE' },
  DEFAULT:    { base: '#94A3B8', glow: '#CBD5E1', ring: '#64748B', label: '#E2E8F0' },
}

/** Get palette entry for a type, falling back to DEFAULT. */
export function getPalette(type?: string) {
  if (!type) return PALETTE.DEFAULT
  return PALETTE[type] ?? PALETTE.DEFAULT
}

/** Get radial gradient id for a type (used in <defs>). */
export function gradientId(type: string): string {
  return `grad-${type in PALETTE ? type : 'DEFAULT'}`
}

/**
 * Get the highlight color used for hovered/selected nodes.
 * Distinct from each type's ring to make highlight pop.
 */
export const HIGHLIGHT = '#E879F9'  // magenta-400
export const HIGHLIGHT_NEIGHBOR = '#F0ABFC'  // magenta-300

/**
 * Halo stroke style for label readability on any background.
 * Use: paint-order: stroke fill; stroke: COSMIC_LABEL_HALO; strokeWidth: 3
 */
export const LABEL_HALO_STYLE = {
  paintOrder: 'stroke fill' as const,
  stroke: COSMIC_LABEL_HALO,
  strokeWidth: 3,
  strokeLinejoin: 'round' as const,
}
