// All imports must be at the very top of the file
import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import userRatingsBackup from "./data/userRatings-backup.json";
import { CircleMarker, MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { MapClickHandler } from "./MapClickHandler";
import placeOverridesData from "./data/placeOverrides.json";
import seededCitiesMetaData from "./data/seededCitiesMeta.json";
import {
  DEFAULT_CITY_ZOOM,
  PIN_FLY_TO_MIN_ZOOM,
  FIT_BOUNDS_PADDING,
  CITY_FILTER_RADIUS_KM,
  LAST_RESORT_RADIUS_MULTIPLIER,
  getCityOverpassRadiusMeters,
} from "./constants/map";
import {
  calculateSpecialtyScore,
  SCORING_PRESETS,
  DEFAULT_WEIGHT_KEYS,
} from "./utils/calculateSpecialtyScore";

import { useManualPlaces } from "./hooks/useManualPlaces";
import { usePlaceOverrides } from "./hooks/usePlaceOverrides";
import { geocodeAddress } from "./utils/geocodeAddress";

import AdvancedScoringPanel from "./components/AdvancedScoringPanel";
// Check if a Google Lists place is coffee-related by name
const sidebarRef = typeof window !== 'undefined' ? (window.__sidebarRef = window.__sidebarRef || { current: null }) : { current: null };
const coffeeKeywords = [
  "coffee", "cafe", "café", "cafè", "caffè", "espresso", "roaster", "roastery",
  "specialty", "barista",
  "קפה", "בית קפה", "אספרסו", "קלייה", "רוסטר",
];

const strictCoffeeKeywords = [
  "coffee", "cafe", "café", "cafè", "caffè", "espresso", "coffee shop",
  "kaffee", "kafe", "קפה", "בית קפה", "אספרסו",
];

// Negative keywords to exclude restaurants/bars/food places
const negativeKeywords = [
  "restaurant", "bistro", "grill", "sushi", "pizza", "bar", "pub",
  "eatery", "kitchen", "diner", "burger", "burgers",
  "bubble", "bubble tea", "bubble_tea", "boba", "tea house", "dessert", "ice cream",
  "gelato", "frozen yogurt", "yogurt", "mochi", "waffle", "crepe", "donut",
  "מסעדה", "בר", "פיצה", "סושי", "גריל", "המבורגר",
];

// Bakery keywords
const bakeryKeywords = [
  "bakery", "patisserie", "pastry", "boulangerie", "viennoiserie", "croissant",
  "מאפיה", "מאפייה", "קונדיטוריה", "פטיסרי", "מאפים",
];

const defaultExplicitNonCoffeeKeywords = [
  "roladin",
  "רולדין",
  "maafe neeman",
  "מאפה נאמן",
  "greg patisserie",
  "גרג קונדיטוריה",
  "hadasa patisserie",
  "קונדיטוריה",
  "bubble tea",
  "bubble_tea",
  "bubble",
  "boba",
  "dessert",
  "ice cream",
  "ice_cream",
  "gelato",
  "frozen yogurt",
  "frozen_yogurt",
  "tea house",
  "teahouse",
  "mochi",
  "yogurt bar",
  "bubbleteacup",
  "square bubbles",
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
  return String(value || "").trim().toLowerCase();
}

function normalizeKeywords(list, fallback) {
  if (!Array.isArray(list)) return fallback;

  const normalized = list
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}

const explicitNonCoffeeKeywords = normalizeKeywords(
  placeOverridesData?.explicitNonCoffeeKeywords,
  defaultExplicitNonCoffeeKeywords
);

const explicitCoffeeAllowKeywords = normalizeKeywords(
  placeOverridesData?.explicitCoffeeAllowKeywords,
  defaultExplicitCoffeeAllowKeywords
);

const citySpecificOverrides = Object.entries(placeOverridesData?.byCity || {}).reduce((acc, [cityName, config]) => {
  const cityKey = normalizeCityKey(cityName);
  if (!cityKey) return acc;

  const aliases = normalizeKeywords(config?.aliases, []);
  acc[cityKey] = {
    explicitNonCoffeeKeywords: normalizeKeywords(config?.explicitNonCoffeeKeywords, []),
    explicitCoffeeAllowKeywords: normalizeKeywords(config?.explicitCoffeeAllowKeywords, []),
    aliases,
  };

  return acc;
}, {});

function getOverridesForCity(cityName) {
  const cityKey = normalizeCityKey(cityName);
  const cityOverrides = citySpecificOverrides[cityKey];

  if (!cityOverrides) {
    return {
      explicitNonCoffeeKeywords,
      explicitCoffeeAllowKeywords,
    };
  }

  return {
    explicitNonCoffeeKeywords: Array.from(
      new Set([...explicitNonCoffeeKeywords, ...cityOverrides.explicitNonCoffeeKeywords])
    ),
    explicitCoffeeAllowKeywords: Array.from(
      new Set([...explicitCoffeeAllowKeywords, ...cityOverrides.explicitCoffeeAllowKeywords])
    ),
  };
}

function isExplicitlyExcludedPlace(place, cityName) {
  const text = [place.name, place.address, place.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const { explicitNonCoffeeKeywords: nonCoffeeKeywords } = getOverridesForCity(cityName);

  return nonCoffeeKeywords.some((keyword) => text.includes(keyword));
}

const EUROPEAN_COUNTRIES = new Set([
  "Austria",
  "Belarus",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Cyprus",
  "Czech Republic",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Georgia",
  "Germany",
  "Greece",
  "Hungary",
  "Ireland",
  "Italy",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Moldova",
  "Netherlands",
  "North Macedonia",
  "Norway",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Spain",
  "Sweden",
  "Switzerland",
  "Turkey",
  "Ukraine",
  "United Kingdom",
]);

const EUROPE_CHAIN_EXCLUSION_KEYWORDS = [
  "starbucks",
  "costa",
  "costa coffee",
  "joe & juice",
  "joe & the juice",
  "joe and the juice",
  "caffe nero",
  "caffè nero",
  "cafe nero",
];

function isEuropeanCity(cityName) {
  return EUROPEAN_COUNTRIES.has(getCountryForCity(cityName));
}

function getExplicitExclusionKeyword(place, cityName) {
  const text = [place.name, place.address, place.description, place.brand, place.operator, place.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const { explicitNonCoffeeKeywords: nonCoffeeKeywords } = getOverridesForCity(cityName);

  if (isEuropeanCity(cityName)) {
    const europeanChainKeyword = EUROPE_CHAIN_EXCLUSION_KEYWORDS.find((keyword) => text.includes(keyword));
    if (europeanChainKeyword) return europeanChainKeyword;
  }

  return nonCoffeeKeywords.find((keyword) => text.includes(keyword)) || null;
}

function isExplicitlyAllowedCoffeePlace(place, cityName) {
  const text = [place.name, place.address, place.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const { explicitCoffeeAllowKeywords: coffeeAllowKeywords } = getOverridesForCity(cityName);

  return coffeeAllowKeywords.some((keyword) => text.includes(keyword));
}

const CITY_LOCKED_PLACE_RULES = [
  {
    keywords: ["cafelix shlomo hamelech", "קפליקס שלמה המלך"],
    allowedCity: "Tel Aviv",
  },
];

// Cities treated as one combined area (nearest-city logic merges them)
const CITY_GROUPS = [
  { primary: "Ramat Gan", members: ["Givatayim"] },
];

function getCityGroupNames(cityName) {
  for (const group of CITY_GROUPS) {
    if (group.primary === cityName || group.members.includes(cityName)) {
      return [group.primary, ...group.members];
    }
  }
  return [cityName];
}

function isPlaceCityLockedOut(place, selectedCityName) {
  const selectedCityKey = normalizeCityKey(selectedCityName);
  const text = [place?.name, place?.address, place?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return CITY_LOCKED_PLACE_RULES.some((rule) => {
    const isMatch = rule.keywords.some((keyword) => text.includes(keyword));
    if (!isMatch) return false;
    return normalizeCityKey(rule.allowedCity) !== selectedCityKey;
  });
}

function getCityAliases(cityName) {
  const cityKey = normalizeCityKey(cityName);
  const configuredAliases = citySpecificOverrides[cityKey]?.aliases || [];
  const fallbackAlias = String(cityName || "").trim().toLowerCase();

  return Array.from(new Set([fallbackAlias, ...configuredAliases].filter(Boolean)));
}

function hasConflictingCityMention(place, selectedCityName) {
  const text = [place?.name, place?.address, place?.description, place?.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!text) return false;

  const selectedCityKey = normalizeCityKey(selectedCityName);
  const selectedAliases = getCityAliases(selectedCityName);
  const mentionsSelectedCity = selectedAliases.some((alias) => text.includes(alias));

  return Object.entries(citySpecificOverrides).some(([cityKey, config]) => {
    if (cityKey === selectedCityKey) return false;
    const aliases = config?.aliases || [];
    if (aliases.length === 0) return false;
    const mentionsOtherCity = aliases.some((alias) => text.includes(alias));
    if (!mentionsOtherCity) return false;
    return !mentionsSelectedCity;
  });
}

function matchesSelectedCityScope(place, selectedCityName) {
  return !isPlaceCityLockedOut(place, selectedCityName)
    && !hasConflictingCityMention(place, selectedCityName);
}

function getPlaceScopeText(place) {
  return [place?.name, place?.address, place?.description, place?.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getMentionedCityName(place, candidateCities) {
  const text = getPlaceScopeText(place);
  if (!text) return null;

  for (const city of candidateCities) {
    const aliases = getCityAliases(city?.name);
    if (aliases.some((alias) => text.includes(alias))) {
      return city.name;
    }
  }

  return null;
}

function getNearestCandidateCityName(place, candidateCities) {
  const coords = getFiniteLatLon(place);
  if (!coords || !Array.isArray(candidateCities) || candidateCities.length === 0) return null;

  let nearest = null;
  for (const city of candidateCities) {
    if (!Number.isFinite(city?.lat) || !Number.isFinite(city?.lon)) continue;
    const distanceKm = haversineKm(coords.lat, coords.lon, city.lat, city.lon);
    if (!Number.isFinite(distanceKm)) continue;
    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = { name: city.name, distanceKm };
    }
  }

  return nearest?.name || null;
}

function isPlaceInSelectedCityScope(place, selectedCity, candidateCities) {
  if (!matchesSelectedCityScope(place, selectedCity?.name)) return false;

  const groupNames = getCityGroupNames(selectedCity?.name);

  const mentionedCityName = getMentionedCityName(place, candidateCities);
  if (mentionedCityName) {
    return groupNames.includes(mentionedCityName);
  }

  const nearestCityName = getNearestCandidateCityName(place, candidateCities);
  if (nearestCityName) {
    return groupNames.includes(nearestCityName);
  }

  return true;
}

function isLikelyOffshoreOutlier(place, selectedCity) {
  if (!selectedCity?.name) return false;

  const coords = getFiniteLatLon(place, selectedCity);
  if (!coords) return false;

  if (selectedCity.name === "Tel Aviv") {
    const estimatedCoastLon = 34.742 + (coords.lat - 32.02) * 0.35;
    return coords.lon < (estimatedCoastLon - 0.0015);
  }

  return false;
}

function isCoffeePlace(place) {
  const text = [place.name, place.address, place.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return coffeeKeywords.some((kw) => text.includes(kw));
}

function isStrictCoffeePlace(place) {
  const text = [place.name, place.address, place.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return strictCoffeeKeywords.some((keyword) => text.includes(keyword));
}

function isRestaurantOrBar(place) {
  const text = [place.name, place.address, place.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return negativeKeywords.some((kw) => text.includes(kw));
}

function isBakeryPlace(place) {
  const text = [
    place.name,
    place.address,
    place.description,
  ].filter(Boolean).join(" ").toLowerCase();

  return bakeryKeywords.some(k => text.includes(k));
}

function getStrictOsmCoffeeDecision(place, cityName) {
  if (isExplicitlyAllowedCoffeePlace(place, cityName)) {
    return { included: true, reason: "explicit allowlist" };
  }
  if (isExplicitlyExcludedPlace(place, cityName)) {
    return { included: false, reason: "explicit non-coffee keyword" };
  }

  const tags = place?.osmTags || {};
  const amenity = String(tags.amenity || "").toLowerCase();
  const shop = String(tags.shop || "").toLowerCase();
  const cuisine = String(tags.cuisine || place?.cuisine || "").toLowerCase();

  const text = [
    place?.name,
    place?.address,
    place?.description,
    cuisine,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const hasCoffeeKeyword = strictCoffeeKeywords.some((kw) => text.includes(kw));
  const hasShopCoffee = shop === "coffee";
  const hasCoffeeCuisine = ["coffee", "coffee_shop", "espresso", "קפה", "אספרסו"].some((kw) =>
    cuisine.includes(kw)
  );

  const hasNonCoffeeSignal = [
    ...negativeKeywords,
    ...bakeryKeywords,
    "bubble_tea",
    "bubble tea",
    "boba",
    "dessert",
    "ice_cream",
    "ice cream",
    "gelato",
    "frozen_yogurt",
    "frozen yogurt",
    "tea house",
    "teahouse",
    "mochi",
  ].some((kw) => text.includes(kw));

  if (hasNonCoffeeSignal) {
    return { included: false, reason: "non-coffee signal (dessert/boba/food)" };
  }

  if (!(hasShopCoffee || hasCoffeeCuisine || hasCoffeeKeyword)) {
    return { included: false, reason: "missing strong coffee signal" };
  }

  if (!(amenity === "cafe" || amenity === "coffee" || hasShopCoffee)) {
    return { included: false, reason: "type is not cafe/coffee" };
  }

  return { included: true, reason: "strict coffee match" };
}

function isStrictOsmCoffeePlace(place, cityName) {
  return getStrictOsmCoffeeDecision(place, cityName).included;
}

function getGooglePlaceDecision(place, googleFilterMode, selectedCityName) {
  if (isExplicitlyExcludedPlace(place, selectedCityName)) {
    return { included: false, reason: "explicit non-coffee keyword" };
  }

  if (isExplicitlyAllowedCoffeePlace(place, selectedCityName)) {
    return { included: true, reason: "explicit allowlist" };
  }

  if (!isStrictCoffeePlace(place)) {
    return { included: false, reason: "missing strict coffee/cafe keyword" };
  }

  const isCoffee = isCoffeePlace(place);
  const isBakery = isBakeryPlace(place);
  const isFood = isRestaurantOrBar(place);

  if (isFood) {
    return { included: false, reason: "food/bar/dessert keyword" };
  }

  if (googleFilterMode === "all") {
    return { included: true, reason: "all mode" };
  }

  if (googleFilterMode === "coffeeOnly") {
    return isCoffee
      ? { included: true, reason: "coffeeOnly match" }
      : { included: false, reason: "not classified as coffee" };
  }

  return (isCoffee || isBakery)
    ? { included: true, reason: "coffee/bakery match" }
    : { included: false, reason: "not coffee/bakery" };
}

// Haversine distance in KM
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function filterGooglePlacesByModeAndCity(places, googleFilterMode, selectedCity, cityRadiusKm, candidateCities = []) {
  const nearCity = (place) =>
    typeof place.lat === "number" &&
    typeof place.lon === "number" &&
    haversineKm(selectedCity.lat, selectedCity.lon, place.lat, place.lon) <= cityRadiusKm;

  const keywordFiltered = places.filter((place) => {
    if (!isPlaceInSelectedCityScope(place, selectedCity, candidateCities)) return false;
    const decision = getGooglePlaceDecision(place, googleFilterMode, selectedCity.name);
    return decision.included;
  });

  const nearby = keywordFiltered.filter(nearCity);
  return nearby;
}

const REVERSE_GEOCODE_CACHE_KEY = "reverseGeocodeAddressCache.v1";

function normalizeAddressText(value) {
  return String(value || "")
    .replace(/^[\s\u200e\u200f\u202a-\u202e]+/, "")
    .trim();
}

function extractPlaceAddress(place) {
  return normalizeAddressText(
    place?.address
      || place?.formattedAddress
      || place?.formatted_address
      || place?.vicinity
      || ""
  );
}

async function reverseGeocodeLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";

  try {
    const response = await fetch(
      `/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
    );

    if (!response.ok) return "";
    const payload = await response.json();
    return normalizeAddressText(payload?.display_name || "");
  } catch {
    return "";
  }
}

function flattenGoogleListsData(data) {
  const lists = Array.isArray(data?.lists) ? data.lists : [];
  return lists.flatMap((list, listIdx) =>
    (Array.isArray(list?.places) ? list.places : []).map((place, placeIdx) => {
      const coords = getFiniteLatLon(place) || { lat: null, lon: null };

      return {
        id: `google-${listIdx}-${placeIdx}`,
        name: place.name,
        lat: coords.lat,
        lon: coords.lon,
        address: extractPlaceAddress(place),
        googleMapsUrl: place.googleMapsUrl,
        source: "google",
      };
    })
  );
}

// Fix for default marker icons in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Custom round marker with coffee SVG icon, color by type
function getCafeDivIcon({ size = 38, beanColor = '#4B2E13' } = {}) {
  // Map pin with coffee bean, brown or red bean for top score
  return L.divIcon({
    className: 'custom-cafe-marker',
    iconSize: [size, size],
    iconAnchor: [size/2, size-4],
    popupAnchor: [0, -size/2],
    html: `
      <svg width="38" height="46" viewBox="0 0 38 46" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">
        <path d="M19 44C19 44 34 32.5 34 19C34 9.61116 27.3888 3 19 3C10.6112 3 4 9.61116 4 19C4 32.5 19 44 19 44Z" fill="#fff" stroke="#4B2E13" stroke-width="2.5"/>
        <ellipse cx="19" cy="19" rx="11" ry="11" fill="${beanColor}"/>
        <path d="M15.5 10C18 18 20 26 22.5 28" stroke="#fff" stroke-width="2" fill="none"/>
        <ellipse cx="19" cy="44.5" rx="10" ry="2" fill="#222" fill-opacity="0.18"/>
      </svg>
    `
  });
}

const specialtyIcon = getCafeDivIcon();
const googleIcon = getCafeDivIcon();
const defaultIcon = getCafeDivIcon();
const topScoreIcon = getCafeDivIcon({ beanColor: '#e11d48' }); // red bean for top score

const defaultCityCenters = {
  "Berlin": { lat: 52.52, lon: 13.405 },
  "Tel Aviv": { lat: 32.0853, lon: 34.7818 },
  "Jerusalem": { lat: 31.7804, lon: 35.2240 },
  "Haifa": { lat: 32.7940, lon: 34.9896 },
  "Ramat Gan": { lat: 32.0827, lon: 34.8020 },
  "Ra'anana": { lat: 32.1976, lon: 34.8711 },
  "Paris": { lat: 48.8566, lon: 2.3522 },
  "Amsterdam": { lat: 52.3676, lon: 4.9041 },
  "Copenhagen": { lat: 55.6761, lon: 12.5683 },
  "Barcelona": { lat: 41.3874, lon: 2.1686 },
  "Madrid": { lat: 40.4168, lon: -3.7038 },
  "Lisbon": { lat: 38.7223, lon: -9.1393 },
  "Porto": { lat: 41.1579, lon: -8.6291 },
  "London": { lat: 51.5074, lon: -0.1278 },
  "Rome": { lat: 41.9028, lon: 12.4964 },
  "Vienna": { lat: 48.2082, lon: 16.3738 },
  "Prague": { lat: 50.0755, lon: 14.4378 },
  "New York": { lat: 40.7128, lon: -74.0060 },
};

const COUNTRY_BY_CITY = {
  "Aarhus": "Denmark",
  "Amsterdam": "Netherlands",
  "Ankara": "Turkey",
  "Antwerp": "Belgium",
  "Athens": "Greece",
  "Banskabystrica": "Slovakia",
  "Barcelona": "Spain",
  "Belgrade": "Serbia",
  "Berlin": "Germany",
  "Bern": "Switzerland",
  "Brasov": "Romania",
  "Bratislava": "Slovakia",
  "Brno": "Czech Republic",
  "Brussels": "Belgium",
  "Bucharest": "Romania",
  "Budapest": "Hungary",
  "Chisinau Moldova": "Moldova",
  "Cluj Napoca": "Romania",
  "Cologne": "Germany",
  "Copenhagen": "Denmark",
  "Cork": "Ireland",
  "Dublin": "Ireland",
  "Edinburgh": "United Kingdom",
  "Florence": "Italy",
  "Geneva": "Switzerland",
  "Ghent": "Belgium",
  "Glasgow": "United Kingdom",
  "Gothenburg": "Sweden",
  "Haifa": "Israel",
  "Hamburg": "Germany",
  "Helsinki": "Finland",
  "Istanbul": "Turkey",
  "Jerusalem": "Israel",
  "Kharkiv": "Ukraine",
  "Kosice": "Slovakia",
  "Krakow": "Poland",
  "Kyiv": "Ukraine",
  "Lausanne": "Switzerland",
  "Leuven": "Belgium",
  "Limassol Cyprus": "Cyprus",
  "Lisbon": "Portugal",
  "Ljubljana": "Slovenia",
  "London": "United Kingdom",
  "Lviv": "Ukraine",
  "Luxembourg City": "Luxembourg",
  "Lyon": "France",
  "Madrid": "Spain",
  "Malmo": "Sweden",
  "Manchester": "United Kingdom",
  "Marseille": "France",
  "Milan": "Italy",
  "Minsk": "Belarus",
  "Munich": "Germany",
  "New York": "United States",
  "Nice": "France",
  "Nicosia": "Cyprus",
  "Olomouc": "Czech Republic",
  "Oslo": "Norway",
  "Palma": "Spain",
  "Paris": "France",
  "Poznan": "Poland",
  "Prague": "Czech Republic",
  "Presov": "Slovakia",
  "Ra'anana": "Israel",
  "Ramat Gan": "Israel",
  "Riga": "Latvia",
  "Rome": "Italy",
  "Rotterdam": "Netherlands",
  "Salzburg": "Austria",
  "Skopje Northmacedonia": "North Macedonia",
  "Sofia": "Bulgaria",
  "Split": "Croatia",
  "Stockholm": "Sweden",
  "Tallinn": "Estonia",
  "Tel Aviv": "Israel",
  "The Hague": "Netherlands",
  "Thessaloniki": "Greece",
  "Tbilisi": "Georgia",
  "Timisoara": "Romania",
  "Torino": "Italy",
  "Utrecht": "Netherlands",
  "Valencia": "Spain",
  "Varna Bulgaria": "Bulgaria",
  "Vienna": "Austria",
  "Vilnius": "Lithuania",
  "Warsaw": "Poland",
  "Wroclaw": "Poland",
  "Zagreb": "Croatia",
  "Zurich": "Switzerland",
};

function getCountryForCity(cityName) {
  return COUNTRY_BY_CITY[cityName] || "Other";
}

const SEEDED_CITY_LOADERS = import.meta.glob("./data/seeded-cities/*.json");
const SEEDED_META_CITIES = Array.isArray(seededCitiesMetaData?.cities)
  ? seededCitiesMetaData.cities
  : [];

function buildCities(metaCities) {
  const metaCenterByName = new Map(
    metaCities
      .filter((item) => item && typeof item.name === "string")
      .map((item) => [item.name, { lat: Number(item.lat), lon: Number(item.lon) }])
  );

  return Array.from(
    new Set([
      ...Object.keys(defaultCityCenters),
      ...Array.from(metaCenterByName.keys()),
    ])
  )
    .map((cityName) => {
      const center = defaultCityCenters[cityName] || metaCenterByName.get(cityName);
      if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return null;
      return { name: cityName, lat: center.lat, lon: center.lon };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getInitialCityFromStorage(cities) {
  const preferredDefault = cities.find((city) => city.name === "Tel Aviv") || cities[0];
  const savedCity = localStorage.getItem("selectedCityName");
  return cities.find((city) => city.name === savedCity) || preferredDefault;
}

// Keywords that suggest specialty coffee
const specialtyKeywords = [
  "specialty", "speciality", "third wave", "artisan", "roaster", "roastery",
  "micro", "single origin", "pour over", "filter", "craft", "independent",
  "espresso bar", "coffee lab", "coffee collective", "the barn", "five elephant",
  "bonanza", "father carpenter", "lot sixty one", "coffee district", "satan's coffee",
];

function isSpecialtyCoffee(cafe) {
  const searchText = [
    cafe.name,
    cafe.cuisine,
    cafe.description,
    cafe.brand,
    cafe.operator,
  ].filter(Boolean).join(" ").toLowerCase();

  return specialtyKeywords.some(keyword => searchText.includes(keyword));
}

// Basic opening_hours parser (minimal): supports '24/7', 'Mo-Su hh:mm-hh:mm' and simple ranges like 'Mo-Fr 08:00-18:00'
function isOpenNow(opening_hours) {
  if (!opening_hours) return null; // unknown
  const now = new Date();
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const hh = now.getHours();
  const mm = now.getMinutes();
  const minutesNow = hh * 60 + mm;

  const s = opening_hours.toLowerCase();
  if (s.includes('24/7') || s.includes('24h') || s.includes('24 hours')) return true;

  // parse patterns like 'mo-fr 08:00-18:00' or 'mo-su 07:00-22:00'
  const parts = s.split(';').map(p => p.trim());
  for (const p of parts) {
    const m = p.match(/([a-z]{2})(?:-([a-z]{2}))?\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/i);
    if (m) {
      const startDay = m[1];
      const endDay = m[2] || m[1];
      const startTime = m[3];
      const endTime = m[4];

      const dayMap = { su:0, mo:1, tu:2, we:3, th:4, fr:5, sa:6 };
      const sd = dayMap[startDay.substring(0,2)];
      const ed = dayMap[endDay.substring(0,2)];
      if (sd == null || ed == null) continue;

      // check if today is in range (handles wrap)
      let inDayRange = false;
      if (sd <= ed) {
        inDayRange = day >= sd && day <= ed;
      } else {
        inDayRange = day >= sd || day <= ed;
      }
      if (!inDayRange) continue;

      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;

      if (startMinutes <= endMinutes) {
        if (minutesNow >= startMinutes && minutesNow <= endMinutes) return true;
      } else {
        // overnight range
        if (minutesNow >= startMinutes || minutesNow <= endMinutes) return true;
      }
    }
  }

  return false;
}

function getPlaceOpenNowStatus(place) {
  if (place?.source === "google") return null;
  if (!place?.opening_hours) return null;
  return isOpenNow(place.opening_hours);
}

function sortPlacesByLiveStatus(places) {
  return places
    .map((place, index) => ({ place, index }))
    .sort((a, b) => {
      const aStatus = getPlaceOpenNowStatus(a.place);
      const bStatus = getPlaceOpenNowStatus(b.place);

      const rank = (status) => (status === true ? 0 : status === null ? 1 : 2);
      const rankDiff = rank(aStatus) - rank(bStatus);
      if (rankDiff !== 0) return rankDiff;

      return a.index - b.index;
    })
    .map(({ place }) => place);
}

const OSM_CACHE_STORAGE_KEY = "scf_osm_cache_v1";
const OSM_CACHE_TTL_MS = 30 * 60 * 1000;
const UI_STATE_VERSION_KEY = "scf_ui_state_version";
const UI_STATE_VERSION = "5";
const DATA_MODES = ["google", "osm", "combined"];
const GOOGLE_FILTER_MODES = ["coffeeOnly", "coffeeAndBakery", "all"];

const UI_STATE_RESET_KEYS = [
  "selectedCityName",
  "selectedCountry",
  "dataMode",
  "googleFilterMode",
  "searchQuery",
  "filterOpenNow",
  "filterHasWebsite",
  "filterWifi",
  "filterNoInfo",
];

function loadBackupSnapshotData(storageKey, fallback) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    return parsed.data;
  } catch {
    return fallback;
  }
}

function mergeRatingsMaps(primary, secondary) {
  const a = primary && typeof primary === "object" && !Array.isArray(primary) ? primary : {};
  const b = secondary && typeof secondary === "object" && !Array.isArray(secondary) ? secondary : {};
  const merged = { ...a };

  Object.entries(b).forEach(([id, value]) => {
    const current = Number(merged[id] || 0);
    const incoming = Number(value || 0);
    if (incoming > current) {
      merged[id] = incoming;
    }
  });

  return merged;
}

function loadOsmCache() {
  try {
    const raw = localStorage.getItem(OSM_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistOsmCache(cache) {
  try {
    localStorage.setItem(OSM_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota / serialization errors
  }
}

// Per-session + persisted OSM cache keyed by city name: { [city]: { ts, data } }
const osmCache = loadOsmCache();

function getCachedOsm(cityName) {
  const entry = osmCache[cityName];
  if (!entry || typeof entry.ts !== "number") return null;
  if (Date.now() - entry.ts > OSM_CACHE_TTL_MS) {
    delete osmCache[cityName];
    persistOsmCache(osmCache);
    return null;
  }

  if (Array.isArray(entry.data)) {
    return { places: entry.data, unnamedFilteredCount: 0 };
  }

  if (entry.data && Array.isArray(entry.data.places)) {
    return {
      places: entry.data.places,
      unnamedFilteredCount: Number(entry.data.unnamedFilteredCount) || 0,
    };
  }

  return null;
}

function setCachedOsm(cityName, data) {
  osmCache[cityName] = { ts: Date.now(), data };
  persistOsmCache(osmCache);
}


// Display name overrides for city names in UI
const CITY_DISPLAY_NAMES = {
  "Ramat Gan": "Ramat Gan-Givataim",
};

function getDisplayCityName(cityName) {
  return CITY_DISPLAY_NAMES[cityName] || cityName;
}

function getCityFilterRadiusKm(cityName) {
  const overpassKm = Math.max(1, getCityOverpassRadiusMeters(cityName) / 1000);
  // Use overpass radius directly, min 3.5km for small cities
  return Math.min(CITY_FILTER_RADIUS_KM, Math.max(3.5, overpassKm));
}

const loggedSwappedCoordinatePlaceIds = new Set();
const swappedCoordinateListeners = new Set();

function subscribeSwappedCoordinateEvents(listener) {
  if (typeof listener !== "function") return () => {};
  swappedCoordinateListeners.add(listener);
  return () => {
    swappedCoordinateListeners.delete(listener);
  };
}

function notifySwappedCoordinate(place, selectedCity, finalCoords) {
  const payload = {
    id: place?.id || null,
    name: place?.name || null,
    city: selectedCity?.name || null,
    finalLat: finalCoords?.lat ?? null,
    finalLon: finalCoords?.lon ?? null,
    total: loggedSwappedCoordinatePlaceIds.size,
  };

  swappedCoordinateListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
      // ignore debug-listener failures
    }
  });
}

function parseNumericCoordinate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLatLonPair(lat, lon, selectedCity) {
  const directValid = Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const swappedValid = Math.abs(lon) <= 90 && Math.abs(lat) <= 180;

  if (!directValid && !swappedValid) return null;

  if (selectedCity && directValid && swappedValid) {
    const directDistance = haversineKm(selectedCity.lat, selectedCity.lon, lat, lon);
    const swappedDistance = haversineKm(selectedCity.lat, selectedCity.lon, lon, lat);

    if (Number.isFinite(swappedDistance) && Number.isFinite(directDistance) && swappedDistance + 0.2 < directDistance) {
      return { lat: lon, lon: lat, swapped: true };
    }

    return { lat, lon, swapped: false };
  }

  if (directValid) return { lat, lon, swapped: false };
  if (swappedValid) return { lat: lon, lon: lat, swapped: true };
  return null;
}

function getFiniteLatLon(place, selectedCity = null) {
  const latCandidates = [
    place?.lat,
    place?.latitude,
    place?.coords?.lat,
    place?.location?.lat,
  ]
    .map(parseNumericCoordinate)
    .filter((value) => value !== null);

  const lonCandidates = [
    place?.lon,
    place?.lng,
    place?.longitude,
    place?.coords?.lon,
    place?.coords?.lng,
    place?.location?.lon,
    place?.location?.lng,
  ]
    .map(parseNumericCoordinate)
    .filter((value) => value !== null);

  if (latCandidates.length === 0 || lonCandidates.length === 0) return null;

  let best = null;

  for (let latIndex = 0; latIndex < latCandidates.length; latIndex += 1) {
    for (let lonIndex = 0; lonIndex < lonCandidates.length; lonIndex += 1) {
      const normalized = normalizeLatLonPair(latCandidates[latIndex], lonCandidates[lonIndex], selectedCity);
      if (!normalized) continue;

      const priorityPenalty = latIndex * 0.001 + lonIndex * 0.001;
      const distanceScore = selectedCity
        ? haversineKm(selectedCity.lat, selectedCity.lon, normalized.lat, normalized.lon)
        : 0;
      const score = (Number.isFinite(distanceScore) ? distanceScore : Number.MAX_SAFE_INTEGER) + priorityPenalty;

      if (!best || score < best.score) {
        best = { ...normalized, score };
      }
    }
  }

  if (!best) return null;

  if (import.meta.env.DEV && best.swapped) {
    const placeKey = String(place?.id || `${place?.name || "unknown"}:${best.lat.toFixed(5)}:${best.lon.toFixed(5)}`);
    if (!loggedSwappedCoordinatePlaceIds.has(placeKey)) {
      loggedSwappedCoordinatePlaceIds.add(placeKey);
      const payload = {
        id: place?.id || null,
        name: place?.name || null,
        city: selectedCity?.name || null,
        finalLat: best.lat,
        finalLon: best.lon,
      };
      console.warn("[coords] swapped lat/lon", payload);
      notifySwappedCoordinate(place, selectedCity, best);
    }
  }

  return { lat: best.lat, lon: best.lon };
}

function isPlaceWithinCityRadius(place, selectedCity, radiusKm = CITY_FILTER_RADIUS_KM) {
  const coords = getFiniteLatLon(place, selectedCity);
  if (!coords || !selectedCity) return false;
  return haversineKm(selectedCity.lat, selectedCity.lon, coords.lat, coords.lon) <= radiusKm;
}

function getPlaceDirectLink(place) {
  if (place?.googleMapsUrl) return place.googleMapsUrl;

  const placeQuery = [place?.name, place?.address]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  if (placeQuery) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeQuery)}`;
  }

  return "";
}

function formatDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) return "";
  if (distanceKm < 1) return `${Math.max(1, Math.round(distanceKm * 1000))} m`;
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm)} km`;
}

const PLACE_SOURCE_PRIORITY = {
  manual: 4,
  seeded: 3,
  osm: 2,
  google: 1,
};

const DEFAULT_DEDUPE_PROFILE = {
  veryCloseMeters: 18,
  sameNameMeters: 90,
  sameAddressMeters: 90,
};

const CITY_DEDUPE_PROFILES = {
  "Tel Aviv": { veryCloseMeters: 12, sameNameMeters: 60, sameAddressMeters: 70 },
  Haifa: { veryCloseMeters: 12, sameNameMeters: 60, sameAddressMeters: 70 },
  Jerusalem: { veryCloseMeters: 12, sameNameMeters: 60, sameAddressMeters: 70 },
  Berlin: { veryCloseMeters: 12, sameNameMeters: 60, sameAddressMeters: 70 },
  "Ramat Gan": { veryCloseMeters: 10, sameNameMeters: 45, sameAddressMeters: 55 },
  Givatayim: { veryCloseMeters: 10, sameNameMeters: 45, sameAddressMeters: 55 },
};

function getDedupeProfile(cityName) {
  return CITY_DEDUPE_PROFILES[cityName] || DEFAULT_DEDUPE_PROFILE;
}

function normalizePlaceText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\u0590-\u05ff\s]/g, "");
}

const GENERIC_PLACE_NAME_TOKENS = new Set([
  "cafe",
  "coffee",
  "espresso",
  "kafe",
  "קפה",
  "בית",
]);

function getPlaceQualityScore(place) {
  const hasAddress = Boolean(String(place?.address || "").trim());
  const sourceScore = PLACE_SOURCE_PRIORITY[String(place?.source || "").toLowerCase()] || 0;
  const specialtyScore = Number.isFinite(place?.specialtyScore) ? Math.round(place.specialtyScore / 10) : 0;
  return (hasAddress ? 50 : 0) + sourceScore * 10 + specialtyScore;
}

function arePlacesLikelyDuplicates(a, b, dedupeProfile = DEFAULT_DEDUPE_PROFILE) {
  const aCoords = getFiniteLatLon(a);
  const bCoords = getFiniteLatLon(b);
  if (!aCoords || !bCoords) return false;

  const distanceMeters = haversineKm(aCoords.lat, aCoords.lon, bCoords.lat, bCoords.lon) * 1000;
  if (!Number.isFinite(distanceMeters)) return false;

  const aName = normalizePlaceText(a?.name);
  const bName = normalizePlaceText(b?.name);
  const aAddress = normalizePlaceText(a?.address);
  const bAddress = normalizePlaceText(b?.address);

  const sameName = Boolean(aName) && aName === bName;
  const sameAddress = Boolean(aAddress) && aAddress === bAddress;
  const shorterName = aName.length <= bName.length ? aName : bName;
  const longerName = aName.length <= bName.length ? bName : aName;
  const shorterIsGeneric = GENERIC_PLACE_NAME_TOKENS.has(shorterName);
  const nameVariantMatch = (
    Boolean(shorterName)
    && shorterName.length >= 3
    && !shorterIsGeneric
    && longerName.includes(shorterName)
  );
  const veryClose = distanceMeters <= dedupeProfile.veryCloseMeters;
  const sameNameClose = distanceMeters <= dedupeProfile.sameNameMeters;
  const sameAddressClose = distanceMeters <= dedupeProfile.sameAddressMeters;
  const nameVariantClose = distanceMeters <= Math.max(dedupeProfile.sameNameMeters, 55);

  if (sameAddress && sameAddressClose) return true;
  if (sameName && sameNameClose) return true;
  if (nameVariantMatch && nameVariantClose) return true;
  if (veryClose && (sameName || !aAddress || !bAddress)) return true;

  return false;
}

function dedupePlaces(places, cityName) {
  const dedupeProfile = getDedupeProfile(cityName);
  const deduped = [];

  for (const place of places) {
    const existingIndex = deduped.findIndex((candidate) => arePlacesLikelyDuplicates(candidate, place, dedupeProfile));

    if (existingIndex === -1) {
      deduped.push(place);
      continue;
    }

    if (getPlaceQualityScore(place) > getPlaceQualityScore(deduped[existingIndex])) {
      deduped[existingIndex] = place;
    }
  }

  return deduped;
}

function getPlaceCoordinatesLink(place) {
  const coords = getFiniteLatLon(place);
  if (!coords) return "";
  return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}`;
}

function isTopScorePlace(place) {
  return Number.isFinite(place?.specialtyScore) && place.specialtyScore >= 95;
}

const CAFE_CARD_COPY = [
  "A standout neighborhood cafe known for quality coffee and a calm atmosphere.",
  "A specialty coffee spot worth visiting for espresso, pour-over, and carefully sourced beans.",
  "A well-loved stop for serious coffee drinkers looking for consistency and craft.",
  "A relaxed cafe with thoughtful coffee and a space that invites you to stay.",
];

const ROASTER_CARD_COPY = [
  "A respected local roaster focused on quality, balance, and traceable sourcing.",
  "Known for thoughtful roasting and coffees that highlight clarity and character.",
  "A standout roaster helping define the city’s specialty coffee scene.",
];

function getStableCopyIndex(value, mod) {
  if (!mod) return 0;
  const text = String(value || "cuproam");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}

function isRoasterLikePlace(place) {
  const text = [place?.name, place?.description, place?.notes, place?.brand, place?.operator]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return place?.placeType === "roaster"
    || text.includes("roaster")
    || text.includes("roastery")
    || text.includes("roast");
}

function getEditorialCardDescription(place) {
  const descriptions = isRoasterLikePlace(place) ? ROASTER_CARD_COPY : CAFE_CARD_COPY;
  const stableKey = place?.id || place?.name || "cuproam";
  return descriptions[getStableCopyIndex(stableKey, descriptions.length)];
}

const PRIORITY_SPECIALTY_TAG_KEYS = [
  "specialty_coffee",
  "third_wave",
  "single_origin",
  "filter_coffee",
  "espresso_bar",
  "manual_brew",
  "roastery",
  "in_house_roasting",
  "micro_roaster",
  "guest_roasters",
  "direct_trade",
  "traceability",
  "v60",
  "chemex",
  "aeropress",
  "kalita",
  "batch_brew",
  "cold_brew",
  "espresso_tonics",
  "quality_grinder",
  "espresso_machine_pro",
  "precision_brewing",
  "weighing_scale",
  "latte_art",
  "barista_focus",
  "tasting_notes",
  "cupping",
  "coffee_workshop",
];

function hasPrioritySpecialtySignals(place) {
  const tags = place?.osmTags || {};
  return PRIORITY_SPECIALTY_TAG_KEYS.some((key) => tags[key] && tags[key] !== "no");
}

function applyPriorityBoost(place, userRating) {
  const numericRating = Number(userRating);
  if (numericRating > 0) {
    if (numericRating === 1) {
      const penaltyReasons = [
        ...(Array.isArray(place.scoreReasons) ? place.scoreReasons : []),
        { label: "Manual 1★ score", points: 60 - Number(place?.specialtyScore || 0) },
      ];

      return {
        ...place,
        specialtyScore: 60,
        scoreExplanation: "1★ rating",
        scoreReasons: penaltyReasons,
      };
    }

    if (numericRating === 2) {
      const penaltyReasons = [
        ...(Array.isArray(place.scoreReasons) ? place.scoreReasons : []),
        { label: "Manual 2★ score", points: 70 - Number(place?.specialtyScore || 0) },
      ];

      return {
        ...place,
        specialtyScore: 70,
        scoreExplanation: "2★ rating",
        scoreReasons: penaltyReasons,
      };
    }

    if (numericRating >= 3) {
      const manualTargetScore = numericRating >= 5 ? 100 : numericRating === 4 ? 90 : 80;
      const priorityReasons = [
        ...(Array.isArray(place.scoreReasons) ? place.scoreReasons : []),
        { label: `Manual ${numericRating}★ score`, points: manualTargetScore - Number(place?.specialtyScore || 0) },
      ];

      return {
        ...place,
        placeType: "coffee",
        specialtyScore: manualTargetScore,
        scoreExplanation: `${numericRating}★ rating`,
        scoreReasons: priorityReasons,
      };
    }
  }

  if (place?.placeType && place.placeType !== "coffee") return place;

  const hasHighManualRating = numericRating >= 4;
  const hasTagPriority = hasPrioritySpecialtySignals(place);
  if (!hasHighManualRating && !hasTagPriority) return place;

  const priorityReasons = [
    ...(Array.isArray(place.scoreReasons) ? place.scoreReasons : []),
  ];

  if (hasHighManualRating) {
    priorityReasons.push({ label: "Manual 4/5★ priority", points: 100 });
  }
  if (hasTagPriority) {
    priorityReasons.push({ label: "Specialty tags priority", points: 100 });
  }

  const manualPriorityScore = numericRating >= 5 ? 100 : numericRating === 4 ? 90 : numericRating === 3 ? 80 : 0;
  const finalPriorityScore = Math.max(manualPriorityScore, hasTagPriority ? 100 : 0);

  return {
    ...place,
    specialtyScore: finalPriorityScore,
    scoreExplanation: hasHighManualRating
      ? Number(userRating) >= 5
        ? "Prioritized by your 5★ rating"
        : "Prioritized by your 4★ rating"
      : "Prioritized by specialty tags",
    scoreReasons: priorityReasons,
  };
}

function hasManualUserRating(placeId, userRatings) {
  return Number(userRatings?.[placeId] || 0) > 0;
}

function buildPlaceSearchText(place) {
  return [place.name, place.address, place.description, place.brand, place.operator, place.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizePlaceName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeIdPart(value, fallback = "na") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u0590-\u05ff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function toNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSeededStableId(cityName, place) {
  const cityKey = normalizeIdPart(cityName, "city");
  const nameKey = normalizeIdPart(place?.name, "unnamed");
  const lat = toNum(place?.lat);
  const lon = toNum(place?.lon);
  const latKey = lat === null ? "na" : lat.toFixed(5);
  const lonKey = lon === null ? "na" : lon.toFixed(5);

  return `seeded-${cityKey}-${nameKey}-${latKey}-${lonKey}`;
}

function getLegacyPlaceIds(place) {
  const ids = Array.isArray(place?.legacyIds) ? place.legacyIds : [];
  return ids.filter(Boolean);
}

function getPlaceOverrideKeys(place) {
  if (!place) return [];
  return Array.from(new Set([place.id, ...getLegacyPlaceIds(place)].filter(Boolean)));
}

function getPlaceOverrideEntry(place, persistedPlaceOverrides) {
  if (!place || !persistedPlaceOverrides || typeof persistedPlaceOverrides !== "object") return null;

  for (const key of getPlaceOverrideKeys(place)) {
    const entry = persistedPlaceOverrides[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return entry;
    }
  }

  return null;
}

function applyPlaceFieldOverrides(place, persistedPlaceOverrides) {
  const override = getPlaceOverrideEntry(place, persistedPlaceOverrides);
  if (!override) return place;

  const next = { ...place };

  if (Object.prototype.hasOwnProperty.call(override, "name")) next.name = override.name;
  if (Object.prototype.hasOwnProperty.call(override, "address")) next.address = override.address;
  if (Object.prototype.hasOwnProperty.call(override, "notes")) next.notes = override.notes;
  if (Object.prototype.hasOwnProperty.call(override, "lat") && Number.isFinite(Number(override.lat))) next.lat = Number(override.lat);
  if (Object.prototype.hasOwnProperty.call(override, "lon") && Number.isFinite(Number(override.lon))) next.lon = Number(override.lon);

  return next;
}

function applyPlaceComputedOverrides(place, persistedPlaceOverrides) {
  const override = getPlaceOverrideEntry(place, persistedPlaceOverrides);
  if (!override) return place;

  let next = { ...place };

  if (Object.prototype.hasOwnProperty.call(override, "specialtyScore") && Number.isFinite(Number(override.specialtyScore))) {
    const nextScore = Math.max(0, Math.min(100, Number(override.specialtyScore)));
    const previousScore = Number(place?.specialtyScore || 0);

    next = {
      ...next,
      specialtyScore: nextScore,
      scoreExplanation: "Live record override",
      scoreReasons: [
        ...(Array.isArray(next.scoreReasons) ? next.scoreReasons : []),
        { label: "Live record override", points: nextScore - previousScore },
      ],
      isSpecialty: isSpecialtyCoffee({ ...next, specialtyScore: nextScore }),
    };
  }

  if (override.deleted === true) {
    next = { ...next, __deletedByOverride: true };
  }

  return next;
}

function hasPersistedPlaceOverride(place, persistedPlaceOverrides) {
  return Boolean(getPlaceOverrideEntry(place, persistedPlaceOverrides));
}

function parseSeededStableId(value) {
  const id = String(value || "");
  if (!id.startsWith("seeded-")) return null;

  const parts = id.split("-");
  if (parts.length < 5) return null;

  const lat = Number(parts[parts.length - 2]);
  const lon = Number(parts[parts.length - 1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const cityKey = parts[1] || "";
  const nameKey = parts.slice(2, -2).join("-");
  if (!cityKey || !nameKey) return null;

  return { cityKey, nameKey, lat, lon };
}

function buildHiddenNameKey(place) {
  const cityKey = normalizeIdPart(place?.cityName || place?.city || "global", "global");
  const nameKey = normalizeIdPart(place?.name, "unnamed");
  return `hidden-name-${cityKey}-${nameKey}`;
}

function getPlaceHideKeys(place) {
  if (!place) return [];
  return Array.from(new Set([
    place.id,
    ...getLegacyPlaceIds(place),
    buildHiddenNameKey(place),
  ].filter(Boolean)));
}

function getPlaceUserRating(place, userRatings) {
  if (!place || !userRatings || typeof userRatings !== "object") return 0;

  const direct = Number(userRatings[place.id] || 0);
  if (direct > 0) return direct;

  for (const legacyId of getLegacyPlaceIds(place)) {
    const legacy = Number(userRatings[legacyId] || 0);
    if (legacy > 0) return legacy;
  }

  const cityKey = normalizeIdPart(place?.cityName || place?.city, "");
  const nameKey = normalizeIdPart(place?.name, "");
  const nameAliasKey = cityKey && nameKey ? `seeded-name-${cityKey}-${nameKey}` : "";
  const byNameAlias = Number(nameAliasKey ? userRatings[nameAliasKey] || 0 : 0);
  if (byNameAlias > 0) return byNameAlias;

  const lat = toNum(place?.lat);
  const lon = toNum(place?.lon);
  const tolerance = 0.0002;
  if (lat !== null && lon !== null) {
    for (const [ratingId, ratingValue] of Object.entries(userRatings)) {
      const parsed = parseSeededStableId(ratingId);
      if (!parsed) continue;

      const sameName = nameKey && parsed.nameKey === nameKey;
      const closeCoords = Math.abs(parsed.lat - lat) <= tolerance && Math.abs(parsed.lon - lon) <= tolerance;
      if (!sameName && !closeCoords) continue;

      const numeric = Number(ratingValue || 0);
      if (numeric > 0) return numeric;
    }
  }

  return 0;
}

function isPlaceHidden(place, hiddenPlaceIds) {
  if (!place) return false;
  return getPlaceHideKeys(place).some((key) => hiddenPlaceIds.includes(key));
}

function extractAreaFromNotes(notes) {
  const raw = String(notes || "").trim();
  if (!raw) return "";
  const match = raw.match(/^area\s*:\s*(.+)$/i);
  if (!match) return "";
  return String(match[1] || "").trim();
}

function getPlaceArea(place) {
  return extractAreaFromNotes(place?.notes);
}

function buildOsmAddress(tags = {}) {
  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  const postcode = tags["addr:postcode"];
  const city = tags["addr:city"];

  const line1 = [street, houseNumber].filter(Boolean).join(" ").trim();
  const line2 = [postcode, city].filter(Boolean).join(" ").trim();

  return [line1, line2].filter(Boolean).join(", ");
}

function passesUiFilters(place, {
  selectedCityName,
  normalizedQuery,
  selectedArea,
  filterOpenNow,
}) {
  if (isPlaceCityLockedOut(place, selectedCityName)) return false;

  // אם יש חיפוש טקסטואלי, עדיין לסנן לפי שם
  if (normalizedQuery) {
    const haystack = buildPlaceSearchText(place);
    if (!haystack.includes(normalizedQuery)) return false;
  }

  if (getExplicitExclusionKeyword(place, selectedCityName)) return false;

  if (selectedArea) {
    const placeArea = getPlaceArea(place);
    if (placeArea !== selectedArea) return false;
  }

  if (normalizedQuery) {
    const haystack = buildPlaceSearchText(place);
    if (!haystack.includes(normalizedQuery)) return false;
  }

  if (filterOpenNow && place.source !== "google") {
    const open = isOpenNow(place.opening_hours);
    if (open !== true) return false;
  }

  return true;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

function buildOverpassCoffeeQuery(city) {
  const { lat, lon, name } = city;
  const radius = getCityOverpassRadiusMeters(name);
  const specialtyTagKeys = [
    "specialty_coffee",
    "third_wave",
    "single_origin",
    "filter_coffee",
    "espresso_bar",
    "manual_brew",
    "roastery",
    "in_house_roasting",
    "micro_roaster",
    "guest_roasters",
    "direct_trade",
    "traceability",
    "v60",
    "chemex",
    "aeropress",
    "kalita",
    "batch_brew",
    "cold_brew",
    "espresso_tonics",
    "quality_grinder",
    "espresso_machine_pro",
    "precision_brewing",
    "weighing_scale",
    "latte_art",
    "barista_focus",
    "tasting_notes",
    "cupping",
    "coffee_workshop",
  ];
  const specialtyTagQueries = specialtyTagKeys
    .flatMap((key) => [
      `  node["${key}"](around:${radius},${lat},${lon});`,
      `  way["${key}"](around:${radius},${lat},${lon});`,
      `  relation["${key}"](around:${radius},${lat},${lon});`,
    ])
    .join("\n");
  return `
[out:json][timeout:25];
(
  node["amenity"="cafe"](around:${radius},${lat},${lon});
  way["amenity"="cafe"](around:${radius},${lat},${lon});
  relation["amenity"="cafe"](around:${radius},${lat},${lon});

  node["shop"="coffee"](around:${radius},${lat},${lon});
  way["shop"="coffee"](around:${radius},${lat},${lon});
  relation["shop"="coffee"](around:${radius},${lat},${lon});

${specialtyTagQueries}
);
out center tags;
`;
}

async function fetchWithTimeout(endpoint, query, timeoutMs = 45000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: query,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Overpass error: HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Overpass request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchOsmCity(city) {
  const query = buildOverpassCoffeeQuery(city);
  let lastErr = null;
  let data = null;

  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        data = await fetchWithTimeout(endpoint, query, 45000);
        break;
      } catch (error) {
        lastErr = error;
      }
    }
    if (!data) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  if (!data) {
    throw lastErr || new Error("Overpass failed");
  }

  const placesWithPossibleNullName = (data.elements || [])
    .map((el) => {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (typeof elLat !== "number" || typeof elLon !== "number") return null;

      const tags = el.tags || {};
      const resolvedName = [
        tags.name,
        tags["name:he"],
        tags["name:en"],
        tags.brand,
        tags.operator,
      ].find((value) => typeof value === "string" && value.trim().length > 0);

      return {
        id: `${el.type}-${el.id}`,
        name: resolvedName || null,
        lat: elLat,
        lon: elLon,
        address: buildOsmAddress(tags),
        cuisine: tags.cuisine,
        description: tags.description,
        brand: tags.brand,
        operator: tags.operator,
        website: tags.website || tags["contact:website"],
        phone: tags.phone || tags["contact:phone"] || tags["contact:mobile"],
        email: tags.email || tags["contact:email"],
        opening_hours: tags.opening_hours,
        wifi: tags.internet_access,
        osmTags: tags,
      };
    })
    .filter(Boolean);

  const places = placesWithPossibleNullName.filter(
    (place) => typeof place.name === "string" && place.name.trim().length > 0
  );

  return {
    places,
    unnamedFilteredCount: Math.max(0, placesWithPossibleNullName.length - places.length),
  };
}

function StarRating({ placeId, rating, onRate }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="star-rating" onClick={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={`star ${(hovered ? star <= hovered : star <= rating) ? "filled" : ""}`}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onRate(placeId, star === rating ? 0 : star)}
          aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
          title={`${star} star${star !== 1 ? "s" : ""}`}
        >
          ★
        </span>
      ))}
      {rating > 0 && (
        <span
          className="star-clear"
          onClick={() => onRate(placeId, 0)}
          title="Clear rating"
        >
          ×
        </span>
      )}
    </div>
  );
}

function MapController({ lat, lon }) {
  const map = useMap();

  useEffect(() => {
    map.setView([lat, lon], DEFAULT_CITY_ZOOM);
  }, [lat, lon, map]);

  return null;
}

function MapInstanceCapture({ onMap }) {
  const map = useMap();
  useEffect(() => { onMap(map); }, [map, onMap]);
  return null;
}



function App() {
    // State for add-in-progress indicator
    const [addingManual, setAddingManual] = useState(false);
  const latestFetchRef = useRef(0);
  // Ref for file input (import)
  const importInputRef = useRef();

  // Export manual places as JSON file
  function handleExportManualPlaces() {
    const dataStr = JSON.stringify(manualPlaces, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `manual-places-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // Import manual places from JSON file
  function handleImportManualPlaces(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported)) {
          if (window.confirm("האם להחליף את כל המקומות הידניים ברשימה המיובאת?")) {
            manualPlacesApi.setAll(imported);
          }
        } else {
          alert("הקובץ לא בפורמט תקין");
        }
      } catch {
        alert("שגיאה בטעינת הקובץ");
      }
    };
    reader.readAsText(file);
  }
  const sidebarRef = useRef(null);
  const sidebarScrollRestoreRef = useRef(null);
  const cityAutoFitRef = useRef({ cityName: null, fittedWithPlaces: false });
  const geolocationWatchRef = useRef(null);
  const [googleListsData, setGoogleListsData] = useState(null);
  const [seededPlacesByCity, setSeededPlacesByCity] = useState({});

  useEffect(() => {
    let cancelled = false;

    import("./data/googleLists.json")
      .then((module) => {
        if (cancelled) return;
        setGoogleListsData(module?.default || module || { lists: [] });
      })
      .catch(() => {
        if (cancelled) return;
        setGoogleListsData({ lists: [] });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const manualPlacesApi = useManualPlaces();
  const { manualPlaces, add: addManualPlace, update: updateManualPlace, remove: removeManualPlace, setAll: setAllManualPlaces } = manualPlacesApi;
  const placeOverridesApi = usePlaceOverrides();
  const { placeOverrides, upsert: upsertPlaceOverride, remove: removePlaceOverride } = placeOverridesApi;

  const googlePlaces = useMemo(
    () => flattenGoogleListsData(googleListsData)
      .map((place) => applyPlaceComputedOverrides(applyPlaceFieldOverrides(place, placeOverrides), placeOverrides))
      .filter((place) => !place.__deletedByOverride),
    [googleListsData, placeOverrides]
  );

  const cities = useMemo(() => buildCities(SEEDED_META_CITIES), []);
  const seededMetaByCityName = useMemo(
    () => new Map(SEEDED_META_CITIES.map((city) => [city.name, city])),
    []
  );

  const [selectedCity, setSelectedCity] = useState(() => getInitialCityFromStorage(cities));
  const [activePage, setActivePage] = useState("home");
  const [selectedCountry, setSelectedCountry] = useState(() => {
    const savedCountry = localStorage.getItem("selectedCountry");
    if (savedCountry) return savedCountry;
    return getCountryForCity(getInitialCityFromStorage(cities)?.name);
  });
  const [reverseAddressByCoordKey, setReverseAddressByCoordKey] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(REVERSE_GEOCODE_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const reverseAddressInFlightRef = useRef(new Set());

  const getCoordCacheKey = (place) => {
    const coords = getFiniteLatLon(place);
    if (!coords) return "";
    return `${coords.lat.toFixed(6)},${coords.lon.toFixed(6)}`;
  };

  const getPlaceAddress = (place) => {
    const direct = extractPlaceAddress(place);
    if (direct) return direct;

    const coordKey = getCoordCacheKey(place);
    return coordKey ? (reverseAddressByCoordKey[coordKey] || "") : "";
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(REVERSE_GEOCODE_CACHE_KEY, JSON.stringify(reverseAddressByCoordKey));
  }, [reverseAddressByCoordKey]);

  const citiesWithCountry = useMemo(
    () => cities.map((city) => ({ ...city, country: getCountryForCity(city.name) })),
    [cities]
  );

  const availableCountries = useMemo(
    () => Array.from(new Set(citiesWithCountry.map((city) => city.country))).sort((a, b) => a.localeCompare(b)),
    [citiesWithCountry]
  );

  const visibleCities = useMemo(
    () => citiesWithCountry.filter((city) => city.country === selectedCountry),
    [citiesWithCountry, selectedCountry]
  );

  const localScopeCities = useMemo(() => {
    const selectedCountryName = getCountryForCity(selectedCity?.name);
    return cities
      .filter((city) => getCountryForCity(city.name) === selectedCountryName)
      .filter((city) => (
        city.name === selectedCity?.name
        || haversineKm(selectedCity.lat, selectedCity.lon, city.lat, city.lon) <= 25
      ));
  }, [cities, selectedCity]);

  useEffect(() => {
    if (!Array.isArray(cities) || cities.length === 0) return;
    const preferredDefault = getInitialCityFromStorage(cities);

    setSelectedCity((prev) => {
      if (!prev) return preferredDefault;

      const matched = cities.find((city) => city.name === prev.name);
      if (!matched) return preferredDefault;

      if (matched.lat === prev.lat && matched.lon === prev.lon) return prev;
      return matched;
    });
  }, [cities]);

  useEffect(() => {
    const cityCountry = getCountryForCity(selectedCity?.name);
    if (cityCountry !== selectedCountry) {
      setSelectedCountry(cityCountry);
    }
  }, [selectedCity?.name, selectedCountry]);

  useEffect(() => {
    if (availableCountries.length === 0) return;
    if (availableCountries.includes(selectedCountry)) return;
    setSelectedCountry(getCountryForCity(selectedCity?.name));
  }, [availableCountries, selectedCountry, selectedCity?.name]);

  useEffect(() => {
    if (!selectedCity?.name) return;
    if (visibleCities.some((city) => city.name === selectedCity.name)) return;
    if (visibleCities.length === 0) return;
    setSelectedCity(visibleCities[0]);
  }, [visibleCities, selectedCity?.name]);

  useEffect(() => {
    const cityName = getDisplayCityName(selectedCity?.name);
    if (activePage === "about") {
      document.title = "About CupRoam";
    } else if (activePage === "contact") {
      document.title = "Contact CupRoam";
    } else {
      document.title = cityName
        ? `Best specialty coffee in ${cityName} | CupRoam`
        : "CupRoam | Explore the best specialty coffee near you";
    }

    const ensureMeta = (selector, attributes) => {
      let element = document.head.querySelector(selector);
      if (!element) {
        element = document.createElement("meta");
        Object.entries(attributes).forEach(([key, value]) => {
          element.setAttribute(key, value);
        });
        document.head.appendChild(element);
      }
      return element;
    };

    ensureMeta('meta[name="description"]', { name: "description" }).setAttribute("content", "Discover specialty coffee shops, cafes, and roasters by city. CupRoam helps you find coffee spots actually worth visiting.");
    ensureMeta('meta[property="og:title"]', { property: "og:title" }).setAttribute("content", "CupRoam");
    ensureMeta('meta[property="og:description"]', { property: "og:description" }).setAttribute("content", "Discover coffee spots worth visiting.");
  }, [activePage, selectedCity?.name]);

  const selectedCitySeededPlaces = seededPlacesByCity[selectedCity?.name];

  useEffect(() => {
    if (!selectedCity?.name) return;
    if (Array.isArray(selectedCitySeededPlaces)) return;

    const meta = seededMetaByCityName.get(selectedCity.name);
    if (!meta?.file) {
      setSeededPlacesByCity((prev) => ({ ...prev, [selectedCity.name]: [] }));
      return;
    }

    const loader = SEEDED_CITY_LOADERS[`./data/seeded-cities/${meta.file}`];
    if (!loader) {
      setSeededPlacesByCity((prev) => ({ ...prev, [selectedCity.name]: [] }));
      return;
    }

    let cancelled = false;
    loader()
      .then((module) => {
        if (cancelled) return;
        const loaded = module?.default || module;
        setSeededPlacesByCity((prev) => ({
          ...prev,
          [selectedCity.name]: Array.isArray(loaded) ? loaded : [],
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setSeededPlacesByCity((prev) => ({ ...prev, [selectedCity.name]: [] }));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCity?.name, selectedCitySeededPlaces, seededMetaByCityName]);
  const [rawCafes, setRawCafes] = useState([]);
  const [osmUnnamedFilteredCount, setOsmUnnamedFilteredCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCafe, setSelectedCafe] = useState(null);
  const [pinnedCafeId, setPinnedCafeId] = useState(null);
  const [minScore, setMinScore] = useState(0);
  const [dataMode, setDataMode] = useState("combined");
  const [googleFilterMode, setGoogleFilterMode] = useState(() => {
    const savedFilter = localStorage.getItem("googleFilterMode");
    return GOOGLE_FILTER_MODES.includes(savedFilter) ? savedFilter : "coffeeOnly";
  });
  const [fetchCounter, setFetchCounter] = useState(0);

  // retry button handler
  const retryFetch = () => setFetchCounter((c) => c + 1);

  const applyScoringPreset = (presetKey) => {
    const preset = SCORING_PRESETS[presetKey];
    if (!preset) return;

    setScoringMode(presetKey);
    setCustomWeights((prev) => ({
      ...prev,
      ...DEFAULT_WEIGHT_KEYS.reduce((acc, key) => {
        acc[key] = preset[key];
        return acc;
      }, {}),
    }));
  };

  // scoring mode (used by presets + AdvancedScoringPanel)
  const [scoringMode, setScoringMode] = useState("balanced");

  // manualForm must be defined before any usage in JSX
  // manualForm must be defined before any usage in JSX
  const [manualForm, setManualForm] = useState({ name: "", lat: "", lon: "", notes: "", gmapsLink: "", loadingGmaps: false, gmapsPreview: null, address: "" });
  // manual places UI
  const [placeOverrideForm, setPlaceOverrideForm] = useState({ name: "", address: "", notes: "", specialtyScore: "" });
  const [editingPlaceOverrideId, setEditingPlaceOverrideId] = useState(null);
  const [placeOverrideError, setPlaceOverrideError] = useState("");
  const [geocodeError, setGeocodeError] = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingManualId, setEditingManualId] = useState(null);
  const [pickedPoint, setPickedPoint] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [isTrackingUserLocation, setIsTrackingUserLocation] = useState(false);
  const [userLocationError, setUserLocationError] = useState("");
  const [devSwappedCoordsCount, setDevSwappedCoordsCount] = useState(() => loggedSwappedCoordinatePlaceIds.size);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    setDevSwappedCoordsCount(loggedSwappedCoordinatePlaceIds.size);
    return subscribeSwappedCoordinateEvents((payload) => {
      setDevSwappedCoordsCount(payload.total);
    });
  }, []);

  const PRIMARY_GEOLOCATION_OPTIONS = {
    enableHighAccuracy: true,
    maximumAge: 15000,
    timeout: 20000,
  };

  const FALLBACK_GEOLOCATION_OPTIONS = {
    enableHighAccuracy: false,
    maximumAge: 120000,
    timeout: 20000,
  };

  const applyGeolocationSuccess = (position) => {
    setUserLocation({
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
    setUserLocationError("");
  };

  const applyGeolocationError = (error) => {
    if (error?.code === 1) {
      setUserLocationError("Location permission was denied. Allow location in browser site settings and try again.");
    } else if (error?.code === 2) {
      setUserLocationError("Unable to get current location. Check GPS/network and try again.");
    } else if (error?.code === 3) {
      setUserLocationError("Location request timed out. Please try again.");
    } else {
      setUserLocationError("Failed to track your location.");
    }
    setIsTrackingUserLocation(false);
    geolocationWatchRef.current = null;
  };

  const beginGeolocationWatch = (options = PRIMARY_GEOLOCATION_OPTIONS) => {
    if (typeof window === "undefined" || !window.navigator?.geolocation) return;

    geolocationWatchRef.current = window.navigator.geolocation.watchPosition(
      applyGeolocationSuccess,
      applyGeolocationError,
      options
    );
  };

  const stopUserLocationTracking = () => {
    if (typeof window !== "undefined" && window.navigator?.geolocation && geolocationWatchRef.current != null) {
      window.navigator.geolocation.clearWatch(geolocationWatchRef.current);
    }
    geolocationWatchRef.current = null;
    setIsTrackingUserLocation(false);
  };

  const startUserLocationTracking = () => {
    if (typeof window === "undefined" || !window.navigator?.geolocation) {
      setUserLocationError("Geolocation is not supported in this browser");
      return;
    }

    if (!window.isSecureContext) {
      setUserLocationError("Location requires HTTPS secure context.");
      return;
    }

    if (window.navigator?.permissions?.query) {
      window.navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          if (result?.state === "denied") {
            setUserLocationError("Location permission is blocked in browser settings.");
          }
        })
        .catch(() => {});
    }

    if (geolocationWatchRef.current != null) {
      window.navigator.geolocation.clearWatch(geolocationWatchRef.current);
      geolocationWatchRef.current = null;
    }

    setUserLocationError("");
    setIsTrackingUserLocation(true);

    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        applyGeolocationSuccess(position);
        beginGeolocationWatch(PRIMARY_GEOLOCATION_OPTIONS);
      },
      (error) => {
        if (error?.code === 1) {
          applyGeolocationError(error);
          return;
        }

        beginGeolocationWatch(FALLBACK_GEOLOCATION_OPTIONS);
      },
      PRIMARY_GEOLOCATION_OPTIONS
    );
  };

  const toggleUserLocationTracking = () => {
    if (isTrackingUserLocation) {
      stopUserLocationTracking();
      return;
    }
    startUserLocationTracking();
  };

  useEffect(() => () => {
    if (typeof window !== "undefined" && window.navigator?.geolocation && geolocationWatchRef.current != null) {
      window.navigator.geolocation.clearWatch(geolocationWatchRef.current);
    }
  }, []);

  function resetManualFormState() {
    setEditingManualId(null);
    setManualForm({ name: "", lat: "", lon: "", notes: "" });
    setShowManualForm(false);
    setAddMode(false);
  }

  function resetPlaceOverrideFormState() {
    setEditingPlaceOverrideId(null);
    setPlaceOverrideForm({ name: "", address: "", notes: "", specialtyScore: "" });
    setPlaceOverrideError("");
  }

  function handleManualSubmit(e) {
    e.preventDefault();
    if (!manualForm.name) return;

    const parsedLat = parseFloat(manualForm.lat);
    const parsedLon = parseFloat(manualForm.lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
      setGeocodeError("You must provide a valid address or coordinates.");
      setAddingManual(false);
      return;
    }

    setAddingManual(true);

    const patch = {
      name: manualForm.name.trim(),
      lat: parsedLat,
      lon: parsedLon,
      notes: (manualForm.notes || "").trim(),
      cityName: selectedCity.name,
      source: "manual",
    };

    if (editingManualId) {
      updateManualPlace(editingManualId, patch);
      resetManualFormState();
      setAddingManual(false);
      return;
    }

    const newPlace = {
      id: `m:${crypto.randomUUID()}`,
      ...patch,
    };

    addManualPlace(newPlace);
    setTimeout(() => {
      setAddingManual(false);
      resetManualFormState();
    }, 400); // short delay for feedback
  }

  function handleManualEdit(place) {
    setEditingManualId(place.id);
    setShowManualForm(true);
    setAddMode(false);
    setManualForm({
      name: String(place?.name || ""),
      lat: Number.isFinite(place?.lat) ? String(place.lat) : "",
      lon: Number.isFinite(place?.lon) ? String(place.lon) : "",
      notes: String(place?.notes || ""),
    });
  }

  function handleManualDelete(id) {
    removeManualPlace(id);
    if (editingManualId === id) {
      resetManualFormState();
    }
  }

  function handlePlaceOverrideEdit(place) {
    if (!place || place.source === "manual") return;

    const override = getPlaceOverrideEntry(place, placeOverrides);

    setEditingPlaceOverrideId(place.id);
    setPlaceOverrideForm({
      name: override && Object.prototype.hasOwnProperty.call(override, "name")
        ? String(override.name || "")
        : String(place.name || ""),
      address: override && Object.prototype.hasOwnProperty.call(override, "address")
        ? String(override.address || "")
        : String(place.address || ""),
      notes: override && Object.prototype.hasOwnProperty.call(override, "notes")
        ? String(override.notes || "")
        : String(place.notes || ""),
      specialtyScore: override && Object.prototype.hasOwnProperty.call(override, "specialtyScore") && Number.isFinite(Number(override.specialtyScore))
        ? String(Math.round(Number(override.specialtyScore)))
        : "",
    });
    setPlaceOverrideError("");
  }

  function handlePlaceOverrideSubmit(e) {
    e.preventDefault();
    if (!editingPlaceOverrideId) return;

    const activePlace = knownPlacesByOverrideKey.get(editingPlaceOverrideId) || null;

    const name = String(placeOverrideForm.name || "").trim();
    if (!name) {
      setPlaceOverrideError("Name is required.");
      return;
    }

    const specialtyScoreRaw = String(placeOverrideForm.specialtyScore || "").trim();
    const patch = {
      name,
      address: String(placeOverrideForm.address || "").trim(),
      notes: String(placeOverrideForm.notes || "").trim(),
      cityName: String(activePlace?.cityName || activePlace?.city || "").trim(),
      source: String(activePlace?.source || "").trim(),
      updatedAt: Date.now(),
    };

    if (specialtyScoreRaw) {
      const specialtyScore = Number(specialtyScoreRaw);
      if (!Number.isFinite(specialtyScore)) {
        setPlaceOverrideError("Score must be a valid number between 0 and 100.");
        return;
      }
      patch.specialtyScore = Math.max(0, Math.min(100, Math.round(specialtyScore)));
    }

    upsertPlaceOverride(editingPlaceOverrideId, patch);
    resetPlaceOverrideFormState();
  }

  function handleResetPlaceOverride(place) {
    getPlaceOverrideKeys(place).forEach((key) => removePlaceOverride(key));
    resetPlaceOverrideFormState();
  }

  function handleDeletePlace(place) {
    if (!place) return;

    if (place.source === "manual") {
      handleManualDelete(place.id);
      return;
    }

    upsertPlaceOverride(place.id, {
      deleted: true,
      name: String(place.name || "").trim(),
      address: String(place.address || "").trim(),
      notes: String(place.notes || "").trim(),
      cityName: String(place.cityName || place.city || "").trim(),
      source: String(place.source || "").trim(),
      updatedAt: Date.now(),
    });

    if (selectedCafe?.id === place.id) {
      setSelectedCafe(null);
    }
    if (pinnedCafeId === place.id) {
      setPinnedCafeId(null);
      restoreSidebarScroll();
    }
    if (editingPlaceOverrideId === place.id) {
      resetPlaceOverrideFormState();
    }
  }

  function handleRestorePlaceOverride(overrideId) {
    removePlaceOverride(overrideId);
    if (editingPlaceOverrideId === overrideId) {
      resetPlaceOverrideFormState();
    }
  }

  function handleManualMapPick(coords) {
    setPickedPoint({ lat: coords.lat, lng: coords.lng });
    setShowManualForm(true);
    setManualForm((prev) => ({
      ...prev,
      lat: coords.lat.toFixed(6),
      lon: coords.lng.toFixed(6),
    }));
  }

  function handleQuickAddFromPickedPoint() {
    if (!pickedPoint) return;

    function slugify(str) {
      return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9א-ת]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/--+/g, '-');
    }
    const citySlug = slugify(selectedCity.name);
    const nameSlug = slugify(`Manual point (${selectedCity.name})`);
    const newPlace = {
      id: `manual-${citySlug}-${nameSlug}`,
      name: `Manual point (${selectedCity.name})`,
      lat: pickedPoint.lat,
      lon: pickedPoint.lng,
      notes: "",
      cityName: selectedCity.name,
      source: "manual",
    };

    addManualPlace(newPlace);
    setPickedPoint(null);
    setShowManualForm(false);
    setAddMode(false);
    setSelectedCafe(newPlace);
    setPinnedCafeId(newPlace.id);
  }

  const [showBreakdown, setShowBreakdown] = useState(false);
  const [auditMode, setAuditMode] = useState(false);
  const [customWeights, setCustomWeights] = useState(() => {
    // Load custom weights from localStorage or initialize from balanced preset
    const saved = localStorage.getItem("customScoringWeights");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved weights:", e);
      }
    }
    // Initialize with balanced preset
    const balanced = SCORING_PRESETS.balanced;
    return DEFAULT_WEIGHT_KEYS.reduce((acc, key) => {
      acc[key] = balanced[key];
      return acc;
    }, {});
  });

  // Save custom weights to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("customScoringWeights", JSON.stringify(customWeights));
  }, [customWeights]);

  // Local blocklist of hidden place IDs (persisted)
  const [hiddenPlaceIds, setHiddenPlaceIds] = useState(() => {
    try {
      const saved = localStorage.getItem("hiddenPlaceIds");
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;

      const backup = loadBackupSnapshotData("hiddenPlaceIds.backup.latest", []);
      return Array.isArray(backup) ? backup : [];
    } catch {
      return [];
    }
  });
  const [isHiddenBackupReady, setIsHiddenBackupReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const hydrateHiddenFromServer = async () => {
      try {
        const response = await fetch("/api/backup-hidden-place-ids");
        if (!response.ok) return;

        const payload = await response.json();
        const remoteHidden = Array.isArray(payload?.hiddenPlaceIds) ? payload.hiddenPlaceIds : [];
        if (cancelled || remoteHidden.length === 0) return;

        setHiddenPlaceIds((prev) => Array.from(new Set([...(Array.isArray(prev) ? prev : []), ...remoteHidden])));
      } catch {
        // ignore when backend is not running
      } finally {
        if (!cancelled) setIsHiddenBackupReady(true);
      }
    };

    hydrateHiddenFromServer();
    return () => {
      cancelled = true;
    };
  }, []);

  // User ratings (1–5 stars), persisted to localStorage

  // Load userRatings from localStorage, or from backup file if localStorage is empty
  const [userRatings, setUserRatings] = useState(() => {
    try {
      const local = localStorage.getItem("userRatings");
      if (local && local !== "{}") return JSON.parse(local);

      const backupLatest = loadBackupSnapshotData("userRatings.backup.latest", null);
      if (backupLatest && typeof backupLatest === "object" && Object.keys(backupLatest).length > 0) {
        return backupLatest;
      }

      // fallback to backup file (read-only)
      if (userRatingsBackup && Object.keys(userRatingsBackup).length > 0) return userRatingsBackup;
      return {};
    } catch {
      return {};
    }
  });
  const [isRatingsBackupReady, setIsRatingsBackupReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const hydrateRatingsFromServer = async () => {
      try {
        const response = await fetch("/api/backup-user-ratings");
        if (!response.ok) return;

        const payload = await response.json();
        const remoteRatings = payload && typeof payload.ratings === "object" ? payload.ratings : {};
        if (cancelled) return;

        setUserRatings((prev) => mergeRatingsMaps(prev, remoteRatings));
      } catch {
        // ignore when backend is not running
      } finally {
        if (!cancelled) setIsRatingsBackupReady(true);
      }
    };

    hydrateRatingsFromServer();
    return () => {
      cancelled = true;
    };
  }, []);

  // On every change, save to localStorage and also POST to a backup endpoint
  useEffect(() => {
    localStorage.setItem("userRatings", JSON.stringify(userRatings));
    localStorage.setItem(
      "userRatings.backup.latest",
      JSON.stringify({ ts: Date.now(), data: userRatings })
    );

    if (!isRatingsBackupReady) return;
    if (Object.keys(userRatings || {}).length === 0) return;

    // Backup to file via a simple endpoint (if running dev server with write access)
    fetch("/api/backup-user-ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userRatings)
    }).catch(() => {});
  }, [userRatings, isRatingsBackupReady]);
  
  // UI filters + search (persisted)
  const [searchQuery, setSearchQuery] = useState(() => localStorage.getItem("searchQuery") || "");
  const [selectedArea, setSelectedArea] = useState(() => localStorage.getItem("selectedArea") || "");
  const [filterOpenNow, setFilterOpenNow] = useState(() => JSON.parse(localStorage.getItem("filterOpenNow") || "false"));
  const [liveClockTick, setLiveClockTick] = useState(() => Date.now());

  const cityFilterRadiusKm = useMemo(
    () => getCityFilterRadiusKm(selectedCity?.name),
    [selectedCity?.name]
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      setLiveClockTick(Date.now());
    }, 60 * 1000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    localStorage.setItem("searchQuery", searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    localStorage.setItem("selectedArea", selectedArea);
  }, [selectedArea]);

  useEffect(() => {
    localStorage.setItem("filterOpenNow", JSON.stringify(filterOpenNow));
  }, [filterOpenNow]);

  useEffect(() => {
    localStorage.setItem("hiddenPlaceIds", JSON.stringify(hiddenPlaceIds));
    localStorage.setItem(
      "hiddenPlaceIds.backup.latest",
      JSON.stringify({ ts: Date.now(), data: hiddenPlaceIds })
    );

    if (!isHiddenBackupReady) return;

    fetch("/api/backup-hidden-place-ids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hiddenPlaceIds)
    }).catch(() => {});
  }, [hiddenPlaceIds, isHiddenBackupReady]);

  useEffect(() => {
    localStorage.removeItem("filterHasWebsite");
    localStorage.removeItem("filterWifi");
    localStorage.removeItem("filterNoInfo");
  }, []);

  useEffect(() => {
    localStorage.setItem("selectedCityName", selectedCity.name);
  }, [selectedCity]);

  useEffect(() => {
    localStorage.setItem("selectedCountry", selectedCountry);
  }, [selectedCountry]);

  useEffect(() => {
    localStorage.setItem("dataMode", dataMode);
  }, [dataMode]);

  useEffect(() => {
    localStorage.setItem("googleFilterMode", googleFilterMode);
  }, [googleFilterMode]);

  useEffect(() => {
    const savedVersion = localStorage.getItem(UI_STATE_VERSION_KEY);
    if (savedVersion === UI_STATE_VERSION) return;

    UI_STATE_RESET_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(UI_STATE_VERSION_KEY, UI_STATE_VERSION);

    setSelectedCity(getInitialCityFromStorage(cities));
    setSelectedCountry(getCountryForCity(getInitialCityFromStorage(cities)?.name));
    setDataMode("combined");
    setGoogleFilterMode("coffeeOnly");
    setSearchQuery("");
    setFilterOpenNow(false);
  }, [cities]);

  useEffect(() => {
    if (dataMode === "google") {
      setFilterOpenNow(false);
    }
  }, [dataMode]);

  // map instance ref (react-leaflet whenCreated)
  const [mapInstance, setMapInstance] = useState(null);
  const [isMobileTouch, setIsMobileTouch] = useState(false);
  const [mapInteractionEnabled, setMapInteractionEnabled] = useState(false);
  const [showMapTouchHint, setShowMapTouchHint] = useState(false);
  const mapContainerRef = useRef(null);
  const [showScoreLabels, setShowScoreLabels] = useState(false);
  const hasActivePlaceSelection = Boolean(pinnedCafeId || selectedCafe?.id);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateMobileTouch = () => {
      const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
      const narrowViewport = window.innerWidth <= 768;
      const mobile = coarsePointer || narrowViewport;
      setIsMobileTouch(mobile);
      setMapInteractionEnabled(!mobile);
    };

    updateMobileTouch();
    window.addEventListener("resize", updateMobileTouch);
    return () => window.removeEventListener("resize", updateMobileTouch);
  }, []);

  useEffect(() => {
    if (!mapInstance) return;

    const allowFullMapGestures = !isMobileTouch || mapInteractionEnabled || hasActivePlaceSelection;

    if (mapInstance.dragging) {
      if (allowFullMapGestures) mapInstance.dragging.enable();
      else mapInstance.dragging.disable();
    }
    if (mapInstance.touchZoom) {
      if (allowFullMapGestures) mapInstance.touchZoom.enable();
      else mapInstance.touchZoom.disable();
    }
    if (mapInstance.doubleClickZoom) {
      if (allowFullMapGestures) mapInstance.doubleClickZoom.enable();
      else mapInstance.doubleClickZoom.disable();
    }
    if (mapInstance.boxZoom) {
      if (allowFullMapGestures) mapInstance.boxZoom.enable();
      else mapInstance.boxZoom.disable();
    }
    if (mapInstance.scrollWheelZoom) {
      if (allowFullMapGestures) mapInstance.scrollWheelZoom.enable();
      else mapInstance.scrollWheelZoom.disable();
    }
    if (mapInstance.keyboard) {
      if (allowFullMapGestures) mapInstance.keyboard.enable();
      else mapInstance.keyboard.disable();
    }
  }, [mapInstance, isMobileTouch, mapInteractionEnabled, hasActivePlaceSelection]);

  useEffect(() => {
    if (!isMobileTouch) return;
    if (!hasActivePlaceSelection) return;
    setMapInteractionEnabled(true);
  }, [isMobileTouch, hasActivePlaceSelection]);

  useEffect(() => {
    if (!isMobileTouch) {
      setShowMapTouchHint(false);
      return;
    }

    const container = mapContainerRef.current;
    if (!container) return;

    let hintTimeoutId = null;

    const onTouchStart = (event) => {
      if (event.touches.length >= 2) {
        setMapInteractionEnabled(true);
        setShowMapTouchHint(false);
        if (hintTimeoutId) {
          window.clearTimeout(hintTimeoutId);
          hintTimeoutId = null;
        }
        return;
      }

      if (!mapInteractionEnabled && !addMode) {
        setShowMapTouchHint(true);
        if (hintTimeoutId) window.clearTimeout(hintTimeoutId);
        hintTimeoutId = window.setTimeout(() => {
          setShowMapTouchHint(false);
          hintTimeoutId = null;
        }, 1800);
      }
    };

    const onTouchEnd = (event) => {
      if (addMode) return;
      if (event.touches.length < 2) {
        setMapInteractionEnabled(false);
      }
    };

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
      if (hintTimeoutId) {
        window.clearTimeout(hintTimeoutId);
      }
    };
  }, [isMobileTouch, mapInteractionEnabled, addMode]);

  useEffect(() => {
    if (!isMobileTouch || !mapInteractionEnabled || addMode || hasActivePlaceSelection) return;

    const timeoutId = window.setTimeout(() => {
      setMapInteractionEnabled(false);
    }, 6500);

    return () => window.clearTimeout(timeoutId);
  }, [isMobileTouch, mapInteractionEnabled, addMode, hasActivePlaceSelection]);

  // Re-score cafes when scoring mode or custom weights change
  const cafes = useMemo(() => {
    // Use custom weights instead of preset
    const config = {
      baseline: 50, // Keep fixed baseline
      ...customWeights,
    };
    return rawCafes.map(cafe => {
      const baseCafe = applyPlaceFieldOverrides(cafe, placeOverrides);
      const { score, explanation, reasons, placeType, confidence } = calculateSpecialtyScore(baseCafe.name, baseCafe.osmTags, config);
      const scored = {
        ...baseCafe,
        specialtyScore: score,
        scoreExplanation: explanation,
        scoreReasons: reasons,
        placeType,
        confidence,
        isSpecialty: isSpecialtyCoffee({ ...baseCafe, specialtyScore: score }),
      };
      const overridden = applyPlaceComputedOverrides(scored, placeOverrides);
      return applyPriorityBoost(overridden, getPlaceUserRating(overridden, userRatings));
    }).filter((place) => !place.__deletedByOverride)
      .sort((a, b) => b.specialtyScore - a.specialtyScore);
  }, [rawCafes, customWeights, userRatings, placeOverrides]);

  const filteredCafes = dedupePlaces(
    cafes
      .filter((cafe) => hasManualUserRating(cafe.id, userRatings) || cafe.specialtyScore >= minScore)
      .filter((cafe) => cafe.placeType === "coffee")
      .filter((cafe) => isPlaceInSelectedCityScope(cafe, selectedCity, localScopeCities))
      .filter((cafe) => !isLikelyOffshoreOutlier(cafe, selectedCity))
      .filter((cafe) => isStrictOsmCoffeePlace(cafe, selectedCity.name)),
    selectedCity.name
  );

  const filteredGooglePlaces = useMemo(
    () => dedupePlaces(
      filterGooglePlacesByModeAndCity(googlePlaces, googleFilterMode, selectedCity, cityFilterRadiusKm, localScopeCities)
        .filter((place) => !isLikelyOffshoreOutlier(place, selectedCity)),
      selectedCity.name
    ),
    [googlePlaces, googleFilterMode, selectedCity, cityFilterRadiusKm, localScopeCities]
  );

  const scoredGooglePlaces = useMemo(() => {
    const config = {
      baseline: 50,
      ...customWeights,
    };

    return filteredGooglePlaces.map((place) => {
      if (Number.isFinite(place?.specialtyScore)) {
        return applyPriorityBoost(place, getPlaceUserRating(place, userRatings));
      }

      const { score, explanation, reasons, placeType, confidence } = calculateSpecialtyScore(
        place.name,
        place.osmTags,
        config
      );

      const scored = {
        ...place,
        specialtyScore: score,
        scoreExplanation: explanation,
        scoreReasons: reasons,
        placeType,
        confidence,
      };
      return applyPriorityBoost(scored, userRatings[place.id]);
    }).filter((place) => !place.__deletedByOverride);
  }, [filteredGooglePlaces, customWeights, userRatings]);

  const auditExcludedPlaces = useMemo(() => {
    if (!auditMode) return [];

    const googleNear = googlePlaces.filter((place) => {
      if (typeof place.lat !== "number" || typeof place.lon !== "number") return false;
      return haversineKm(selectedCity.lat, selectedCity.lon, place.lat, place.lon) <= cityFilterRadiusKm;
    });
    const googlePool = googleNear.length > 0 ? googleNear : googlePlaces;

    const googleDecisions = googlePool.map((place) => {
      const decision = getGooglePlaceDecision(place, googleFilterMode, selectedCity.name);
      return {
        id: `audit-${place.id}`,
        source: "google",
        name: place.name,
        included: decision.included,
        reason: decision.reason,
      };
    });

    const osmDecisions = cafes.map((place) => {
      if (place.specialtyScore < minScore) {
        return {
          id: `audit-${place.id}`,
          source: "osm",
          name: place.name,
          included: false,
          reason: `score below minimum (${place.specialtyScore} < ${minScore})`,
        };
      }

      if (place.placeType !== "coffee") {
        return {
          id: `audit-${place.id}`,
          source: "osm",
          name: place.name,
          included: false,
          reason: `place type: ${place.placeType}`,
        };
      }

      const decision = getStrictOsmCoffeeDecision(place, selectedCity.name);
      return {
        id: `audit-${place.id}`,
        source: "osm",
        name: place.name,
        included: decision.included,
        reason: decision.reason,
      };
    });

    const candidates = dataMode === "google"
      ? googleDecisions
      : dataMode === "osm"
        ? osmDecisions
        : [...osmDecisions, ...googleDecisions];

    return candidates
      .filter((item) => !item.included)
      .slice(0, 40);
  }, [auditMode, dataMode, selectedCity, googleFilterMode, cafes, minScore, googlePlaces, cityFilterRadiusKm]);

  const baseDisplayedPlaces = useMemo(() => {
    const sourcePlaces = dataMode === "google"
      ? scoredGooglePlaces
      : [...filteredCafes, ...scoredGooglePlaces];

    return sourcePlaces.filter((place) => (
      !isPlaceHidden(place, hiddenPlaceIds)
      && isPlaceInSelectedCityScope(place, selectedCity, localScopeCities)
      && !isLikelyOffshoreOutlier(place, selectedCity)
    ));
  }, [dataMode, scoredGooglePlaces, filteredCafes, hiddenPlaceIds, selectedCity, localScopeCities]);

  const manualPlacesForCity = useMemo(() => [], []);

  // Seeded (curated) places for the selected city — always shown regardless of mode
  const seededCityPlaces = useMemo(() => {
    const cityPlaces = (seededPlacesByCity[selectedCity.name] || [])
      .map((place, rawIndex) => ({
        ...applyPlaceFieldOverrides(place, placeOverrides),
        __seededRawIndex: rawIndex,
      }))
      .filter((place) => isPlaceInSelectedCityScope(place, selectedCity, localScopeCities))
      .filter((place) => !isLikelyOffshoreOutlier(place, selectedCity));
    const config = {
      baseline: 50,
      ...customWeights,
    };

    return dedupePlaces(cityPlaces
      .map((p, i) => {
        const rawIndex = Number.isInteger(p.__seededRawIndex) ? p.__seededRawIndex : i;
        const legacyFilteredId = `seeded-${selectedCity.name}-${i}`;
        const legacyRawId = `seeded-${selectedCity.name}-${rawIndex}`;
        const id = buildSeededStableId(selectedCity.name, p);
        const { score, explanation, reasons, placeType, confidence } = calculateSpecialtyScore(
          p.name,
          p.osmTags,
          config
        );

        const seededSpecialtyFloor = 72;
        const boostedSeededScore = p.isSpecialty ? Math.max(score, seededSpecialtyFloor) : score;
        const seededPlaceType = p.isSpecialty ? "coffee" : placeType;

        const scored = {
          id,
          source: "seeded",
          cityName: selectedCity.name,
          ...p,
          legacyIds: Array.from(new Set([legacyFilteredId, legacyRawId])),
          __seededRawIndex: undefined,
          specialtyScore: boostedSeededScore,
          scoreExplanation: explanation,
          scoreReasons: p.isSpecialty
            ? [...reasons, { label: "Curated specialty seed", points: boostedSeededScore - score }]
            : reasons,
          placeType: seededPlaceType,
          confidence,
          isSpecialty: isSpecialtyCoffee({ ...p, specialtyScore: boostedSeededScore }),
        };

        const overridden = applyPlaceComputedOverrides(scored, placeOverrides);
        return applyPriorityBoost(overridden, getPlaceUserRating(overridden, userRatings));
      }).filter((place) => !place.__deletedByOverride), selectedCity.name);
  }, [selectedCity, seededPlacesByCity, customWeights, userRatings, localScopeCities, placeOverrides]);

  const seededLegacyToStableIdMap = useMemo(() => {
    const map = new Map();
    seededCityPlaces.forEach((place) => {
      getLegacyPlaceIds(place).forEach((legacyId) => {
        if (!legacyId || legacyId === place.id) return;
        map.set(legacyId, place.id);
      });
    });
    return map;
  }, [seededCityPlaces]);

  useEffect(() => {
    if (seededLegacyToStableIdMap.size === 0) return;

    setUserRatings((prev) => {
      let changed = false;
      const next = { ...prev };

      seededLegacyToStableIdMap.forEach((stableId, legacyId) => {
        const legacyRating = Number(prev[legacyId] || 0);
        if (!legacyRating) return;
        if (Number(next[stableId] || 0) > 0) return;
        next[stableId] = legacyRating;
        changed = true;
      });

      return changed ? next : prev;
    });

    setHiddenPlaceIds((prev) => {
      let changed = false;
      const merged = new Set(prev);

      prev.forEach((id) => {
        const stableId = seededLegacyToStableIdMap.get(id);
        if (!stableId) return;
        if (!merged.has(stableId)) {
          merged.add(stableId);
          changed = true;
        }
      });

      return changed ? Array.from(merged) : prev;
    });
  }, [seededLegacyToStableIdMap]);

  // ✅ seeded נכנסים לפני ה-UI filtering
  const displayedPlaces = useMemo(() => {
    const base = baseDisplayedPlaces;
    const baseNames = new Set(base.map((p) => (p.name || "").toLowerCase()));
    const newSeeded = seededCityPlaces.filter((p) => !baseNames.has((p.name || "").toLowerCase()));

    // ...existing code...
    const allPlaces = dedupePlaces([...newSeeded, ...base], selectedCity.name);
    return allPlaces;
  }, [baseDisplayedPlaces, seededCityPlaces, selectedCity.name]);

  const availableAreas = useMemo(() => {
    const areas = Array.from(
      new Set(
        displayedPlaces
          .map((place) => getPlaceArea(place))
          .filter(Boolean)
      )
    );

    return areas.sort((a, b) => a.localeCompare(b));
  }, [displayedPlaces]);

  useEffect(() => {
    if (!selectedArea) return;
    if (availableAreas.includes(selectedArea)) return;
    setSelectedArea("");
  }, [selectedArea, availableAreas]);

  // UI-level filtering (search + basic filters) applied to both list and markers
  const filteredPlaces = useMemo(() => {
    const normalizedQuery = (searchQuery || "").trim().toLowerCase();
    return displayedPlaces.filter((place) => {
      if (
        Number.isFinite(place?.specialtyScore)
        && place.specialtyScore < minScore
      ) return false;

      return passesUiFilters(place, {
        selectedCityName: selectedCity.name,
        normalizedQuery,
        selectedArea,
        filterOpenNow,
      });
    });
  }, [displayedPlaces, selectedCity.name, searchQuery, selectedArea, filterOpenNow, minScore, userRatings]);

  const hasActiveUiFilters = Boolean(
    (searchQuery || "").trim()
    || selectedArea
    || minScore > 0
    || filterOpenNow
  );

  const effectivePlaces = useMemo(() => {
    const _clockTick = liveClockTick;

    // Always try to return something — cascade through fallbacks until we find data
    if (filteredPlaces.length > 0) return sortPlacesByLiveStatus(filteredPlaces);

    // filteredPlaces is empty — if active filters are on, intentionally empty
    if (hasActiveUiFilters) return filteredPlaces;

    // No active filters, pipeline produced 0 — fall back to broader sources
    if (displayedPlaces.length > 0) return sortPlacesByLiveStatus(displayedPlaces);
    if (filteredGooglePlaces.length > 0) return sortPlacesByLiveStatus(filteredGooglePlaces);

    // Absolute last resort: all google places within 2× radius of city
    return sortPlacesByLiveStatus(
      dedupePlaces(
        googlePlaces.filter((p) =>
          typeof p.lat === "number" &&
          typeof p.lon === "number" &&
          haversineKm(selectedCity.lat, selectedCity.lon, p.lat, p.lon) <= cityFilterRadiusKm * LAST_RESORT_RADIUS_MULTIPLIER
          && isPlaceInSelectedCityScope(p, selectedCity, localScopeCities)
        ),
        selectedCity.name
      )
    );
  }, [filteredPlaces, filteredGooglePlaces, hasActiveUiFilters, displayedPlaces, selectedCity, liveClockTick, googlePlaces, cityFilterRadiusKm, localScopeCities]);

  useEffect(() => {
    const candidates = effectivePlaces
      .filter((place) => {
        if (extractPlaceAddress(place)) return false;
        const coords = getFiniteLatLon(place);
        if (!coords) return false;
        const key = `${coords.lat.toFixed(6)},${coords.lon.toFixed(6)}`;
        if (reverseAddressByCoordKey[key]) return false;
        if (reverseAddressInFlightRef.current.has(key)) return false;
        return true;
      })
      .slice(0, 10);

    if (candidates.length === 0) return;

    let cancelled = false;

    candidates.forEach((place) => {
      const coords = getFiniteLatLon(place);
      if (!coords) return;

      const key = `${coords.lat.toFixed(6)},${coords.lon.toFixed(6)}`;
      reverseAddressInFlightRef.current.add(key);

      reverseGeocodeLatLon(coords.lat, coords.lon)
        .then((resolvedAddress) => {
          if (cancelled || !resolvedAddress) return;
          setReverseAddressByCoordKey((prev) => {
            if (prev[key]) return prev;
            return { ...prev, [key]: resolvedAddress };
          });
        })
        .finally(() => {
          reverseAddressInFlightRef.current.delete(key);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [effectivePlaces, reverseAddressByCoordKey]);

  const orderedEffectivePlaces = useMemo(() => {
    if (!pinnedCafeId) return effectivePlaces;
    const selectedIndex = effectivePlaces.findIndex((place) => place.id === pinnedCafeId);
    if (selectedIndex === -1) {
      if (!hasActiveUiFilters && selectedCafe?.id === pinnedCafeId) return [selectedCafe, ...effectivePlaces];
      return effectivePlaces;
    }
    if (selectedIndex === 0) return effectivePlaces;
    const selected = effectivePlaces[selectedIndex];
    return [selected, ...effectivePlaces.slice(0, selectedIndex), ...effectivePlaces.slice(selectedIndex + 1)];
  }, [effectivePlaces, pinnedCafeId, selectedCafe, hasActiveUiFilters]);

  const knownPlacesByOverrideKey = useMemo(() => {
    const map = new Map();

    [
      ...orderedEffectivePlaces,
      ...effectivePlaces,
      ...displayedPlaces,
      ...seededCityPlaces,
      ...manualPlacesForCity,
      ...scoredGooglePlaces,
      ...cafes,
      ...googlePlaces,
    ].forEach((place) => {
      getPlaceOverrideKeys(place).forEach((key) => {
        if (!key || map.has(key)) return;
        map.set(key, place);
      });
    });

    return map;
  }, [orderedEffectivePlaces, effectivePlaces, displayedPlaces, seededCityPlaces, manualPlacesForCity, scoredGooglePlaces, cafes, googlePlaces]);

  const managedPlaceOverrides = useMemo(() => {
    return Object.entries(placeOverrides || {})
      .map(([id, override]) => {
        const matchedPlace = knownPlacesByOverrideKey.get(id) || null;
        return {
          id,
          override,
          place: matchedPlace,
          name: override?.name || matchedPlace?.name || id,
          cityName: override?.cityName || matchedPlace?.cityName || matchedPlace?.city || "",
          source: override?.source || matchedPlace?.source || "",
          deleted: override?.deleted === true,
          updatedAt: Number(override?.updatedAt || 0) || 0,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
  }, [placeOverrides, knownPlacesByOverrideKey]);

  const nearestPlaceInfo = useMemo(() => {
    if (!userLocation || !Array.isArray(effectivePlaces) || effectivePlaces.length === 0) return null;

    let nearest = null;
    for (const place of effectivePlaces) {
      const coords = getFiniteLatLon(place);
      if (!coords) continue;
      const distanceKm = haversineKm(userLocation.lat, userLocation.lon, coords.lat, coords.lon);
      if (!Number.isFinite(distanceKm)) continue;

      if (!nearest || distanceKm < nearest.distanceKm) {
        nearest = { place, distanceKm };
      }
    }

    return nearest;
  }, [userLocation, effectivePlaces]);

  const effectiveMappablePlaces = useMemo(() => {
    const withinCityRadius = (place) => isPlaceWithinCityRadius(place, selectedCity, cityFilterRadiusKm);
    const withCoords = (place) => Boolean(getFiniteLatLon(place));

    const primary = effectivePlaces.filter(withinCityRadius);
    if (primary.length > 0) return primary;

    // When user has active UI filters/search, keep map aligned with visible list results
    // even if some results fall just outside the city-radius cutoff.
    if (hasActiveUiFilters) return effectivePlaces.filter(withCoords);

    const displayedWithCoords = displayedPlaces.filter(withinCityRadius);
    if (displayedWithCoords.length > 0) return displayedWithCoords;

    const seededWithCoords = seededCityPlaces.filter(withinCityRadius);
    if (seededWithCoords.length > 0) return seededWithCoords;

    return filteredGooglePlaces.filter(withinCityRadius);
  }, [effectivePlaces, hasActiveUiFilters, displayedPlaces, seededCityPlaces, filteredGooglePlaces, selectedCity, cityFilterRadiusKm]);

  useEffect(() => {
    if (dataMode !== "google") return;
    if (filteredGooglePlaces.length === 0) return;
    if (filteredPlaces.length > 0) return;

    setSearchQuery("");
    setHiddenPlaceIds([]);
  }, [dataMode, filteredGooglePlaces.length, filteredPlaces.length]);

  useEffect(() => {
    if (hasActiveUiFilters) return;
    if (filteredPlaces.length > 0) return;
    if (hiddenPlaceIds.length === 0) return;

    setHiddenPlaceIds([]);
  }, [
    hasActiveUiFilters,
    filteredPlaces.length,
    hiddenPlaceIds.length,
  ]);

  useEffect(() => {
    async function fetchCafes() {
      const requestId = ++latestFetchRef.current;

      if (dataMode === "google") {
        if (requestId === latestFetchRef.current) {
          setRawCafes([]);
          setOsmUnnamedFilteredCount(0);
          setLoading(false);
          setError(null);
        }
        return;
      }

      // Serve from cache if available
      const cached = getCachedOsm(selectedCity.name);
      if (cached) {
        if (requestId === latestFetchRef.current) {
          setRawCafes(cached.places);
          setOsmUnnamedFilteredCount(cached.unnamedFilteredCount || 0);
          setLoading(false);
          setError(null);
        }
        return;
      }

      if (requestId === latestFetchRef.current) {
        setLoading(true);
        setError(null);
        setRawCafes([]);
        setOsmUnnamedFilteredCount(0);
      }

      try {
        const parsed = await fetchOsmCity(selectedCity);

        setCachedOsm(selectedCity.name, parsed);
        if (requestId === latestFetchRef.current) {
          setRawCafes(parsed.places);
          setOsmUnnamedFilteredCount(parsed.unnamedFilteredCount || 0);
          setError(null);
        }
      } catch (err) {
        console.error(err);
        if (requestId === latestFetchRef.current) {
          setError("Failed to fetch data");
        }
      } finally {
        if (requestId === latestFetchRef.current) {
          setLoading(false);
        }
    }
  }

  fetchCafes();
}, [selectedCity, fetchCounter, dataMode]);

  useEffect(() => {
    if (dataMode === "google") return;

    const currentIndex = cities.findIndex((city) => city.name === selectedCity.name);
    const nextCity = cities[(currentIndex + 1) % cities.length];
    if (!nextCity || getCachedOsm(nextCity.name)) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const prefetched = await fetchOsmCity(nextCity);
        if (!cancelled) {
          setCachedOsm(nextCity.name, prefetched);
        }
      } catch {
        // ignore prefetch failures
      }
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedCity, dataMode, cities]);

  const handleCityChange = (e) => {
    const city = citiesWithCountry.find((c) => c.name === e.target.value);
    if (!city) return;
    setSelectedCity(city);
    setSelectedCafe(null);
    setPinnedCafeId(null);
    setPickedPoint(null);
    sidebarScrollRestoreRef.current = null;
  };

  const handleCountryChange = (e) => {
    const nextCountry = e.target.value;
    setSelectedCountry(nextCountry);

    const currentCityInCountry = citiesWithCountry.find(
      (city) => city.name === selectedCity.name && city.country === nextCountry
    );
    if (currentCityInCountry) return;

    const firstCity = citiesWithCountry.find((city) => city.country === nextCountry);
    if (!firstCity) return;

    setSelectedCity(firstCity);
    setSelectedCafe(null);
    setPinnedCafeId(null);
    setPickedPoint(null);
    sidebarScrollRestoreRef.current = null;
  };

  const scrollSidebarToPinnedItem = (placeId) => {
    if (!sidebarRef.current || !placeId) return;

    // Double-RAF: first RAF queues after React's paint, second ensures the
    // re-rendered pinned list has been written to the DOM before we scroll.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!sidebarRef.current) return;
        const safeId = String(placeId).replaceAll('"', '\\"');
        const item = sidebarRef.current.querySelector(`[data-place-id="${safeId}"]`);
        if (item) {
          item.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }
        sidebarRef.current.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  };

  const restoreSidebarScroll = () => {
    if (!sidebarRef.current) return;
    if (sidebarScrollRestoreRef.current == null) return;
    sidebarRef.current.scrollTo({ top: sidebarScrollRestoreRef.current, behavior: "smooth" });
    sidebarScrollRestoreRef.current = null;
  };

  const toggleCafePin = (cafe, { flyToMap = false } = {}) => {
    const isSamePinned = pinnedCafeId === cafe.id;

    if (isSamePinned) {
      setPinnedCafeId(null);
      setSelectedCafe(null);
      restoreSidebarScroll();
      return;
    }

    setSelectedCafe(cafe);
    if (flyToMap && mapInstance) {
      const coords = getFiniteLatLon(cafe);
      if (coords) {
        try {
          const targetZoom = Math.max(mapInstance.getZoom(), PIN_FLY_TO_MIN_ZOOM);
          mapInstance.flyTo([coords.lat, coords.lon], targetZoom);
        } catch {
          // ignore map errors
        }
      }
    }

    if (sidebarScrollRestoreRef.current == null && sidebarRef.current) {
      sidebarScrollRestoreRef.current = sidebarRef.current.scrollTop;
    }
    setPinnedCafeId(cafe.id);
    scrollSidebarToPinnedItem(cafe.id);
  };

  const handleSidebarCafeClick = (cafe) => {
    toggleCafePin(cafe, { flyToMap: true });
  };

  const handleMapMarkerHover = (cafe) => {
    if (pinnedCafeId) return;
    setSelectedCafe(cafe);
  };

  const handleMapMarkerClick = (cafe) => {
    toggleCafePin(cafe);
  };

  useEffect(() => {
    if (!mapInstance) return;

    if (cityAutoFitRef.current.cityName !== selectedCity.name) {
      cityAutoFitRef.current = { cityName: selectedCity.name, fittedWithPlaces: false };
    }

    if (cityAutoFitRef.current.fittedWithPlaces) return;

    const latlngs = effectiveMappablePlaces
      .map((place) => getFiniteLatLon(place, selectedCity))
      .filter(Boolean)
      .map((coords) => [coords.lat, coords.lon]);

    const cityScopedLatlngs = latlngs.filter(([lat, lon]) => (
      haversineKm(selectedCity.lat, selectedCity.lon, lat, lon)
      <= cityFilterRadiusKm * LAST_RESORT_RADIUS_MULTIPLIER
    ));

    if (cityScopedLatlngs.length === 0) {
      mapInstance.setView([selectedCity.lat, selectedCity.lon], DEFAULT_CITY_ZOOM);
      return;
    }

    if (cityScopedLatlngs.length === 1) {
      mapInstance.setView(cityScopedLatlngs[0], DEFAULT_CITY_ZOOM);
    } else {
      const bounds = L.latLngBounds(cityScopedLatlngs);
      mapInstance.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING });
    }

    cityAutoFitRef.current = { cityName: selectedCity.name, fittedWithPlaces: true };
  }, [mapInstance, selectedCity, effectiveMappablePlaces, cityFilterRadiusKm]);

  const fitToResults = () => {
    if (!mapInstance) return;
    if (!effectiveMappablePlaces || effectiveMappablePlaces.length === 0) return;
    const latlngs = effectiveMappablePlaces
      .map((place) => getFiniteLatLon(place, selectedCity))
      .filter(Boolean)
      .map((coords) => [coords.lat, coords.lon]);

    const cityScopedLatlngs = latlngs.filter(([lat, lon]) => (
      haversineKm(selectedCity.lat, selectedCity.lon, lat, lon)
      <= cityFilterRadiusKm * LAST_RESORT_RADIUS_MULTIPLIER
    ));

    if (cityScopedLatlngs.length === 0) {
      mapInstance.setView([selectedCity.lat, selectedCity.lon], DEFAULT_CITY_ZOOM);
      return;
    }

    if (cityScopedLatlngs.length === 1) {
      mapInstance.setView(cityScopedLatlngs[0], DEFAULT_CITY_ZOOM);
    } else {
      const bounds = L.latLngBounds(cityScopedLatlngs);
      mapInstance.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING });
    }
  };

  const focusOnMyLocation = () => {
    if (!mapInstance || !userLocation) return;
    mapInstance.setView([userLocation.lat, userLocation.lon], DEFAULT_CITY_ZOOM);
  };

  const handleHidePlace = (placeId) => {
    const allKnownPlaces = [
      ...orderedEffectivePlaces,
      ...effectivePlaces,
      ...displayedPlaces,
      ...seededCityPlaces,
      ...scoredGooglePlaces,
      ...manualPlacesForCity,
    ];
    const hiddenPlace = allKnownPlaces.find((place) => place?.id === placeId);
    const hideKeys = hiddenPlace ? getPlaceHideKeys(hiddenPlace) : [placeId];

    setHiddenPlaceIds((prev) => {
      const merged = new Set(prev);
      hideKeys.forEach((key) => merged.add(key));
      return merged.size === prev.length ? prev : Array.from(merged);
    });

    if (selectedCafe?.id === placeId) {
      setSelectedCafe(null);
    }
    if (pinnedCafeId === placeId) {
      setPinnedCafeId(null);
      restoreSidebarScroll();
    }
  };

  const handleRatePlace = (placeId, rating) => {
    const allKnownPlaces = [
      ...orderedEffectivePlaces,
      ...effectivePlaces,
      ...displayedPlaces,
      ...seededCityPlaces,
      ...scoredGooglePlaces,
      ...manualPlacesForCity,
    ];

    const ratedPlace = allKnownPlaces.find((place) => place?.id === placeId);
    const ratedNameKey = normalizePlaceName(ratedPlace?.name);
    const relatedPlaceIds = ratedNameKey
      ? Array.from(
          new Set(
            allKnownPlaces
              .filter((place) => normalizePlaceName(place?.name) === ratedNameKey)
              .flatMap((place) => [place?.id, ...getLegacyPlaceIds(place)])
              .filter(Boolean)
          )
        )
      : [placeId];

    if (ratedPlace?.source === "seeded") {
      const cityKey = normalizeIdPart(ratedPlace?.cityName || ratedPlace?.city, "");
      const nameKey = normalizeIdPart(ratedPlace?.name, "");
      if (cityKey && nameKey) {
        relatedPlaceIds.push(`seeded-name-${cityKey}-${nameKey}`);
      }
    }

    // Save sidebar scroll position
    const sidebar = sidebarRef.current;
    const prevScroll = sidebar ? sidebar.scrollTop : null;

    setUserRatings((prev) => {
      const next = { ...prev };

      if (rating === 0) {
        relatedPlaceIds.forEach((id) => {
          delete next[id];
        });
        return next;
      }

      relatedPlaceIds.forEach((id) => {
        next[id] = rating;
      });
      return next;
    });

    // Update specialtyScore in memory for displayedPlaces and manualPlacesForCity (UI only)
    // This ensures the UI shows the updated score immediately, even for seededPlaces
    if (ratedPlace) {
      const updated = applyPriorityBoost(ratedPlace, rating);
      // Try to update in displayedPlaces (if possible)
      setDisplayedPlaces && setDisplayedPlaces((prev) => prev.map((p) => p.id === ratedPlace.id ? { ...p, ...updated } : p));
      // Try to update in manualPlacesForCity (if possible)
      setManualPlacesForCity && setManualPlacesForCity((prev) => prev.map((p) => p.id === ratedPlace.id ? { ...p, ...updated } : p));
    }

    const idsToUnhide = new Set(ratedPlace ? getPlaceHideKeys(ratedPlace) : [placeId]);
    setHiddenPlaceIds((prev) => prev.filter((hiddenId) => !idsToUnhide.has(hiddenId)));

    // Restore sidebar scroll position after DOM update
    setTimeout(() => {
      if (sidebar && prevScroll !== null) {
        sidebar.scrollTop = prevScroll;
      }
    }, 0);
  };

  const resetAllFilters = () => {
    setSearchQuery("");
    setSelectedArea("");
    setFilterOpenNow(false);
    setHiddenPlaceIds([]);
    setMinScore(0);
    setShowBreakdown(false);
    setGoogleFilterMode("coffeeOnly");
    setDataMode("combined");
  };

  const shouldShowOsmError = Boolean(error)
    && dataMode === "osm"
    && !loading
    && orderedEffectivePlaces.length === 0;

  const hasCityScopedGoogleData = useMemo(
    () => googlePlaces.some((place) => isPlaceWithinCityRadius(place, selectedCity, cityFilterRadiusKm)),
    [googlePlaces, selectedCity, cityFilterRadiusKm]
  );

  const hasCityScopedSeededData = Boolean(seededMetaByCityName.get(selectedCity.name));
  const hasAnyCityScopedData = hasCityScopedGoogleData || hasCityScopedSeededData;

  return (
    <div className="app">
      <header className="header">
        <div className="brand-block">
          <button className="brand-name" type="button" onClick={() => setActivePage("home")}>CupRoam</button>
          <p className="brand-line">Discover coffee spots worth visiting</p>
        </div>
        {activePage === "home" && (
          <div className="hero-block">
            <h1>Explore the best specialty coffee near you</h1>
            <p className="header-subtitle">Find coffee spots actually worth visiting.</p>
            <div className="header-cta-row">
              <button className="fit-button" type="button" onClick={() => sidebarRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>
                Explore cafes
              </button>
              <button className="fit-button" type="button" onClick={() => document.getElementById("city")?.focus()}>
                Browse cities
              </button>
            </div>
          </div>
        )}
      </header>

      {activePage === "home" ? (
      <div className="main-content">
        <aside className="sidebar sidebar-top">

          <div className="city-selector city-selector-panel">
            <div className="city-selector-group">
              <label htmlFor="country">Country</label>
              <select id="country" value={selectedCountry} onChange={handleCountryChange}>
                {availableCountries.map((country) => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </div>
            <div className="city-selector-group">
              <label htmlFor="city">City</label>
              <select id="city" value={selectedCity.name} onChange={handleCityChange}>
                {visibleCities.map((city) => (
                  <option key={city.name} value={city.name}>{getDisplayCityName(city.name)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="sidebar-header-content">
            <h2>Best specialty coffee in {getDisplayCityName(selectedCity.name)}</h2>
            <p className="sidebar-subtitle">Discover standout cafes, coffee shops, and roasters in {getDisplayCityName(selectedCity.name)}.</p>
            <details className="advanced-tools utility-tools">
              <summary>Manage saved places</summary>
              <div className="json-actions" style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
                <button onClick={handleExportManualPlaces}>Export saved places</button>
                <button onClick={() => importInputRef.current?.click()}>Import saved places</button>
                <input
                  type="file"
                  accept="application/json"
                  style={{ display: 'none' }}
                  ref={importInputRef}
                  onChange={handleImportManualPlaces}
                />
              </div>
            </details>
            <div className="sidebar-header-right">
              <span className="city-name">{getDisplayCityName(selectedCity.name)}</span>
              {loading && dataMode !== "google" && <span className="loading">Loading...</span>}
              {(!loading || dataMode === "google") && <span className="count">{effectivePlaces.length} found</span>}
              {nearestPlaceInfo && (
                <span className="nearest-badge" title={nearestPlaceInfo.place.name}>
                  Nearest: {nearestPlaceInfo.place.name} ({formatDistance(nearestPlaceInfo.distanceKm)})
                </span>
              )}
              <button className="fit-button" onClick={fitToResults} title="Fit to results">Fit</button>
              <button
                className={`fit-button${showScoreLabels ? " fit-button-active" : ""}`}
                onClick={() => setShowScoreLabels(v => !v)}
                title="Toggle score labels on map"
              >Show scores</button>
            </div>
          </div>

          {shouldShowOsmError && (
            <div className="error">
              <span>Oops! Unable to fetch places.</span>
              <button className="retry-button" onClick={retryFetch}>Retry</button>
            </div>
          )}

          <div className="search-controls">
            <input
              type="search"
              className="search-input"
              placeholder="Search by city or cafe"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {availableAreas.length > 0 && (
              <select
                className="filter-select"
                value={selectedArea}
                onChange={(e) => setSelectedArea(e.target.value)}
                aria-label="Filter by area"
              >
                <option value="">All neighborhoods</option>
                {availableAreas.map((area) => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
            )}
            <div className="filter-row">
              <label className="checkbox-control small">
                <input
                  type="checkbox"
                  checked={filterOpenNow}
                  disabled={dataMode === "google"}
                  onChange={(e) => setFilterOpenNow(e.target.checked)}
                />
                Open
              </label>
            </div>

            <div className="location-controls">
              <button
                className={`fit-button${isTrackingUserLocation ? " fit-button-active" : ""}`}
                onClick={toggleUserLocationTracking}
                type="button"
                title={isTrackingUserLocation ? "Stop live location tracking" : "Use my location"}
              >
                {isTrackingUserLocation ? "Using current location" : "Use current location"}
              </button>
              <button
                className="fit-button"
                onClick={focusOnMyLocation}
                type="button"
                disabled={!userLocation}
                title="Center map on my location"
              >
                Center on me
              </button>
            </div>
            {userLocationError && <div className="location-error">{userLocationError}</div>}
            {userLocation && (
              <div className="location-hint">
                Your location: {userLocation.lat.toFixed(5)}, {userLocation.lon.toFixed(5)}
                {Number.isFinite(userLocation.accuracy) ? ` (±${Math.round(userLocation.accuracy)}m)` : ""}
              </div>
            )}
            {import.meta.env.DEV && devSwappedCoordsCount > 0 && (
              <div className="location-hint" title="Number of unique places where lat/lon was auto-swapped in this session">
                Coord swaps (session): {devSwappedCoordsCount}
              </div>
            )}
          </div>
        </aside>

        <div
          ref={mapContainerRef}
          className={`map-container ${isMobileTouch ? (mapInteractionEnabled || hasActivePlaceSelection ? "map-interaction-enabled" : "map-interaction-locked") : ""} ${hasActivePlaceSelection ? "map-selection-active" : ""}`}
        >
          {isMobileTouch && !mapInteractionEnabled && !hasActivePlaceSelection && !addMode && (
            <div className={`map-touch-hint ${showMapTouchHint ? "visible" : ""}`}>
              Use two fingers to move the map
            </div>
          )}
          <MapContainer
            center={[selectedCity.lat, selectedCity.lon]}
            zoom={DEFAULT_CITY_ZOOM}
            style={{ height: "100%", width: "100%" }}
          >
            <MapInstanceCapture onMap={setMapInstance} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapController lat={selectedCity.lat} lon={selectedCity.lon} />
            <MapClickHandler enabled={addMode} onPick={handleManualMapPick} />
            {pickedPoint && (
              <Marker position={[pickedPoint.lat, pickedPoint.lng]} icon={defaultIcon}>
                <Popup>
                  <div className="popup-content">
                    <strong>Picked map point</strong>
                    <p>Coordinates: {pickedPoint.lat.toFixed(5)}, {pickedPoint.lng.toFixed(5)}</p>
                    <p className="popup-links">
                      <button className="reset-hidden" type="button" onClick={handleQuickAddFromPickedPoint}>
                        Create manual place
                      </button>
                      <button className="reset-hidden" type="button" onClick={() => setPickedPoint(null)}>
                        Clear point
                      </button>
                    </p>
                  </div>
                </Popup>
              </Marker>
            )}

            {userLocation && (
              <Marker
                position={[userLocation.lat, userLocation.lon]}
                icon={L.divIcon({
                  className: 'custom-user-star-marker',
                  iconSize: [44, 44],
                  iconAnchor: [22, 22],
                  popupAnchor: [0, -22],
                  html: `
                    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <polygon points="22,3 27,17 43,17 30,25 34,41 22,32 10,41 14,25 1,17 17,17" fill="#e53935" stroke="#0ea5e9" stroke-width="2.5"/>
                    </svg>
                  `
                })}
              >
                <Popup>
                  <div className="popup-content">
                    <strong>Your location</strong>
                    <p>Coordinates: {userLocation.lat.toFixed(5)}, {userLocation.lon.toFixed(5)}</p>
                    {nearestPlaceInfo && (
                      <p>Nearest: {nearestPlaceInfo.place.name} ({formatDistance(nearestPlaceInfo.distanceKm)})</p>
                    )}
                  </div>
                </Popup>
              </Marker>
            )}

            {effectiveMappablePlaces.map(place => (
              (() => {
                const coords = getFiniteLatLon(place, selectedCity);
                if (!coords) return null;
                const placeAddress = getPlaceAddress(place);
                const openNowStatus = getPlaceOpenNowStatus(place);
                const isPinnedMarker = pinnedCafeId === place.id;
                const isSelectedMarker = selectedCafe?.id === place.id;
                const showMarkerHighlight = isPinnedMarker || isSelectedMarker;
                const highlightColor = isPinnedMarker ? "#f97316" : "#0ea5e9";
                const markerOpacity = openNowStatus === false ? 0.45 : 1;
                const showScoreLabel = Number.isFinite(place.specialtyScore) &&
                  (showMarkerHighlight || showScoreLabels);
                return (
              <Fragment key={place.id}>
                {showMarkerHighlight && (
                  <CircleMarker
                    center={[coords.lat, coords.lon]}
                    radius={isPinnedMarker ? 18 : 15}
                    pathOptions={{
                      color: highlightColor,
                      weight: 3,
                      fillColor: highlightColor,
                      fillOpacity: openNowStatus === false
                        ? (isPinnedMarker ? 0.11 : 0.08)
                        : (isPinnedMarker ? 0.18 : 0.12),
                    }}
                  />
                )}
                <Marker
                  position={[coords.lat, coords.lon]}
                  opacity={markerOpacity}
                  icon={isTopScorePlace(place) ? topScoreIcon : place.source === "google" ? googleIcon : place.isSpecialty ? specialtyIcon : defaultIcon}
                  eventHandlers={{
                    click: () => handleMapMarkerClick(place),
                    mouseover: () => handleMapMarkerHover(place),
                    popupopen: () => handleMapMarkerHover(place),
                  }}
                >
                  {showScoreLabel && (
                    <Tooltip
                      permanent
                      direction="top"
                      offset={[0, -4]}
                      className={`score-tooltip${isPinnedMarker ? " score-tooltip-pinned" : isSelectedMarker ? " score-tooltip-selected" : ""}`}
                    >
                      {Math.round(place.specialtyScore)}
                    </Tooltip>
                  )}
                  <Popup>
                    <div className="popup-content">
                      <strong>{place.name}</strong>
                      {place.source !== "google" && place.isSpecialty && <span className="popup-badge">Specialty</span>}
                      {openNowStatus === true && <span className="popup-badge popup-badge-open">Open</span>}
                      {openNowStatus === false && <span className="popup-badge popup-badge-closed">Closed</span>}
                      {place.placeType && place.placeType !== "coffee" && (
                        <span className="popup-badge non-pure-popup">Non-pure (capped 40)</span>
                      )}
                      {placeAddress && <p>{placeAddress}</p>}
                      {!placeAddress && <p>Address coming soon</p>}
                      {place.source !== "google" && place.opening_hours && <p>Hours: {place.opening_hours}</p>}
                      {(getPlaceDirectLink(place) || getPlaceCoordinatesLink(place)) && (
                        <p className="popup-links">
                          {getPlaceDirectLink(place) && (
                            <a href={getPlaceDirectLink(place)} target="_blank" rel="noopener noreferrer">
                              View cafe
                            </a>
                          )}
                          {getPlaceCoordinatesLink(place) && (
                            <details className="popup-coords-details">
                              <summary>Details</summary>
                              <a href={getPlaceCoordinatesLink(place)} target="_blank" rel="noopener noreferrer">
                                View map coordinates
                              </a>
                            </details>
                          )}
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              </Fragment>
                );
              })()
            ))}
          </MapContainer>
        </div>

        <aside className={`${isMobileTouch ? "mobile-bottom-panel" : "sidebar"} sidebar-bottom`} ref={sidebarRef}>

          <details className="advanced-tools">
            <summary>View tools</summary>

            {dataMode !== "osm" && (
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={googleFilterMode === "coffeeOnly"}
                  onChange={(e) => setGoogleFilterMode(e.target.checked ? "coffeeOnly" : "coffeeAndBakery")}
                />
                Focus on coffee only
              </label>
            )}

            {dataMode !== "google" && (
              <div className="scoring-mode">
                <span className="scoring-mode-label">Ranking style:</span>
                {Object.entries(SCORING_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    className={scoringMode === key ? "active" : ""}
                    onClick={() => applyScoringPreset(key)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}

            {(dataMode === "osm" || dataMode === "combined") && (
              <AdvancedScoringPanel
                scoringMode={scoringMode}
                weights={customWeights}
                onWeightsChange={setCustomWeights}
              />
            )}

            {dataMode !== "google" && (
              <label className="checkbox-control">
                <input
                  type="checkbox"
                  checked={showBreakdown}
                  onChange={(e) => setShowBreakdown(e.target.checked)}
                />
                Show why places are ranked this way
              </label>
            )}

            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={auditMode}
                onChange={(e) => setAuditMode(e.target.checked)}
              />
              Review hidden candidates
            </label>
          </details>

          <div className="legend">
            <span className="legend-item">
              <span className="dot top-score"></span> Top rated
            </span>
            {dataMode !== "google" && (
              <>
                <span className="legend-item">
                  <span className="dot specialty"></span> Specialty coffee
                </span>
                <span className="legend-item">
                  <span className="dot regular"></span> Cafe
                </span>
              </>
            )}
            {dataMode !== "osm" && (
              <span className="legend-item">
                <span className="dot google"></span> Curated imports
              </span>
            )}
          </div>

          {editingPlaceOverrideId && (
            <div className="manual-panel">
              <div className="manual-panel-header">
                <strong>Edit listing details</strong>
              </div>
              <form className="manual-form" onSubmit={handlePlaceOverrideSubmit}>
                <input
                  type="text"
                  placeholder="Name"
                  value={placeOverrideForm.name}
                  onChange={(e) => setPlaceOverrideForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
                <input
                  type="text"
                  placeholder="Address"
                  value={placeOverrideForm.address}
                  onChange={(e) => setPlaceOverrideForm((prev) => ({ ...prev, address: e.target.value }))}
                />
                <textarea
                  rows={2}
                  placeholder="Notes"
                  value={placeOverrideForm.notes}
                  onChange={(e) => setPlaceOverrideForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="Override score (optional)"
                  value={placeOverrideForm.specialtyScore}
                  onChange={(e) => setPlaceOverrideForm((prev) => ({ ...prev, specialtyScore: e.target.value }))}
                />
                {placeOverrideError && <div style={{ color: "red", marginBottom: 8 }}>{placeOverrideError}</div>}
                <div className="manual-form-actions">
                  <button className="reset-hidden" type="submit">Save changes</button>
                  <button className="reset-hidden" type="button" onClick={resetPlaceOverrideFormState}>Cancel</button>
                  <button
                    className="reset-hidden"
                    type="button"
                    onClick={() => {
                      const activePlace = orderedEffectivePlaces.find((place) => place.id === editingPlaceOverrideId);
                      if (activePlace) {
                        handleResetPlaceOverride(activePlace);
                      } else {
                        removePlaceOverride(editingPlaceOverrideId);
                        resetPlaceOverrideFormState();
                      }
                    }}
                  >
                    Reset listing
                  </button>
                </div>
              </form>
            </div>
          )}

          {managedPlaceOverrides.length > 0 && (
            <details className="advanced-tools">
              <summary>Saved listing updates ({managedPlaceOverrides.length})</summary>
              <ul className="manual-list">
                {managedPlaceOverrides.map((entry) => (
                  <li key={entry.id} className="manual-list-item">
                    <div className="manual-list-main">
                      <span className="manual-list-name">{entry.name}</span>
                      <span className="manual-list-coords">
                        {[entry.cityName, entry.source].filter(Boolean).join(" · ") || entry.id}
                      </span>
                      <span className="manual-list-notes">
                        {entry.deleted ? "Removed from listing" : "Updated listing details"}
                      </span>
                    </div>
                    <div className="manual-list-actions">
                      {entry.place && !entry.deleted && (
                        <button className="reset-hidden" type="button" onClick={() => handlePlaceOverrideEdit(entry.place)}>
                          Edit
                        </button>
                      )}
                      {entry.place && !entry.deleted && (
                        <button className="reset-hidden" type="button" onClick={() => handleSidebarCafeClick(entry.place)}>
                          Focus
                        </button>
                      )}
                      <button className="reset-hidden" type="button" onClick={() => handleRestorePlaceOverride(entry.id)}>
                        {entry.deleted ? "Restore" : "Clear"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {auditMode && (
            <div className="audit-panel">
              <div className="audit-title">Hidden results ({auditExcludedPlaces.length})</div>
              {auditExcludedPlaces.length === 0 ? (
                <div className="audit-empty">No hidden results for this city right now.</div>
              ) : (
                <ul className="audit-list">
                  {auditExcludedPlaces.map((entry) => (
                    <li key={entry.id} className="audit-item">
                      <span className="audit-source">{entry.source.toUpperCase()}</span>
                      <span className="audit-name">{entry.name}</span>
                      <span className="audit-reason">{entry.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {dataMode !== "google" && (
            <div className="filter-control">
              <label htmlFor="minScore">Minimum quality score: {minScore}</label>
              <input
                type="range"
                id="minScore"
                min="0"
                max="100"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
              />
            </div>
          )}

          {loading && dataMode !== "google" && (
            <div className="loading-banner">⏳ Loading coffee spots…</div>
          )}
          <ul className="cafe-list">
              {orderedEffectivePlaces.length === 0 && (
                <li className="empty-state">
                  <span className="empty-state-icon" aria-hidden="true">🔎</span>
                  <strong>No results found. Try another city or search term.</strong>
                  <span>
                    {dataMode !== "google" && minScore > 0
                      ? `Minimum quality score is set to ${minScore}. Lower it to discover more spots.`
                      : !hasAnyCityScopedData
                        ? "No cafes listed yet. Check back soon."
                        : "We are still brewing this page."}
                  </span>
                  <button className="reset-hidden" onClick={resetAllFilters}>Clear filters</button>
                </li>
              )}
              {orderedEffectivePlaces.map(place => (
                (() => {
                  const openNowStatus = getPlaceOpenNowStatus(place);
                  const placeAddress = getPlaceAddress(place);
                  const manualRating = getPlaceUserRating(place, userRatings);
                  const displayScore = manualRating === 1 ? 50 : place.specialtyScore;
                  return (
                <li
                  key={place.id}
                  data-place-id={place.id}
                  className={`cafe-item ${place.source === "google" ? "google-place" : place.isSpecialty ? "specialty" : ""} ${selectedCafe?.id === place.id ? "selected" : ""} ${openNowStatus === false ? "closed-now" : openNowStatus === true ? "open-now" : ""}`}
                  onClick={() => handleSidebarCafeClick(place)}
                >
                  {place.photoUrl && (
                    <img
                      src={place.photoUrl}
                      alt={place.name}
                      style={{
                        width: 'calc(100% + 2.1rem)',
                        height: '160px',
                        objectFit: 'cover',
                        borderRadius: '20px 20px 0 0',
                        marginLeft: '-1.05rem',
                        marginRight: '-1.05rem',
                        marginTop: '-1rem',
                        marginBottom: '0.75rem'
                      }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div className="cafe-header">
                    <span className="cafe-name">{place.name}</span>
                    <div className="cafe-actions">
                      <button
                        className="hide-button"
                        aria-label="Edit"
                        title="Edit record"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (place.source === "manual") {
                            handleManualEdit(place);
                            return;
                          }
                          handlePlaceOverrideEdit(place);
                        }}
                      >
                        ✎
                      </button>
                      {true && (
                        <button
                          className="remove-button"
                          aria-label="Remove"
                          title="Remove this place from the site"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm("Remove this place from the site?")) {
                              handleDeletePlace(place);
                            }
                          }}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                    <div className="cafe-badges">
                      {pinnedCafeId === place.id && (
                        <span className="pinned-badge" title="Pinned" aria-label="Pinned">📌</span>
                      )}
                      {hasPersistedPlaceOverride(place, placeOverrides) && (
                        <span className="user-verified-badge" title="Saved update applied">Updated</span>
                      )}
                      {place.needsCoords && !getFiniteLatLon(place) && (
                        <span className="low-data-badge" title="Missing map coordinates">Missing coordinates</span>
                      )}
                      {Number.isFinite(place.specialtyScore) && (
                        <>
                          <span className={`score-badge ${displayScore >= 95 ? 'score-top' : displayScore >= 80 ? 'score-high' : displayScore >= 50 ? 'score-mid' : 'score-low'}`}>
                            {displayScore}
                          </span>
                          {manualRating > 0 && (
                            <span className="manual-rating-badge" title={`Your rating: ${manualRating} stars`}>
                              ★ {manualRating}
                            </span>
                          )}
                          {place.placeType && place.placeType !== "coffee" && (
                            <span className="non-pure-badge">Non-pure (capped 40)</span>
                          )}
                          {openNowStatus === true ? (
                            <span className="open-now-badge">Open</span>
                          ) : openNowStatus === false ? (
                            <span className="closed-now-badge">Closed</span>
                          ) : null}
                          {manualRating > 0 ? (
                            <span className="user-verified-badge" title="Approved by Barista">
                              Approved by Barista
                            </span>
                          ) : Number.isFinite(place.confidence) && place.confidence < 40 ? (
                            <span className="low-data-badge">Low data</span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>

                  {place.source !== "google" && manualRating <= 0 && (
                    <div className="cafe-explanation">{getEditorialCardDescription(place)}</div>
                  )}
                  {place.source !== "google" && showBreakdown && place.scoreReasons && place.scoreReasons.length > 0 && (
                    <div className="score-breakdown">
                      {place.scoreReasons.slice(0, 3).map((reason, i) => (
                        <span key={i} className={`breakdown-tag ${reason.points > 0 ? "positive" : "negative"}`}>
                          {reason.points > 0 ? "+" : ""}{reason.points} {reason.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {!placeAddress && (
                    <div className="cafe-meta">{place.needsCoords ? "Missing map coordinates" : "Address coming soon"}</div>
                  )}
                  {placeAddress && <div className="cafe-address">{placeAddress}</div>}
                  <StarRating
                    placeId={place.id}
                    rating={manualRating || 0}
                    onRate={handleRatePlace}
                  />
                  {(getPlaceDirectLink(place) || getPlaceCoordinatesLink(place)) && (
                    <div className="location-links" onClick={(e) => e.stopPropagation()}>
                      {getPlaceDirectLink(place) && (
                        <a className="google-link" href={getPlaceDirectLink(place)} target="_blank" rel="noopener noreferrer">
                          View cafe
                        </a>
                      )}
                      {getPlaceCoordinatesLink(place) && (
                        <details className="coords-details" onClick={(e) => e.stopPropagation()}>
                          <summary>Details</summary>
                          <a className="google-link coords-link" href={getPlaceCoordinatesLink(place)} target="_blank" rel="noopener noreferrer">
                            View map coordinates
                          </a>
                        </details>
                      )}
                    </div>
                  )}
                </li>
                  );
                })()
              ))}
            </ul>
        </aside>
      </div>
      ) : (
      <main className="content-page" role="main">
        {activePage === "about" ? (
          <section className="content-card">
            <h2>About CupRoam</h2>
            <p>CupRoam was created to make finding truly great coffee easier.</p>
            <p>Instead of scrolling through endless generic results, CupRoam helps people discover specialty cafes, coffee shops, and roasters that actually stand out.</p>
            <p>Whether you are at home, traveling, or exploring a new neighborhood, CupRoam is designed to help you find places worth your time.</p>
            <p className="content-highlight">To help more people discover better coffee, one city at a time.</p>
            <p className="content-muted">CupRoam is a curated guide to specialty coffee by city.</p>
          </section>
        ) : (
          <section className="content-card">
            <h2>Contact CupRoam</h2>
            <p>Have a suggestion, correction, or coffee spot we should know about? We would love to hear from you.</p>
            <p>
              For suggestions, updates, or general inquiries, email us at {" "}
              <a href="mailto:golanp75@gmail.com">golanp75@gmail.com</a>
            </p>
          </section>
        )}
      </main>
      )}
      <footer className="app-footer">
        <div className="footer-left">© {new Date().getFullYear()} CupRoam</div>
        <div className="footer-legal">CupRoam helps you discover specialty coffee spots worth visiting.</div>
        <div className="footer-right">Discover coffee spots worth visiting.</div>
        <div className="footer-links">
          <button type="button" onClick={() => setActivePage("about")}>About</button>
          <button type="button" onClick={() => setActivePage("contact")}>Contact</button>
        </div>
      </footer>
    </div>
  );
}

export default App;
