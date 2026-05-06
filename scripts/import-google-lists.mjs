#!/usr/bin/env node

/**
 * Google Maps List Importer
 *
 * Reads Google Maps list URLs from lists.txt and extracts place data
 * using Playwright to scrape the pages.

 * Usage: node scripts/import-google-lists.mjs
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const LISTS_FILE = join(projectRoot, 'lists.txt'); 

const OUTPUT_FILE = join(projectRoot, 'src', 'data', 'googleLists.json');
const PLACE_OVERRIDES_FILE = join(projectRoot, 'src', 'data', 'placeOverrides.json');

// Delay helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const coffeeKeywords = ["coffee", "cafe", "café", "espresso", "roaster", "specialty", "קפה", "בית קפה", "אספרסו", "קלייה", "רוסטר"];
const bakeryKeywords = ["bakery", "patisserie", "pastry", "מאפיה", "מאפייה", "קונדיטוריה", "מאפים"];
const negativeKeywords = ["restaurant", "bar", "pub", "pizza", "sushi", "מסעדה", "בר", "פיצה", "סושי", "גריל", "המבורגר"];
const defaultExplicitNonCoffeeKeywords = [
  "roladin",
  "רולדין",
  "maafe neeman",
  "מאפה נאמן",
  "greg patisserie",
  "גרג קונדיטוריה",
  "hadasa patisserie",
  "קונדיטוריה",
];
const defaultExplicitCoffeeAllowKeywords = [
  "cafelix",
  "קפליקס",
  "nahat",
  "נחת",
  "waycup",
  "ווייקאפ",
  "coffee lab",
  "קופי לאב",
];

function normalizeCityKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeKeywords(list, fallback) {
  if (!Array.isArray(list)) return fallback;

  const normalized = list
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}

function normalizeCityOverrides(byCity) {
  if (!byCity || typeof byCity !== 'object') return [];

  return Object.entries(byCity).reduce((acc, [cityName, config]) => {
    const cityKey = normalizeCityKey(cityName);
    if (!cityKey) return acc;

    const aliases = Array.from(new Set([
      cityKey,
      ...normalizeKeywords(config?.aliases, []),
    ]));

    acc.push({
      cityKey,
      aliases,
      explicitNonCoffeeKeywords: normalizeKeywords(config?.explicitNonCoffeeKeywords, []),
      explicitCoffeeAllowKeywords: normalizeKeywords(config?.explicitCoffeeAllowKeywords, []),
    });

    return acc;
  }, []);
}

function loadPlaceOverrides() {
  try {
    if (!existsSync(PLACE_OVERRIDES_FILE)) {
      return {
        explicitNonCoffeeKeywords: defaultExplicitNonCoffeeKeywords,
        explicitCoffeeAllowKeywords: defaultExplicitCoffeeAllowKeywords,
        citySpecificOverrides: [],
      };
    }

    const raw = readFileSync(PLACE_OVERRIDES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    return {
      explicitNonCoffeeKeywords: normalizeKeywords(
        parsed?.explicitNonCoffeeKeywords,
        defaultExplicitNonCoffeeKeywords
      ),
      explicitCoffeeAllowKeywords: normalizeKeywords(
        parsed?.explicitCoffeeAllowKeywords,
        defaultExplicitCoffeeAllowKeywords
      ),
      citySpecificOverrides: normalizeCityOverrides(parsed?.byCity),
    };
  } catch {
    return {
      explicitNonCoffeeKeywords: defaultExplicitNonCoffeeKeywords,
      explicitCoffeeAllowKeywords: defaultExplicitCoffeeAllowKeywords,
      citySpecificOverrides: [],
    };
  }
}

const placeOverrides = loadPlaceOverrides();
const explicitNonCoffeeKeywords = placeOverrides.explicitNonCoffeeKeywords;
const explicitCoffeeAllowKeywords = placeOverrides.explicitCoffeeAllowKeywords;
const citySpecificOverrides = placeOverrides.citySpecificOverrides;

const AGENT_TAGGING_VERSION = 'cuproam-tagging-v1';
const AGENT_SCORING_VERSION = 'cuproam-score-v1';

const AGENT_TAG_RULES = [
  { tag: 'specialty_coffee', patterns: ['specialty', 'single origin', 'micro-lot', 'third wave'] },
  { tag: 'espresso_bar', patterns: ['espresso bar', 'espresso'] },
  { tag: 'pour_over', patterns: ['pour over', 'pour-over', 'filter coffee'] },
  { tag: 'v60', patterns: ['v60'] },
  { tag: 'chemex', patterns: ['chemex'] },
  { tag: 'aeropress', patterns: ['aeropress', 'aero press'] },
  { tag: 'roastery', patterns: ['roaster', 'roastery', 'roast'] },
  { tag: 'bakery', patterns: ['bakery', 'pastry', 'croissant', 'patisserie'] },
  { tag: 'brunch', patterns: ['brunch', 'breakfast', 'sandwich', 'kitchen'] },
  { tag: 'work_friendly', patterns: ['laptop', 'wifi', 'work', 'workspace', 'quiet'] },
  { tag: 'takeaway_friendly', patterns: ['take away', 'takeaway', 'to-go', 'to go'] },
];

const AGENT_TAG_POINTS = {
  specialty_coffee: 18,
  espresso_bar: 8,
  pour_over: 10,
  v60: 7,
  chemex: 7,
  aeropress: 7,
  roastery: 12,
  bakery: 2,
  brunch: -4,
  work_friendly: 4,
  takeaway_friendly: 2,
};

const AGENT_SOURCE_POINTS = {
  seeded: 8,
  manual: 7,
  google: 4,
  osm: 3,
};

const PUBLIC_METADATA_TIMEOUT_MS = 5000;
const PUBLIC_METADATA_HEAD_SLICE_CHARS = 50000;
const IMAGE_META_TIMEOUT_MS = 4000;
const IMAGE_FIELD_CANDIDATES = [
  'photoUrl',
  'photoURL',
  'photo_url',
  'photo',
  'googlePhoto',
  'googlePhotoUrl',
  'googlePhotoURL',
  'imageUrl',
  'imageURL',
  'image_url',
  'thumbnailUrl',
  'thumbnailURL',
  'thumbnail_url',
];

const OBVIOUS_NON_COFFEE_KEYWORDS = [
  'pizza',
  'sushi',
  'ice cream',
  'gelato',
  'frozen yogurt',
  'yogurt',
  'bubble tea',
  'bubble_tea',
  'boba',
  'tea house',
  'teahouse',
  'dessert',
  'waffle',
  'crepe',
  'donut',
  'mochi',
];

const STRONG_COFFEE_TEXT_KEYWORDS = [
  'coffee',
  'cafe',
  'café',
  'espresso',
  'coffee shop',
  'specialty coffee',
  'roaster',
  'roastery',
  'pour over',
  'pour-over',
  'filter coffee',
  'v60',
  'chemex',
  'aeropress',
  'קפה',
  'בית קפה',
  'אספרסו',
  'רוסטר',
  'קלייה',
];

function toNonEmptyString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function resolveAbsoluteUrl(url, baseUrl) {
  const raw = toNonEmptyString(url);
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch {
    return null;
  }
}

async function fetchImageMeta(url, metadataCache) {
  if (!url) return null;
  const cacheKey = `image:${url}`;
  if (metadataCache.has(cacheKey)) return metadataCache.get(cacheKey);

  const p = (async () => {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), IMAGE_META_TIMEOUT_MS);
      const res = await fetch(url, {
        method: 'GET', redirect: 'follow', signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml' },
      });
      clearTimeout(tid);
      if (!res.ok) return null;
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('text/html')) return null;
      const html = await res.text();
      const head = html.slice(0, PUBLIC_METADATA_HEAD_SLICE_CHARS);
      const ogMatch =
        head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      const twMatch =
        head.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
        head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
      const rawImage = ogMatch?.[1] || twMatch?.[1] || null;
      const absoluteImage = resolveAbsoluteUrl(rawImage, res.url || url);
      return absoluteImage;
    } catch {
      return null;
    }
  })();

  metadataCache.set(cacheKey, p);
  return p;
}

function getPlaceText(place) {
  return [place.name, place.address].filter(Boolean).join(" ").toLowerCase();
}

function getPlaceSearchText(place) {
  const typesText = Array.isArray(place?.types)
    ? place.types.join(' ')
    : (typeof place?.types === 'string' ? place.types : '');

  return [
    place?.name,
    place?.address,
    place?.description,
    place?.notes,
    typesText,
  ].filter(Boolean).join(' ').toLowerCase();
}

function getOverrideKeywordsForPlace(place, normalizedText) {
  const text = normalizedText || getPlaceText(place);
  const nonCoffeeKeywords = [...explicitNonCoffeeKeywords];
  const coffeeAllowKeywords = [...explicitCoffeeAllowKeywords];

  citySpecificOverrides.forEach((cityConfig) => {
    const isCityMatch = cityConfig.aliases.some((alias) => text.includes(alias));
    if (!isCityMatch) return;

    nonCoffeeKeywords.push(...cityConfig.explicitNonCoffeeKeywords);
    coffeeAllowKeywords.push(...cityConfig.explicitCoffeeAllowKeywords);
  });

  return {
    explicitNonCoffeeKeywords: Array.from(new Set(nonCoffeeKeywords)),
    explicitCoffeeAllowKeywords: Array.from(new Set(coffeeAllowKeywords)),
  };
}

function isExplicitlyExcludedPlace(place) {
  const text = getPlaceText(place);
  const { explicitNonCoffeeKeywords: nonCoffeeKeywords } = getOverrideKeywordsForPlace(place, text);
  return nonCoffeeKeywords.some((keyword) => text.includes(keyword));
}

function isExplicitlyAllowedCoffeePlace(place) {
  const text = getPlaceText(place);
  const { explicitCoffeeAllowKeywords: coffeeAllowKeywords } = getOverrideKeywordsForPlace(place, text);
  return coffeeAllowKeywords.some((keyword) => text.includes(keyword));
}

function normalizeAgentText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getAgentText(place) {
  const typesText = Array.isArray(place?.types)
    ? place.types.join(' ')
    : (typeof place?.types === 'string' ? place.types : '');

  return normalizeAgentText([
    place?.name,
    place?.description,
    place?.notes,
    place?.address,
    typesText,
    place?.source,
  ].filter(Boolean).join(' '));
}

function tagPlaceDeterministic(place) {
  const text = getAgentText(place);
  const tags = [];
  const tagEvidence = {};

  AGENT_TAG_RULES.forEach((rule) => {
    const matches = rule.patterns.filter((pattern) => text.includes(pattern));
    if (matches.length === 0) return;
    tags.push(rule.tag);
    tagEvidence[rule.tag] = matches;
  });

  if (typeof place?.specialtyScore === 'number' && place.specialtyScore >= 80 && !tags.includes('specialty_coffee')) {
    tags.push('specialty_coffee');
    tagEvidence.specialty_coffee = [`specialtyScore:${Math.round(place.specialtyScore)}`];
  }

  return {
    version: AGENT_TAGGING_VERSION,
    tags: tags.sort((a, b) => a.localeCompare(b)),
    tagEvidence,
  };
}

function scorePlaceDeterministic(place, tags) {
  const components = [];

  const specialtyRaw = Number(place?.specialtyScore);
  const specialtyBase = Number.isFinite(specialtyRaw)
    ? clamp(Math.round(specialtyRaw * 0.45), 0, 45)
    : 0;
  components.push({ key: 'specialtyScore', points: specialtyBase });

  const sourceKey = String(place?.source || '').toLowerCase();
  const sourcePoints = AGENT_SOURCE_POINTS[sourceKey] || 0;
  if (sourcePoints !== 0) {
    components.push({ key: `source:${sourceKey}`, points: sourcePoints });
  }

  tags.forEach((tag) => {
    const points = AGENT_TAG_POINTS[tag] || 0;
    if (points !== 0) {
      components.push({ key: `tag:${tag}`, points });
    }
  });

  return {
    version: AGENT_SCORING_VERSION,
    value: clamp(Math.round(components.reduce((sum, entry) => sum + entry.points, 0)), 0, 100),
    components,
  };
}

function firstSentence(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const idx = text.search(/[.!?]/);
  if (idx === -1) return text.slice(0, 180);
  return text.slice(0, Math.min(idx + 1, 180));
}

function getSourceDomain(url) {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function collectAgentSources(place) {
  const sources = [];

  if (place?.source) {
    sources.push({ id: 'source-primary', type: 'dataset', title: String(place.source).toUpperCase() });
  }

  if (place?.googleMapsUrl) {
    const url = String(place.googleMapsUrl);
    sources.push({ id: 'google-maps-url', type: 'map', title: 'Google Maps', url, domain: getSourceDomain(url) });
  }

  if (place?.sourceUrl) {
    const url = String(place.sourceUrl);
    sources.push({ id: 'source-url', type: 'source_url', title: 'Source', url, domain: getSourceDomain(url) });
  }

  if (place?.website) {
    const url = String(place.website);
    sources.push({ id: 'website', type: 'website', title: 'Website', url, domain: getSourceDomain(url) });
  }

  const dedupedById = new Map();
  sources.forEach((source) => {
    if (!dedupedById.has(source.id)) dedupedById.set(source.id, source);
  });

  return Array.from(dedupedById.values());
}

function sanitizeSourceTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.slice(0, 120);
}

async function fetchPublicSourceMetadata(url, metadataCache) {
  const normalizedUrl = normalizeGoogleMapsUrl(url);
  if (!normalizedUrl) return null;

  if (metadataCache.has(normalizedUrl)) {
    return metadataCache.get(normalizedUrl);
  }

  const metadataPromise = (async () => {
    let timeoutId = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), PUBLIC_METADATA_TIMEOUT_MS);

      const response = await fetch(normalizedUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!response.ok) return null;
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html')) {
        return {
          title: null,
          domain: getSourceDomain(normalizedUrl),
        };
      }

      const html = await response.text();
      const headSlice = html.slice(0, PUBLIC_METADATA_HEAD_SLICE_CHARS);
      const titleMatch = headSlice.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = sanitizeSourceTitle(titleMatch?.[1] || '');

      return {
        title: title || null,
        domain: getSourceDomain(normalizedUrl),
      };
    } catch {
      return {
        title: null,
        domain: getSourceDomain(normalizedUrl),
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  })();

  metadataCache.set(normalizedUrl, metadataPromise);
  return metadataPromise;
}

async function enrichAgentSourcesWithPublicMetadata(baseSources, metadataCache) {
  const enrichedSources = [];

  for (const source of baseSources) {
    if (!source?.url) {
      enrichedSources.push(source);
      continue;
    }

    const normalizedUrl = normalizeGoogleMapsUrl(source.url);
    const metadata = await fetchPublicSourceMetadata(normalizedUrl, metadataCache);
    const hasGenericTitle = ['Website', 'Source', 'Google Maps'].includes(String(source.title || '').trim());
    const bestTitle = metadata?.title && hasGenericTitle
      ? metadata.title
      : source.title;

    enrichedSources.push({
      ...source,
      title: sanitizeSourceTitle(bestTitle) || source.title,
      url: normalizedUrl,
      domain: metadata?.domain || source.domain || getSourceDomain(normalizedUrl),
    });
  }

  return enrichedSources;
}

function formatTagLabel(tag) {
  return String(tag || '').replace(/_/g, ' ').trim();
}

function buildOriginalStorySummary(place, tags, sources) {
  const tagSet = new Set(Array.isArray(tags) ? tags : []);
  const sentences = [];

  const hasSpecialty = tagSet.has('specialty_coffee');
  const hasRoastery = tagSet.has('roastery');
  const hasBakery = tagSet.has('bakery');
  const hasEspresso = tagSet.has('espresso_bar');
  const hasPourSignals = ['pour_over', 'v60', 'chemex', 'aeropress'].some((tag) => tagSet.has(tag));

  if (hasRoastery && hasSpecialty) {
    sentences.push('A roastery-forward coffee spot with specialty signals in its public-facing metadata.');
  } else if (hasBakery && (hasEspresso || hasSpecialty)) {
    sentences.push('A bakery-and-coffee stop with visible espresso cues and a broader cafe profile.');
  } else if (hasSpecialty || hasEspresso || hasPourSignals) {
    const cueParts = [];
    if (hasPourSignals) cueParts.push('pour-over');
    if (hasEspresso) cueParts.push('espresso');
    if (cueParts.length === 0 && hasSpecialty) cueParts.push('specialty coffee');
    sentences.push(`A specialty-leaning cafe with clear ${cueParts.join(' and ')} signals in its public-facing metadata.`);
  } else {
    sentences.push('A coffee-oriented venue with structured public source references.');
  }

  const referencedSources = (Array.isArray(sources) ? sources : [])
    .filter((source) => source?.url)
    .map((source) => source.domain || source.title)
    .filter(Boolean);
  const uniqueRefs = Array.from(new Set(referencedSources)).slice(0, 2);
  if (uniqueRefs.length > 0) {
    sentences.push(`Source metadata references ${uniqueRefs.join(' and ')}.`);
  }

  if (place?.address) {
    sentences.push('Address metadata is available for location context.');
  }

  return sentences.slice(0, 3).join(' ');
}

function buildAgentStory(place, tags, sources) {
  const summary = buildOriginalStorySummary(place, tags, sources);
  if (!summary) return undefined;

  const sourceIds = (Array.isArray(sources) ? sources : [])
    .map((source) => source?.id)
    .filter(Boolean);

  return {
    summary,
    status: 'draft',
    generatedAt: new Date().toISOString(),
    sourceIds,
  };
}

function normalizeAgentImageState(agent) {
  if (!agent || typeof agent !== 'object') return agent;

  const imageValue = agent.image && typeof agent.image === 'object' ? agent.image : null;
  const imageUrl = toNonEmptyString(imageValue?.url || imageValue?.src || imageValue?.photoUrl || imageValue?.imageUrl);

  if (!imageUrl) {
    return {
      ...agent,
      imageStatus: toNonEmptyString(agent.imageStatus) || 'missing',
    };
  }

  const rawSource = toNonEmptyString(imageValue?.source)?.toLowerCase();
  let source = rawSource;
  if (source !== 'google' && source !== 'website') {
    source = /googleusercontent\.com|google\./i.test(imageUrl) ? 'google' : 'website';
  }

  return {
    ...agent,
    image: {
      ...imageValue,
      url: imageUrl,
      source,
      attribution: imageValue?.attribution || (source === 'google' ? 'google-maps' : imageValue?.attribution),
    },
    imageStatus: 'ok',
  };
}

async function enrichPlaceWithAgent(place, metadataCache) {
  if (place?.agent && typeof place.agent === 'object') {
    return {
      ...place,
      agent: normalizeAgentImageState(place.agent),
    };
  }

  const tagging = tagPlaceDeterministic(place);
  const baseSources = collectAgentSources(place);
  const sources = await enrichAgentSourcesWithPublicMetadata(baseSources, metadataCache);
  const story = buildAgentStory(place, tagging.tags, sources);

  // Resolve image: existing Google photoUrl first, then website og:image/twitter:image.
  let image = null;
  let imageStatus = 'missing';
  const googlePhoto = getGoogleImageCandidate(place);
  if (googlePhoto) {
    image = { url: googlePhoto, source: 'google', attribution: 'google-maps' };
    imageStatus = 'ok';
  } else {
    const googleMapsUrl = normalizeGoogleMapsUrl(place.googleMapsUrl);
    if (googleMapsUrl) {
      const googleMetaImage = await fetchImageMeta(googleMapsUrl, metadataCache);
      if (googleMetaImage) {
        image = { url: googleMetaImage, source: 'google', attribution: 'google-maps' };
        imageStatus = 'ok';
      }
    }

    const websiteUrl = place.website ? String(place.website).trim() : null;
    if (!image && websiteUrl) {
      const ogUrl = await fetchImageMeta(websiteUrl, metadataCache);
      if (ogUrl) {
        image = { url: ogUrl, source: 'website', attribution: getSourceDomain(websiteUrl) || websiteUrl };
        imageStatus = 'ok';
      }
    }
  }

  return {
    ...place,
    agent: normalizeAgentImageState({
      story,
      sources,
      tags: tagging.tags,
      tagEvidence: tagging.tagEvidence,
      score: scorePlaceDeterministic(place, tagging.tags),
      enrichmentStatus: tagging.tags.length > 0 ? 'scored' : 'none',
      ...(image ? { image } : {}),
      imageStatus,
    }),
  };
}

function normalizeGoogleMapsUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/\/$/, '');
  }
}

function dedupePlacesByGoogleMapsUrl(places) {
  const deduped = [];
  const indexByUrlKey = new Map();

  places.forEach((place) => {
    const urlKey = normalizeGoogleMapsUrl(place?.googleMapsUrl);
    if (!urlKey) {
      deduped.push(place);
      return;
    }

    const existingIndex = indexByUrlKey.get(urlKey);
    if (existingIndex == null) {
      indexByUrlKey.set(urlKey, deduped.length);
      deduped.push({ ...place, googleMapsUrl: urlKey });
      return;
    }

    const base = deduped[existingIndex] || {};
    const next = { ...base, googleMapsUrl: urlKey };

    Object.keys(place || {}).forEach((key) => {
      const incomingValue = place[key];
      const baseValue = next[key];
      if (key === 'googleMapsUrl') return;

      if (key === 'types' || key === 'notes') {
        const toArray = (value) => {
          if (Array.isArray(value)) return value.filter(Boolean);
          if (typeof value === 'string' && value.trim()) return [value.trim()];
          return [];
        };

        const merged = Array.from(new Set([...toArray(baseValue), ...toArray(incomingValue)]));
        if (merged.length > 0) {
          next[key] = merged;
        }
        return;
      }

      const baseMissing = baseValue == null || baseValue === '';
      if (baseMissing && incomingValue != null && incomingValue !== '') {
        next[key] = incomingValue;
      }
    });

    deduped[existingIndex] = next;
  });

  return deduped;
}

const STRONG_COFFEE_TAGS = ['specialty_coffee', 'roastery', 'espresso_bar', 'pour_over', 'v60', 'chemex', 'aeropress'];
const COFFEE_NAME_KEYWORDS = ['coffee', 'cafe', 'café', 'espresso', 'roaster', 'roastery', 'specialty'];
const FOOD_FIRST_KEYWORDS = [
  'brunch',
  'breakfast',
  'all day breakfast',
  'sandwich',
  'kitchen',
  'restaurant',
  'steakhouse',
  'ramen',
  'noodle',
  'burger',
  'hotdog',
  'taco',
  'bbq',
  'barbecue',
  'grill',
  'bistro',
  'diner',
  'wine',
  'cocktail',
  'ארוחת בוקר',
  'בראנץ',
  'מסעדה',
  'gelato',
  'ice cream',
];

function getGoogleImageCandidate(place) {
  for (const key of IMAGE_FIELD_CANDIDATES) {
    const value = toNonEmptyString(place?.[key]);
    if (value) return value;
  }

  const photoArrays = [place?.photos, place?.photoUrls, place?.images];
  for (const arr of photoArrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item === 'string') {
        const value = toNonEmptyString(item);
        if (value) return value;
      } else if (item && typeof item === 'object') {
        const value = toNonEmptyString(item.url || item.src || item.photoUrl || item.imageUrl);
        if (value) return value;
      }
    }
  }

  return null;
}

function hasCoffeeLeadingSignal(place) {
  const text = getPlaceSearchText(place);
  return STRONG_COFFEE_TEXT_KEYWORDS.some((keyword) => text.includes(keyword));
}

function hasCoffeeNameSignal(place) {
  const nameText = normalizeAgentText(place?.name);
  if (!nameText) return false;
  return COFFEE_NAME_KEYWORDS.some((keyword) => nameText.includes(keyword));
}

function isObviousNonCoffeePlace(place) {
  const text = getPlaceSearchText(place);
  return OBVIOUS_NON_COFFEE_KEYWORDS.some((keyword) => text.includes(keyword));
}

function hasStrongCoffeeTag(place) {
  const tags = Array.isArray(place?.agent?.tags) ? place.agent.tags : [];
  return tags.some((t) => STRONG_COFFEE_TAGS.includes(t));
}

function hasBakeryOrBrunchSignal(place) {
  const tags = Array.isArray(place?.agent?.tags) ? place.agent.tags : [];
  if (tags.includes('bakery') || tags.includes('brunch')) return true;
  const text = [place?.name, place?.address].filter(Boolean).join(' ').toLowerCase();
  return ['bakery', 'patisserie', 'boulangerie', 'brunch', 'breakfast', 'sandwich', 'kitchen'].some((k) => text.includes(k));
}

function hasFoodFirstSignal(place) {
  const text = getPlaceSearchText(place);
  return FOOD_FIRST_KEYWORDS.some((keyword) => text.includes(keyword));
}

function placePassesGoogleFilterMode(place, mode = 'coffeeOnly') {
  if (isExplicitlyExcludedPlace(place)) return false;
  if (isExplicitlyAllowedCoffeePlace(place)) return true;

  const hasStrongTag = hasStrongCoffeeTag(place);
  const hasCoffeeName = hasCoffeeNameSignal(place);
  const hasCoffeeText = hasCoffeeLeadingSignal(place);
  const hasCoffeeEvidence = hasStrongTag || hasCoffeeName;
  const hasBakeryBrunch = hasBakeryOrBrunchSignal(place);
  const hasFoodFirst = hasFoodFirstSignal(place);
  const specialtyScore = Number(place?.specialtyScore);
  const hasNeutralCoffeeScore = Number.isFinite(specialtyScore) && specialtyScore >= 48;

  if (isObviousNonCoffeePlace(place) && !hasStrongTag) return false;

  if (mode === 'coffeeAndBakery') {
    if (hasCoffeeEvidence || hasCoffeeText) return true;
    return hasBakeryBrunch && !isObviousNonCoffeePlace(place);
  }

  // coffeeOnly: food-primary and bakery/brunch places must have strong coffee-leading tags.
  if ((hasBakeryBrunch || hasFoodFirst) && !hasStrongTag) return false;

  // Coffee-led acceptance: either a strong coffee tag (covers non-obvious names),
  // or a direct coffee-led name, or strong coffee text without food-first signals.
  if (hasCoffeeEvidence) return true;
  if (hasCoffeeText && !hasBakeryBrunch && !hasFoodFirst) return true;

  // Slightly relax neutral places: keep plausible coffee candidates with decent specialty score
  // only when they are neither food-first nor bakery/brunch-led.
  if (!hasBakeryBrunch && !hasFoodFirst && hasNeutralCoffeeScore) return true;

  return false;
}
function findFirstGoogleImageUrl(value, depth = 0) {
  if (depth > 6 || value == null) return null;

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (!/^https:\/\//i.test(text)) return null;
    if (!/googleusercontent\.com/i.test(text)) return null;
    // Accept any HTTPS googleusercontent.com URL — covers /p/, /places/, /place-photos/, and other CDN paths
    return text;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstGoogleImageUrl(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === 'object') {
    for (const entry of Object.values(value)) {
      const found = findFirstGoogleImageUrl(entry, depth + 1);
      if (found) return found;
    }
  }

  return null;
}
/**
 * Extract coordinates from a Google Maps URL
 */
