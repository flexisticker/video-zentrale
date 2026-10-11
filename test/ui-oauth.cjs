// Ein-Klick-Verbindung (Popup) gegen test/mock.js; Zentrale auf localhost:8191
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const B = 'http://localhost:8191';
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(B); await pg.fill('input[type=password]', 'geheim123'); await pg.click('button[type=submit]');
  await pg.waitForSelector('main'); await pg.click('text=Einstellungen'); await pg.waitForSelector('text=Google-App');
  const g = pg.locator('.box', { hasText: 'Google-App' });
  console.log('Anleitung:', (await g.locator('li').nth(2).textContent()).slice(0, 120));
  await g.locator('input').nth(0).fill('web.apps.googleusercontent.com'); await g.locator('input').nth(1).fill('sec');
  await g.locator('button', { hasText: 'Speichern' }).click(); await pg.waitForTimeout(700);
  const t = pg.locator('.box', { hasText: 'TikTok-App' });
  await t.locator('input').nth(0).fill('ck'); await t.locator('input').nth(1).fill('cs'); await t.locator('input').nth(2).fill(B + '/oauth/tiktok');
  await t.locator('button', { hasText: 'Speichern' }).click(); await pg.waitForTimeout(700);
  for (const [i, plat] of [[0, 'YouTube'], [0, 'TikTok'], [1, 'YouTube']]) {
    const pop = pg.waitForEvent('popup');
    await pg.locator('.channelbox').nth(i).locator('button', { hasText: `Mit ${plat} verbinden` }).click();
    const p = await pop; await p.waitForLoadState();
    await p.waitForSelector('#title'); const title = await p.textContent('#title');
    await p.waitForEvent('close', { timeout: 5000 }).catch(() => {});
    console.log(`Kanal ${i + 1} ${plat}: Popup „${title}“, geschlossen: ${p.isClosed()}`);
    await pg.waitForTimeout(800);
  }
  const state = await pg.$$eval('.channelbox .conn .ok-text', (e) => e.map((x) => x.textContent));
  console.log('Verbunden-Anzeige:', state);
  console.log('JS-Fehler:', errs); await br.close();
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
