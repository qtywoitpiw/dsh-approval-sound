/**
 * approval-sound 宿主半边的离线自测（不装进 Harness，直接跑）。
 *
 * 重点验证「宿主不监听审批」：这样声音只能由页面在当前会话的审批卡片出现时触发，
 * 不会因为别的会话/子代理挂起审批而在没有弹窗时响。
 * 另外覆盖状态读写、响铃上报、非法请求与卸载。
 *
 * 用法：node test/host.test.mjs
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const root = await mkdtemp(join(tmpdir(), 'approval-sound-test-'))
process.env.DSH_HOME = root
const statePath = join(root, 'approval-sound.json')
await writeFile(statePath, `${JSON.stringify({ enabled: false })}\n`, 'utf8')

const { apply, inject } = await import('../index.js')

const listeners = []
const effects = []
const routes = []
let routeDisposed = false
const ctx = {
  logger: { warn: (...args) => console.warn('[warn]', ...args) },
  on(name, callback, options) {
    listeners.push({ name, callback, options })
    return () => {}
  },
  effect(setup, label) {
    const disposer = setup()
    effects.push({ label, disposer })
    return disposer
  },
  webServer: {
    register(definition) {
      routes.push(definition)
      return () => { routeDisposed = true }
    },
  },
}

apply(ctx)

assert.deepEqual(inject, ['webServer'], 'host should require webServer')
assert.equal(listeners.length, 0, 'the host must not listen to approval/request: chime is decided by the visible card')
assert.equal(effects.length, 1, 'route registration is effect-owned')
assert.equal(routes.length, 1)
assert.equal(routes[0].kind, 'prefix')
assert.equal(routes[0].path, '/approval-sound')

/** 最小 HTTP 响应：像 ServerResponse 一样收集 body。 */
class FakeResponse extends EventEmitter {
  constructor() {
    super()
    this.status = 0
    this.headers = {}
    this.headersSent = false
    this.chunks = []
  }
  writeHead(status, headers) {
    this.status = status
    this.headers = headers
    this.headersSent = true
    return this
  }
  write(chunk) {
    this.chunks.push(String(chunk))
    return true
  }
  end(chunk) {
    if (chunk !== undefined) this.write(chunk)
    this.headersSent = true
    this.emit('close')
  }
}

async function call(method, path, body) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const request = Object.assign(Readable.from(payload === undefined ? [] : [payload]), { method, url: path, headers: {} })
  const response = new FakeResponse()
  await routes[0].handler(request, response)
  let json
  try {
    json = JSON.parse(response.chunks.join(''))
  } catch {}
  return { status: response.status, headers: response.headers, json }
}

// 初始状态：关闭、未响过、页面未上报
const initial = await call('GET', '/approval-sound/state')
assert.equal(initial.status, 200)
assert.equal(initial.headers['cache-control'], 'no-store')
assert.deepEqual(
  {
    enabled: initial.json.enabled,
    plays: initial.json.plays,
    lastReason: initial.json.lastReason,
    hello: initial.json.hello,
  },
  { enabled: false, plays: 0, lastReason: null, hello: null },
)

// 页面端上报构建标记
assert.equal((await call('POST', '/approval-sound/client', { version: 'test-build' })).status, 200)
assert.equal((await call('GET', '/approval-sound/state')).json.hello.version, 'test-build')

// 打开开关：只落盘，宿主自己不发声
const on = await call('POST', '/approval-sound/state', { enabled: true })
assert.equal(on.status, 200)
assert.equal(on.json.enabled, true)
assert.equal(on.json.plays, 0, 'the host never plays by itself')
assert.equal(JSON.parse(await readFile(statePath, 'utf8')).enabled, true)

// 页面响铃后上报：plays / 原因 / 工具名
const played = await call('POST', '/approval-sound/played', { reason: 'approval', tool: 'bash' })
assert.equal(played.status, 200)
assert.equal(played.json.plays, 1)
assert.equal(played.json.lastReason, 'approval')
assert.equal(played.json.lastTool, 'bash')
assert.ok(typeof played.json.lastPlayedAt === 'number')

// 非法原因不会被记账成任意字符串
const weird = await call('POST', '/approval-sound/played', { reason: '<script>' })
assert.equal(weird.json.lastReason, 'unknown')

// 旧接口已移除：SSE 与宿主预览都不存在，避免绕过「当前会话卡片」的判断
assert.equal((await call('GET', '/approval-sound/events')).status, 404)
assert.equal((await call('POST', '/approval-sound/preview')).status, 404)

// 参数校验与未知路径
assert.equal((await call('POST', '/approval-sound/state', { enabled: 'yes' })).status, 400)
assert.equal((await call('GET', '/approval-sound/nope')).status, 404)
assert.equal((await call('GET', '/something-else')).status, 404)

// 卸载：路由注册被释放
effects[0].disposer()
assert.equal(routeDisposed, true, 'unload disposes the route')

console.log('approval-sound host self-test: OK (no approval listener, temp state at', root, ')')
