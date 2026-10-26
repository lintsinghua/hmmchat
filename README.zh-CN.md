<div align="center">
  <img src="docs/icon.png" width="112" alt="">
  <h1>HmmChat</h1>
  <p><em>问一个问题，拿到不止一个回答，并排放着比。<br>
  轻到你会忘记，它不是系统自带的那一个。</em></p>
  <p>
    <a href="https://github.com/lintsinghua/hmmchat/releases"><img alt="下载最新版本" src="https://img.shields.io/github/v/release/lintsinghua/hmmchat?style=flat-square&color=7c3f2e&label=download&labelColor=1a1817"></a>
    <img alt="macOS 11+" src="https://img.shields.io/badge/macOS-11%2B%20(arm64)-2b4a63?style=flat-square&labelColor=1a1817">
    <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-3d5a45?style=flat-square&labelColor=1a1817">
    <img alt="React 19" src="https://img.shields.io/badge/React-19-2f5d66?style=flat-square&labelColor=1a1817">
    <img alt="Rust" src="https://img.shields.io/badge/Rust-6b4636?style=flat-square&labelColor=1a1817">
    <img alt="MIT" src="https://img.shields.io/badge/license-MIT-5a4a6b?style=flat-square&labelColor=1a1817">
  </p>
  <p>
    <a href="README.md">English</a>
  </p>
</div>

问一个问题，拿到不止一个回答，并排放在一起比较。开源的聚合客户端（LibreChat、Lobe Chat、Open WebUI、Chatbox、Cherry Studio）想一次解决所有问题，结果都很重——面板、插件，还有你从来没要过的各种设置。厂商自家的应用（claude.ai、chatgpt.com）很安静，但只能用一家。

HmmChat 走的是中间那条窄路。**轻、直接、不绕：** 一个窗口、一列导航、一个输入框，没有第二条侧栏，没有仪表盘。它打开时像应用，不像网页控制台——别的客户端让你在「安静」和「对比」之间二选一，它两个都要。

<table>
<tr>
<td width="50%"><img src="docs/compare-columns.jpg" alt="四个模型并排回答同一个问题"></td>
<td width="50%"><img src="docs/single-column.jpg" alt="单列回答，上方是思考窗口"></td>
</tr>
<tr>
<td><sub><b>一个问题，几个模型。</b>等高并列，各自按自己的速度输出，每一列都能单独停、单独重新生成。</sub></td>
<td><sub><b>也可以只问一个。</b>同一套代码：单列对话就是只有一条回答的一轮。</sub></td>
</tr>
<tr>
<td><img src="docs/fork.jpg" alt="从某一句提问分出去的新对话"></td>
<td><img src="docs/quote.jpg" alt="把早先对话里的若干轮引用进来"></td>
</tr>
<tr>
<td><sub><b>从任何一句提问分出去。</b>跑题的问题在新对话里接着问，之前的上下文一起带过去。</sub></td>
<td><sub><b>引用早先的对话。</b>勾选要带进来的轮次；来源本身也是并排的话，可以指定引用哪个模型的回答。</sub></td>
</tr>
</table>

## 它能做什么

- **并排对比** —— 最多四个模型回答同一个问题，入口在输入框的「对比」。各列独立输出，可分别停止与重新生成；中途加入的列，先显示它继承到的回答，也可以让它自己再答一次。
- **收窄，或者只看一列** —— 取消勾选，后面的追问就只发给还勾着的模型（Esc 恢复全部；没被问到的列显示「未参与」，那一轮也从不进入它的上下文）。点列标题上的 ⤢，或 ⌘K 里的「单独查看」，可以把一个模型的对话摊成单列来读，它错过的轮次收成一行。
- **拿掉一列，什么都不会丢** —— 标签上的 × 只是把这一列移出并排：回答都留着，输入框上方浮出「撤销」，可以直接放回来；之后的「对比」菜单里，它也一直留在「已移除」中，连同回答过的轮数。再添加同一个模型，回来的还是原来那一列。
- **从任何一条回答分出去** —— 在某轮回答之后把对话切开，新对话带着到此为止的全部回答继续，所以跑题的问题不会打断原来那段。提问本身也有分支：改一版，原来那版还在，一步切回。
- **引用早先的对话** —— 把过去的一段对话作为上下文带进来，勾选要包含的轮次；来源本身是并排对比的话，还能指定引用哪个模型的回答。引用是一份快照，像附件那样一路带着，点它的标签能打开原对话。
- **其余的，都很安静** —— Anthropic、OpenAI、Gemini、OpenRouter，以及任何 OpenAI 兼容端点；联网可以用厂商自带的，也可以走 Tavily / Brave / Exa，一个开关切换；思考深度只列出模型真正接受的档位，并且每列可以单独设置；文本、图片、PDF 和 Office 附件只发给读得懂的模型；输入框按你上次离开时的样子重新打开；所有快捷键都可以按下你想要的键来重新绑定。

