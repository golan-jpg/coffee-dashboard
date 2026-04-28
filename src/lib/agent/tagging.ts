import type { PlaceLike } from "../../types/place";

export const AGENT_TAGGING_VERSION = "cuproam-tagging-v1";

type TagRule = {
  tag: string;
  patterns: string[];
};

const TAG_RULES: TagRule[] = [
  { tag: "specialty_coffee", patterns: ["specialty", "single origin", "micro-lot", "third wave"] },
  { tag: "espresso_bar", patterns: ["espresso bar", "espresso"] },
  { tag: "pour_over", patterns: ["pour over", "pour-over", "filter coffee"] },
  { tag: "v60", patterns: ["v60"] },
  { tag: "chemex", patterns: ["chemex"] },
  { tag: "aeropress", patterns: ["aeropress", "aero press"] },
  { tag: "roastery", patterns: ["roaster", "roastery", "roast"] },
  { tag: "bakery", patterns: ["bakery", "pastry", "croissant", "patisserie"] },
  { tag: "brunch", patterns: ["brunch", "breakfast", "sandwich", "kitchen"] },
  { tag: "work_friendly", patterns: ["laptop", "wifi", "work", "workspace", "quiet"] },
  { tag: "takeaway_friendly", patterns: ["take away", "takeaway", "to-go", "to go"] },
];

function normalizeText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toTypesArray(types: PlaceLike["types"]): string[] {
  if (Array.isArray(types)) return types.map((entry) => String(entry || "")).filter(Boolean);
  if (typeof types === "string" && types.trim()) return [types];
  return [];
}

export function buildPlaceTextForTagging(place: PlaceLike): string {
  const typesText = toTypesArray(place.types).join(" ");
  return normalizeText([
    place.name,
    place.description,
    place.notes,
    typesText,
    place.source,
  ].filter(Boolean).join(" "));
}

export function tagPlaceDeterministic(place: PlaceLike): {
  version: string;
  tags: string[];
  tagEvidence: Record<string, string[]>;
} {
  const text = buildPlaceTextForTagging(place);
  const tags: string[] = [];
  const tagEvidence: Record<string, string[]> = {};

  TAG_RULES.forEach((rule) => {
    const matches = rule.patterns.filter((pattern) => text.includes(pattern));
    if (matches.length === 0) return;
    tags.push(rule.tag);
    tagEvidence[rule.tag] = matches;
  });

  if (typeof place.specialtyScore === "number" && place.specialtyScore >= 80 && !tags.includes("specialty_coffee")) {
    tags.push("specialty_coffee");
    tagEvidence["specialty_coffee"] = [`specialtyScore:${Math.round(place.specialtyScore)}`];
  }

  return {
    version: AGENT_TAGGING_VERSION,
    tags: tags.sort((a, b) => a.localeCompare(b)),
    tagEvidence,
  };
}
