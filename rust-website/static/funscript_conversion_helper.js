const PATTERN_GENERATION_RATE = 100; // ms
const PATTERN_GENERATION_TICK_MAX_CHANGE = 10; // %
const TARGET_MIN = 0; // hard limit
const TARGET_MAX = 100; // hard limit

export const intensityPattern = (actions) => {
  if (actions.length > 0) {
    actions[0].pos = 0;
    actions[actions.length - 1].pos = 0;
  }
  const newActions = createNewPositions(actions);
  const smoothed = smoothPattern(newActions, PATTERN_GENERATION_RATE, PATTERN_GENERATION_TICK_MAX_CHANGE);
  return normalizePattern(smoothed.actions);
};

const intensityPosition = (a0, a1) => {
  const deltaPos = Math.abs(a1.pos - a0.pos);
  const deltaTime = a1.at - a0.at;
  return Math.min(100, Math.floor((deltaPos / deltaTime) * 100));
};

const createNewPositions = (actions) => {
  const length = actions.length - 1;
  for (let i = 0; i < length; i++) {
    actions[i].pos = intensityPosition(actions[i], actions[i + 1]);
  }
  return actions;
};

const normalizePattern = (actions) => {
  if (!actions) return actions;

  const multiplier = window.intensityMultiplier || 1.0; // Default to 1.0 if not set

  return actions.map((action) => {
    return { ...action, pos: Math.min(TARGET_MAX, Math.max(TARGET_MIN, Math.floor(action.pos * multiplier))) };
  });
};

const smoothPattern = (actions, patternGenerationRate, patternGenerationTickMaxChange) => {
  const length = actions[actions.length - 1].at;
  const inverseRate = 1 / patternGenerationRate;
  const inverseTickChange = 1 / patternGenerationTickMaxChange;
  const totalSamples = Math.floor(length * inverseRate);

  let current = 0;
  let actionIndex = 0;
  let previousPosition = 0;
  let position = 0;
  const newActions = [];

  let max = 0;
  let min = null;
  let a1 = actions[0];
  let a0 = a1;
  let sample = (a0.at * inverseRate) - (100 * inverseTickChange);

  const pauseThreshold = 500; // Keep pos at 0 for 500ms after a pause
  let lastNonZeroTime = 0;

  for (; sample < totalSamples; sample++) {
    const ms = sample * patternGenerationRate;

    if (a1.at < ms && actionIndex < actions.length - 1) {
      const old = a1;
      let positions = 0;
      previousPosition = position;

      while (a1.at < ms && actionIndex < actions.length - 1) {
        a0 = a1;
        actionIndex++;
        a1 = actions[actionIndex];
        positions += a1.pos * (a1.at - a0.at);
      }

      position = Math.floor(positions / (a1.at - old.at));
    }

    const distFromNow = a1.at - ms;
    const dpos = position - previousPosition;
    const steps = Math.ceil(Math.abs(dpos) * inverseTickChange);
    const samplesLeft = Math.floor(distFromNow * inverseRate);

    // Adjust ramp-up based on the duration of the pause
    const pauseDuration = ms - (newActions.length > 0 ? newActions[newActions.length - 1].at : 0);

    if (pauseDuration > pauseThreshold && current === 0) {
      // Keep pos at 0 during the pause threshold
      newActions.push({
        at: ms,
        pos: 0,
      });
      continue;
    }

    if (steps >= samplesLeft) {
      const target = position;

      if (current !== target) {
        current += Math.sign(target - current) * Math.min(Math.abs(target - current), patternGenerationTickMaxChange);
        current = Math.max(0, Math.min(100, current));

        max = Math.max(max, current);
        min = min === null ? current : Math.min(min, current);

        newActions.push({
          at: ms,
          pos: current,
        });

        if (current > 0) {
          lastNonZeroTime = ms;
        }
      }
    } else {
      sample += Math.max(1, samplesLeft - steps + 1) - 1; // Adjust sample increment
    }
  }

  // Handle looping or fading (unchanged)
  if (window.isLoopEnabled && newActions.length > 0) {
    const firstAction = newActions[0];
    const lastAction = newActions[newActions.length - 1];
    const loopDeltaPos = firstAction.pos - lastAction.pos;
    const loopSteps = Math.ceil(Math.abs(loopDeltaPos) * inverseTickChange);

    for (let i = 1; i <= loopSteps; i++) {
      const loopMs = lastAction.at + i * patternGenerationRate;
      const loopPos = lastAction.pos + Math.sign(loopDeltaPos) * Math.min(Math.abs(loopDeltaPos), i * patternGenerationTickMaxChange);

      newActions.push({
        at: loopMs,
        pos: Math.max(0, Math.min(100, loopPos)),
      });
    }
  } else if (!window.isLoopEnabled && newActions.length > 0) {
    const fadeDuration = 1000; // 1 second in milliseconds
    const fadeSteps = Math.floor(fadeDuration / patternGenerationRate);
    for (let i = 0; i < fadeSteps; i++) {
      const fadeInFactor = i / fadeSteps;
      newActions[i].pos = Math.floor(newActions[i].pos * fadeInFactor);

      const fadeOutFactor = (fadeSteps - i) / fadeSteps;
      const index = newActions.length - (fadeSteps - i);
      newActions[index].pos = Math.floor(newActions[index].pos * fadeOutFactor);
    }
  }

  return {
    min,
    max,
    actions: newActions,
  };
};