function extractCoordsFromUrl(url) {
  // Try various patterns for coordinates in Google Maps URLs
  // Priority 1: Pattern !3d{lat}!4d{lng} - most accurate, specific to the place
  const bangPattern = /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/;
  // Priority 2: Pattern @lat,lng,zoom - map center, less accurate
  const atPattern = /@(-?\d+\.?\d*),(-?\d+\.?\d*)/;
  // Priority 3: Pattern ll=lat,lng
  const llPattern = /ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/;

  // Try bang pattern first (most accurate)
  let match = url.match(bangPattern);
  if (match) {
    return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) };
  }

  // Fall back to @ pattern
  match = url.match(atPattern);
  if (match) {
    return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) };
  }

  // Last resort: ll pattern
  match = url.match(llPattern);
  if (match) {
    return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) };
  }

  return null;
}

function extractPlacesFromEntityListResponse(responseText) {
  if (!responseText) return [];

  try {
    const jsonText = responseText.startsWith(")]}'")
      ? responseText.slice(responseText.indexOf('\n') + 1)
      : responseText;
    const data = JSON.parse(jsonText);
    const root = Array.isArray(data) ? data[0] : null;
    const listItems = Array.isArray(root?.[8]) ? root[8] : [];
    const places = [];
    const seen = new Set();

    for (const item of listItems) {
      const details = Array.isArray(item?.[1]) ? item[1] : null;
      const name = typeof item?.[2] === 'string' ? item[2].trim() : null;
      const address = details
        ? (typeof details[4] === 'string' && details[4].trim()) || (typeof details[2] === 'string' && details[2].trim())
        : null;
      const coords = Array.isArray(details?.[5]) ? details[5] : null;

      if (!name || !details) continue;

      const dedupeKey = `${name.toLowerCase()}|${(address || '').toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const place = { name };

      if (address) {
        place.address = address;
      }

      if (Array.isArray(coords) && typeof coords[2] === 'number' && typeof coords[3] === 'number') {
        place.latitude = coords[2];
        place.longitude = coords[3];
        place.googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords[2]},${coords[3]}`;
      }

      const photoUrl = findFirstGoogleImageUrl(item);
      if (photoUrl) {
        place.photoUrl = photoUrl;
      }

      places.push(place);
    }

    return places;
  } catch {
    return [];
  }
}

