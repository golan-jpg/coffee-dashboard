import type { PlaceAgentData } from "../../types/place";

type QualityLevel = "strong" | "medium" | "weak";
type ScoreBand = "elite" | "high" | "medium" | "low";
export type CoffeeQualityBucket = "coffee_led" | "mixed" | "weak";

export interface AgentReviewSummary {
  scoreBand: ScoreBand;
  sourceQuality: QualityLevel;
  storyQuality: QualityLevel;
  coffeeQualityBucket: CoffeeQualityBucket;
  flags: string[];
  scoreBreakdown: Array<{ key: string; points: number }>;
}

const COFFEE_LEADING_TAGS = new Set([
  "specialty_coffee",
  "roastery",
  "espresso_bar",
  "pour_over",
  "v60",
  "chemex",
  "aeropress",
]);

const BAKERY_BRUNCH_TAGS = new Set(["bakery", "brunch"]);

const COFFEE_RELEVANT_TAGS = new Set([
  ...Array.from(COFFEE_LEADING_TAGS),
  "coffee",
  "cafe",
  "coffee_shop",
]);

function getScoreBand(scoreValue: number): ScoreBand {
  if (scoreValue >= 85) return "elite";
  if (scoreValue >= 70) return "high";
  if (scoreValue >= 50) return "medium";
  return "low";
}

function getSourceQuality(agent: PlaceAgentData): QualityLevel {
  const sources = Array.isArray(agent.sources) ? agent.sources : [];
  const withUrl = sources.filter((source) => Boolean(source?.url));
  const sourceTypes = new Set(withUrl.map((source) => String(source?.type || "").toLowerCase()));
  const uniqueDomains = new Set(withUrl.map((source) => source.domain).filter(Boolean));

  const hasWebsite = sourceTypes.has("website");
  const hasSourceUrl = sourceTypes.has("source_url");
  const hasMap = sourceTypes.has("map");
  const onlyMapSources = withUrl.length > 0 && hasMap && !hasWebsite && !hasSourceUrl;

  if (hasWebsite && (hasSourceUrl || hasMap) && uniqueDomains.size >= 1) return "strong";
  if (onlyMapSources) return "weak";
  if (hasWebsite || hasSourceUrl) return "medium";

  if (sources.length >= 2 && withUrl.length >= 1 && uniqueDomains.size >= 1) return "strong";
  if (sources.length >= 1) return "medium";
  return "weak";
}

function isGoogleMapsOnly(agent: PlaceAgentData): boolean {
  const sources = Array.isArray(agent.sources) ? agent.sources : [];
  const withUrl = sources.filter((source) => Boolean(source?.url));
  if (withUrl.length === 0) return false;

  const urlTypes = new Set(withUrl.map((source) => String(source?.type || "").toLowerCase()));
  return urlTypes.has("map") && !urlTypes.has("website") && !urlTypes.has("source_url");
}

export function getCoffeeQualityBucket(agent: PlaceAgentData): CoffeeQualityBucket {
  const tags = Array.isArray(agent?.tags) ? agent.tags : [];
  const sourceQuality = getSourceQuality(agent);
  const scoreBand = getScoreBand(Number(agent?.score?.value || 0));

  const hasCoffeeLeadingTag = tags.some((tag) => COFFEE_LEADING_TAGS.has(tag));
  const hasBakeryOrBrunch = tags.some((tag) => BAKERY_BRUNCH_TAGS.has(tag));
  const hasCoffeeRelevantTag = tags.some((tag) => COFFEE_RELEVANT_TAGS.has(tag));

  if (scoreBand === "low" || sourceQuality === "weak") {
    return "weak";
  }

  if (!hasCoffeeLeadingTag) {
    if (hasBakeryOrBrunch && hasCoffeeRelevantTag) return "mixed";
    return "weak";
  }

  if (hasBakeryOrBrunch && (hasCoffeeLeadingTag || hasCoffeeRelevantTag)) return "mixed";
  if (hasCoffeeLeadingTag) return "coffee_led";
  return "weak";
}

export function getCoffeeQualityLabel(bucket: CoffeeQualityBucket): string {
  if (bucket === "coffee_led") return "Coffee-led";
  if (bucket === "mixed") return "Mixed";
  return "Weak";
}

function getStoryQuality(agent: PlaceAgentData): QualityLevel {
  const summary = String(agent.story?.summary || "").trim();
  if (!summary) return "weak";

  const words = summary.split(/\s+/).filter(Boolean).length;
  const hasProvenance = Array.isArray(agent.story?.sourceIds) && agent.story.sourceIds.length > 0;

  if (words >= 8 && words <= 45 && hasProvenance) return "strong";
  return "medium";
}

export function computeAgentReview(agent: PlaceAgentData): AgentReviewSummary {
  const scoreValue = Number(agent?.score?.value || 0);
  const scoreComponents = Array.isArray(agent?.score?.components) ? agent.score.components : [];
  const flags: string[] = [];
  const sourceQuality = getSourceQuality(agent);
  const scoreBand = getScoreBand(scoreValue);
  const coffeeQualityBucket = getCoffeeQualityBucket(agent);

  const scoreSum = scoreComponents.reduce((sum, component) => sum + Number(component?.points || 0), 0);
  if (scoreComponents.length === 0) flags.push("low_score");
  if (Math.round(scoreSum) !== Math.round(scoreValue)) flags.push("score_mismatch");

  if (!Array.isArray(agent?.sources) || agent.sources.length === 0) {
    flags.push("missing_sources");
  } else if (sourceQuality === "weak") {
    flags.push("weak_sources");
  }

  if (isGoogleMapsOnly(agent)) {
    flags.push("google_maps_only");
  }

  if (!String(agent?.story?.summary || "").trim()) flags.push("missing_story");

  if (scoreBand === "low") flags.push("low_score");

  const tags = Array.isArray(agent?.tags) ? agent.tags : [];
  const hasSpecialtySignals = tags.some((tag) => COFFEE_LEADING_TAGS.has(tag));
  if (!hasSpecialtySignals) flags.push("no_specialty_signals");
  if (coffeeQualityBucket === "weak") flags.push("coffee_profile_weak");

  const uniqueFlags = Array.from(new Set(flags));

  return {
    scoreBand,
    sourceQuality,
    storyQuality: getStoryQuality(agent),
    coffeeQualityBucket,
    flags: uniqueFlags,
    scoreBreakdown: [...scoreComponents].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
  };
}
