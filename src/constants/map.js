export const DEFAULT_CITY_ZOOM = 15;
export const PIN_FLY_TO_MIN_ZOOM = 16;
export const FIT_BOUNDS_PADDING = [64, 64];

export const CITY_FILTER_RADIUS_KM = 40;
export const LAST_RESORT_RADIUS_MULTIPLIER = 2;

export const DEFAULT_OVERPASS_RADIUS_METERS = 2200;
export const CITY_OVERPASS_RADIUS_METERS = {
	"Tel Aviv": 5000,
	Jerusalem: 3500,
	Haifa: 3000,
	"Ramat Gan": 2500,
	"Ra'anana": 2500,
};

export function getCityOverpassRadiusMeters(cityName) {
	return CITY_OVERPASS_RADIUS_METERS[cityName] ?? DEFAULT_OVERPASS_RADIUS_METERS;
}

export const TOOLTIP_ZOOM_THRESHOLD = 16;
