const PATTERN_GENERATION_RATE = 100; // ms
const PATTERN_GENERATION_TICK_MAX_CHANGE = 10; // %
const TARGET_MIN = 0; // machine value
const TARGET_MAX = 100; // machine value

export const intensityPattern = (actions) => {
  const newActions = createNewPositions(actions, intensityPosition);
  const smoothed = smoothPattern(newActions, PATTERN_GENERATION_RATE, PATTERN_GENERATION_TICK_MAX_CHANGE);
  return normalizePattern(smoothed.actions, smoothed.min, smoothed.max, TARGET_MIN, TARGET_MAX);
};

const intensityPosition = (a0, a1) => {
  const deltaPos = Math.abs(a1.pos - a0.pos);
  const deltaTime = a1.at - a0.at;
  return Math.min(100, Math.floor((deltaPos / deltaTime) * 100));
};

const createNewPositions = (actions, positionFunction) => {
  const length = actions.length - 1;
  for (let i = 0; i < length; i++) {
    actions[i].pos = positionFunction(actions[i], actions[i + 1]);
  }
  return actions;
};

const smoothPattern = (newActions, patternGenerationRate, patternGenerationTickMaxChange) => {
  return teaseSmoothPattern(newActions, patternGenerationRate, patternGenerationTickMaxChange);
};

const normalizePattern = (actions, min, max, targetMin, targetMax) => {
  return teaseNormalizePattern(actions, min, max, targetMin, targetMax);
};

const teaseNormalizePattern = (actions, min, max, targetMin, targetMax) => {
  if (!actions) return actions;

  const range = max - min;
  const targetRange = targetMax - targetMin;

  return actions.map((action) => {
    const normalizedPos = ((action.pos - min) / range) * targetRange + targetMin;
    return { ...action, pos: Math.floor(normalizedPos) };
  });
};

const teaseSmoothPattern = (actions, patternGenerationRate, patternGenerationTickMaxChange) => {
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
      }
    } else {
      sample += Math.max(1, samplesLeft - steps + 1) - 1; // Adjust sample increment
    }
  }

  return {
    min,
    max,
    actions: newActions,
  };
};