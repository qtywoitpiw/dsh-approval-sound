# dsh-approval-sound

[中文](#中文) · English

A small DSH plugin that plays a chime **exactly when the permission-approval card appears in the
session you are looking at**, plus an on/off switch and a preview button in **Settings → General**.
No system notification, no badge, no extra process: the page synthesizes the chime with Web Audio,
so it plays through the same app audio session as the DSH window — even when the window is minimized.

> Approvals that are pending in *other* sessions (subagents, teammates, another tab) do **not**
> chime here. That is deliberate: it fixes the old "sound without a visible prompt" behavior.

## Features

- Chime when the approval card actually shows up in the current session
  (tool escalation, plugin manager, sandbox upgrade…).
- On/off switch in **Settings → General**, persisted across restarts.
- **Play sound** preview button; switching on also plays one chime so you can check the volume.
- Two-note bell (C6 → G6, ~0.6 s) synthesized in the page — no audio asset, no npm dependencies.
- Multiple approvals within 1.2 s collapse into one chime; the same card never chimes twice.
- Non-approval interactions (e.g. `ask_user_question`) never chime.

## Install

**1. Download the package** from the [latest release](https://github.com/qtywoitpiw/dsh-approval-sound/releases/latest)
→ **Assets** → `dsh-approval-sound-1.0.0.tgz` (**do not unzip it**; it is the npm package itself).

**2. Add it in DSH**: open **Plugins → Add plugin**, paste the **absolute path** of the `.tgz`
(e.g. `C:\Users\you\Downloads\dsh-approval-sound-1.0.0.tgz`) and confirm. DSH installs it with its
own pnpm and enables it; no restart is normally required.

Step-by-step walkthrough, troubleshooting and uninstall: [INSTALL.md](./INSTALL.md) (Chinese).

### From npm

Once published to npm, **Add plugin** with the name `dsh-approval-sound` (or
`dsh plugin add dsh-approval-sound`) is enough.

> The `.tgz` attached to a release is exactly what `npm pack` produces, so a repo checkout can also
> be packed locally with `npm pack` and installed the same way.

## Usage

1. Open **Settings → General** and scroll to the **Approval chime** row.
2. Click **Play sound** once. Browsers require a user gesture before a page may play audio, so this
   first click also unlocks the audio context for later approvals.
3. Toggle the switch on/off as you like. The setting is stored in
   `<DSH_HOME>/approval-sound.json` (`%USERPROFILE%\.dsh\approval-sound.json` on Windows).

## How it works

| Half | Responsibility |
| --- | --- |
| Host `index.js` | Stores the switch in `<DSH_HOME>/approval-sound.json` and records play reports for diagnostics. It never listens to `approval/request`, so it cannot chime on its own. |
| Client `client.js` | Registers an invisible watcher in the session header: it reads the open session's `PendingInteraction` from `uiSession` (`useSessionStatus`) and chimes only when that interaction is `kind === 'approval'`, i.e. the moment the card is put in front of you. Also renders the settings row. |

Same-origin, loopback-only routes: `GET/POST /approval-sound/state`, `POST /approval-sound/played`
(what the page reports after a chime), `POST /approval-sound/client` (build marker).

## Compatibility

- DSH with the Web UI (Desktop or Web build). Tested on `0.2.2-rc.1`.
- No npm dependencies and no build step; host code uses Node built-ins only, browser code takes React
  from the DSH client module table.
- Windows, macOS and Linux: the chime is synthesized in the page, so no platform audio command is
  involved.

## Troubleshooting

- **No sound from the preview**: check the system volume and the **DSH app's volume** in the OS volume
  mixer; click somewhere in the page first (audio unlock).
- **Card appears but no chime**: check the row switch is on, then `GET /approval-sound/state`:
  `plays`, `lastReason` (`approval` / `preview` / `enabled`), `lastTool` and `hello.version` tell you
  whether the page actually played and which client build is loaded.
- **Reloading after an update**: the client half hot-reloads; if the row looks stale, refresh the page.
- `POST /approval-sound/played` with `{"reason":"preview"}` is a quick way to verify the reporting
  path end to end without touching the UI.

## Development

Plain ESM host module + plain browser module, no bundler.

```sh
node tools/test-approval-sound.mjs         # host: no approval listener, state/report routes
node tools/test-approval-sound-client.mjs  # client: chimes only for the visible approval card
node tools/test-approval-sound-live.mjs    # against a running DSH: state + report routes
node tools/verify-pack.mjs .pack-test/package
```

## License

[MIT](./LICENSE)

---

<a id="中文"></a>

# 中文

需要你批准工具权限时，**只有当前打开的会话里真的弹出审批卡片**才响一声；在 **设置 → 通用**
里可以随时开关、试听。没有系统通知、没有徽标、不起外部进程：声音由页面用 Web Audio 合成，
和 DSH 窗口共用同一个应用音频会话，窗口最小化也能响。

> 其它会话（子代理、队友、另一个标签页）里挂起的审批**不会**在这里响。
> 这是有意为之：修掉旧版「没弹审批也响」的问题。

## 功能

- 当前会话的审批卡片出现时响一声（工具越权执行、插件管理、沙盒升级等）；
- **设置 → 通用** 里的开关，选择会持久化，重启 DSH 仍生效；
- **试听** 按钮；打开开关时也会立即响一声，方便确认音量；
- 两音铃（C6 → G6，约 0.6 秒）在页面内合成——没有音频文件、没有 npm 依赖；
- 1.2 秒内的多个审批只响一次；同一张卡片不会重复响；
- 非审批的交互（例如 `ask_user_question` 提问）不响。

## 安装

**第 1 步，下载安装包**：打开 [最新 Release](https://github.com/qtywoitpiw/dsh-approval-sound/releases/latest)
→ **Assets** → 下载 `dsh-approval-sound-1.0.0.tgz`（**不要解压**，它就是 npm 包本身）。

**第 2 步，在 DSH 里装**：**插件 → Add plugin**，粘贴这个 `.tgz` 的**绝对路径**
（例如 `C:\Users\你\Downloads\dsh-approval-sound-1.0.0.tgz`）→ 确认。DSH 用自己的 pnpm 安装并
自动启用，通常不需要重启。

详细步骤、没声音排查、卸载方法见 [INSTALL.md](./INSTALL.md)。

> 发布到 npm 之后，也可以直接在 **Add plugin** 里填包名 `dsh-approval-sound`。
> Release 里附的 `.tgz` 就是 `npm pack` 的产物，所以直接 clone 仓库再 `npm pack` 也一样能装。

## 使用

1. 打开 **设置 → 通用**，找到 **审批提示音** 一行；
2. 点一次 **试听**（浏览器要求先有用户手势才允许页面出声，这一下同时解锁音频）；
3. 右侧开关控制开/关。开关状态存在 `<DSH_HOME>/approval-sound.json`。

## 实现

| 半边 | 职责 |
| --- | --- |
| 宿主 `index.js` | 记住开关（落盘）并记录页面上报的响铃次数，**不监听审批事件**，因此不可能自己响。 |
| 浏览器 `client.js` | 在会话头部注册一个不可见的观察器：通过 `uiSession` 的 `useSessionStatus` 读取当前会话的 `PendingInteraction`，只有当它是 `kind === 'approval'`（审批卡片真正摆到面前）时才响；同时渲染设置行。 |

同源本地路由（仅本机）：`GET/POST /approval-sound/state`、`POST /approval-sound/played`
（页面响铃后上报）、`POST /approval-sound/client`（构建标记）。

## 兼容性与排查

- 需要带 Web 界面的 DSH（Desktop 或 Web），在 `0.2.2-rc.1` 上验证过；
- 无 npm 依赖、无构建步骤：宿主只用 Node 内置模块，浏览器端从 DSH 模块表取 React；
- 试听没声音：检查系统音量与 **系统音量合成器里 DSH 这个应用** 的音量，并先点一下页面解锁音频；
- 卡片出现但没响：确认开关是开着的，然后看 `GET /approval-sound/state` 里的 `plays`、`lastReason`、
  `lastTool`、`hello.version`，能区分「页面没播」和「客户端代码没更新」；
- 想快速验证上报链路：`POST /approval-sound/played` 带 `{"reason":"preview"}`。

## 许可

[MIT](./LICENSE)
