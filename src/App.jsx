import { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { calculateSpecialtyScore, SCORING_PRESETS, DEFAULT_WEIGHT_KEYS } from "./utils/calculateSpecialtyScore";
import AdvancedScoringPanel from "./components/AdvancedScoringPanel";
import googleListsData from "./data/googleLists.json";

// Check if a Google Lists place is coffee-related by name
const coffeeKeywords = [
  "coffee", "cafe", "café", "cafè", "caffè", "espresso", "roaster", "roastery",
  "specialty", "barista",
  "קפה", "בית קפה", "אספרסו", "קלייה", "רוסטר",
];

// Negative keywords to exclude restaurants/bars/food places
const negativeKeywords = [
  "restaurant", "bistro", "grill", "sushi", "pizza", "bar", "pub",
  "eatery", "kitchen", "diner",
  "מסעדה", "בר", "פיצה", "סושי", "גריל", "המבורגר",
];

// Bakery keywords
const bakeryKeywords = [
  "bakery", "patisserie", "pastry", "boulangerie", "viennoiserie", "croissant",
  "מאפיה", "מאפייה", "קונדיטוריה", "פטיסרי", "מאפים",
];

function isCoffeePlace(place) {
  const name = place.name.toLowerCase();
  return coffeeKeywords.some(kw => name.includes(kw));
}

function isRestaurantOrBar(place) {
  const name = place.name.toLowerCase();
  return negativeKeywords.some(kw => name.includes(kw));
}

function isBakeryPlace(place) {
  const text = [
    place.name,
    place.address,
    place.description,
  ].filter(Boolean).join(" ").toLowerCase();

  return bakeryKeywords.some(k => text.includes(k));
}

// Haversine distance in KM
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

// Flatten all Google Lists places into a single array
const googlePlaces = googleListsData.lists.flatMap((list, listIdx) =>
  list.places.map((place, placeIdx) => ({
    id: `google-${listIdx}-${placeIdx}`,
    name: place.name,
    lat: place.latitude,
    lon: place.longitude,
    address: place.address || "",
    googleMapsUrl: place.googleMapsUrl,
    source: "google",
  }))
);

// Fix for default marker icons in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Custom icon for specialty coffee
const specialtyIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-gold.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const defaultIcon = new L.Icon({
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const googleIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// European cities with coordinates
const cities = [
  { name: "Berlin", lat: 52.52, lon: 13.405 },
  { name: "Tel Aviv", lat: 32.0853, lon: 34.7818 },
  { name: "Paris", lat: 48.8566, lon: 2.3522 },
  { name: "Amsterdam", lat: 52.3676, lon: 4.9041 },
  { name: "Copenhagen", lat: 55.6761, lon: 12.5683 },
  { name: "Barcelona", lat: 41.3874, lon: 2.1686 },
  { name: "London", lat: 51.5074, lon: -0.1278 },
];

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

// Component to recenter map when city changes
function MapController({ center }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 13);
  }, [center, map]);
  return null;
}