async function extractPlacesFromEntityListApi(page) {
  try {
    const endpoint = await page.evaluate(() => {
      const link = document.querySelector('link[href*="entitylist/getlist"]');
      return link?.getAttribute('href') || null;
    });

    if (!endpoint) return [];

    const responseText = await page.evaluate(async (href) => {
      const response = await fetch(href, { credentials: 'include' });
      return response.ok ? await response.text() : null;
    }, endpoint);

    return extractPlacesFromEntityListResponse(responseText);
  } catch (error) {
    console.log(`  Entity list API extraction failed: ${error.message}`);
    return [];
  }
}

/**
 * Scrape a single Google Maps list page
 */
async function scrapeList(page, listUrl) {
  console.log(`\nProcessing list: ${listUrl}`);

  try {
    // Use 'load' instead of 'networkidle' - Google Maps never stops making requests
    await page.goto(listUrl, { waitUntil: 'load', timeout: 30000 });

    // Wait for initial load
    await delay(3000);

    // Handle cookie consent dialog if present
    const consentSelectors = [
      'button[aria-label*="Accept"]',
      'button[aria-label*="accept"]',
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      'button:has-text("Accept")',
      '[aria-label="Accept all"]',
      'form[action*="consent"] button',
    ];

    for (const selector of consentSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          console.log('  Found consent dialog, accepting...');
          await btn.click();
          await delay(2000);
          break;
        }
      } catch (e) {
        // Continue trying other selectors
      }
    }

    // Wait for the list panel to load
    await delay(5000);

    // Wait for the feed/list container to appear
    await page.waitForSelector('[role="feed"], [role="main"], a[aria-label]', { timeout: 15000 }).catch(() => {});

    // Try to scroll the list panel to trigger lazy loading
    await page.evaluate(() => {
      const scrollContainers = document.querySelectorAll('[role="feed"], [role="main"], .m6QErb');
      scrollContainers.forEach(container => {
        if (container.scrollHeight > container.clientHeight) {
          container.scrollTop = 100;
        }
      });
    });

    // Extra wait for content to fully load after scroll
    await delay(3000);

    // Try to find list items - Google Maps lists have various structures
    // Look for place entries in the list
    const places = [];

    const entityListPlaces = await extractPlacesFromEntityListApi(page);
    if (entityListPlaces.length > 0) {
      places.push(...entityListPlaces);
      console.log(`  Entity list API found: ${entityListPlaces.length}`);
    }

    // Selector for list items (may need adjustment based on Google's current HTML)
    // Google Maps lists typically show places as clickable items
    const placeElements = await page.$$('[data-item-id], [data-cid], .fontHeadlineSmall');

    if (places.length === 0 && placeElements.length === 0) {
      // Alternative: try to find any links that look like place links
      const allLinks = await page.$$('a[href*="/maps/place/"]');

      for (const link of allLinks) {
        try {
          const href = await link.getAttribute('href');
          const textContent = await link.textContent();
          const name = textContent?.trim();

          if (name && href && !places.find(p => p.name === name)) {
            const coords = extractCoordsFromUrl(href);
            const place = {
              name,
              googleMapsUrl: href.startsWith('http') ? href : `https://www.google.com${href}`,
            };

            if (coords) {
              place.latitude = coords.latitude;
              place.longitude = coords.longitude;
            }

            places.push(place);
            console.log(`  Found: ${name}`);
          }
        } catch (e) {
          // Skip this element
        }
      }
    }

    // If still no places found, try a more aggressive approach
    if (places.length === 0) {
      console.log('  Trying alternative extraction method...');

      // Look for place cards/items in the sidebar or main content
      const cards = await page.$$('[role="article"], [role="listitem"], .hfpxzc');

      for (const card of cards) {
        try {
          // Try to find the name
          const nameEl = await card.$('.fontHeadlineSmall, [class*="fontHeadline"], h2, h3');
          const name = nameEl ? (await nameEl.textContent())?.trim() : null;

          // Try to find address
          const addressEl = await card.$('[class*="fontBody"], .rogA2c');
          const address = addressEl ? (await addressEl.textContent())?.trim() : null;

          // Try to get the link
          const linkEl = await card.$('a[href*="maps"]');
          const href = linkEl ? await linkEl.getAttribute('href') : null;

          if (name && !places.find(p => p.name === name)) {
            const place = { name };

            if (href) {
              place.googleMapsUrl = href.startsWith('http') ? href : `https://www.google.com${href}`;
              const coords = extractCoordsFromUrl(href);
              if (coords) {
                place.latitude = coords.latitude;
                place.longitude = coords.longitude;
              }
            }

            if (address) {
              place.address = address;
            }

            places.push(place);
            console.log(`  Found: ${name}`);
          }
        } catch (e) {
          // Skip this card
        }
      }
    }

    // Final fallback: extract from page content using evaluate
    if (places.length === 0) {
      console.log('  Trying JavaScript extraction...');

      const extractedPlaces = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        // UI labels to filter out
        const isUILabel = (text) => {
          const uiPatterns = /^(שמורים|מהזמן|להורדת|שמירה|שיתוף|חיפוש|הגדלת התצוגה|הקטנת התצוגה|הצג Street View|Saved|Recent|Download|Save|Share|Search|Zoom in|Zoom out|Street View|Google|golan peretz|רשימה משותפת|מקומות|Directions|אפליקציות Google|כניסה|Show the Input Tools menu)$/i;
          return uiPatterns.test(text?.trim());
        };

        // Method 1: Find elements that look like place names in the list panel
        // Google Maps list items have a specific structure with the name as the first prominent text
        document.querySelectorAll('[role="article"], [data-index]').forEach(item => {
          const textContent = item.textContent?.trim();
          // Find the first line of text which is usually the place name
          const lines = textContent?.split('\n').filter(l => l.trim());
          if (lines && lines.length > 0) {
            const name = lines[0].trim();
            if (name && name.length > 2 && name.length < 100 && !seen.has(name) && !isUILabel(name)) {
              // Check if this looks like a place (has rating or category nearby)
              if (/\d\.\d|בית קפה|מסעדה|פארק|מאפייה|Café|Restaurant|Park|Bakery|Museum/i.test(textContent)) {
                seen.add(name);
                results.push({ name, googleMapsUrl: null });
              }
            }
          }
        });

        // Method 2: Look for clickable divs with jsaction attribute (Google's pattern)
        document.querySelectorAll('[jsaction*="click"], [data-value]').forEach(el => {
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.length > 2 && ariaLabel.length < 100 && !seen.has(ariaLabel) && !isUILabel(ariaLabel)) {
            seen.add(ariaLabel);
            results.push({ name: ariaLabel, googleMapsUrl: null });
          }
        });

        // Method 3: Find text nodes that look like place names based on nearby ratings
        const textWalker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );

        const potentialPlaces = [];
        while (textWalker.nextNode()) {
          const node = textWalker.currentNode;
          const text = node.textContent?.trim();
          // Look for rating patterns like "4.5" followed by text
          if (text && /^\d\.\d$/.test(text)) {
            // Found a rating, look at previous sibling or parent for name
            const parent = node.parentElement?.parentElement;
            if (parent) {
              const prevText = parent.previousElementSibling?.textContent?.trim();
              if (prevText && prevText.length > 2 && prevText.length < 100 && !seen.has(prevText)) {
                seen.add(prevText);
                potentialPlaces.push({ name: prevText, rating: text });
              }
            }
          }
        }

        // Method 4: Parse visible text for place-like patterns
        const bodyText = document.body?.innerText || '';
        // Split by newlines and look for lines followed by ratings
        const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          const nextLine = lines[i + 1];
          // If next line looks like a rating (e.g., "4.5", "4.8(1,234)")
          if (/^\d\.\d(\([\d,]+\))?$/.test(nextLine) || /^\d\.\d/.test(nextLine)) {
            // Current line might be a place name
            if (line.length > 2 && line.length < 80 && !seen.has(line)) {
              // Exclude obvious non-place text (UI elements)
              if (!isUILabel(line)) {
                seen.add(line);
                results.push({ name: line, googleMapsUrl: null });
              }
            }
          }
        }

        return results.concat(potentialPlaces);
      });

      for (const place of extractedPlaces) {
        if (place.name && !places.find(p => p.name === place.name)) {
          if (place.googleMapsUrl) {
            const coords = extractCoordsFromUrl(place.googleMapsUrl);
            if (coords) {
              place.latitude = coords.latitude;
              place.longitude = coords.longitude;
            }
          }
          places.push(place);
          console.log(`  Found: ${place.name}`);
        }
      }
    }

    // Debug: if still no places, save a screenshot and log page info
    if (places.length === 0) {
      const debugDir = join(projectRoot, 'debug');
      if (!existsSync(debugDir)) {
        const { mkdirSync } = await import('fs');
        mkdirSync(debugDir, { recursive: true });
      }
      const filename = listUrl.split('/').pop();
      await page.screenshot({ path: join(debugDir, `${filename}.png`), fullPage: true });
      console.log(`  Debug screenshot saved to debug/${filename}.png`);

      // Debug: count elements
      const debugInfo = await page.evaluate(() => {
        return {
          anchorsTotal: document.querySelectorAll('a').length,
          anchorsWithAriaLabel: document.querySelectorAll('a[aria-label]').length,
          anchorsWithMapsHref: document.querySelectorAll('a[href*="maps"]').length,
          anchorsWithPlaceHref: document.querySelectorAll('a[href*="/maps/place/"]').length,
          ariaLabels: Array.from(document.querySelectorAll('a[aria-label]')).slice(0, 5).map(a => a.getAttribute('aria-label')),
          pageTitle: document.title,
          url: window.location.href,
          iframes: document.querySelectorAll('iframe').length,
          bodyText: document.body?.innerText?.substring(0, 500)
        };
      });
      console.log('  Debug info:', JSON.stringify(debugInfo, null, 2));

      // Save HTML for deeper inspection
      const html = await page.content();
      const { writeFileSync: writeSync } = await import('fs');
      writeSync(join(debugDir, `${filename}.html`), html);
      console.log(`  Debug HTML saved to debug/${filename}.html`);
    }

    console.log(`  Total places found: ${places.length}`);
    return { url: listUrl, places };

  } catch (error) {
    console.error(`  Error processing list: ${error.message}`);
    return { url: listUrl, places: [], error: error.message };
  }
}

