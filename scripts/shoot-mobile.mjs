// Phone-layout check harness.
//
// The same idea as shoot.mjs, at phone size: an iPhone-sized viewport with
// touch emulation (so `hover: none` and `pointer: coarse` match, as they do on
// a device), driven through the real UI against the mock provider. Screenshots
// go to `shots/mobile/`.
//
//   node scripts/mock-llm.mjs &
//   pnpm dev &
//   node scripts/shoot-mobile.mjs
//
// Safe-area insets cannot be emulated in desktop Chrome, so the notch and home
// indicator margins only show on a device or in the iOS simulator.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../shots/mobile')
const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173'
const MOCK = process.env.MOCK_BASE ?? 'http://127.0.0.1:8787'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME })
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: process.env.DARK ? 'dark' : 'light',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
})
const page = await context.newPage()
page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') console.log(`  [console] ${message.text()}`)
})

let step = 0
async function shoot(name) {
  step += 1
  const file = resolve(OUT, `${String(step).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  → ${file.replace(process.cwd() + '/', '')}`)
}
const settle = (ms = 400) => page.waitForTimeout(ms)

/** A finger swipe, as touch events: Playwright has taps but no swipes. */
async function swipe(from, to) {
  await page.evaluate(
    ([from, to]) => {
      const target = document.elementFromPoint(from.x, from.y) ?? document.body
      const touch = (x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y })
      const fire = (type, x, y) =>
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [touch(x, y)],
            changedTouches: [touch(x, y)],
          }),
        )
      fire('touchstart', from.x, from.y)
      for (let i = 1; i <= 8; i += 1) fire('touchmove', from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8)
      fire('touchend', to.x, to.y)
    },
    [from, to],
  )
}

console.log(`opening ${APP}`)
await page.goto(APP, { waitUntil: 'networkidle' })
await settle(600)
const media = await page.evaluate(() => ({
  touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
  compact: matchMedia('(max-width: 767px)').matches,
}))
console.log(`  media: touch=${media.touch} compact=${media.compact}`)
await shoot('setup')

// --- Provider, through the full-screen settings -----------------------------
await page.getByRole('button', { name: '配置供应商' }).tap()
await settle(400)
await shoot('settings-sheet')
await page.getByRole('button', { name: /添加/ }).tap()
await settle(200)
await page.getByText('Anthropic', { exact: true }).first().tap()
await settle(200)
const dialog = page.locator('[role="dialog"]')
const inputs = dialog.locator('input')
await inputs.nth(1).fill(`${MOCK}/anthropic/v1`)
await inputs.nth(2).fill('test-key')
await shoot('settings-add-provider')
await dialog.getByRole('button', { name: /保存/ }).tap()
await settle(1200)
await dialog.getByText('Anthropic', { exact: true }).first().tap()
await settle(300)
for (const label of ['Claude Opus 5.5', 'Claude Haiku 4.5']) {
  const row = dialog.getByText(label, { exact: true }).first()
  if (!(await row.count())) continue
  const checkbox = row.locator('xpath=ancestor::label//input[@type="checkbox"]')
  if ((await checkbox.count()) && !(await checkbox.isChecked())) await checkbox.check()
}
await shoot('settings-models')
await dialog.getByRole('button', { name: '通用' }).tap()
await settle(300)
await shoot('settings-general')
await page.getByRole('button', { name: '关闭' }).tap()
await settle(500)
await shoot('empty-state')

// --- One column ---------------------------------------------------------------
const box = page.getByPlaceholder(/问点什么/)
await box.tap()
await box.fill('这个应用的数据模型要怎么设计？')
// Enter is a new line on a phone; the button sends.
await page.keyboard.press('Enter')
await shoot('composer-enter-newline')
await page.getByRole('button', { name: '发送', exact: true }).tap()
await settle(800)
await shoot('streaming')
await settle(3000)
await shoot('single-done')

// --- Compare: tabs, swipe between them ---------------------------------------
await page.getByRole('button', { name: /对比/ }).tap()
await settle(300)
await shoot('compare-menu')
await page.getByRole('button', { name: /Claude Haiku 4\.5/ }).first().tap()
await settle(300)
await page.mouse.click(196, 300).catch(() => {})
await page.keyboard.press('Escape')
await settle(300)
await box.fill('用一句话总结你的取舍。')
await page.getByRole('button', { name: '发送', exact: true }).tap()
await settle(4000)
await shoot('compare-tabs')
// Across body text: a swipe that starts on a code block is the block's scroll.
await swipe({ x: 300, y: 565 }, { x: 80, y: 570 })
await settle(400)
await shoot('compare-swiped')

// --- The models panel: one button for every compared column -----------------
await page.getByRole('button', { name: '回答的模型' }).tap()
await settle(400)
await shoot('models-panel')
await page.getByRole('checkbox', { name: /发给 Claude Haiku/ }).tap()
await settle(300)
await shoot('models-panel-narrowed')
await page.keyboard.press('Escape')
await settle(300)
await shoot('composer-narrowed')

// --- Composer menus ------------------------------------------------------------
await page.getByLabel('思考深度').first().tap().catch(() => console.log('  (no reasoning control)'))
await settle(300)
await shoot('reasoning-menu')
await page.keyboard.press('Escape')
await settle(300)

// --- Drawer --------------------------------------------------------------------
await swipe({ x: 10, y: 400 }, { x: 260, y: 405 })
await settle(600)
await shoot('drawer-swiped-open')
await page.getByLabel('对话操作').first().tap()
await settle(300)
await shoot('drawer-row-menu')
await page.keyboard.press('Escape')
await settle(300)
await page.mouse.click(370, 400)
await settle(600)
await shoot('drawer-closed')
await page.getByLabel('对话列表').tap()
await settle(600)
await shoot('drawer-button')
await page.getByRole('button', { name: '设置' }).tap()
await settle(600)
await shoot('settings-from-drawer')
await page.getByRole('button', { name: '关闭' }).tap()
await settle(400)

// --- Dark ------------------------------------------------------------------------
await page.evaluate(() => document.documentElement.classList.add('dark'))
await settle(400)
await shoot('dark')

// --- Landscape: still touch, no longer compact ------------------------------------
await page.evaluate(() => document.documentElement.classList.remove('dark'))
await page.setViewportSize({ width: 852, height: 393 })
await settle(600)
await shoot('landscape')

await browser.close()
console.log('\nDone.')