**刻意没有**：插件、角色、知识库、温度面板、提示词库、图像生成。

## 快速开始

### 安装

到 [**Releases**](https://github.com/lintsinghua/hmmchat/releases) 下载
`HmmChat_x.y.z_aarch64.dmg`，打开后把 HmmChat 拖进「应用程序」。

应用暂时还没有 Apple 开发者签名，所以第一次打开会被拦下，提示「无法验证」。点「完成」，然后到 **系统设置 → 隐私与安全性**，在页面底部点「仍要打开」。也可以在终端里执行：

```bash
xattr -dr com.apple.quarantine /Applications/HmmChat.app
```

需要 macOS 11 或更高版本，Apple 芯片。

### 从源码构建

需要 Node 20+、Rust，以及 Xcode 命令行工具。

```bash
git clone https://github.com/lintsinghua/hmmchat.git
cd hmmchat
pnpm install
pnpm app              # 桌面应用，带热重载
pnpm app:build        # 或者直接产出 .app 与 .dmg，在 src-tauri/target/release/bundle/
```

### 第一次运行

打开 **设置 → 添加**，选一家供应商，粘贴 API Key。密钥直接写进 macOS 原生存储，此后不会再显示，也从不进入 webview（见[密钥从不进入界面](#密钥从不进入界面)）。

不需要别的：没有账号，没有服务器，没有遥测。界面有中文和英文两版——**设置 → 通用 → 界面语言**。

### 不用密钥，先试试

整个应用也能在浏览器里跑，对着一个 mock 供应商：不构建 Tauri，不要密钥，不花钱。

```bash
pnpm mock             # 终端一：mock 供应商，跑在 :8787
pnpm dev              # 终端二：应用，跑在 :5173
```

把供应商地址指到 `http://127.0.0.1:8787/anthropic/v1`（或 `/openai/v1`、`/openai-responses/v1`、`/google/v1beta`；自建的 OpenAI 兼容供应商用 `/compatible/v1`，比如 DeepSeek），密钥随便填个非空值。mock 三种协议都会说，也会发出思考与联网搜索的事件，整条流式链路都能跑通。

特性开关写在模型 id 里，例如 `claude-opus-5-5?slow=1&reason=1`。

设 `MOCK_SCRIPT=path/to/script.json`，mock 就改为照脚本回答：最后一条用户消息命中某条目的 `match` 时，用该条目里这个模型的回答（或它的 `*`），按 `cps`（每秒字符数）的速度吐出，可以附带思考与搜索来源。没命中的请求和非流式的请求照旧。格式见 `scripts/mock-script.example.json`。

## 它是怎么做的

```
┌──────────────────────────────────────────────────────────────┐
│ webview（React 19 + Vite + Tailwind v4）                      │
│   输入框 · 会话流 · 侧栏 · 设置 · ⌘K 命令面板                  │
│   Vercel AI SDK  ← 各家适配器、流式输出、工具循环              │
│         │ 自定义 fetch（src/lib/transport.ts）                 │
└─────────┼────────────────────────────────────────────────────┘
          │ Tauri IPC：Channel（流式）+ invoke
┌─────────▼────────────────────────────────────────────────────┐
│ Rust（src-tauri）                                            │
│   http_stream  — reqwest 代理、base64 分片、可取消             │
│   secrets      — 只写密钥存储，绑定来源                        │
│   tauri-plugin-sql — SQLite                                  │
└──────────────────────────────────────────────────────────────┘
```

大部分设计取决于三个决定。

**AI SDK 跑在 webview 里。** 各家的流式格式差别不小（`message_start`/`content_block_delta`、responses 事件、Gemini candidates），手写四个解析器是这类项目最容易出 bug 的地方。交给 SDK 归一化之后，应用的流式代码就只是对 `fullStream` 各 part 类型的一次 `switch`。

**每个请求都经过 Rust。** 浏览器直连会被各家的 CORS 挡下。`src/lib/transport.ts` 实现了一个从 Rust 命令里穿过去的 `fetch`，SDK 的各家 provider 把它当作普通的 `FetchFunction` 接过去——于是没有任何一个适配器知道旁边有个代理。

<a id="密钥从不进入界面"></a>

**API 密钥从不进入 webview。** 前端在密钥该出现的位置只存一个占位符（`{{secret:provider:abc}}`）；真值由 Rust 在请求发出的路上替换，而且只对它保存时绑定的来源这么做。没有任何读取路径：没有函数会返回它，提示词也就拿不走它。见 `src-tauri/src/secrets.rs`。

## 数据模型

一句提问是一个 **turn**，一个 turn 有 **N 条 reply**，每个 lane 一条。单列对话就是 N 等于 1 的情形。没有任何地方去判断「现在是不是对比模式」；会话流只读 lane 的数量，画一列或者画一格里。

对话是 turn 的树——改一句提问，会分出一个兄弟分支；而 reply 是挂在 turn 下的**版本化兄弟**，不是树节点，因为重新生成某个模型的回答，不该让整段对话跟着分叉。

对比功能靠两个细节立住：

`replyFor`（`src/chat/types.ts`）——中途加入的 lane，对更早的轮次本来没有 reply，于是它继承自己分出来的那条 lane 的回答。少了这个回退，加第二个模型就等于递给它一段没有历史的对话，而且界面上看不出任何异常。

lane 上的 `hidden`——拿掉一列只是标记为隐藏，而不是把 lane 丢掉。回答留着，lane 的链条也完整（下游因此仍然解析到同一份上下文），`restoreLane` 能让这一列原样回来。

## 验证

```bash
pnpm check            # 类型检查 + 单元测试
pnpm verify:streams   # 断言 SDK 的 stream part 与引擎 switch 的分支一致
pnpm verify:ui        # 在 Chrome 里跑一遍，截图写到 shots/
```

`verify:streams` 是其中值得看懂的一个。引擎处理流式数据，是对 part 类型名（`text-delta`、`reasoning-delta`、`tool-call`……）的 `switch`。SDK 改了名字不会报错——只会让回答变空。那个脚本拿真实适配器对着 mock 跑一遍，断言每个 part 都到达，把这层契约钉住。

`verify:ui` 需要 Chrome 在 macOS 默认路径（或用 `CHROME_PATH` 指定），会端到端走一遍：配置供应商、发消息、对比两个模型、跑一次搜索、打开命令面板。

## 目录

```
src/
  i18n/        core（t/useT）· catalog/（所有文案，按区域分文件）
  lib/         transport（Tauri 的 fetch）· db（SQLite + 内存版）· secrets · open
  providers/   registry · capabilities · reasoning（深度映射）· model discovery
  search/      Tavily / Brave / Exa 适配器，对外是一个 web_search 工具
  chat/        types（数据模型）· context · engine · session · smoother · store
  components/  shell · sidebar · thread · composer · settings · palette · message · ui
  styles/      tokens.css · global.css · markdown.css
src-tauri/src/ lib.rs · http.rs · secrets.rs
scripts/       mock-llm.mjs · verify-streams.mjs · shoot.mjs · make-icon.mjs
```

动样式之前，有两件事值得知道：

- **`markdown.css` 刻意不管 `pre`、`table` 和 `code` 的样式。** 这些元素归 Streamdown，它会打上 `data-streamdown="code-block"`、`"table"` 之类的标记。两层都写，会得到一个双层边框的代码块，和一个多出来的语言标签。
- **流式文字不在对话图里。** 它住在另一张按 reply id 索引的表中（`src/chat/store.ts`），所以某一列进来一个 token，不会牵动另外三列重绘。

## 添一句文案

用户可见的文字只该待在 `src/i18n/`。一条就是一个对子：

```ts
export const thread = {
  skipped: { en: 'Not asked', zh: '未参与' },
} satisfies Record<string, Entry>
```

React 之外用 `t(thread.skipped)`（引擎、辅助函数）；组件里用 `useT()`，语言一变它就会重新渲染。带数量的文案用 `counted(entry, n)` 传 `{ one, many }`——英文要分单复数，中文不用。

## 模型能力

一个模型能做什么——会不会思考、有哪些深度、看不看得见图片和 PDF、接不接受文档——来自 [models.dev](https://models.dev) 的一份快照，生成进 `src/providers/catalog.data.ts`：

```bash
pnpm sync:catalog          # 从 models.dev 重新拉取
MODELS_DEV_FILE=/path/to/api.json pnpm sync:catalog   # 用本地副本
```

它换掉了一张手写的正则表，而那张表的错处没人看得见：整个厂商被压平成「不会思考」，可它们的模型其实是带开关的；有一个 UI 永远够不到的 `xhigh`；每个网关模型都被判成不会思考，只因它的*供应商*不为人知。厂商的能力事实每月都在变，这不是适合手工维护的东西。

底下仍然保留家族规则，用来处理目录里从没见过的 id——刚发布的新模型，自托管改了名的模型。它们按代际推断，而不假装认识每一个具体模型。

同一份数据还支撑这些：

- **深度控制**只给出模型接受的档位。`gpt-5-pro` 只有一种设定，于是它没有控件；`o3` 不接受 `none`，于是它没有关闭项；`gpt-5.1` 接受，于是它有。
- **取值映射**会就近夹到模型确实接受的档位，请求的深度绝不会以厂商会拒绝的值发出去。
- **附件**按输入类型把关。图片得模型看得见；PDF 不必，因为它的文字是在你本机抽出来的，永远可读。
- **自带搜索**只在厂商有、且模型接受工具调用的地方给出：Claude 3.5+、OpenAI 的 gpt-4o/4.1/5+ 与 o 系列、Gemini 2+。models.dev 没有搜索字段，所以按 id 匹配家族，再用目录里的工具调用标记排掉图像与 TTS 变体。OpenRouter 有自己的搜索，所以在它那里，凡是接受工具调用的模型都算。

## 键盘

下面这些都能在 **设置 → 快捷键** 里改，改的方式就是按下你想要的键。

| | |
|---|---|
| `⌘N` | 新对话 |
| `⌘K` | 命令面板 |
| `⌘P` | 切换模型 |
| `⌘\` | 显示 / 隐藏侧栏 |
| `⌘,` | 设置 |
| `Esc` | 停止生成 |
| `Enter` | 发送 |
| `⇧Enter` | 换行 |

Enter 的判断同时看 `isComposing` **和** `keyCode === 229`。在 WebKit 上，确认输入法候选词的那一次 Enter 会报 `isComposing: false`，却把 `keyCode` 留在 229；只看 `isComposing`，中文用户就会把只打了一半的话发出去。

## 设计上的一些取舍

- **不用强调色。** 主操作在浅色下是纸上落墨，在深色下是墨上落纸。加一个饱和的强调色，最容易让一个工具看起来像个玩具。
- **只留一列导航。** 没有第二条侧栏，没有常驻的右面板；设置关在一个模态里。同类应用里的杂，多半来自并排的多个面板。
- **动效用来解释状态，不做装饰。** 120–320ms，指数缓出，只动 transform 和 opacity。流式正文永远不做布局动画。
- **四个时长、两条曲线**，都在 `tokens.css` 里。没有动画超过 320ms，`prefers-reduced-motion` 会把它们一并收掉。

## 许可证

MIT。
