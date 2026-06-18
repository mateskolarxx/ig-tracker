/**
 * sync.js – IG Tracker scraper
 * Spusť: node sync.js
 *
 * Potřebuje: npm install (viz package.json)
 * Co dělá:
 *   1. Otevře Instagram profil @stelinkax v Chromiu
 *   2. Počká na přihlášení (pokud nejsi přihlášen)
 *   3. Vytáhne počet sledujících → uloží do Supabase (logs)
 *   4. Vytáhne posledních N reelů (views, likes, datum) → uloží do Supabase (reels)
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SB_URL = 'https://tolfunyrkqvjoscepkzw.supabase.co';
const SB_KEY = 'sb_publishable_g4_Zrm9SJSFZICzBao-AmA_hfcMxftQ';
const IG_HANDLE = 'stelinkax';
const REELS_TO_SCRAPE = 10; // kolik posledních reelů zkusit

const sb = createClient(SB_URL, SB_KEY);

// ── Helpers ───────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function today() { return new Date().toISOString().split('T')[0]; }

function parseCount(str) {
  if (!str) return null;
  str = str.trim().replace(/\s/g, '').replace(',', '.');
  if (str.includes('M')) return Math.round(parseFloat(str) * 1_000_000);
  if (str.includes('K') || str.includes('k')) return Math.round(parseFloat(str) * 1_000);
  return parseInt(str.replace(/\D/g, ''), 10) || null;
}

// ── Main ──────────────────────────────────────────────────────────────

(async function main() {
  console.log('🚀 IG Tracker sync start –', new Date().toLocaleString('cs'));

  // Otevři prohlížeč (headful = viditelné okno)
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const ctx     = await browser.newContext({ locale: 'cs-CZ', viewport: { width: 1280, height: 900 } });
  const page    = await ctx.newPage();

  // ── 1. Přejdi na profil ──────────────────────────────────────────
  console.log('📱 Načítám profil @' + IG_HANDLE + '…');
  await page.goto('https://www.instagram.com/' + IG_HANDLE + '/', { waitUntil: 'networkidle' });

  // Zjisti jestli je třeba přihlášení
  const url = page.url();
  if (url.includes('accounts/login') || url.includes('accounts/suspended')) {
    console.log('🔐 Nejsi přihlášen. Přihlas se v okně prohlížeče.');
    console.log('   Čekám na přihlášení (max 3 minuty)…');
    await page.waitForURL('**/instagram.com/' + IG_HANDLE + '/**', { timeout: 180_000 })
      .catch(() => page.goto('https://www.instagram.com/' + IG_HANDLE + '/', { waitUntil: 'networkidle' }));
  }

  await sleep(2000);

  // ── 2. Vytáhni sledující ─────────────────────────────────────────
  let followers = null;
  try {
    // Zkus meta tag (nejspolehlivější)
    const meta = await page.$eval('meta[name="description"]', el => el.content).catch(() => null);
    if (meta) {
      const m = meta.match(/([\d,\.]+[KkMm]?)\s+Followers/i);
      if (m) followers = parseCount(m[1]);
    }

    // Záloha: hledej v textu stránky
    if (!followers) {
      const allText = await page.evaluate(() => document.body.innerText);
      const m = allText.match(/([\d,\.]+[KkMm]?)\s+(?:followers|sledující)/i);
      if (m) followers = parseCount(m[1]);
    }

    // Záloha 2: hledej span s aria-label
    if (!followers) {
      const spans = await page.$$eval('span', els =>
        els.map(e => e.getAttribute('title') || e.innerText).filter(Boolean)
      );
      for (const s of spans) {
        const n = parseCount(s);
        if (n && n > 100 && n < 100_000_000) { followers = n; break; }
      }
    }
  } catch (e) {
    console.warn('⚠️  Nepodařilo se získat sledující:', e.message);
  }

  if (followers) {
    console.log('👥 Sledující:', followers.toLocaleString('cs'));
    const { error } = await sb.from('logs').upsert(
      { date: today(), followers, note: 'sync.js' },
      { onConflict: 'date' }
    );
    if (error) console.error('❌ Chyba uložení logs:', error.message);
    else       console.log('✅ Sledující uloženi do Supabase');
  } else {
    console.warn('⚠️  Sledující se nepodařilo přečíst. Pokračuji s reely…');
  }

  // ── 3. Vytáhni reels ─────────────────────────────────────────────
  console.log('🎥 Načítám reely…');
  await page.goto('https://www.instagram.com/' + IG_HANDLE + '/reels/', { waitUntil: 'networkidle' });
  await sleep(2000);

  // Sbírej URL reelů ze stránky profilu
  const reelLinks = await page.$$eval('a[href*="/reel/"]', els =>
    [...new Set(els.map(e => e.href).filter(h => h.includes('/reel/')))].slice(0, 20)
  );

  console.log(`   Nalezeno ${reelLinks.length} odkazů na reely`);

  const toScrape = reelLinks.slice(0, REELS_TO_SCRAPE);
  const results  = [];

  for (let i = 0; i < toScrape.length; i++) {
    const url = toScrape[i];
    console.log(`   [${i+1}/${toScrape.length}] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await sleep(1500);

      // Datum zveřejnění
      let postedAt = null;
      try {
        postedAt = await page.$eval('time', el => el.getAttribute('datetime'));
      } catch {}

      // Views
      let views = null;
      try {
        const allText = await page.evaluate(() => document.body.innerText);
        const m = allText.match(/([\d,\.]+[KkMm]?)\s+(?:views|zhlédnutí)/i);
        if (m) views = parseCount(m[1]);
      } catch {}

      // Likes
      let likes = null;
      try {
        const allText = await page.evaluate(() => document.body.innerText);
        const m = allText.match(/([\d,\.]+[KkMm]?)\s+(?:likes|To se mi líbí)/i);
        if (m) likes = parseCount(m[1]);
      } catch {}

      // Popis
      let description = '';
      try {
        description = await page.$eval('h1', el => el.innerText.trim().slice(0, 120)).catch(() => '');
      } catch {}

      if (views !== null) {
        results.push({ url, views, likes: likes || 0, description, posted_at: postedAt });
        console.log(`      views=${views} likes=${likes} date=${postedAt}`);
      } else {
        console.log('      views nenalezeny, přeskakuji');
      }
    } catch (e) {
      console.warn(`      Chyba: ${e.message}`);
    }

    await sleep(1000 + Math.random() * 1000); // anti-throttle delay
  }

  // Ulož reely do Supabase (upsert podle url)
  if (results.length) {
    const { error } = await sb.from('reels').upsert(results, { onConflict: 'url' });
    if (error) console.error('❌ Chyba uložení reelů:', error.message);
    else       console.log(`✅ ${results.length} reelů uloženo do Supabase`);
  }

  await browser.close();
  console.log('🏁 Sync hotový –', new Date().toLocaleString('cs'));
})();
