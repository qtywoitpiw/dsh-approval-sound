/**
 * 审批提示音 · 宿主端（node half）
 *
 * 只负责「记住开关」和「记录页面实际响了几次」，**不监听审批事件**。
 * 声音的触发点在浏览器：当前打开的会话里真的出现了审批卡片（PendingInteraction
 * 变成 kind === 'approval'）时才响。这样不会出现「没有弹审批也响」——
 * 其它会话/子代理/别的窗口里挂起的审批不算「你面前的弹窗」。
 *
 * - 开关状态落盘在 `<DSH_HOME>/approval-sound.json`，重启后仍然生效。
 *
 * 路由（同源，仅本机使用）：
 *   GET  /approval-sound/state   → { enabled, plays, lastPlayedAt, lastReason, lastTool, hello }
 *   POST /approval-sound/state   { enabled: boolean } → 同一份状态
 *   POST /approval-sound/played  { reason, tool? }    页面响铃后上报，仅用于统计与排查
 *   POST /approval-sound/client  { version }          页面端自报构建标记，仅用于排查
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const ROUTE = '/approval-sound'
/** 请求体上限，只有一两个短字符串。 */
const BODY_LIMIT = 4096
/** 允许上报的响铃原因，挡住随便写的数据。 */
const REASONS = new Set(['approval', 'preview', 'enabled'])

const statePath = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'approval-sound.json')

/** 读取落盘的开关；文件缺失或损坏时默认开启（用户装这个插件就是要提示音）。 */
function readEnabled() {
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'))
    return parsed?.enabled !== false
  } catch {
    return true
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** 宿主插件主体。`webServer` 是路由的硬依赖：没有它就不激活。 */
export const inject = ['webServer']

export function apply(ctx) {
  let enabled = readEnabled()
  /** 本进程内页面实际上报的响铃次数与最后一次原因（诊断用，重启清零）。 */
  let plays = 0
  let lastPlayedAt = 0
  let lastReason = null
  let lastTool = null
  /** 页面端上报的构建标记（证明浏览器里跑的是哪一版客户端代码）。 */
  let hello = null

  function status() {
    return {
      enabled,
      plays,
      lastPlayedAt: lastPlayedAt === 0 ? null : lastPlayedAt,
      lastReason,
      lastTool,
      hello,
    }
  }

  async function persist() {
    await mkdir(dirname(statePath), { recursive: true })
    const temp = `${statePath}.tmp`
    await writeFile(temp, `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8')
    await rename(temp, statePath)
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname !== ROUTE && !url.pathname.startsWith(`${ROUTE}/`)) {
        sendJson(res, 404, { error: 'not found' })
        return
      }
      const sub = url.pathname.slice(ROUTE.length)
      if (sub !== '/state' && sub !== '/played' && sub !== '/client') {
        sendJson(res, 404, { error: 'not found' })
        return
      }

      if (sub === '/client' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req)
          hello = { at: Date.now(), version: typeof body?.version === 'string' ? body.version : 'unknown' }
        } catch {
          hello = { at: Date.now(), version: 'unreadable' }
        }
        sendJson(res, 200, { ok: true })
        return
      }

      if (sub === '/played' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const reason = typeof body?.reason === 'string' && REASONS.has(body.reason) ? body.reason : 'unknown'
        plays += 1
        lastPlayedAt = Date.now()
        lastReason = reason
        lastTool = typeof body?.tool === 'string' ? body.tool.slice(0, 120) : null
        sendJson(res, 200, status())
        return
      }

      if (sub === '/state' && req.method === 'GET') {
        sendJson(res, 200, status())
        return
      }

      if (sub === '/state' && req.method === 'POST') {
        const body = await readJsonBody(req)
        if (typeof body?.enabled !== 'boolean') {
          sendJson(res, 400, { error: 'enabled must be a boolean' })
          return
        }
        const wasEnabled = enabled
        enabled = body.enabled
        try {
          await persist()
        } catch (error) {
          enabled = wasEnabled
          throw error
        }
        sendJson(res, 200, status())
        return
      }

      sendJson(res, 405, { error: 'method not allowed' })
    } catch (error) {
      ctx.logger?.warn?.('approval-sound: request failed', error)
      if (!res.headersSent) sendJson(res, 500, { error: 'request failed' })
      else res.end()
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: handle }),
    'approval-sound: state and play-report routes',
  )
}
