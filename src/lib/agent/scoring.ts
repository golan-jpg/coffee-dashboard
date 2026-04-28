import type { PlaceAgentScore, PlaceLike } from "../../types/place";

export const AGENT_SCORING_VERSION = "cuproam-score-v1";

const TAG_POINTS: Record<string, number> = {
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

const SOURCE_POINTS: Record<string, number> = {
  seeded: 8,
  manual: 7,
  google: 4,
  osm: 3,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function scorePlaceDeterministic(place: PlaceLike, tags: string[]): PlaceAgentScore {
  const components: PlaceAgentScore["components"] = [];

  const specialtyRaw = Number(place.specialtyScore);
  const specialtyBase = Number.isFinite(specialtyRaw)
    ? clamp(Math.round(specialtyRaw * 0.45), 0, 45)
    : 0;
  components.push({ key: "specialtyScore", points: specialtyBase });

  const sourceKey = String(place.source || "").toLowerCase();
  const sourcePoints = SOURCE_POINTS[sourceKey] || 0;
  if (sourcePoints !== 0) {
    components.push({ key: `source:${sourceKey}`, points: sourcePoints });
  }

  tags.forEach((tag) => {
    const points = TAG_POINTS[tag] || 0;
    if (points !== 0) {
      components.push({ key: `tag:${tag}`, points });
    }
  });

  const value = clamp(
    Math.round(components.reduce((sum, entry) => sum + entry.points, 0)),
    0,
    100
  );

  return {
    version: AGENT_SCORING_VERSION,
    value,
    components,
  };
}
