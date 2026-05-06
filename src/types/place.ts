export type AgentEnrichmentStatus = "none" | "tagged" | "scored";

export interface PlaceAgentScoreComponent {
  key: string;
  points: number;
}

export interface PlaceAgentScore {
  version: string;
  value: number;
  components: PlaceAgentScoreComponent[];
}

export interface PlaceAgentStory {
  summary: string;
  status: "draft";
  generatedAt?: string;
  sourceIds?: string[];
}

export interface PlaceAgentSource {
  id: string;
  type: string;
  title: string;
  url?: string;
  domain?: string;
}

export interface PlaceAgentImage {
  url: string;
  source: "google" | "website";
  attribution?: string;
}

export interface PlaceAgentData {
  story?: PlaceAgentStory;
  sources: PlaceAgentSource[];
  tags: string[];
  tagEvidence: Record<string, string[]>;
  score: PlaceAgentScore;
  enrichmentStatus: AgentEnrichmentStatus;
  image?: PlaceAgentImage;
  imageStatus?: "ok" | "missing";
}

export interface PlaceLike {
  id?: string | number;
  name?: string;
  types?: string[] | string;
  notes?: string;
  description?: string;
  source?: string;
  specialtyScore?: number;
  website?: string;
  sourceUrl?: string;
  gmapsLink?: string;
  googleMapsUrl?: string;
  agent?: PlaceAgentData;
  [key: string]: unknown;
}
