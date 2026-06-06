/**
 * usePipelineEvent - 订阅 store 派发的事件。
 *
 * 来源：C3 P0 #3 + C1 C-11
 *
 * 设计：
 *   - store 内部维护 liveEventsBuffer（200 条环形 buffer，O(1) 写入）
 *   - hook 通过 useSyncExternalStore 订阅（避免 React 18 撕裂）
 *   - 组件卸载即停止订阅（hook cleanup 取消监听）
 *   - predicate 过滤（可选）
 *
 * 用法：
 *   usePipelineEvent((event) => {
 *     if (event.type === 'round_progress') { ... }
 *   })
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useLastEventAt } from '../../store/pipeline'

/** 事件 payload 类型（后端 SSE 推送） */
export interface PipelineEvent {
  type: string
  data?: any
  /** 原始数据 */
  raw?: any
}

// ---- 环形 buffer（store 内部使用）----

const BUFFER_LIMIT = 200
const _buffer: PipelineEvent[] = []
const _listeners = new Set<() => void>()

function _push(event: PipelineEvent) {
  if (_buffer.length >= BUFFER_LIMIT) {
    _buffer.shift()
  }
  _buffer.push(event)
  _listeners.forEach((fn) => fn())
}

function _subscribe(fn: () => void) {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

function _getSnapshot() {
  return _buffer.length
}

/**
 * 内部：从 store 的 SSE onmessage 处推入事件。
 * 当前由 _openSSE 在 store 内通过 _pushEvent 调用。
 * 这里导出供 store 集成（避免循环 import 用 module-level helper）。
 */
export function pushPipelineEvent(event: PipelineEvent) {
  _push(event)
}

export function clearPipelineEvents() {
  _buffer.length = 0
  _listeners.forEach((fn) => fn())
}

/**
 * 订阅最近一次事件变化。
 *
 * @param handler 事件回调；predicate 过滤后命中才触发
 * @param predicate 可选过滤；true 表示关心此事件
 */
export function usePipelineEvent(
  handler: (event: PipelineEvent) => void,
  predicate?: (event: PipelineEvent) => boolean,
) {
  const lastEventAt = useLastEventAt()
  const handlerRef = useRef(handler)
  const predicateRef = useRef(predicate)
  handlerRef.current = handler
  predicateRef.current = predicate

  // 用 useSyncExternalStore 订阅 buffer 长度变化
  useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot)

  useEffect(() => {
    // lastEventAt 变化时（即有新 SSE 事件），跑一遍 buffer 把关心的回调触发
    if (lastEventAt === 0) return
    const latest = _buffer[_buffer.length - 1]
    if (!latest) return
    if (predicateRef.current && !predicateRef.current(latest)) return
    try {
      handlerRef.current(latest)
    } catch (e) {
      // 隔离回调异常，避免破坏 SSE 流
      // eslint-disable-next-line no-console
      console.error('[usePipelineEvent] handler threw', e)
    }
    // 仅依赖 lastEventAt 即可；handler / predicate 在 ref 里保持最新
  }, [lastEventAt])
}
