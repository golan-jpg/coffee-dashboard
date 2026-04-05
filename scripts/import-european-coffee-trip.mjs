#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const SEEDED_FILE = join(projectRoot, 'src', 'data', 'seededPlaces.json');

const USER_AGENT = 'coffee-dashboard-ect-importer/1.0';

const CITY_NAME_MAP = {
  berlin: 'Berlin',
  'tel-aviv': 'Tel Aviv',
  telaviv: 'Tel Aviv',
  paris: 'Paris',
  amsterdam: 'Amsterdam',
  copenhagen: 'Copenhagen',
  barcelona: 'Barcelona',
  madrid: 'Madrid',
  london: 'London',
  rome: 'Rome',
  lisbon: 'Lisbon',
  porto: 'Porto',
  vienna: 'Vienna',
  prague: 'Prague',
};

function parseArgs() {
  const url = process.argv.find((arg) => arg.startsWith('--url='))?.split('=')[1] || null;
  const city = process.argv.find((arg) => arg.startsWith('--city='))?.split('=')[1] || null;
  const write = process.argv.includes('--write');
  const limitArg = Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1]);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : null;

  return { url, city, write, limit };
}

function loadSeeded() {
  if (!existsSync(SEEDED_FILE)) {
    throw new Error(`Missing file: ${SEEDED_FILE}`);
  }
  return JSON.parse(readFileSync(SEEDED_FILE, 'utf-8'));
}

function saveSeeded(data) {
  writeFileSync(SEEDED_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function deriveCityName(url, cityArg) {
  if (cityArg && cityArg.trim()) return cityArg.trim();

  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const first = (pathParts[0] || '').toLowerCase();
    return CITY_NAME_MAP[first] || first.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  } catch {
    return null;
  }
}

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value = '') {
  return decodeHtml(value.replace(/<[^>]+>/g, '')).trim();
}

function titleFromSlug(slug, cityName) {
  const cityToken = String(cityName || '').toLowerCase().replace(/\s+/g, '-');
  const cleaned = slug
    .toLowerCase()
    .replace(new RegExp(`-${cityToken}$`), '')
    .replace(/-berlin$|-paris$|-london$|-barcelona$|-amsterdam$|-copenhagen$|-tel-aviv$|-telaviv$/g, '');

  return cleaned
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim();
}

function extractCafeEntries(html, cityName) {
  const linkRegex = /https?:\/\/europeancoffeetrip\.com\/cafe\/([a-z0-9-]+)\/?/gi;
  const found = [];

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const fullLink = match[0];
    const slug = match[1];
    const idx = match.index;

    const windowAfter = html.slice(idx, idx + 600);
    const h3Match = windowAfter.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const headingName = h3Match ? cleanText(h3Match[1]) : null;

    found.push({
      slug,
      url: fullLink,
      name: headingName || titleFromSlug(slug, cityName),
    });
  }

  const seenBySlug = new Set();
  const deduped = [];

  for (const item of found) {
    const key = item.slug.toLowerCase();
    if (seenBySlug.has(key)) continue;
    seenBySlug.add(key);
    deduped.push(item);
  }

  return deduped;
}

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
    });

    if (res.ok) {
      return await res.text();
    }
  } catch {
    // fallback to browser below
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: USER_AGENT,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function main() {
  const { url, city, write, limit } = parseArgs();

  if (!url) {
    console.error('Usage: node scripts/import-european-coffee-trip.mjs --url=<https://europeancoffeetrip.com/berlin/> [--city="Berlin"] [--write] [--limit=50]');
    process.exit(1);
  }

  const cityName = deriveCityName(url, city);
  if (!cityName) {
    console.error('Could not derive city name. Please pass --city="City Name".');
    process.exit(1);
  }

  const html = await fetchHtml(url);
  let entries = extractCafeEntries(html, cityName);
  if (limit) entries = entries.slice(0, limit);

  if (entries.length === 0) {
    console.log(`No cafe entries found in ${url}`);
    process.exit(0);
  }

  const seeded = loadSeeded();
  const existing = Array.isArray(seeded[cityName]) ? seeded[cityName] : [];

  const existingNames = new Set(existing.map((place) => String(place?.name || '').trim().toLowerCase()));

  const additions = entries
    .filter((entry) => entry.name && !existingNames.has(entry.name.toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      lat: null,
      lon: null,
      address: '',
      source: 'seeded',
      isSpecialty: true,
      needsCoords: true,
      notes: `imported from European Coffee Trip (${entry.url})`,
    }));

  if (!Array.isArray(seeded[cityName])) {
    seeded[cityName] = [];
  }

  seeded[cityName] = [...seeded[cityName], ...additions];

  console.log(`City: ${cityName}`);
  console.log(`Extracted from page: ${entries.length}`);
  console.log(`Already existed: ${entries.length - additions.length}`);
  console.log(`New additions: ${additions.length}`);

  if (additions.length > 0) {
    console.log('Sample additions:');
    additions.slice(0, 12).forEach((place) => {
      console.log(`- ${place.name}`);
    });
  }

  if (write) {
    saveSeeded(seeded);
    console.log('Saved to src/data/seededPlaces.json');
  } else {
    console.log('Dry-run only. Use --write to persist changes.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
