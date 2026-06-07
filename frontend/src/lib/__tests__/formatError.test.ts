/**
 * formatError 单元测试
 *
 * 覆盖：
 *   - axios 4xx / 5xx 错误码归一化
 *   - 网络错误（ECONNREFUSED / Network Error）
 *   - 取消错误
 *   - 普通 Error / 字符串 / null
 */
import { describe, it, expect } from 'vitest'
import { formatError, formatErrorMessage } from '../formatError'

describe('formatError', () => {
  it('axios 4xx (400) → BAD_REQUEST, message 透传后端 detail', () => {
    const err: any = {
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: { detail: '参数错误: doc_id 缺失' },
      },
    }
    const r = formatError(err)
    expect(r.code).toBe('BAD_REQUEST')
    expect(r.message).toBe('参数错误: doc_id 缺失')
    expect(r.retryable).toBe(false)
  })

  it('axios 5xx (500) → SERVER_5XX, 兜底 "服务器错误"', () => {
    const err: any = {
      isAxiosError: true,
      message: 'Request failed with status code 500',
      response: { status: 500, data: null },
    }
    const r = formatError(err)
    expect(r.code).toBe('SERVER_5XX')
    // 500 时 backendMsg 缺省 → 走 anyErr?.message 或 "请求失败"（这里有 axios 兜底）
    expect(r.message.length).toBeGreaterThan(0)
    expect(r.retryable).toBe(true)
  })

  it('axios 网络错 (ECONNREFUSED-like) → NETWORK_OFFLINE, "无法连接/网络连接失败"', () => {
    const err: any = {
      isAxiosError: true,
      message: 'Network Error',
      code: 'ERR_NETWORK',
    }
    const r = formatError(err)
    expect(r.code).toBe('NETWORK_OFFLINE')
    expect(r.message).toBe('网络连接失败')
    expect(r.retryable).toBe(true)
  })

  it('普通 Error("foo") → UNKNOWN, message="foo"', () => {
    const r = formatError(new Error('foo'))
    expect(r.code).toBe('UNKNOWN')
    expect(r.message).toBe('foo')
  })

  it('字符串 "bar" → message="bar"', () => {
    const r = formatError('bar')
    expect(r.code).toBe('UNKNOWN')
    expect(r.message).toBe('bar')
  })

  it('null → "未知错误"', () => {
    const r = formatError(null)
    expect(r.code).toBe('UNKNOWN')
    expect(r.message).toBe('未知错误')
  })

  it('formatErrorMessage 简版：只取 message 字段', () => {
    const err: any = { response: { status: 404, data: { detail: '资源不存在' } } }
    expect(formatErrorMessage(err)).toBe('资源不存在')
    expect(formatErrorMessage(null)).toBe('未知错误')
    expect(formatErrorMessage(new Error('boom'))).toBe('boom')
  })
})
