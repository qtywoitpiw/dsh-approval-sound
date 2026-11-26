/**
 * 审批提示音 · 浏览器端（client half）
 *
 * 声音的触发点在这里，而不是宿主：只有当**当前打开的会话**真的把审批卡片摆到
 * 你面前（`uiSession` 的 PendingInteraction 变成 `kind === 'approval'`）时才响。
 * 其它会话 / 子代理 / 别的窗口里挂起的审批不会触发提示音。
 *
 * 另外在「设置 → 通用」注册一行开关，读写宿主的 /approval-sound/state。
 */
window.__ModuleLoader__.load({
  id: 'dsh-approval-sound',
  factory(require) {
    const React = require('react')
    const NS = 'approval-sound'
    const ROUTE = '/approval-sound'
    /** 页面里的构建标记；宿主 /state 的 hello 字段能看到它，用来确认热更新是否生效。 */
    const CLIENT_VERSION = '3-visible-pending'
    /** 两个提示音的间隔下限，避免叠加。 */
    const COOLDOWN_MS = 1200

    /** 简体中文字典（键集与英文一致）。 */
    const zh = {
      title: '审批提示音',
      description: '需要你批准工具权限时在这台电脑上播放提示音。关闭后不再播放。',
      preview: '试听',
      error: '设置没有保存成功，请再试一次。',
      unavailable: '提示音服务不可用：宿主插件可能没有激活。',
    }
    /** 英文回退字典。 */
    const en = {
      title: 'Approval chime',
      description: 'Plays a chime on this computer whenever a permission approval is waiting for you. Turn it off to stay silent.',
      preview: 'Play sound',
      error: 'The setting was not saved. Please try again.',
      unavailable: 'The chime service is unavailable: the host plugin may be inactive.',
    }

    /**
     * 复制自宿主 General 设置行的排版样式（只保留 --dsw-* 主题令牌），
     * 开关的外观沿用宿主 Switch 的尺寸与状态色，类名全部加插件前缀。
     */
    const CSS = `
.aps-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
}
.aps-text { min-width: 0; }
.aps-title { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 20px; }
.aps-desc { color: var(--dsw-alias-label-secondary); margin-top: 4px; font-size: 12px; line-height: 18px; }
.aps-error { color: var(--dsw-alias-state-error-primary); margin-top: 4px; font-size: 12px; line-height: 18px; }
.aps-controls { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
.aps-preview {
  padding: 4px 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.aps-preview:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.aps-preview:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.aps-preview:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.aps-switch {
  box-sizing: border-box;
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
}
.aps-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.aps-switch:disabled { cursor: default; opacity: .5; }
.aps-switch:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.aps-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary-foreground);
  transition: transform .12s ease;
}
.aps-switch[aria-checked="false"] .aps-thumb { background: var(--dsw-alias-switch-thumb); }
.aps-switch[aria-checked="true"] .aps-thumb { transform: translate(16px); }
`

    /* ---------------------------------------------------------------- 声音 */

    /** 页面级 AudioContext；浏览器要求先有用户手势才能出声。 */
    let audio = null
    /** 上一次响铃时间（冷却）与上一次已响过的审批 key（去重）。 */
    let lastChimeAt = 0
    let lastApprovalKey = null

    function ensureAudio() {
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (Ctor === undefined) return null
      if (audio === null) {
        try {
          audio = new Ctor()
        } catch {
          return null
        }
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {})
      return audio
    }

    /** 上报一次实际响铃（只用于统计/排查，失败无所谓）。 */
    function reportPlayed(reason, tool) {
      const body = { reason }
      if (typeof tool === 'string' && tool !== '') body.tool = tool
      fetch(`${ROUTE}/played`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {})
    }

    /** 在给定 AudioContext 上排一段两音上行铃（C6 → G6）。 */
    function renderChime(context) {
      const master = context.createGain()
      master.gain.value = 0.5
      master.connect(context.destination)
      const now = context.currentTime + 0.02
      const notes = [
        { frequency: 1046.5, offset: 0, duration: 0.3, gain: 0.5 },
        { frequency: 1567.98, offset: 0.13, duration: 0.49, gain: 0.65 },
      ]
      for (const note of notes) {
        const start = now + note.offset
        const envelope = context.createGain()
        envelope.gain.setValueAtTime(0.0001, start)
        envelope.gain.exponentialRampToValueAtTime(note.gain, start + 0.008)
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.duration)
        envelope.connect(master)
        for (const [ratio, level] of [[1, 1], [2, 0.22], [3, 0.08]]) {
          const oscillator = context.createOscillator()
          oscillator.type = 'sine'
          oscillator.frequency.value = note.frequency * ratio
          const levelGain = context.createGain()
          levelGain.gain.value = level
          oscillator.connect(levelGain)
          levelGain.connect(envelope)
          oscillator.start(start)
          oscillator.stop(start + note.duration + 0.02)
        }
      }
    }

    /**
     * 响一声。
     * @param {'approval'|'preview'|'enabled'} reason 触发原因。
     * @param {{force?: boolean, tool?: string}} [options] force 越过冷却；tool 记录工具名。
     * @returns 是否已立即排入播放。
     */
    function playChime(reason, options = {}) {
      if (options.force !== true && Date.now() - lastChimeAt < COOLDOWN_MS) return false
      const context = ensureAudio()
      if (context === null) return false
      const run = () => {
        lastChimeAt = Date.now()
        renderChime(context)
        reportPlayed(reason, options.tool)
      }
      if (context.state === 'running') {
        run()
        return true
      }
      // 可能刚被用户手势唤醒：等 resume 成功再补这一声。
      context.resume()
        .then(() => {
          if (context.state === 'running') run()
        })
        .catch(() => {})
      return false
    }

    /** 首次点击/按键解锁音频，让后续审批卡片能直接出声。 */
    function installAudioUnlock(ctx) {
      ctx.effect(() => {
        const unlock = () => { ensureAudio() }
        for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock, true)
        return () => {
          for (const type of ['pointerdown', 'keydown']) window.removeEventListener(type, unlock, true)
        }
      }, 'approval-sound: audio unlock')
    }

    /* ------------------------------------------------------- 审批卡片观察器 */

    /**
     * 只观察「当前会话」的待处理交互。ui-session 把每个会话的 pendingInteraction
     * 发布成快照，会话头部槽位会拿到 `sessionId` 与 `useSessionStatus`；审批卡片
     * 出现的同一刻这里就能看到 kind === 'approval'，于是响铃。其它会话的挂起审批
     * 不会进入这个选择器，所以不会出现「没弹窗也响」。
     */
    function ApprovalChimeWatcher(props) {
      const useSessionStatus = props.useSessionStatus
      const sessionId = props.sessionId
      const pending = typeof useSessionStatus === 'function'
        ? useSessionStatus((snapshot) => (sessionId === undefined ? undefined : snapshot.get(sessionId)?.pendingInteraction))
        : undefined

      React.useEffect(() => {
        if (pending === null || pending === undefined) return
        if (pending.kind !== 'approval') return
        const key = typeof pending.key === 'string' && pending.key !== ''
          ? pending.key
          : `session:${String(pending.sessionId)}`
        if (key === lastApprovalKey) return
        lastApprovalKey = key
        playChime('approval', { tool: typeof pending.toolName === 'string' ? pending.toolName : undefined })
      }, [pending])

      return null
    }

    /* ---------------------------------------------------------------- 设置行 */

    /** 调一次宿主路由；非 2xx 直接抛错，交给行内错误提示。 */
    async function call(path, init) {
      const response = await fetch(ROUTE + path, { cache: 'no-store', ...init })
      if (!response.ok) throw new Error(`approval-sound: HTTP ${String(response.status)}`)
      return await response.json()
    }

    /** 通用设置行：标题 + 说明 + 试听 + 开关。 */
    function ApprovalSoundRow(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => (en[key] ?? key)
      const [status, setStatus] = React.useState('loading')
      const [enabled, setEnabled] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => {
        let active = true
        const controller = new AbortController()
        call('/state', { signal: controller.signal })
          .then((value) => {
            if (!active) return
            setEnabled(value.enabled !== false)
            setStatus('ready')
          })
          .catch(() => {
            if (active) setStatus('unavailable')
          })
        return () => {
          active = false
          controller.abort()
        }
      }, [])

      const update = (next) => {
        if (busy || status !== 'ready') return
        setFailed(false)
        setBusy(true)
        ensureAudio() // 用户手势里解锁音频，打开时那一声才响得出来
        call('/state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        })
          .then((value) => {
            setEnabled(value.enabled !== false)
            if (value.enabled === true) playChime('enabled', { force: true })
          })
          .catch(() => setFailed(true))
          .finally(() => setBusy(false))
      }

      const preview = () => {
        if (!enabled || busy || status !== 'ready') return
        setFailed(false)
        ensureAudio()
        playChime('preview', { force: true })
      }

      const ready = status === 'ready'
      const messages = []
      if (failed) messages.push(React.createElement('div', { key: 'failed', className: 'aps-error', role: 'alert' }, t('error')))
      if (status === 'unavailable') messages.push(React.createElement('div', { key: 'unavailable', className: 'aps-error', role: 'alert' }, t('unavailable')))

      return React.createElement('div', { className: 'aps-row' },
        React.createElement('div', { className: 'aps-text' },
          React.createElement('div', { className: 'aps-title' }, t('title')),
          React.createElement('div', { className: 'aps-desc' }, t('description')),
          ...messages,
        ),
        React.createElement('div', { className: 'aps-controls' },
          React.createElement('button', {
            type: 'button',
            className: 'aps-preview',
            disabled: !ready || busy || !enabled,
            onClick: preview,
          }, t('preview')),
          React.createElement('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': enabled,
            'aria-label': t('title'),
            className: 'aps-switch',
            disabled: !ready || busy,
            onClick: () => update(!enabled),
          }, React.createElement('span', { className: 'aps-thumb' })),
        ),
      )
    }

    /** 注册字典、样式、音频解锁、审批观察器与设置行；资源都挂在 ctx.effect 上。 */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'approval-sound: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.approvalSound = '1'
        style.textContent = CSS
        document.head.append(style)
        return () => {
          style.remove()
        }
      }, 'approval-sound: styles')
      installAudioUnlock(ctx)
      ctx.effect(() => {
        const controller = new AbortController()
        let timer = 0
        const postHello = async (attempt) => {
          try {
            const response = await fetch(`${ROUTE}/client`, {
              method: 'POST',
              cache: 'no-store',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ version: CLIENT_VERSION }),
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          } catch {
            // 宿主可能比页面晚就绪（插件刚重载 / 应用刚启动）：重试几次，纯诊断用。
            if (controller.signal.aborted || attempt >= 3) return
            timer = setTimeout(() => { postHello(attempt + 1) }, 1500)
          }
        }
        postHello(1)
        return () => {
          controller.abort()
          clearTimeout(timer)
        }
      }, 'approval-sound: client hello')
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'approval-sound-watch',
        order: 9000,
      }, ApprovalChimeWatcher))
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'approval-sound',
        order: 18,
        locale: NS,
      }, ApprovalSoundRow))
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
