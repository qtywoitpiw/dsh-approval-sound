/**
 * approval-sound 浏览器半边的离线自测：用假的 React / AudioContext / fetch 驱动
 * 「审批卡片观察器」，验证提示音只在**当前会话**真的出现审批卡片时响一次。
 *
 * 覆盖：
 *  - 当前会话审批出现 → 响一次并上报 reason=approval
 *  - 同一张卡片重渲染 → 不重复响
 *  - 待处理交互消失 / 非审批交互（如提问）→ 不响
 *  - 别的会话挂起审批（当前视图看不到卡片）→ 不响  ← 修复「没弹窗也响」
 *  - 冷却结束后新的审批 → 再响，且按 key 去重
 *
 * 用法：node test/client.test.mjs
 */

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const played = []
let helloPosted = false

globalThis.fetch = async (url, init = {}) => {
  if (String(url).endsWith('/played')) {
    played.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ plays: played.length }) }
  }
  if (String(url).endsWith('/client')) {
    helloPosted = true
    return { ok: true, json: async () => ({ ok: true }) }
  }
  return { ok: true, json: async () => ({ enabled: true, plays: played.length }) }
}

class FakeGain {
  constructor() {
    this.gain = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }
  }
  connect() {}
}
class FakeOscillator {
  constructor() {
    this.frequency = { value: 0 }
    this.type = ''
  }
  connect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  constructor() {
    this.state = 'running'
    this.currentTime = 0
    this.destination = {}
  }
  createGain() { return new FakeGain() }
  createOscillator() { return new FakeOscillator() }
  resume() { this.state = 'running'; return Promise.resolve() }
}

const styleElement = { dataset: {}, textContent: '', remove() {} }
globalThis.document = {
  createElement: () => styleElement,
  head: { append() {} },
}
globalThis.window = {
  AudioContext: FakeAudioContext,
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: { load(spec) { globalThis.__spec = spec } },
}

const React = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: (effect) => { effect() },
  createElement: () => null,
}

await import(new URL('../client.js', import.meta.url).href)
const spec = globalThis.__spec
assert.equal(spec.id, 'dsh-approval-sound')

const registrations = []
const ctx = {
  locale: { register: () => () => {} },
  effect: (setup) => setup(),
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

const client = spec.factory((id) => {
  if (id !== 'react') throw new Error(`unexpected require ${id}`)
  return React
})
client.apply(ctx)

const watcher = registrations.find((entry) => entry.options.name === 'conversation.session.header.utilities')
assert.ok(watcher, 'watcher must register into the session header utilities slot')
assert.equal(watcher.options.id, 'approval-sound-watch')
/** 设置行仍然注册（功能没被改动）。 */
assert.ok(registrations.some((entry) => entry.options.id === 'approval-sound'))
assert.equal(helloPosted, true, 'client reports its build marker')

/** 模拟一次渲染：把给定的会话状态 Map 交给观察器。 */
function render(sessionId, statusMap) {
  watcher.component({
    sessionId,
    useSessionStatus: (selector) => selector(statusMap),
  })
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const approval = (key, tool) => ({ kind: 'approval', key, sessionId: 's1', toolName: tool })
const question = { kind: 'question', key: 'question:1', sessionId: 's1' }
const visibleApproval = (interaction) => new Map([['s1', { pendingInteraction: interaction }]])
const hiddenApproval = (interaction) => new Map([['s2', { pendingInteraction: interaction }]])

// 1. 当前会话的审批卡片出现 → 响一次
await render('s1', visibleApproval(approval('approval:1', 'bash')))
assert.equal(played.length, 1, 'visible approval chimes once')
assert.equal(played[0].reason, 'approval')
assert.equal(played[0].tool, 'bash')

// 2. 同一张卡片重渲染 → 不重复
await render('s1', visibleApproval(approval('approval:1', 'bash')))
assert.equal(played.length, 1, 'same pending card does not chime again')

// 3. 卡片消失 / 无待处理交互 → 不响
await render('s1', visibleApproval(null))
assert.equal(played.length, 1)

// 4. 非审批的待处理交互（例如提问）→ 不响
await render('s1', visibleApproval(question))
assert.equal(played.length, 1, 'non-approval interactions must not chime')

// 5. 别的会话挂起审批，当前视图（s1）没有卡片 → 不响（原 bug 场景）
await render('s1', hiddenApproval(approval('approval:2', 'bash')))
assert.equal(played.length, 1, 'an approval pending in another session must not chime here')

// 6. 冷却后再出现一张新的当前会话审批 → 再响，并按 key 去重
await new Promise((resolve) => setTimeout(resolve, 1300))
await render('s1', visibleApproval(approval('approval:3', 'edit')))
assert.equal(played.length, 2, 'a new visible approval after the cooldown chimes again')
assert.equal(played[1].tool, 'edit')
await render('s1', visibleApproval(approval('approval:3', 'edit')))
assert.equal(played.length, 2, 'key dedupe still holds for the new card')

console.log('approval-sound client self-test: OK (chime only for the visible approval card)')
