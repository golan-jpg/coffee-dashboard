import type { PlaceLike } from "../types/place";
import { computeAgentReview, getCoffeeQualityLabel } from "../lib/agent/review";

type PlaceAgentSectionProps = {
  place: PlaceLike;
  showReviewDetails?: boolean;
};

export default function PlaceAgentSection({ place, showReviewDetails = false }: PlaceAgentSectionProps) {
  const agent = place?.agent;
  if (!agent) return null;
  const review = showReviewDetails ? computeAgentReview(agent) : null;

  return (
    <section className="place-agent-section" aria-label="CupRoam agent summary">
      <div className="place-agent-row">
        <span className="place-agent-label">CupRoam Score</span>
        <strong className="place-agent-score">{Math.round(agent.score?.value || 0)}</strong>
      </div>

      {agent.story && (
        <p className="place-agent-story">{agent.story.summary}</p>
      )}

      {Array.isArray(agent.tags) && agent.tags.length > 0 && (
        <div className="place-agent-group">
          <span className="place-agent-label">Tags</span>
          <div className="place-agent-chips">
            {agent.tags.map((tag) => (
              <span key={tag} className="place-agent-chip">{tag}</span>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(agent.sources) && agent.sources.length > 0 && (
        <div className="place-agent-group">
          <span className="place-agent-label">Sources</span>
          <ul className="place-agent-sources">
            {agent.sources.map((source) => (
              <li key={source.id}>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}{source.domain ? ` (${source.domain})` : ""}
                  </a>
                ) : (
                  <span>{source.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {review && (
        <div className="place-agent-group place-agent-review">
          <span className="place-agent-label">Agent review</span>
          <ul className="place-agent-review-list">
            <li>Score band: <strong>{review.scoreBand}</strong></li>
            <li>Source quality: <strong>{review.sourceQuality}</strong></li>
            <li>Story quality: <strong>{review.storyQuality}</strong></li>
            <li>
              Coffee profile: <strong>{getCoffeeQualityLabel(review.coffeeQualityBucket)}</strong>
            </li>
          </ul>

          {review.flags.length > 0 ? (
            <div className="place-agent-flags">
              {review.flags.map((flag) => (
                <span key={flag} className="place-agent-flag">{flag}</span>
              ))}
            </div>
          ) : (
            <div className="place-agent-no-flags">No review flags</div>
          )}

          {review.scoreBreakdown.length > 0 && (
            <div className="place-agent-breakdown">
              <span className="place-agent-label">Score breakdown</span>
              <ul className="place-agent-breakdown-list">
                {review.scoreBreakdown.map((component) => (
                  <li key={component.key}>
                    <span>{component.key}</span>
                    <strong>{component.points > 0 ? `+${component.points}` : component.points}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
