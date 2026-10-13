// Visual check harness.
//
// Drives the app in a real browser against the mock provider and writes
// screenshots to `shots/`. Uses the locally installed Chrome rather than a
// downloaded Chromium, so it costs nothing to run and needs no extra setup:
//
//   node scripts/mock-llm.mjs &
//   pnpm dev &
//   node scripts/shoot.mjs
//
// The app must be seeded first (a provider pointing at the mock and a
// conversation), which `seed()` below does by driving the real settings UI.
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../shots')
const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const MOCK = process.env.MOCK_BASE ?? 'http://127.0.0.1:8787'

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// Start from a clean directory: the numbering is positional, so a run that
// drops or adds a step would otherwise leave the previous run's files behind
// under numbers that no longer mean what their names say.
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--force-device-scale-factor=2'],
})
const context = await browser.newContext({
  viewport: { width: 1180, height: 780 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
})
const page = await context.newPage()

page.on('console', (message) => {
  if (message.type() === 'error') console.log(`  [console] ${message.text()}`)
})
page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message}`))

let step = 0
async function shoot(name) {
  step += 1
  const file = resolve(OUT, `${String(step).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  → ${file.replace(process.cwd() + '/', '')}`)
}

async function settle(ms = 400) {
  await page.waitForTimeout(ms)
}

console.log(`opening ${APP}`)
await page.goto(APP, { waitUntil: 'networkidle' })
await settle(600)
await shoot('empty-state')

// --- Seed a provider through the real UI -----------------------------------
console.log('configuring a provider against the mock')
await page.getByRole('button', { name: '配置供应商' }).click()
await settle(300)
await shoot('settings-providers')

await page.getByRole('button', { name: /添加/ }).click()
await settle(200)
// Anthropic specifically: it is the vendor whose wire protocol the mock's
// /anthropic route speaks, and whose models carry hosted search — so the
// reasoning panel and the search toggle both get exercised.
await page.getByText('Anthropic', { exact: true }).first().click()
await settle(200)

// Scope every field lookup to the dialog: the sidebar also has an input (its
// search box), and an unscoped `page.locator('input')` picks that up first.
const dialog = page.locator('[role="dialog"]')
const inputs = dialog.locator('input')
// The preset already fills name and base URL; only the URL needs redirecting at
// the mock and the key needs a value.
await inputs.nth(1).fill(`${MOCK}/anthropic/v1`)
await inputs.nth(2).fill('test-key')
await shoot('settings-add-provider')

await dialog.getByRole('button', { name: /保存/ }).click()
await settle(1200)
await shoot('settings-provider-saved')

// Expand the provider row to reach its model list, which is what the health
// check and the enable checkboxes live in.
await dialog.getByText('Anthropic', { exact: true }).first().click()
await settle(300)

// Model discovery hits the mock's /models route; enable the reasoning-capable
// ones so the composer shows its full control set.
for (const label of ['Claude Opus 5.5', 'Claude Haiku 4.5']) {
  const row = dialog.getByText(label, { exact: true }).first()
  if (!(await row.count())) continue
  const checkbox = row.locator('xpath=ancestor::label//input[@type="checkbox"]')
  if ((await checkbox.count()) && !(await checkbox.isChecked())) {
    await checkbox.check()
    await settle(120)
  }
}
await shoot('settings-models-selected')

// Health check: probes every enabled model and shows latency or the failure.
console.log('model health check')
await dialog.getByRole('button', { name: /测试已启用/ }).click()
await settle(250)
await shoot('settings-healthcheck-running')
await settle(3000)
await shoot('settings-healthcheck')

await page.keyboard.press('Escape')
await settle(500)

// --- Attachments ------------------------------------------------------------
console.log('attachments')
await page.locator('input[type=file]').setInputFiles([
  {
    name: 'design-notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# 数据模型笔记\n\n- 一次提问 = 一个 turn\n- 一个 turn 有 N 条 reply，每个 lane 一条\n- 重新生成只影响所在 lane\n',
    ),
  },
  // A real PDF, so the pdf.js path is exercised rather than only the text one.
  { name: 'dummy.pdf', mimeType: 'application/pdf', buffer: readFileSync('/tmp/t.pdf') },
])
await settle(2500)
await shoot('composer-attachment')

// --- One column -------------------------------------------------------------
console.log('single-column conversation')
await page.getByPlaceholder(/问点什么/).fill('这个应用的数据模型要怎么设计？')
await shoot('composer-filled')

await page.keyboard.press('Enter')
await settle(700)
await shoot('streaming-single')

await settle(2500)
await shoot('single-column-done')

// --- Compare mode -----------------------------------------------------------
console.log('compare mode')
await page.getByRole('button', { name: /对比/ }).click()
await settle(300)
await shoot('model-picker')
// Pick the second Anthropic model so both columns answer.
await page.getByRole('button', { name: /Claude Haiku 4\.5/ }).first().click()
await settle(400)

await page.getByPlaceholder(/问点什么/).fill('用一句话总结你的取舍。')
await page.keyboard.press('Enter')
await settle(800)
await shoot('streaming-compare')

await settle(3000)
await shoot('compare-done')

// --- Reasoning and search ---------------------------------------------------
console.log('web search')
await page.getByLabel('联网搜索').click()
await settle(250)
await shoot('search-menu')
await page.getByRole('button', { name: /模型自带/ }).first().click()
await settle(300)

await page.getByPlaceholder(/问点什么/).fill('搜一下现在流行什么做法')
await page.keyboard.press('Enter')
await settle(900)
await shoot('search-running')
await settle(3500)
await shoot('search-done')

// --- Reasoning window -------------------------------------------------------
console.log('reasoning chain')
await page.getByLabel('联网搜索').click()
await settle(200)
await page.getByRole('button', { name: /关闭/ }).first().click()
await settle(200)
// A model id carrying the mock's reason flag streams a thinking chain.
await page.getByPlaceholder(/问点什么/).fill('用一句话说明你的取舍')
await page.keyboard.press('Enter')
await settle(1200)
await shoot('reasoning-streaming')
await settle(3000)
await shoot('reasoning-collapsed')

// --- Fork -------------------------------------------------------------------
console.log('fork')
const firstQuestion = page.locator('[data-turn]').first()
await firstQuestion.hover()
await settle(200)
await page.getByLabel('从这里分支').first().click()
await settle(1200)
await shoot('forked-conversation')

// --- Shortcuts --------------------------------------------------------------
console.log('shortcut editor')
await page.keyboard.press('Meta+,')
await settle(400)
await page.getByRole('button', { name: '快捷键' }).click()
await settle(300)
await shoot('settings-shortcuts')
await page.getByRole('button', { name: /⌘N|N$/ }).first().click().catch(() => {})
await settle(200)
await page.keyboard.press('Meta+Shift+J')
await settle(300)
await shoot('settings-shortcuts-rebound')
await page.keyboard.press('Escape')
await settle(400)
await page.keyboard.press('Escape')
await settle(300)

// --- Command palette --------------------------------------------------------
console.log('command palette')
await page.keyboard.press('Meta+k')
await settle(400)
await shoot('command-palette')
await page.keyboard.press('Escape')
await settle(300)

// --- Sidebar and dark mode --------------------------------------------------
await page.keyboard.press('Meta+\\')
await settle(600)
await shoot('sidebar-hidden')
await page.keyboard.press('Meta+\\')
await settle(500)

await page.evaluate(() => {
  document.documentElement.classList.add('dark')
})
await settle(500)
await shoot('dark-mode')

// --- Narrow window: compare columns collapse to tabs ------------------------
console.log('narrow window')
await page.setViewportSize({ width: 720, height: 780 })
await settle(500)
await shoot('narrow-tabs')

await browser.close()
console.log('\nDone.')
