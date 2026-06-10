/**
 * FilterBar.test.tsx — Component tests for chip-row filter.
 *
 * Spec (T3.7):
 *   - Click chip = toggle
 *   - Multi-select = union
 *   - Search = fuzzy match
 *   - Click PERSON chip -> only PERSON at full opacity (handled by parent dimming)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { FilterBar, applyFilter } from '../FilterBar'
import type { ForceNode } from '../useD3Force'

function makeNode(id: string, type: string, label: string): ForceNode {
  return { id, type, label } as unknown as ForceNode
}

describe('FilterBar (T3.7)', () => {
  it('renders chip row with All chip showing total count', () => {
    const nodes = [
      makeNode('1', 'PERSON', 'Alice'),
      makeNode('2', 'COMPANY', 'Acme'),
      makeNode('3', 'PERSON', 'Bob'),
    ]
    const { getByTestId } = render(
      <FilterBar
        nodes={nodes}
        selectedTypes={new Set()}
        onSelectedTypesChange={() => {}}
        search=""
        onSearchChange={() => {}}
      />,
    )
    const all = getByTestId('chip-All')
    expect(all.getAttribute('data-active')).toBe('1')
    expect(all.textContent).toContain('3')
  })

  it('click chip = toggle (PERSON click -> 2 selected)', () => {
    const nodes = [
      makeNode('1', 'PERSON', 'Alice'),
      makeNode('2', 'COMPANY', 'Acme'),
      makeNode('3', 'PERSON', 'Bob'),
    ]
    const onChange = vi.fn()
    const { getByTestId } = render(
      <FilterBar
        nodes={nodes}
        selectedTypes={new Set()}
        onSelectedTypesChange={onChange}
        search=""
        onSearchChange={() => {}}
      />,
    )
    fireEvent.click(getByTestId('chip-PERSON'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0][0] as Set<string>
    expect(arg.has('PERSON')).toBe(true)
    expect(arg.size).toBe(1)
  })

  it('click All chip clears selection', () => {
    const onChange = vi.fn()
    const { getByTestId } = render(
      <FilterBar
        nodes={[]}
        selectedTypes={new Set(['PERSON', 'COMPANY'])}
        onSelectedTypesChange={onChange}
        search=""
        onSearchChange={() => {}}
      />,
    )
    fireEvent.click(getByTestId('chip-All'))
    const arg = onChange.mock.calls[0][0] as Set<string>
    expect(arg.size).toBe(0)
  })

  it('multi-select = union (PERSON + COMPANY)', () => {
    const nodes = [
      makeNode('1', 'PERSON', 'Alice'),
      makeNode('2', 'COMPANY', 'Acme'),
      makeNode('3', 'TECH', 'AI'),
    ]
    const onChange = vi.fn()
    const { getByTestId } = render(
      <FilterBar
        nodes={nodes}
        selectedTypes={new Set(['PERSON'])}
        onSelectedTypesChange={onChange}
        search=""
        onSearchChange={() => {}}
      />,
    )
    fireEvent.click(getByTestId('chip-COMPANY'))
    const arg = onChange.mock.calls[0][0] as Set<string>
    expect(arg.has('PERSON')).toBe(true)
    expect(arg.has('COMPANY')).toBe(true)
    expect(arg.size).toBe(2)
  })

  it('click chip again deselects (toggle off)', () => {
    const onChange = vi.fn()
    const nodes = [
      makeNode('1', 'PERSON', 'Alice'),
    ]
    const { getByTestId } = render(
      <FilterBar
        nodes={nodes}
        selectedTypes={new Set(['PERSON'])}
        onSelectedTypesChange={onChange}
        search=""
        onSearchChange={() => {}}
      />,
    )
    fireEvent.click(getByTestId('chip-PERSON'))
    const arg = onChange.mock.calls[0][0] as Set<string>
    expect(arg.size).toBe(0)
  })

  it('search box updates parent on input', () => {
    const onChange = vi.fn()
    const { getByTestId } = render(
      <FilterBar
        nodes={[]}
        selectedTypes={new Set()}
        onSelectedTypesChange={() => {}}
        search=""
        onSearchChange={onChange}
      />,
    )
    const input = getByTestId('filter-search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ali' } })
    expect(onChange).toHaveBeenCalledWith('ali')
  })
})

describe('applyFilter (T3.7)', () => {
  const nodes = [
    makeNode('1', 'PERSON', 'Alice Wong'),
    makeNode('2', 'COMPANY', 'Acme Inc'),
    makeNode('3', 'PERSON', 'Bob Smith'),
    makeNode('4', 'TECH', 'AI Platform'),
  ]

  it('no filters -> all visible', () => {
    const visible = applyFilter(nodes, new Set(), '')
    expect(visible.size).toBe(4)
  })

  it('PERSON filter -> only PERSONs', () => {
    const visible = applyFilter(nodes, new Set(['PERSON']), '')
    expect(visible.has('1')).toBe(true)
    expect(visible.has('3')).toBe(true)
    expect(visible.has('2')).toBe(false)
    expect(visible.has('4')).toBe(false)
  })

  it('multi-type filter = union', () => {
    const visible = applyFilter(nodes, new Set(['PERSON', 'TECH']), '')
    expect(visible.has('1')).toBe(true)  // PERSON
    expect(visible.has('3')).toBe(true)  // PERSON
    expect(visible.has('4')).toBe(true)  // TECH
    expect(visible.has('2')).toBe(false) // COMPANY
  })

  it('search = fuzzy match on label', () => {
    // "ali" -> "Alice"
    const visible = applyFilter(nodes, new Set(), 'ali')
    expect(visible.has('1')).toBe(true)
    expect(visible.has('2')).toBe(false)
  })

  it('search + type filter combine (AND)', () => {
    // PERSON + "bob" -> only Bob
    const visible = applyFilter(nodes, new Set(['PERSON']), 'bob')
    expect(visible.has('3')).toBe(true)
    expect(visible.has('1')).toBe(false)
  })

  it('search = empty -> all match (when no type filter)', () => {
    const visible = applyFilter(nodes, new Set(), '')
    expect(visible.size).toBe(4)
  })
})