/**
 * For each place, navigate to its page and extract more details
 */
async function enrichPlaceData(page, place) {
  if (!place.googleMapsUrl) return place;

  try {
    console.log(`    Enriching: ${place.name}`);
    await page.goto(place.googleMapsUrl, { waitUntil: 'load', timeout: 30000 });
    await delay(3000);

    // Extract coordinates from the final URL (after redirects)
    const currentUrl = page.url();
    const coords = extractCoordsFromUrl(currentUrl);
    if (coords && !place.latitude) {
      place.latitude = coords.latitude;
      place.longitude = coords.longitude;
    }

    // Update the URL to the canonical one
    place.googleMapsUrl = currentUrl;

    // Try to extract address if not already present
    if (!place.address) {
      const address = await page.evaluate(() => {
        // Look for address elements
        const addressEl = document.querySelector('[data-item-id="address"], button[data-item-id="address"]');
        if (addressEl) return addressEl.textContent?.trim();

        // Alternative: look for common address patterns
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent || '';
          // Look for text that looks like an address (contains numbers and common street suffixes)
          if (/\d+.*(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Street|Avenue|Boulevard|Road|Drive|Lane)/i.test(text)) {
            return text.trim();
          }
        }

        return null;
      });

      if (address) {
        place.address = address;
      }
    }

  } catch (error) {
    console.log(`    Could not enrich ${place.name}: ${error.message}`);
  }

  return place;
}

