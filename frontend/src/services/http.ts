/**
 * 统一 HTTP 客户端（单例 axios）。
 *
 * 来源：C3 P0 #13 + C2 §5.3
 *
 * 职责：
 *   - 全应用唯一一个 axios.create 实例（其余地方引用此模块）
 *   - 401 / 网络 / 5xx 统一拦截
 *   - 请求默认 30s 超时 + 支持 AbortSignal
 *   - 把 axios 错误转成 FormattedError（保持错误在 UI 层的形态一致）
 */
import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { formatError } from '../lib/formatError'

const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// 透传 AbortSignal：axios v1 的 signal 字段类型已内置，无需 declare module
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  return config
})

// 统一错误处理
http.interceptors.response.use(
  (resp) => resp,
  (err: AxiosError) => {
    // 把后端 detail 透到 err.message，方便上层 formatError
    const data: any = err?.response?.data
    if (data && !err.message.includes('Request failed')) {
      const detail = typeof data === 'string' ? data : data?.detail || data?.error
      if (detail && typeof detail === 'string') {
        ;(err as any).message = detail
      }
    }
    return Promise.reject(err)
  },
)

/** 把任意 axios 错误转 FormattedError（视图层用） */
export function formatHttpError(err: unknown) {
  return formatError(err)
}

export default http
