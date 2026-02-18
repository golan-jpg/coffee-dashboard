import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { calculateSpecialtyScore } from "./utils/calculateSpecialtyScore";
import googleListsData from "./data/googleLists.json";

// Check if a Google Lists place is coffee-related by name
const coffeeKeywords = [
  "coffee", "cafe", "café", "cafè", "caffè", "espresso", "roaster", "roastery",
  "specialty", "barista",
  "קפה", "בית קפה", "אספרסו", "קלייה", "רוסטר",
];

function isCoffeePlace(place) {
  const name = place.name.toLowerCase();
  return coffeeKeywords.some(kw => name.includes(kw));
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
  { name: "Berlin", lat: 52.52, lon: 13.405 },{ name: "Tel Aviv", lat: 32.0853, lon: 34.7818 },
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
  "bonanza", "father carpenter", "lot sixty one", "coffee district", "satan's coffee"
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

// Component to recenter map when city changes
function MapController({ center }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 13);
  }, [center, map]);
  return null;
}

function App() {
  const [selectedCity, setSelectedCity] = useState(cities[0]);
  const [cafes, setCafes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCafe, setSelectedCafe] = useState(null);
  const [minScore, setMinScore] = useState(60);
  const [dataMode, setDataMode] = useState("osm"); // "google" | "osm" | "combined"
  const [showAllGoogle, setShowAllGoogle] = useState(false);

  const filteredCafes = cafes.filter(cafe => cafe.specialtyScore >= minScore);
  const filteredGooglePlaces = showAllGoogle ? googlePlaces : googlePlaces.filter(isCoffeePlace);

  const displayedPlaces = dataMode === "google"
    ? filteredGooglePlaces
    : dataMode === "osm"
      ? filteredCafes
      : [...filteredCafes, ...filteredGooglePlaces];

  // Fetch cafes from Overpass API
  useEffect(() => {
    async function fetchCafes() {
      setLoading(true);
      setError(null);
      setCafes([]);

      const { lat, lon } = selectedCity;
      const radius = 3000; // 3km radius

      const query = `
        [out:json][timeout:25];
        (
          node["amenity"="cafe"](around:${radius},${lat},${lon});
          node["cuisine"~"coffee"](around:${radius},${lat},${lon});
          node["shop"="coffee"](around:${radius},${lat},${lon});
        );
        out body;
      `;

      try {
        const response = await fetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });

        if (!response.ok) {
          throw new Error("Failed to fetch data");
        }

        const data = await response.json();

        const cafeList = data.elements
          .filter(el => el.tags?.name) // Only include named places
          .map(el => {
            const { score, explanation } = calculateSpecialtyScore(el.tags.name, el.tags);
            return {
              id: el.id,
              name: el.tags.name,
              lat: el.lat,
              lon: el.lon,
              cuisine: el.tags.cuisine,
              description: el.tags.description,
              brand: el.tags.brand,
              operator: el.tags.operator,
              website: el.tags.website,
              phone: el.tags["contact:phone"] || el.tags.phone,
              address: [
                el.tags["addr:street"],
                el.tags["addr:housenumber"],
              ].filter(Boolean).join(" "),
              openingHours: el.tags.opening_hours,
              specialtyScore: score,
              scoreExplanation: explanation,
            };
          })
          .map(cafe => ({
            ...cafe,
            isSpecialty: isSpecialtyCoffee(cafe),
          }))
          .sort((a, b) => b.specialtyScore - a.specialtyScore);

        setCafes(cafeList);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchCafes();
  }, [selectedCity]);

  const handleCityChange = (e) => {
    const city = cities.find(c => c.name === e.target.value);
    setSelectedCity(city);
    setSelectedCafe(null);
  };

  const handleCafeClick = (cafe) => {
    setSelectedCafe(cafe);
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
            <h2>Coffee Shops</h2>
            {loading && dataMode !== "google" && <span className="loading">Loading...</span>}
            {(!loading || dataMode === "google") && <span className="count">{displayedPlaces.length} found</span>}
          </div>

          {error && dataMode !== "google" && <div className="error">Error: {error}</div>}

          <div className="mode-toggle">
            <button className={dataMode === "google" ? "active" : ""} onClick={() => setDataMode("google")}>Google Lists</button>
            <button className={dataMode === "osm" ? "active" : ""} onClick={() => setDataMode("osm")}>OSM Discovery</button>
            <button className={dataMode === "combined" ? "active" : ""} onClick={() => setDataMode("combined")}>Combined</button>
          </div>

          {dataMode !== "osm" && (
            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={showAllGoogle}
                onChange={(e) => setShowAllGoogle(e.target.checked)}
              />
              Show non-coffee places
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

          <ul className="cafe-list">
            {displayedPlaces.map(place => (
              <li
                key={place.id}
                className={`cafe-item ${place.source === "google" ? "google-place" : place.isSpecialty ? "specialty" : ""} ${selectedCafe?.id === place.id ? "selected" : ""}`}
                onClick={() => handleCafeClick(place)}
              >
                <div className="cafe-name">
                  {place.name}
                  {place.source !== "google" && (
                    <span className={`score-badge ${place.specialtyScore >= 80 ? 'score-high' : place.specialtyScore >= 50 ? 'score-mid' : 'score-low'}`}>
                      {place.specialtyScore}
                    </span>
                  )}
                </div>
                {place.source !== "google" && <div className="cafe-explanation">{place.scoreExplanation}</div>}
                {place.address && <div className="cafe-address">{place.address}</div>}
                {place.source === "google" && place.googleMapsUrl && (
                  <a className="google-link" href={place.googleMapsUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                    View on Google Maps
                  </a>
                )}
              </li>
            ))}
          </ul>
        </aside>

        <div className="map-container">
          <MapContainer
            center={[selectedCity.lat, selectedCity.lon]}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapController center={[selectedCity.lat, selectedCity.lon]} />

            {displayedPlaces.map(place => (
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
                    {place.source !== "google" && place.openingHours && <p>Hours: {place.openingHours}</p>}
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
