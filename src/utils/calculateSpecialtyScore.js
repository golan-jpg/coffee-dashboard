/**
 * Scoring presets that control how cafes are evaluated.
 */
export const SCORING_PRESETS = {
  strict: {
    label: "Strict",
    baseline: 50,
    specialtyKeywords: 25,
    roaster: 15,
    website: 5,
    openingHours: 3,
    wifiAccess: 1,
    chainPenalty: -50,
    genericPenalty: -20,
    restaurantPenalty: -15,
  },
  balanced: {
    label: "Balanced",
    baseline: 50,
    specialtyKeywords: 20,
    roaster: 10,
    website: 5,
    openingHours: 3,
    wifiAccess: 2,
    chainPenalty: -40,
    genericPenalty: -15,
    restaurantPenalty: -10,
  },
  discovery: {
    label: "Discovery",
    baseline: 60,
    specialtyKeywords: 15,
    roaster: 10,
    website: 5,
    openingHours: 5,
    wifiAccess: 3,
    chainPenalty: -30,
    genericPenalty: -5,
    restaurantPenalty: -8,
  },
};

// Default weights config structure for custom mode
export const DEFAULT_WEIGHT_KEYS = [
  'specialtyKeywords',
  'roaster',
  'website',
  'openingHours',
  'wifiAccess',
  'chainPenalty',
  'genericPenalty',
  'restaurantPenalty',
];

/**
 * Classifies an OSM place by type based on tags and name.
 * @param {Object} tags - OpenStreetMap tags
 * @param {string} name - Place name
 * @returns {string} One of: "coffee", "restaurant", "bar", "bakery", "other"
 */
export function classifyPlace(tags, name = '') {
  const nameLower = (name || '').toLowerCase();
  const amenity = (tags?.amenity || '').toLowerCase();
  const cuisine = (tags?.cuisine || '').toLowerCase();
  const shop = (tags?.shop || '').toLowerCase();

  // Check for coffee-specific amenities
  if (amenity === 'cafe' || amenity === 'coffee' || shop === 'coffee') {
    return 'coffee';
  }

  // Check for coffee in name or cuisine
  const coffeeKeywords = ['cafe', 'café', 'coffee', 'espresso', 'barista', 'roaster', 'roastery'];
  if (coffeeKeywords.some(kw => nameLower.includes(kw) || cuisine.includes(kw))) {
    return 'coffee';
  }

  // Check for restaurant
  if (amenity === 'restaurant' || cuisine.includes('restaurant') || nameLower.includes('restaurant')) {
    return 'restaurant';
  }

  // Check for bar/pub
  const barKeywords = ['bar', 'pub', 'tavern', 'nightclub'];
  if (amenity === 'bar' || amenity === 'pub' || barKeywords.some(kw => nameLower.includes(kw) || amenity.includes(kw))) {
    return 'bar';
  }

  // Check for bakery
  if (amenity === 'bakery' || shop === 'bakery' || nameLower.includes('bakery') || nameLower.includes('boulangerie') || nameLower.includes('bäckerei')) {
    return 'bakery';
  }

  return 'other';
}

/**
 * Computes confidence score (0-100) based on data completeness.
 * @param {Object} tags - OpenStreetMap tags
 * @returns {number} Confidence score 0-100
 */
export function computeConfidence(tags) {
  if (!tags) return 0;

  let confidence = 0;
  const indicators = [];

  // Contact information (30 points max)
  if (tags.phone || tags['contact:phone'] || tags['contact:mobile']) {
    confidence += 10;
    indicators.push('phone');
  }
  if (tags.website || tags['contact:website']) {
    confidence += 10;
    indicators.push('website');
  }
  if (tags.email || tags['contact:email']) {
    confidence += 10;
    indicators.push('email');
  }

  // Operating hours (20 points)
  if (tags.opening_hours) {
    confidence += 20;
    indicators.push('hours');
  }

  // Address fields (30 points max)
  let addressCount = 0;
  if (tags['addr:street']) addressCount++;
  if (tags['addr:housenumber']) addressCount++;
  if (tags['addr:postcode']) addressCount++;
  if (tags['addr:city']) addressCount++;
  confidence += addressCount * 7.5;

  // Core type tags (20 points max)
  let tagCount = 0;
  if (tags.amenity) tagCount++;
  if (tags.cuisine) tagCount++;
  if (tags.shop) tagCount++;
  if (tags.brand) tagCount++;
  confidence += Math.min(20, tagCount * 5);

  return Math.min(100, confidence);
}

/**
 * Calculates a specialty score for a cafe based on its name and OSM tags.
 *
 * @param {string} cafeName - The name of the cafe
 * @param {Object} osmTags - OpenStreetMap tags object
 * @param {Object} config - Scoring weights config (default: balanced preset)
 * @returns {{ score: number, explanation: string, reasons: Array<{label: string, points: number}>, placeType: string, confidence: number }}
 */
