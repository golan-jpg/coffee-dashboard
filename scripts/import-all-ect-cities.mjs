#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const CITY_GUIDES_URL = 'https://europeancoffeetrip.com/city-guides/';
const USER_AGENT = 'coffee-dashboard-ect-bulk-import/1.0';
const MIN_CAFE_LINKS = 8;

const NON_CITY_SLUGS = new Set([
  'add-cafe',
  'advertise',
  'awards',
  'brew-guides',
  'magazine',
  'privacy-policy',
  'reviews',
  'shop',
  'news',
  'podcast',
  'about',
  'partners',
  'contact',
  'events',
  'jobs',
  'app',
  'account',
  'city-guides',
  'city-guide',
  'cafe',
  'uk',
  'albania',
  'andorra',
  'austria',
  'belarus',
  'belgium',
  'bosnaherzegovina',
  'bulgaria',
  'croatia',
  'cyprus',
  'czech-republic',
  'denmark',
  'estonia',
  'finland',
  'france',
  'georgia',
  'germany',
  'greece',
  'hungary',
  'iceland',
  'ireland',
  'italy',
  'latvia',
  'lithuania',
  'luxembourg',
  'malta',
  'moldova',
  'montenegro',
  'netherlands',
  'northmacedonia',
  'norway',
  'poland',
  'portugal',
  'romania',
  'serbia',
  'slovakia',
  'slovenia',
  'spain',
  'sweden',
  'switzerland',
  'turkey',
  'ukraine',
]);

function slugToUrl(slug) {
  return `https://europeancoffeetrip.com/${slug}/`;
}

function discoverSlugsFromLinks(hrefs) {
  const slugs = new Set();

  for (const href of hrefs) {
    const match = String(href || '').match(/^https:\/\/europeancoffeetrip\.com\/([a-z][a-z-]+)\/$/i);
    if (!match) continue;

    const slug = match[1].toLowerCase();
    if (NON_CITY_SLUGS.has(slug)) continue;
    slugs.add(slug);
  }

  return [...slugs].sort();
}

async function fetchCityGuideLinks() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(CITY_GUIDES_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    return await page.$$eval('a[href]', (els) => els.map((el) => el.href));
  } finally {
    await browser.close();
  }
}

async function getCafeLinkCount(slug) {
  const url = slugToUrl(slug);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    const html = await page.content();
    return (html.match(/https?:\/\/europeancoffeetrip\.com\/cafe\//gi) || []).length;
  } catch {
    return 0;
  } finally {
    await browser.close();
  }
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync('node', [scriptPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function parseImportedCity(stdout, slug) {
  const cityMatch = stdout.match(/City:\s*(.+)/);
  const additionsMatch = stdout.match(/New additions:\s*(\d+)/);
  const city = cityMatch ? cityMatch[1].trim() : slug;
  const additions = additionsMatch ? Number(additionsMatch[1]) : 0;

  return { city, additions };
}

async function main() {
  console.log('Discovering ECT city slugs...');
  const hrefs = await fetchCityGuideLinks();
  const slugs = discoverSlugsFromLinks(hrefs);

  console.log(`Discovered candidate slugs: ${slugs.length}`);

  const validSlugs = [];
  for (const slug of slugs) {
    const cafeLinkCount = await getCafeLinkCount(slug);
    if (cafeLinkCount >= MIN_CAFE_LINKS) {
      validSlugs.push(slug);
      console.log(`✓ ${slug} (${cafeLinkCount} cafe links)`);
    } else {
      console.log(`- ${slug} (skipped, cafe links: ${cafeLinkCount})`);
    }
  }

  console.log(`Valid city slugs for import: ${validSlugs.length}`);

  const importedCities = [];
  for (const slug of validSlugs) {
    const url = slugToUrl(slug);
    const importResult = runNodeScript('scripts/import-european-coffee-trip.mjs', [`--url=${url}`, '--write']);

    if (!importResult.ok) {
      console.log(`✗ import failed for ${slug}`);
      if (importResult.stderr) console.log(importResult.stderr.trim());
      continue;
    }

    const { city, additions } = parseImportedCity(importResult.stdout, slug);
    importedCities.push(city);
    console.log(`✓ imported ${city} (+${additions})`);
  }

  const uniqueImportedCities = [...new Set(importedCities)];

  for (const cityName of uniqueImportedCities) {
    const geocodeResult = runNodeScript('scripts/geocode-seeded-places.mjs', [`--city=${cityName}`, '--write', '--limit=5000']);
    if (!geocodeResult.ok) {
      console.log(`✗ geocode failed for ${cityName}`);
      if (geocodeResult.stderr) console.log(geocodeResult.stderr.trim());
      continue;
    }
    console.log(`✓ geocoded ${cityName}`);
  }

  console.log(`Done. Cities imported/geocoded: ${uniqueImportedCities.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