// Helper: fetch with timeout + retry
async function fetchWithTimeout(url, body, timeoutMs = 45000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: body }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function App() {
  const [selectedCity, setSelectedCity] = useState(cities[0]);
  const [rawCafes, setRawCafes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCafe, setSelectedCafe] = useState(null);
  const [minScore, setMinScore] = useState(60);
  const [dataMode, setDataMode] = useState("osm"); // "google" | "osm" | "combined"
  const [fetchCounter, setFetchCounter] = useState(0); // increment to refetch

  // human-readable mode label used in header and map overlay
  const modeLabel = dataMode === "google"
    ? "Google Lists"
    : dataMode === "osm"
      ? "OSM"
      : "Combined";

  const retryFetch = () => {
    // bump counter to re-trigger effect
    setFetchCounter(c => c + 1);
  };
  const [googleFilterMode, setGoogleFilterMode] = useState("coffeeOnly"); // "coffeeOnly" | "coffeeAndBakery" | "all"
  const [scoringMode, setScoringMode] = useState("balanced");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showNonCoffeeOSM, setShowNonCoffeeOSM] = useState(false);
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

  // Local blocklist of hidden place IDs (persisted to localStorage)
  const [hiddenPlaceIds, setHiddenPlaceIds] = useState(() => {
    const saved = localStorage.getItem("hiddenPlaceIds");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse hiddenPlaceIds:", e);
      }
    }
    return [];
  });
  
  // UI filters + search (persisted)
  const [searchQuery, setSearchQuery] = useState(() => localStorage.getItem("searchQuery") || "");
  const [filterOpenNow, setFilterOpenNow] = useState(() => JSON.parse(localStorage.getItem("filterOpenNow") || "false"));
  const [filterHasWebsite, setFilterHasWebsite] = useState(() => JSON.parse(localStorage.getItem("filterHasWebsite") || "false"));
  const [filterWifi, setFilterWifi] = useState(() => JSON.parse(localStorage.getItem("filterWifi") || "false"));

  useEffect(() => {
    localStorage.setItem("searchQuery", searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    localStorage.setItem("filterOpenNow", JSON.stringify(filterOpenNow));
  }, [filterOpenNow]);

  useEffect(() => {
    localStorage.setItem("filterHasWebsite", JSON.stringify(filterHasWebsite));
  }, [filterHasWebsite]);

  useEffect(() => {
    localStorage.setItem("filterWifi", JSON.stringify(filterWifi));
  }, [filterWifi]);

  // map instance ref (react-leaflet whenCreated)
  const [mapInstance, setMapInstance] = useState(null);

  useEffect(() => {
    localStorage.setItem("hiddenPlaceIds", JSON.stringify(hiddenPlaceIds));
  }, [hiddenPlaceIds]);

  // Re-score cafes when scoring mode or custom weights change
  const cafes = useMemo(() => {
    // Use custom weights instead of preset
    const config = {
      baseline: 50, // Keep fixed baseline
      ...customWeights,
    };
    return rawCafes.map(cafe => {
      const { score, explanation, reasons, placeType, confidence } = calculateSpecialtyScore(cafe.name, cafe.osmTags, config);
      return {
        ...cafe,
        specialtyScore: score,
        scoreExplanation: explanation,
        scoreReasons: reasons,
        placeType,
        confidence,
        isSpecialty: isSpecialtyCoffee({ ...cafe, specialtyScore: score }),
      };
    }).sort((a, b) => b.specialtyScore - a.specialtyScore);
  }, [rawCafes, customWeights]);

  const filteredCafes = cafes
    .filter(cafe => cafe.specialtyScore >= minScore)
    .filter(cafe => showNonCoffeeOSM || cafe.placeType === 'coffee');

  const filteredGooglePlaces = useMemo(() => {
    if (googleFilterMode === "all") return googlePlaces;

    return googlePlaces.filter((p) => {
      const isCoffee = isCoffeePlace(p);
      const isBakery = isBakeryPlace(p);
      const isFood = isRestaurantOrBar(p);

      if (googleFilterMode === "coffeeOnly") {
        return isCoffee && !isFood;
      }

      // coffeeAndBakery
      return (isCoffee || isBakery) && !isFood;
    });
  }, [googleFilterMode]);

  const displayedPlaces = (
    dataMode === "google"
      ? filteredGooglePlaces
      : dataMode === "osm"
        ? filteredCafes
        : [...filteredCafes, ...filteredGooglePlaces]
  ).filter(p => !hiddenPlaceIds.includes(p.id));

  // UI-level filtering (search + basic filters) applied to both list and markers
  const uiFilteredPlaces = useMemo(() => {
    const q = (searchQuery || "").trim().toLowerCase();
    return displayedPlaces.filter((p) => {
      // search by name/address/description/brand/operator
      if (q) {
        const hay = [p.name, p.address, p.description, p.brand, p.operator]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (filterOpenNow) {
        // use basic opening_hours parser; require it to be open now
        const open = isOpenNow(p.opening_hours);
        if (open !== true) return false;
      }

      if (filterHasWebsite) {
        if (!p.website && !p.googleMapsUrl) return false;
      }

      if (filterWifi) {
        if (!(p.wifi || p.osmTags?.internet_access)) return false;
      }

      return true;
    });
  }, [displayedPlaces, searchQuery, filterOpenNow, filterHasWebsite, filterWifi]);

  // Fetch cafes from Overpass API
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
  ];
  useEffect(() => {
    async function fetchCafes() {
      setLoading(true);
      setError(null);
      setRawCafes([]);

      const { lat, lon } = selectedCity;

      // Smaller radius for dense cities (Tel Aviv)
      const radius = selectedCity.name === "Tel Aviv" ? 1800 : 3000;

      const query = `
[out:json][timeout:60];
(
  node["amenity"="cafe"](around:${radius},${lat},${lon});
  way["amenity"="cafe"](around:${radius},${lat},${lon});
  relation["amenity"="cafe"](around:${radius},${lat},${lon});

  node["shop"="coffee"](around:${radius},${lat},${lon});
  way["shop"="coffee"](around:${radius},${lat},${lon});
  relation["shop"="coffee"](around:${radius},${lat},${lon});
);
out center tags;
`;

      let lastErr = null;
      let data = null;

      try {
        for (let attempt = 0; attempt < 3 && !data; attempt++) {
          for (const ep of endpoints) {
            try {
              data = await fetchWithTimeout(ep, query, 45000);
              break;
            } catch (e) {
              lastErr = e;
            }
          }
          // tiny backoff
          if (!data) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }

        if (!data) {
          throw lastErr || new Error("Overpass failed");
        }

        const elements = data.elements || [];
        const parsed = elements
          .map((el) => {
            const elLat = el.lat ?? el.center?.lat;
            const elLon = el.lon ?? el.center?.lon;
            if (typeof elLat !== "number" || typeof elLon !== "number") return null;

            const tags = el.tags || {};
            return {
              id: `${el.type}-${el.id}`,
              name: tags.name || "Unnamed",
              lat: elLat,
              lon: elLon,
              cuisine: tags.cuisine,
              description: tags.description,
              brand: tags.brand,
              operator: tags.operator,
              website: tags.website,
              opening_hours: tags.opening_hours,
              wifi: tags.internet_access,
              osmTags: tags,
            };
          })
          .filter(Boolean);

        setRawCafes(parsed);
        setError(null);
      } catch (err) {
        console.error(err);
        setError("Failed to fetch data");
      } finally {
        setLoading(false);
      }
    }

    fetchCafes();
  }, [selectedCity, fetchCounter]);

  const handleCityChange = (e) => {
    const city = cities.find(c => c.name === e.target.value);
    setSelectedCity(city);
    setSelectedCafe(null);
  };

  const handleCafeClick = (cafe) => {
    setSelectedCafe(cafe);
    if (mapInstance && cafe && typeof cafe.lat === 'number' && typeof cafe.lon === 'number') {
      try {
        mapInstance.flyTo([cafe.lat, cafe.lon], 16);
        // open popup requires marker reference; selecting and flying is usually enough
      } catch (e) {
        // ignore map errors
      }
    }
  };

  const fitToResults = () => {
    if (!mapInstance) return;
    if (!uiFilteredPlaces || uiFilteredPlaces.length === 0) return;
    const latlngs = uiFilteredPlaces
      .filter(p => typeof p.lat === 'number' && typeof p.lon === 'number')
      .map(p => [p.lat, p.lon]);
    if (latlngs.length === 0) return;
    if (latlngs.length === 1) {
      mapInstance.setView(latlngs[0], 14);
    } else {
      const bounds = L.latLngBounds(latlngs);
      mapInstance.fitBounds(bounds, { padding: [64, 64] });
    }
  };

  const handleHidePlace = (placeId) => {
    setHiddenPlaceIds(prev => prev.includes(placeId) ? prev : [...prev, placeId]);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>Specialty Coffee Finder</h1>
          <p className="header-subtitle">Discover the best specialty cafés worldwide</p>
        </div>
        <div className="city-selector">
          <label htmlFor="city">City:</label>
          <select id="city" value={selectedCity.name} onChange={handleCityChange}>
            {cities.map(city => (
              <option key={city.name} value={city.name}>{city.name}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-header-content">
              <h2>Coffee Shops</h2>
              <p className="sidebar-subtitle">Browse around and pick a spot</p>
            </div>
              <div className="sidebar-header-right">
                <span className="city-name">{selectedCity.name}</span>
                <span className="mode-badge">{modeLabel}</span>
                {loading && dataMode !== "google" && <span className="loading">Loading...</span>}
                {(!loading || dataMode === "google") && <span className="count">{displayedPlaces.length} found</span>}
                <button className="fit-button" onClick={fitToResults} title="Fit to results">Fit</button>
              </div>
          </div>

          {error && dataMode !== "google" && (
            <div className="error">
              <span>Oops! Unable to fetch places.</span>
              <button className="retry-button" onClick={retryFetch}>Retry</button>
            </div>
          )}

          <div className="mode-toggle">
            <button className={dataMode === "google" ? "active" : ""} onClick={() => setDataMode("google")}>Google Lists</button>
            <button className={dataMode === "osm" ? "active" : ""} onClick={() => setDataMode("osm")}>OSM Discovery</button>
            <button className={dataMode === "combined" ? "active" : ""} onClick={() => setDataMode("combined")}>Combined</button>
          </div>
          
          <div className="search-controls">
            <input
              type="search"
              className="search-input"
              placeholder="Search name, address, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="filter-row">
              <label className="checkbox-control small">
                <input type="checkbox" checked={filterOpenNow} onChange={(e) => setFilterOpenNow(e.target.checked)} />
                Open now
              </label>
              <label className="checkbox-control small">
                <input type="checkbox" checked={filterHasWebsite} onChange={(e) => setFilterHasWebsite(e.target.checked)} />
                Has website
              </label>
              <label className="checkbox-control small">
                <input type="checkbox" checked={filterWifi} onChange={(e) => setFilterWifi(e.target.checked)} />
                WiFi
              </label>
            </div>
          </div>
          
          {dataMode === "google" && (
            <div className="filter-status">
              Coffee-only filtering: {googleFilterMode === "coffeeOnly" ? "ON" : "OFF"}
            </div>
          )}

          {dataMode !== "osm" && (
            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={googleFilterMode === "coffeeAndBakery"}
                onChange={(e) => setGoogleFilterMode(e.target.checked ? "coffeeAndBakery" : "coffeeOnly")}
              />
              Include bakeries with coffee
            </label>
          )}

          {dataMode !== "google" && (
            <div className="scoring-mode">
              <span className="scoring-mode-label">Scoring:</span>
              {Object.entries(SCORING_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  className={scoringMode === key ? "active" : ""}
                  onClick={() => setScoringMode(key)}
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

          {(dataMode === "osm" || dataMode === "combined") && (
            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={showNonCoffeeOSM}
                onChange={(e) => setShowNonCoffeeOSM(e.target.checked)}
              />
              Show non-coffee OSM places
            </label>
          )}

          {dataMode !== "google" && (
            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={showBreakdown}
                onChange={(e) => setShowBreakdown(e.target.checked)}
              />
              Show score breakdown
            </label>
          )}

          <div className="legend">
            {dataMode !== "google" && (
              <>
                <span className="legend-item">
                  <span className="dot specialty"></span> Likely specialty
                </span>
                <span className="legend-item">
                  <span className="dot regular"></span> Cafe
                </span>
              </>
            )}
            {dataMode !== "osm" && (
              <span className="legend-item">
                <span className="dot google"></span> Google Lists
              </span>
            )}
          </div>

          <div className="hidden-manager">
            <span>Hidden: {hiddenPlaceIds.length}</span>
            <button className="reset-hidden" onClick={() => setHiddenPlaceIds([])}>Reset hidden</button>
          </div>

          {dataMode !== "google" && (
            <div className="filter-control">
              <label htmlFor="minScore">Minimum score: {minScore}</label>
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

          {loading && dataMode !== "google" ? (
            <div className="skeleton-list">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton-item"></div>
              ))}
            </div>
          ) : (
            <ul className="cafe-list">
              {uiFilteredPlaces.map(place => (
                <li
                  key={place.id}
                  className={`cafe-item ${place.source === "google" ? "google-place" : place.isSpecialty ? "specialty" : ""} ${selectedCafe?.id === place.id ? "selected" : ""}`}
                  onClick={() => handleCafeClick(place)}
                >
                  <div className="cafe-header">
                    <span className="cafe-name">{place.name}</span>
                    <div className="cafe-badges">
                      {place.source !== "google" && (
                        <>
                          <span className={`score-badge ${place.specialtyScore >= 80 ? 'score-high' : place.specialtyScore >= 50 ? 'score-mid' : 'score-low'}`}>
                            {place.specialtyScore}
                          </span>
                          {place.confidence < 40 && (
                            <span className="low-data-badge">Low data</span>
                          )}
                        </>
                      )}
                      {place.source === "google" && (
                        <span className="google-badge">Google</span>
                      )}
                      <button
                        className="hide-button"
                        aria-label="Hide"
                        onClick={(e) => { e.stopPropagation(); handleHidePlace(place.id); }}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {place.source !== "google" && <div className="cafe-explanation">{place.scoreExplanation}</div>}
                  {place.source !== "google" && showBreakdown && place.scoreReasons && place.scoreReasons.length > 0 && (
                    <div className="score-breakdown">
                      {place.scoreReasons.slice(0, 3).map((reason, i) => (
                        <span key={i} className={`breakdown-tag ${reason.points > 0 ? "positive" : "negative"}`}>
                          {reason.points > 0 ? "+" : ""}{reason.points} {reason.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {place.address && <div className="cafe-address">{place.address}</div>}
                  {place.source === "google" && place.googleMapsUrl && (
                    <a className="google-link" href={place.googleMapsUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                      View on Google Maps
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="map-container">
          <MapContainer
            center={[selectedCity.lat, selectedCity.lon]}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
            whenCreated={setMapInstance}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapController center={[selectedCity.lat, selectedCity.lon]} />

            {uiFilteredPlaces.map(place => (
              <Marker
                key={place.id}
                position={[place.lat, place.lon]}
                icon={place.source === "google" ? googleIcon : place.isSpecialty ? specialtyIcon : defaultIcon}
                eventHandlers={{
                  click: () => handleCafeClick(place),
                }}
              >
                <Popup>
                  <div className="popup-content">
                    <strong>{place.name}</strong>
                    {place.source !== "google" && place.isSpecialty && <span className="popup-badge">Specialty</span>}
                    {place.source === "google" && <span className="popup-badge google-badge">Google Lists</span>}
                    {place.address && <p>{place.address}</p>}
                    {place.source !== "google" && place.opening_hours && <p>Hours: {place.opening_hours}</p>}
                    {place.source !== "google" && place.website && (
                      <p>
                        <a href={place.website} target="_blank" rel="noopener noreferrer">
                          Website
                        </a>
                      </p>
                    )}
                    {place.source === "google" && place.googleMapsUrl && (
                      <p>
                        <a href={place.googleMapsUrl} target="_blank" rel="noopener noreferrer">
                          Google Maps
                        </a>
                      </p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

export default App;