export function calculateSpecialtyScore(cafeName, osmTags, config = SCORING_PRESETS.balanced) {
  let score = config.baseline || 50;
  const reasons = [];
  const nameLower = (cafeName || '').toLowerCase();
  const brand = (osmTags?.brand || '').toLowerCase();

  // Known chain cafes (heavy penalty)
  const chains = [
    'starbucks', 'costa coffee', 'costa', 'pret a manger', 'pret', 'nero',
    'caffè nero', 'dunkin', 'tim hortons', 'mccafé', 'mccafe', 'mcdonald',
    'greggs', 'subway', 'krispy kreme', 'coffee republic', 'wild bean cafe',
    'segafredo', 'lavazza', 'illy', 'tchibo', 'balzac coffee', 'einstein kaffee',
    'starbucks reserve', 'coffee#1', 'café amazon', 'wayne\'s coffee',
    'espresso house', 'baresso', 'joe & the juice', 'le pain quotidien'
  ];

  // Generic names (moderate penalty)
  const genericNames = [
    'cafe', 'café', 'coffee shop', 'coffee house', 'kaffee', 'kaffeehaus',
    'bistro', 'bakery', 'bäckerei', 'boulangerie', 'cafeteria'
  ];

  // Specialty indicators (bonus) - specialty keywords
  const specialtyKeywords = [
    'specialty', 'speciality', 'artisan', 'craft',
    'micro-roast', 'third wave', 'single origin', 'pour over', 'filter bar',
    'coffee lab', 'kaffeelabor', 'torrefazione'
  ];

  // Roaster-related keywords
  const roasterKeywords = [
    'roaster', 'roastery', 'coffee roasters', 'kaffeerösterei'
  ];

  // Restaurant-related keywords (negative)
  const restaurantKeywords = [
    'restaurant', 'bistro', 'grill', 'sushi', 'pizza', 'bar', 'pub',
    'eatery', 'kitchen', 'diner', 'burger', 'food'
  ];

  // === PENALTIES ===

  // Chain detection (name or brand tag)
  const isChain = chains.some(chain => nameLower.includes(chain) || brand.includes(chain));
  if (isChain) {
    const penalty = config.chainPenalty || -40;
    score += penalty;
    reasons.push({ label: 'Chain cafe', points: penalty });
  }

  // Generic name only (e.g., just "Cafe" or "Coffee Shop")
  const isGenericOnly = genericNames.some(g => nameLower === g || nameLower === `the ${g}`);
  if (isGenericOnly) {
    const penalty = config.genericPenalty || -15;
    score += penalty;
    reasons.push({ label: 'Generic name', points: penalty });
  }

  // Restaurant/bar detection
  const isRestaurant = restaurantKeywords.some(kw => nameLower.includes(kw));
  if (isRestaurant && !isChain && !specialtyKeywords.some(kw => nameLower.includes(kw))) {
    const penalty = config.restaurantPenalty || -10;
    score += penalty;
    reasons.push({ label: 'Restaurant/bar', points: penalty });
  }

  // === BONUSES ===

  // Specialty keywords in name
  const matchedSpecialty = specialtyKeywords.find(kw => nameLower.includes(kw));
  if (matchedSpecialty) {
    const bonus = config.specialtyKeywords || 20;
    score += bonus;
    reasons.push({ label: 'Specialty keyword', points: bonus });
  }

  // Roaster keywords in name
  const matchedRoaster = roasterKeywords.find(kw => nameLower.includes(kw));
  if (matchedRoaster && !matchedSpecialty) {
    const bonus = config.roaster || 10;
    score += bonus;
    reasons.push({ label: 'Roaster', points: bonus });
  }

  // OSM tag bonuses
  if (osmTags) {
    if (osmTags.website || osmTags['contact:website']) {
      const bonus = config.website || 5;
      score += bonus;
      reasons.push({ label: 'Has website', points: bonus });
    }

    if (osmTags.opening_hours) {
      const bonus = config.openingHours || 3;
      score += bonus;
      reasons.push({ label: 'Opening hours listed', points: bonus });
    }

    if (osmTags.internet_access === 'wlan' || osmTags.internet_access === 'yes') {
      const bonus = config.wifiAccess || 2;
      score += bonus;
      reasons.push({ label: 'WiFi available', points: bonus });
    }
  }

  // Build explanation
  const finalScore = Math.max(0, Math.min(100, score));
  const placeType = classifyPlace(osmTags, cafeName);
  const confidence = computeConfidence(osmTags);

  let explanation;

  if (reasons.length === 0) {
    explanation = 'Standard cafe';
  } else if (finalScore >= 60) {
    explanation = reasons.filter(r => r.points > 0).map(r => r.label).join(', ') || 'Looks promising';
  } else if (finalScore <= 30) {
    explanation = reasons.filter(r => r.points < 0).map(r => r.label).join(', ') || 'Likely generic';
  } else {
    explanation = reasons.slice(0, 2).map(r => r.label).join(', ') || 'Mixed signals';
  }

  return { score: finalScore, explanation, reasons, placeType, confidence };
}
