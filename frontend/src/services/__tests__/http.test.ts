/**
 * http 客户端单测
 *
 * 覆盖：
 *   - create() 用 baseURL = '/api' + 30s 超时
 *   - http.get 透传 URL 给底层
 *   - AbortSignal 透传
 *   - 4xx 响应拦截器把后端 detail 写到 err.message
 *   - formatHttpError 包装 axios 错为中文 FormattedError
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createConfig: null as any,
  responseErr: null as ((err: any) => any) | null,
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: (config: any) => {
      h.createConfig = config
      return {
        interceptors: {
          request: { use: vi.fn() },
          response: {
            use: (_ok: any, err: any) => {
              h.responseErr = err
            },
          },
        },
        get: h.mockGet,
        post: h.mockPost,
      }
    },
  },
}))

import http, { formatHttpError } from '../http'

describe('http client', () => {
  beforeEach(() => {
    h.mockGet.mockReset()
    h.mockPost.mockReset()
  })

  it('axios.create() 用 baseURL="/api" + 30s 超时创建单例', () => {
    expect(h.createConfig).toMatchObject({ baseURL: '/api', timeout: 30000 })
  })

  it('http.get("/pipeline/runs") 透传到 axios.get', async () => {
    h.mockGet.mockResolvedValueOnce({ data: { runs: [] } })
    await http.get('/pipeline/runs')
    expect(h.mockGet).toHaveBeenCalled()
    const call = h.mockGet.mock.calls[0]
    expect(call[0]).toBe('/pipeline/runs')
  })

  it('AbortSignal 透传到 axios.get（显式传 config）', async () => {
    h.mockGet.mockResolvedValueOnce({ data: {} })
    const ac = new AbortController()
    await http.get('/pipeline/runs', { signal: ac.signal })
    expect(h.mockGet).toHaveBeenCalled()
    const call = h.mockGet.mock.calls[0]
    expect(call[0]).toBe('/pipeline/runs')
    expect(call[1]).toEqual({ signal: ac.signal })
  })

  it('4xx 响应拦截器：后端 detail 覆盖到 err.message', async () => {
    expect(h.responseErr).toBeTruthy()
    // err.message 不含 "Request failed" 时，拦截器会用 detail 覆盖
    const err: any = {
      message: 'some other message',
      response: { status: 400, data: { detail: '参数错误' } },
    }
    await expect(h.responseErr!(err)).rejects.toMatchObject({ message: '参数错误' })
  })

  it('formatHttpError 包装 axios 错为中文 FormattedError', () => {
    const err: any = {
      isAxiosError: true,
      message: '参数错误: doc_id 缺失',
      response: { status: 400, data: { detail: '参数错误: doc_id 缺失' } },
    }
    const r = formatHttpError(err)
    expect(r.code).toBe('BAD_REQUEST')
    expect(r.message).toBe('参数错误: doc_id 缺失')
  })
})
