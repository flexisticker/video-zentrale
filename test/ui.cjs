// Oberflächentest gegen test/mock.js: node test/ui.cjs <tmp-ordner>  (Server auf 8190, Mock auf 9300)
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const T = process.argv[2], B = 'http://localhost:8190';
const mock = () => fetch('http://127.0.0.1:9300/_log').then((r) => r.json());
(async () => {
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('dialog', (d) => d.accept());
  await pg.goto(B);
  await pg.fill('input[type=password]', 'geheim123'); await pg.click('button[type=submit]');
  await pg.waitForSelector('.card'); await pg.waitForTimeout(800);
  const badges = await pg.$$eval('.card', (cs) => cs.map((c) => c.querySelector('.title').textContent + ' => ' + (c.querySelector('.chip.channel')?.textContent || '-') + ' [' + (c.querySelector('.chip.channel')?.title || '') + ']'));
  console.log('Vorschläge:\n  ' + badges.join('\n  '));
  await pg.screenshot({ path: T + '/1-grid.png' });

  // Apps eintragen
  await pg.click('text=Einstellungen'); await pg.waitForSelector('text=Google-App');
  const g = pg.locator('.box', { hasText: 'Google-App' });
  await g.locator('input').nth(0).fill('test.apps.googleusercontent.com'); await g.locator('input').nth(1).fill('sec');
  await g.locator('button', { hasText: 'Speichern' }).click(); await pg.waitForTimeout(600);
  const t = pg.locator('.box', { hasText: 'TikTok-App' });
  await t.locator('input').nth(0).fill('ck'); await t.locator('input').nth(1).fill('cs'); await t.locator('input').nth(2).fill('https://example.org/cb');
  await t.locator('button', { hasText: 'Speichern' }).click(); await pg.waitForTimeout(600);
  // je Kanal YouTube + TikTok verbinden
  for (const [i, name, ytTitle] of [[0, 'MichaModus', 'MichaModus'], [1, '3dbymicha', '3D by Micha']]) {
    const box = () => pg.locator('.channelbox').nth(i);
    await box().locator('button', { hasText: 'YouTube verbinden' }).click();
    await box().locator('.code').waitFor();
    await box().locator('.ok-text', { hasText: `„${ytTitle}“` }).waitFor({ timeout: 15000 });
    const pop = pg.waitForEvent('popup'); await box().locator('button', { hasText: 'TikTok verbinden' }).click();
    const p = await pop; const state = new URL(p.url()).searchParams.get('state'); await p.close();
    await box().locator('input[placeholder^="Adresse nach"]').fill(`https://example.org/cb?code=${name}&state=${state}`);
    await box().locator('button', { hasText: 'Übernehmen' }).click();
    await box().locator('.ok-text', { hasText: `„${name}“` }).nth(ytTitle === name ? 1 : 0).waitFor();
    console.log(`Kanal ${name}: YouTube „${ytTitle}“ + TikTok „${name}“ verbunden`);
  }
  await pg.screenshot({ path: T + '/2-kanaele.png', fullPage: true });

  // Filter
  await pg.click('text=Zur Freigabe'); await pg.waitForSelector('.filter');
  await pg.click('.filter button:has-text("3dbymicha")'); await pg.waitForTimeout(300);
  console.log('Filter 3dbymicha:', await pg.$$eval('.card .title', (e) => e.map((x) => x.textContent)));
  await pg.click('.filter button:has-text("Alle Kanäle")');

  // "Irgendwas" (Standard = MichaModus) auf 3dbymicha umstellen und zu YouTube
  await pg.click('.card:has-text("Irgendwas")'); await pg.waitForSelector('.modal');
  console.log('Detail-Hinweis:', await pg.textContent('.modal select + .hint'));
  await pg.selectOption('.modal select >> nth=0', '3dbymicha'); await pg.waitForTimeout(200);
  console.log('nach Wahl:', await pg.textContent('.modal select + .hint'));
  await pg.screenshot({ path: T + '/3-detail.png', fullPage: true });
  await pg.click('.modal button:has-text("Auf YouTube hochladen")');
  await pg.waitForSelector('.modal >> text=Hochgeladen (privat)', { timeout: 30000 });
  let m = await mock();
  console.log('YouTube-Upload als', m.yt.auth, '| Kategorie', m.yt.meta.snippet.categoryId, '| Tags', m.yt.meta.snippet.tags.join(','));
  console.log('Status:', await pg.textContent('.modal .section .status'));
  await pg.click('.close');

  // Fortnite → TikTok (Vorschlag MichaModus)
  await pg.click('.card:has-text("Fortnite")'); await pg.waitForSelector('.modal');
  await pg.click('.modal button:has-text("Als Entwurf an TikTok")');
  await pg.waitForSelector('.modal >> text=Im TikTok-Posteingang', { timeout: 30000 });
  m = await mock(); console.log('TikTok-Upload als', m.tt.auth);
  await pg.screenshot({ path: T + '/4-detail-tt.png', fullPage: true });
  await pg.click('.close');
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(400);
  console.log('Handy Überlauf:', await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await pg.screenshot({ path: T + '/5-handy.png' });
  await pg.click('text=Einstellungen'); await pg.waitForTimeout(800);
  console.log('Handy Einstellungen Überlauf:', await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('JS-Fehler:', errs);
  await br.close();
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
