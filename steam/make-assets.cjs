// Steam のストア・ライブラリ用画像と実績アイコン、スクリーンショットを作る
// 使い方: リポジトリ直下で `npx vite --port 5199` を起動しておき、`node steam/make-assets.cjs`
// 出力: steam/assets/
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.ART_BASE || 'http://localhost:5199';
const OUT = path.join(__dirname, 'assets');

// Steamworks の「グラフィックアセット」の規定サイズ
const ART = [
  ['header_capsule', 'header', 920, 430],
  ['small_capsule', 'small', 462, 174],
  ['main_capsule', 'main', 1232, 706],
  ['vertical_capsule', 'vertical', 748, 896],
  ['library_capsule', 'library', 600, 900],
  ['library_hero', 'hero', 3840, 1240],
  ['library_logo', 'logo', 1280, 720],
  ['page_background', 'page', 1438, 810],
  ['community_icon', 'icon', 184, 184],
  ['client_icon', 'icon', 32, 32],
];

// 実績（src/app/records.ts の ID と同じ）と、アイコンに描く文字
const ACH = {
  FIRST_GAME: '始', FIRST_WIN: '和', FIRST_TOP: '頂', RIICHI_WIN: '立', TSUMO_WIN: '摸', MANGAN: '満', HANEMAN: '跳',
  YAKUMAN: '役', OPAQUE_WAIT: '隠', ALL_CLEAR: '透', AKA_3: '紅', NO_DEALIN: '守', SANMA: '三', HANCHAN: '荘',
  ONLINE: '卓', TOP_10: '勝', GAMES_50: '常',
};

async function shot(page, url, file, w, h, transparent) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, omitBackground: !!transparent, type: file.endsWith('.jpg') ? 'jpeg' : 'png', quality: file.endsWith('.jpg') ? 92 : undefined });
}

(async () => {
  fs.mkdirSync(path.join(OUT, 'achievements'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage();
  for (const lang of ['ja', 'en']) {
    for (const [name, kind, w, h] of ART) {
      if (lang === 'en' && !['header', 'small', 'main', 'vertical', 'library', 'page'].includes(kind)) continue;
      const suffix = lang === 'en' ? '_en' : '';
      const ext = kind === 'logo' ? 'png' : kind === 'icon' && w === 32 ? 'png' : 'png';
      await shot(page, `${BASE}/steam/art/?kind=${kind}&w=${w}&h=${h}&lang=${lang}`, path.join(OUT, `${name}${suffix}.${ext}`), w, h, kind === 'logo');
    }
  }
  for (const [id, glyph] of Object.entries(ACH)) {
    for (const gray of [false, true]) {
      await shot(page, `${BASE}/steam/art/?kind=icon&w=256&h=256&glyph=${encodeURIComponent(glyph)}&gray=${gray ? 1 : 0}`,
        path.join(OUT, 'achievements', `${id}${gray ? '_locked' : ''}.jpg`), 256, 256);
    }
  }

  // スクリーンショット（1920x1080）
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  for (const lang of ['ja', 'en']) {
    const p = await ctx.newPage();
    const S = (n) => path.join(OUT, 'screenshots', `${lang}_${n}.png`);
    await p.goto(`${BASE}/`);
    await p.evaluate((l) => { localStorage.clear(); localStorage.setItem('tmj-lang', l); localStorage.setItem('tmj-tutorial', '1'); localStorage.setItem('tmj-settings', JSON.stringify({ autoSort: true })); }, lang);
    await p.reload(); await p.waitForTimeout(1200);
    await p.screenshot({ path: S('01_title') });
    await p.click('#tutorial'); await p.waitForTimeout(400); await p.click('#next'); await p.waitForTimeout(400);
    await p.screenshot({ path: S('02_rule') });
    await p.goto(`${BASE}/`); await p.waitForTimeout(800);
    await p.click('#cpu'); await p.waitForTimeout(1000);
    let shotGame = false; let shotViewer = false;
    for (let i = 0; i < 600; i++) {
      try {
        const ok = await p.$('[data-act="ready"]');
        if (ok) { await p.waitForTimeout(1400); await p.screenshot({ path: S('05_result') }); break; }
        const discards = await p.$$eval('.pond .tile', (e) => e.length);
        if (!shotGame && discards >= 22) { await p.screenshot({ path: S('03_table') }); shotGame = true; }
        if (shotGame && !shotViewer && discards >= 26) {
          await p.click('.viewbtn'); await p.waitForTimeout(300); await p.screenshot({ path: S('04_handview') });
          await p.keyboard.press('Escape'); shotViewer = true;
        }
        const pass = await p.$('[data-act="pass"]'); if (pass) { await pass.click({ timeout: 400 }); continue; }
        const win = await p.$('[data-act="ron"], [data-act="tsumo"]'); if (win) { await win.click({ timeout: 400 }); continue; }
        await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter');
      } catch { /* 画面切り替え中 */ }
      await p.waitForTimeout(150);
    }
    await p.close();
  }
  await b.close();
  console.log('steam/assets を作成しました');
})();
