/**
 * Represents a single action point in time.
 * @typedef {object} Action
 * @property {number} at - Timestamp in milliseconds.
 * @property {number} pos - Position (0 to 100).
 */

/**
 * Calculates the position at a specific time between two actions using linear interpolation.
 * @param {Action} a0 - The action before the target time.
 * @param {Action} a1 - The action after the target time.
 * @param {number} time - The target time in milliseconds.
 * @returns {number} The interpolated position (0-100).
 */
function interpolatePosition(a0, a1, time) {
  // Handle edge cases or invalid input
  if (!a0) return a1 ? a1.pos : 0;
  if (!a1) return a0.pos;
  if (a0.at === a1.at) return a0.pos;
  if (time <= a0.at) return a0.pos;
  if (time >= a1.at) return a1.pos;

  // Linear interpolation
  const timeFraction = (time - a0.at) / (a1.at - a0.at);
  return a0.pos + (a1.pos - a0.pos) * timeFraction;
}

/**
* Calculates thrust intensity based on the total absolute position change
* within a moving window, scaled so that 4 full thrusts/sec corresponds to an
* intensity value of 100. Outputs the raw calculated value without clamping or rounding.
*
* @param {Action[]} actions - Sorted array of input actions {at, pos}.
* @param {number} sampleRateMs - The interval for output samples (e.g., 50ms).
* @param {number} windowRadiusMs - The radius of the moving window (e.g., 200ms for a 400ms total window).
* @returns {Action[]} A new array of actions {at, pos} where pos is the raw calculated thrust intensity.
*/
export function calculateThrustIntensityByScaledSpeed(
  actions,
  sampleRateMs = 50,
  windowRadiusMs = 200
) {
  if (!actions || actions.length < 2) {
    return [];
  }

  actions.sort((a, b) => a.at - b.at);

  const outputActions = [];
  const minTime = actions[0].at;
  const maxTime = actions[actions.length - 1].at;

  // Scaling factor derived from: 4 thrusts/sec = 100 intensity
  // 4 thrusts/sec * 200% change/thrust = 800% change/sec target speed
  // Intensity = (Speed(%/sec) / 800) * 100
  // Intensity = (Speed(%/ms) * 1000 / 800) * 100
  // Intensity = Speed(%/ms) * 125
  // Intensity = (totalChange / durationMs) * 125
  const SCALING_FACTOR = 125;

  if (minTime > 0) {
    outputActions.push({ at: 0, pos: 0 });
  }

  for (let t = 0; t <= maxTime; t += sampleRateMs) {
    const windowStart = Math.max(0, t - windowRadiusMs);
    const windowEnd = Math.min(maxTime, t + windowRadiusMs);
    const windowDurationMs = windowEnd - windowStart;

    let rawIntensity = 0; // Initialize intensity for this sample

    if (windowDurationMs > 0) {
      // Find the last action *before* or *at* windowStart
      let startBoundaryAction = null;
      for (let i = actions.length - 1; i >= 0; i--) {
        if (actions[i].at <= windowStart) {
          startBoundaryAction = actions[i];
          break;
        }
      }
      if (!startBoundaryAction) startBoundaryAction = actions[0];

      // Find the first action *after* or *at* windowEnd
      let endBoundaryAction = null;
      for (let i = 0; i < actions.length; i++) {
        if (actions[i].at >= windowEnd) {
          endBoundaryAction = actions[i];
          break;
        }
      }
      if (!endBoundaryAction) endBoundaryAction = actions[actions.length - 1];

      // Create list of points relevant to the window's change calculation
      const effectivePoints = [];

      // Interpolate position at the exact start of the window
      let prevActionForStart = startBoundaryAction;
      let nextActionForStart = actions.find(a => a.at > prevActionForStart.at);
      const positionAtWindowStart = interpolatePosition(prevActionForStart, nextActionForStart, windowStart);
      effectivePoints.push({ at: windowStart, pos: positionAtWindowStart });

      // Add all original actions strictly within the window interval
      actions.forEach(a => {
        if (a.at > windowStart && a.at < windowEnd) {
          effectivePoints.push(a);
        }
      });

      // Interpolate position at the exact end of the window
      let prevActionForEnd = actions.slice().reverse().find(a => a.at < windowEnd);
      if (!prevActionForEnd) prevActionForEnd = startBoundaryAction;
      let nextActionForEnd = endBoundaryAction;
      const positionAtWindowEnd = interpolatePosition(prevActionForEnd, nextActionForEnd, windowEnd);
      effectivePoints.push({ at: windowEnd, pos: positionAtWindowEnd });

      // Calculate sum of absolute differences between consecutive effective points
      let totalPositionChange = 0;
      for (let i = 0; i < effectivePoints.length - 1; i++) {
        if (effectivePoints[i + 1].at > effectivePoints[i].at) {
          totalPositionChange += Math.abs(effectivePoints[i + 1].pos - effectivePoints[i].pos);
        }
      }

      // Calculate intensity using the derived scaling factor
      // *** REMOVED Clamping and Rounding ***
      rawIntensity = (totalPositionChange / windowDurationMs) * SCALING_FACTOR;

      // Handle potential NaN/Infinity if windowDurationMs was somehow zero despite check
      if (!isFinite(rawIntensity)) {
        rawIntensity = 0;
      }

    } else {
      rawIntensity = 0; // Handle zero duration window
    }

    const roundedTime = Math.round(t / sampleRateMs) * sampleRateMs;

    // Assign the raw calculated intensity
    if (outputActions.length > 0 && outputActions[outputActions.length - 1].at === roundedTime) {
      outputActions[outputActions.length - 1].pos = rawIntensity;
    } else {
      outputActions.push({ at: roundedTime, pos: rawIntensity });
    }
  }

  return outputActions;
}

// --- Example Usage ---

// Assuming inputData.actions is loaded from your file 'values.txt'
// const inputData = { /* ... load data from values.txt ... */ }; // Make sure to load the actual data here

// const intensityActions = calculateThrustIntensityByScaledSpeed(inputData.actions, 50, 200);

// console.log(JSON.stringify({"actions": intensityActions}));