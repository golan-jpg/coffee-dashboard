#!/usr/bin/env node

/**
 * Google Maps List Importer
 *
 * Reads Google Maps list URLs from lists.txt and extracts place data
 * using Playwright to scrape the pages.
 *
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

// Delay helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    // Selector for list items (may need adjustment based on Google's current HTML)
    // Google Maps lists typically show places as clickable items
    const placeElements = await page.$$('[data-item-id], [data-cid], .fontHeadlineSmall');

    if (placeElements.length === 0) {
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

            console.log(`    ${i + 1}/${listData.places.length}: ${place.name} ${coords ? '(coords found)' : ''}`);

            // Go back to the list
            await page.goBack();
            await delay(1500);
          }
        } catch (e) {
          console.log(`    ${i + 1}/${listData.places.length}: ${place.name} (error: ${e.message})`);
        }
      }
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
