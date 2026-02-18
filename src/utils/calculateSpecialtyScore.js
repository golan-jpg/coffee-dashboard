/**
 * Calculates a specialty score for a cafe based on its name and OSM tags.
 *
 * @param {string} cafeName - The name of the cafe
 * @param {Object} osmTags - OpenStreetMap tags object
 * @returns {{ score: number, explanation: string }} Score (0-100) and explanation
 */
export function calculateSpecialtyScore(cafeName, osmTags) {
  let score = 50; // Start at neutral
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

  // Specialty indicators (bonus)
  const specialtyKeywords = [
    'specialty', 'speciality', 'artisan', 'roaster', 'roastery', 'craft',
    'micro-roast', 'third wave', 'single origin', 'pour over', 'filter bar',
    'coffee lab', 'kaffeelabor', 'torrefazione'
  ];

  const premiumKeywords = [
    'espresso bar', 'barista', 'brew bar', 'coffee collective',
    'coffee roasters', 'kaffeerösterei'
  ];

  // === PENALTIES ===

  // Chain detection (name or brand tag)
  const isChain = chains.some(chain => nameLower.includes(chain) || brand.includes(chain));
  if (isChain) {
    score -= 40;
    reasons.push('Chain cafe');
  } else if (osmTags?.brand) {
    score -= 20;
    reasons.push('Branded');
  }

  // Generic name only (e.g., just "Cafe" or "Coffee Shop")
  const isGenericOnly = genericNames.some(g => nameLower === g || nameLower === `the ${g}`);
  if (isGenericOnly) {
    score -= 15;
    reasons.push('Generic name');
  }

  // === BONUSES ===

  // Specialty keywords in name
  const matchedSpecialty = specialtyKeywords.find(kw => nameLower.includes(kw));
  if (matchedSpecialty) {
    score += 20;
    reasons.push('Specialty keyword');
  }

  // Premium keywords in name
  const matchedPremium = premiumKeywords.find(kw => nameLower.includes(kw));
  if (matchedPremium && !matchedSpecialty) {
    score += 10;
    reasons.push('Premium keyword');
  }

  // OSM tag bonuses
  if (osmTags) {
    if (osmTags.cuisine === 'coffee_shop' || osmTags.cuisine === 'coffee') {
      score += 10;
      reasons.push('Coffee-focused');
    }

    if (osmTags.website || osmTags['contact:website']) {
      score += 5;
      reasons.push('Has website');
    }

    if (osmTags.opening_hours) {
      score += 3;
    }

    if (osmTags.outdoor_seating === 'yes') {
      score += 3;
    }

    if (osmTags.internet_access === 'wlan' || osmTags.internet_access === 'yes') {
      score += 2;
    }

    // Detailed OSM data suggests enthusiast-maintained listing
    const detailCount = [
      osmTags.wheelchair,
      osmTags['payment:credit_cards'],
      osmTags.phone || osmTags['contact:phone'],
      osmTags.description
    ].filter(Boolean).length;

    if (detailCount >= 3) {
      score += 5;
      reasons.push('Well-documented');
    }
  }

  // Build explanation
  const finalScore = Math.max(0, Math.min(100, score));
  let explanation;

  if (reasons.length === 0) {
    explanation = 'Standard cafe';
  } else if (finalScore >= 60) {
    explanation = reasons.filter(r => !r.includes('Chain') && !r.includes('Generic')).join(', ') || 'Looks promising';
  } else if (finalScore <= 30) {
    explanation = reasons.filter(r => r.includes('Chain') || r.includes('Branded') || r.includes('Generic')).join(', ') || 'Likely generic';
  } else {
    explanation = reasons.slice(0, 2).join(', ') || 'Mixed signals';
  }

  return { score: finalScore, explanation };
}
