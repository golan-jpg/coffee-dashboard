import { useMemo } from "react";
import { SCORING_PRESETS, DEFAULT_WEIGHT_KEYS } from "../utils/calculateSpecialtyScore";
import "./AdvancedScoringPanel.css";

function AdvancedScoringPanel({ scoringMode, weights, onWeightsChange }) {
  const weightLabels = {
    specialtyKeywords: "Specialty Keywords",
    roaster: "Roaster",
    website: "Website",
    openingHours: "Opening Hours",
    wifiAccess: "WiFi Access",
    chainPenalty: "Chain Penalty",
    genericPenalty: "Generic Penalty",
    restaurantPenalty: "Restaurant Penalty",
  };

  const weightRanges = {
    specialtyKeywords: { min: -30, max: 50 },
    roaster: { min: -30, max: 50 },
    website: { min: -10, max: 20 },
    openingHours: { min: -10, max: 20 },
    wifiAccess: { min: -10, max: 20 },
    chainPenalty: { min: -100, max: 0 },
    genericPenalty: { min: -100, max: 0 },
    restaurantPenalty: { min: -100, max: 0 },
  };

  const currentPreset = SCORING_PRESETS[scoringMode];
  
  // Determine if current weights match preset
  const isCustomMode = useMemo(() => {
    if (!currentPreset) return true;
    return DEFAULT_WEIGHT_KEYS.some(
      key => Math.abs(weights[key] - currentPreset[key]) > 0.01
    );
  }, [weights, currentPreset]);

  const handleWeightChange = (key, value) => {
    onWeightsChange({
      ...weights,
      [key]: parseFloat(value),
    });
  };

  const handleResetToPreset = () => {
    if (currentPreset) {
      onWeightsChange({
        ...weights,
        ...DEFAULT_WEIGHT_KEYS.reduce((acc, key) => {
          acc[key] = currentPreset[key];
          return acc;
        }, {}),
      });
    }
  };

  return (
    <div className="advanced-scoring-panel">
      <div className="panel-header">
        <h3>Advanced Scoring</h3>
        <span className={`mode-badge ${isCustomMode ? "custom" : "preset"}`}>
          {isCustomMode ? "Custom" : currentPreset?.label || "Custom"}
        </span>
      </div>

      {isCustomMode && (
        <button className="reset-button" onClick={handleResetToPreset}>
          Reset to {currentPreset?.label || "Balanced"}
        </button>
      )}

      <div className="weights-container">
        {DEFAULT_WEIGHT_KEYS.map((key) => (
          <div key={key} className="weight-input-group">
            <label htmlFor={`weight-${key}`}>
              {weightLabels[key]}
              <span className="value">{weights[key]}</span>
            </label>
            <input
              id={`weight-${key}`}
              type="range"
              min={weightRanges[key].min}
              max={weightRanges[key].max}
              step="1"
              value={weights[key]}
              onChange={(e) => handleWeightChange(key, e.target.value)}
              className={`slider ${key.includes("Penalty") ? "penalty" : "bonus"}`}
            />
            <div className="range-labels">
              <span className="min">{weightRanges[key].min}</span>
              <span className="max">{weightRanges[key].max}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AdvancedScoringPanel;
