/**
 * 统一错误格式化工具。
 *
 * 目标：
 *   - 把 axios / fetch / Error / string 四种输入归一为 { code, message, suggest, retryable }
 *   - 把后端 detail / error / hint 翻译成中文人话
 *   - 让所有视图（Dashboard / Workbench / Report / SeedLoader / ProviderPicker）共用同一份错误文案
 *
 * 来源：C3 P0 #1 + C2 §5.3 融合
 */

export type ErrorCode =
  | 'NETWORK_OFFLINE'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'SERVER_5XX'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'FILE_TOO_LARGE'
  | 'PARSE_ERROR'
  | 'UNKNOWN'

export interface FormattedError {
  /** 机器可读 code */
  code: ErrorCode
  /** 给用户看的中文消息 */
  message: string
  /** 行动建议（可选） */
  suggest?: string
  /** 是否可重试 */
  retryable: boolean
  /** 原始错误（仅供日志） */
  raw?: unknown
}

const SUGGEST_BY_CODE: Record<ErrorCode, string | undefined> = {
  NETWORK_OFFLINE: '请检查网络连接后重试',
  TIMEOUT: '请求超时，可重试；若反复发生请检查后端是否在线',
  CANCELLED: '请求已取消',
  BAD_REQUEST: '请检查参数是否正确后重试',
  UNAUTHORIZED: '请先登录或刷新页面',
  FORBIDDEN: '没有权限执行此操作',
  NOT_FOUND: '资源不存在或已被删除',
  CONFLICT: '状态冲突，请刷新页面后重试',
  RATE_LIMIT: '请求过于频繁，请稍后再试',
  SERVER_5XX: '后端服务异常，请稍后重试',
  PROVIDER_NOT_CONFIGURED: '请先在右上角切换到已配置的模型',
  FILE_TOO_LARGE: '请选择更小的文件（建议 < 10MB）',
  PARSE_ERROR: '返回数据格式异常，请稍后重试',
  UNKNOWN: '请稍后重试，若问题持续请联系支持',
}

function statusToCode(status: number | undefined): ErrorCode {
  if (status == null) return 'UNKNOWN'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 413 || status === 422) return 'BAD_REQUEST'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'SERVER_5XX'
  if (status >= 400) return 'BAD_REQUEST'
  return 'UNKNOWN'
}

function isRetryable(code: ErrorCode): boolean {
  return ['NETWORK_OFFLINE', 'TIMEOUT', 'RATE_LIMIT', 'SERVER_5XX'].includes(code)
}

/**
 * 把任意错误格式化为统一结构。
 *
 * 兼容输入：
 *   - axios 错误（含 response.status / response.data）
 *   - fetch 错误（无 response）
 *   - AbortError / DOMException
 *   - 普通 Error
 *   - 字符串
 *   - null / undefined
 */
export function formatError(e: unknown): FormattedError {
  // 字符串
  if (typeof e === 'string') {
    return {
      code: 'UNKNOWN',
      message: e || '未知错误',
      suggest: SUGGEST_BY_CODE.UNKNOWN,
      retryable: false,
      raw: e,
    }
  }

  // null / undefined
  if (e == null) {
    return {
      code: 'UNKNOWN',
      message: '未知错误',
      suggest: SUGGEST_BY_CODE.UNKNOWN,
      retryable: false,
      raw: e,
    }
  }

  // axios 错误
  const anyErr = e as any
  // 取消
  if (anyErr?.name === 'CanceledError' || anyErr?.code === 'ERR_CANCELED') {
    return {
      code: 'CANCELLED',
      message: SUGGEST_BY_CODE.CANCELLED || '请求已取消',
      retryable: false,
      raw: e,
    }
  }
  // 超时
  if (anyErr?.code === 'ECONNABORTED' || anyErr?.message?.includes('timeout')) {
    return {
      code: 'TIMEOUT',
      message: '请求超时',
      suggest: SUGGEST_BY_CODE.TIMEOUT,
      retryable: true,
      raw: e,
    }
  }
  // 网络断开
  if (anyErr?.message === 'Network Error' || anyErr?.code === 'ERR_NETWORK') {
    return {
      code: 'NETWORK_OFFLINE',
      message: '网络连接失败',
      suggest: SUGGEST_BY_CODE.NETWORK_OFFLINE,
      retryable: true,
      raw: e,
    }
  }

  const status: number | undefined = anyErr?.response?.status
  const data: any = anyErr?.response?.data
  const backendMsg: string | undefined =
    (typeof data === 'string' ? data : undefined) ||
    data?.detail ||
    data?.error ||
    data?.message ||
    anyErr?.message

  // 特殊业务码：模型未配置
  if (data?.code === 'PROVIDER_NOT_CONFIGURED' || data?.error?.includes?.('provider')) {
    return {
      code: 'PROVIDER_NOT_CONFIGURED',
      message: backendMsg || '当前模型未配置，请先切换模型',
      suggest: SUGGEST_BY_CODE.PROVIDER_NOT_CONFIGURED,
      retryable: false,
      raw: e,
    }
  }

  const code = statusToCode(status)
  return {
    code,
    message: backendMsg || anyErr?.message || '请求失败',
    suggest: SUGGEST_BY_CODE[code],
    retryable: isRetryable(code),
    raw: e,
  }
}

/** 取 message 字段（最常用，给 UI 直接显示） */
export function formatErrorMessage(e: unknown): string {
  return formatError(e).message
}
