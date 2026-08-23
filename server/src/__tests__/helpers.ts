import type { AddressInfo } from 'node:net'
import type { Express } from 'express'

// 测试工具: 起临时服务 / 创建隔离数据目录

export interface TestServer {
  base: string
  port: number
  close: () => Promise<void>
}

export async function startServer(app: Express): Promise<TestServer> {
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        }),
      ),
  }
}

interface JsonRes<T = unknown> {
  status: number
  body: T
}

// 固定绑定原生 fetch, 避免被测试中的沙箱桩(stub)劫持
const rawFetch = globalThis.fetch.bind(globalThis)

export async function req<T = unknown>(
  base: string,
  method: string,
  pathname: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<JsonRes<T>> {
  const res = await rawFetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // 非 JSON 响应保留原文
  }
  return { status: res.status, body: parsed as T }
}
