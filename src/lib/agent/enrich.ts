import type { PlaceAgentData, PlaceAgentImage, PlaceAgentSource, PlaceAgentStory, PlaceLike } from "../../types/place";
import { scorePlaceDeterministic } from "./scoring";
import { tagPlaceDeterministic } from "./tagging";

function firstSentence(value: unknown): string {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const idx = text.search(/[.!?]/);
  if (idx === -1) return text.slice(0, 180);
  return text.slice(0, Math.min(idx + 1, 180));
}

function toStory(summary: string, sourceIds?: string[]): PlaceAgentStory {
  return {
    summary,
    status: "draft",
    sourceIds,
  };
}

function buildStory(place: PlaceLike, tags: string[]): PlaceAgentStory | undefined {
  const fromNotes = firstSentence(place.notes || place.description);
  if (fromNotes) {
    const sourceIds: string[] = [];
    if (place.notes) sourceIds.push("notes");
    if (!place.notes && place.description) sourceIds.push("description");
    return toStory(fromNotes, mergeStorySourceIds(place, sourceIds));
  }
  if (tags.length === 0) return undefined;

  const prettyTags = tags
    .slice(0, 3)
    .map((tag) => tag.replace(/_/g, " "))
    .join(", ");

  return toStory(`Known for ${prettyTags}.`, mergeStorySourceIds(place, ["tags"]));
}

function getDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function toPrettyDomain(domain?: string): string {
  const normalized = String(domain || "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.replace(/^www\./, "");
}

function getPreferredStorySourceId(place: PlaceLike): string | undefined {
  if (place.website) return "website";
  if (place.sourceUrl) return "source-url";
  if (place.googleMapsUrl) return "google-maps-url";
  if (place.gmapsLink) return "gmaps-link";
  return undefined;
}

function mergeStorySourceIds(place: PlaceLike, sourceIds: string[]): string[] | undefined {
  const preferred = getPreferredStorySourceId(place);
  const next = [...sourceIds];
  if (preferred && !next.includes(preferred)) {
    next.push(preferred);
  }
  return next.length > 0 ? next : undefined;
}

function collectSources(place: PlaceLike): PlaceAgentSource[] {
  const sources: PlaceAgentSource[] = [];

  const websiteUrl = place.website ? String(place.website) : "";
  const sourceUrl = place.sourceUrl ? String(place.sourceUrl) : "";
  const googleMapsUrl = place.googleMapsUrl ? String(place.googleMapsUrl) : "";
  const gmapsLinkUrl = place.gmapsLink ? String(place.gmapsLink) : "";

  const websiteDomain = toPrettyDomain(getDomain(websiteUrl));
  const sourceDomain = toPrettyDomain(getDomain(sourceUrl));

  if (websiteUrl) {
    sources.push({
      id: "website",
      type: "website",
      title: websiteDomain ? `Official website (${websiteDomain})` : "Official website",
      url: websiteUrl,
      domain: websiteDomain || getDomain(websiteUrl),
    });
  }

  if (sourceUrl) {
    const sourceTitle = sourceDomain
      ? sourceDomain === websiteDomain && websiteDomain
        ? "Source (official site)"
        : `Source (${sourceDomain})`
      : "Source";

    sources.push({
      id: "source-url",
      type: "source_url",
      title: sourceTitle,
      url: sourceUrl,
      domain: sourceDomain || getDomain(sourceUrl),
    });
  }

  if (googleMapsUrl) {
    sources.push({
      id: "google-maps-url",
      type: "map",
      title: "Google Maps",
      url: googleMapsUrl,
      domain: getDomain(googleMapsUrl),
    });
  }

  if (gmapsLinkUrl) {
    sources.push({
      id: "gmaps-link",
      type: "map",
      title: "Google Maps",
      url: gmapsLinkUrl,
      domain: getDomain(gmapsLinkUrl),
    });
  }

  if (place.source) {
    sources.push({
      id: "source-primary",
      type: "dataset",
      title: String(place.source).toUpperCase(),
    });
  }

  const dedupedById = new Map<string, PlaceAgentSource>();
  sources.forEach((source) => {
    if (!dedupedById.has(source.id)) {
      dedupedById.set(source.id, source);
    }
  });

  return Array.from(dedupedById.values());
}

function toNonEmptyString(value: unknown): string | undefined {
  const text = String(value || "").trim();
  return text ? text : undefined;
}

function getWebsiteImageCandidate(place: PlaceLike): string | undefined {
  const candidates = [
    place.websiteOgImage,
    place.websiteOgImageUrl,
    place.ogImage,
    place.ogImageUrl,
    place.siteImage,
    place.siteImageUrl,
    place.image,
    place.imageUrl,
  ];

  for (const candidate of candidates) {
    const url = toNonEmptyString(candidate);
    if (url) return url;
  }

  return undefined;
}

function getImageAttributionFromWebsite(place: PlaceLike): string | undefined {
  const fromWebsite = toPrettyDomain(getDomain(String(place.website || "")));
  if (fromWebsite) return fromWebsite;
  const fromSource = toPrettyDomain(getDomain(String(place.sourceUrl || "")));
  return fromSource || undefined;
}

function isKnownBrokenPhotoUrl(url: string): boolean {
  // Google's place-photos/AL8-* CDN path requires authentication and returns 403 in browser context
  return url.includes("/place-photos/AL8");
}

function resolveAgentImage(place: PlaceLike): { image?: PlaceAgentImage; imageStatus: "ok" | "missing" } {
  const googleImageUrl = toNonEmptyString(place.photoUrl);
  if (googleImageUrl && !isKnownBrokenPhotoUrl(googleImageUrl)) {
    return {
      image: { url: googleImageUrl, source: "google", attribution: "google-maps" },
      imageStatus: "ok",
    };
  }

  const websiteImageUrl = getWebsiteImageCandidate(place);
  if (websiteImageUrl) {
    return {
      image: {
        url: websiteImageUrl,
        source: "website",
        attribution: getImageAttributionFromWebsite(place) || undefined,
      },
      imageStatus: "ok",
    };
  }

  return { image: undefined, imageStatus: "missing" };
}

function buildAgentData(place: PlaceLike): PlaceAgentData {
  const tagging = tagPlaceDeterministic(place);
  const score = scorePlaceDeterministic(place, tagging.tags);
  const story = buildStory(place, tagging.tags);
  const sources = collectSources(place);
  const { image, imageStatus } = resolveAgentImage(place);

  return {
    story,
    sources,
    tags: tagging.tags,
    tagEvidence: tagging.tagEvidence,
    score,
    enrichmentStatus: tagging.tags.length > 0 ? "scored" : "none",
    ...(image ? { image } : {}),
    imageStatus,
  };
}

export function enrichPlaceWithAgent<T extends PlaceLike>(place: T): T & { agent: PlaceAgentData } {
  const existing = place?.agent;
  if (existing && typeof existing === "object") {
    return place as T & { agent: PlaceAgentData };
  }

  return {
    ...place,
    agent: buildAgentData(place),
  };
}
