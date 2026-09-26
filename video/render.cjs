const { chromium } = require('/Users/gourab/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core')
const fs = require('fs')
const [, , outDir, only] = process.argv
;(async () => {
  const browser = await chromium.launch({ executablePath: '/Users/gourab/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', headless: true })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => console.log('PAGEERR', e.message))
  await page.goto('file://' + __dirname + '/film.html')
  await page.evaluate(() => document.fonts.ready)
  fs.mkdirSync(outDir, { recursive: true })
  const dur = await page.evaluate(() => window.DURATION)
  const times = only ? only.split(',').map(Number) : Array.from({ length: Math.ceil(dur * 30) }, (_, i) => i / 30)
  let i = 0
  for (const t of times) {
    await page.evaluate((t) => window.seek(t), t)
    await page.screenshot({ path: `${outDir}/${only ? 't' + t : 'f' + String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 })
    i++
  }
  await browser.close()
})().catch((e) => { console.error('FAILED', e); process.exit(1) })