async function main() {
  // Check if lists.txt exists
  if (!existsSync(LISTS_FILE)) {
    console.error(`Error: ${LISTS_FILE} not found.`);
    console.error('Please create lists.txt with one Google Maps list URL per line.');
    process.exit(1);
  }

  // Read URLs from lists.txt
  const content = readFileSync(LISTS_FILE, 'utf-8');
  const urls = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#')); // Skip empty lines and comments

  if (urls.length === 0) {
    console.error('Error: No URLs found in lists.txt');
    process.exit(1);
  }

  console.log(`Found ${urls.length} list(s) to process`);

  // Launch browser
  const browser = await chromium.launch({
    headless: false, // Set to true for production, false for debugging
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();

  const results = {
    exportedAt: new Date().toISOString(),
    lists: []
  };

  // Process each list
  for (const url of urls) {
    const listData = await scrapeList(page, url);

    // Enrich each place by clicking on it to get URL and coordinates
    if (listData.places.length > 0) {
      console.log('  Enriching place data...');
      for (let i = 0; i < listData.places.length; i++) {
        const place = listData.places[i];
        try {
          // Find and click on the place name
          const placeElement = await page.locator(`text="${place.name}"`).first();
          if (placeElement) {
            await placeElement.click();
            await delay(2000);

            // Get the updated URL which contains the place info
            const currentUrl = page.url();
            const coords = extractCoordsFromUrl(currentUrl);

            if (currentUrl.includes('/place/')) {
              place.googleMapsUrl = currentUrl;
            }

            if (coords) {
              place.latitude = coords.latitude;
              place.longitude = coords.longitude;
            }

            // Try to get address from the page
            const addressText = await page.evaluate(() => {
              const btn = document.querySelector('button[data-item-id="address"]');
              return btn?.textContent?.trim() || null;
            });
            if (addressText) {
              place.address = addressText;
            }

            // Extract the first Google photo from the place detail panel
            if (!place.photoUrl) {
              const photoUrl = await page.evaluate(() => {
                const imgs = document.querySelectorAll('img[src*="googleusercontent.com"]');
                for (const img of imgs) {
                  const src = img.getAttribute('src') || '';
                  if (src.startsWith('https://')) return src;
                }
                return null;
              });
              if (photoUrl) {
                place.photoUrl = photoUrl;
              }
            }

            console.log(`    ${i + 1}/${listData.places.length}: ${place.name} ${coords ? '(coords found)' : ''}${place.photoUrl ? ' (photo)' : ''}`);

            // Go back to the list
            await page.goBack();
            await delay(1500);
          }
        } catch (e) {
          console.log(`    ${i + 1}/${listData.places.length}: ${place.name} (error: ${e.message})`);
        }
      }

      const totalBeforeDedupe = listData.places.length;
      listData.places = dedupePlacesByGoogleMapsUrl(listData.places);
      console.log(`  Dedupe by googleMapsUrl: kept ${listData.places.length}/${totalBeforeDedupe}`);

      const metadataCache = new Map();
      const enrichedPlaces = [];
      for (const place of listData.places) {
        enrichedPlaces.push(await enrichPlaceWithAgent(place, metadataCache));
      }
      listData.places = enrichedPlaces;

      const rawFilterMode = process.env.GOOGLE_FILTER_MODE || 'coffeeOnly';
      const filterMode = ['coffeeOnly', 'coffeeAndBakery'].includes(rawFilterMode)
        ? rawFilterMode
        : 'coffeeOnly';
      const totalBeforeFilter = listData.places.length;

      listData.places = listData.places.filter((place) => placePassesGoogleFilterMode(place, filterMode));
      console.log(`  Google filter (post-enrich): kept ${listData.places.length}/${totalBeforeFilter} (${filterMode})`);
    }
    results.lists.push(listData);
  }

  await browser.close();

  // Write results
  writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${OUTPUT_FILE}`);

  // Summary
  const totalPlaces = results.lists.reduce((sum, list) => sum + list.places.length, 0);
  console.log(`\nSummary:`);
  console.log(`  Lists processed: ${results.lists.length}`);
  console.log(`  Total places found: ${totalPlaces}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
