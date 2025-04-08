const PATTERN_GENERATION_RATE = 50; // ms
const PATTERN_GENERATION_TICK_MAX_CHANGE = 10; // %
const useXtoysFunctions = false;

function intensityPosition(a0, a1) {
  return Math.min(100, Math.floor(Math.abs((a1.pos - a0.pos) / (a1.at - a0.at)) * 100));
}

function createNewPositions(actions, positionFunction) {
  for (var i = 0; i < actions.length - 1; i++) {
    actions[i].pos = positionFunction(actions[i], actions[i + 1]);
  }
  return actions;
}

export const intensityPattern = (actions) => {
  if (actions.length > 0) {
    actions[0].pos = 0;
    actions[actions.length - 1].pos = 0;
  }
  var newActions = createNewPositions(actions, intensityPosition);
  return facade_smoothPattern(newActions, PATTERN_GENERATION_RATE, PATTERN_GENERATION_TICK_MAX_CHANGE).actions;
};

function facade_smoothPattern(newActions, patternGenerationRate, patternGenerationTickMaxChange) {
  if (useXtoysFunctions) {
    return funscript_smoothPattern(newActions, patternGenerationRate, patternGenerationTickMaxChange);
  } else {
    return tease_smoothPattern(newActions, patternGenerationRate, patternGenerationTickMaxChange);
  }
}

function tease_smoothPattern(
  actions,
  patternGenerationRate,
  patternGenerationTickMaxChange
) {
  var length = actions.slice(-1).pop().at;
  var target = 0;
  var normalSamples = length / patternGenerationRate;
  var totalSamples = normalSamples;
  var current = 0;
  var actionIndex = 0;
  var previousPosition = 0;
  var position = 0;
  var newActions = [];

  var max = 0;
  var min = null;
  var a1 = actions[0];
  var a0 = a1;
  var sample = (a0.at / patternGenerationRate) - (100 / patternGenerationTickMaxChange);

  while (sample < totalSamples) {
    var ms = sample * patternGenerationRate;
    if (a1.at < ms && actionIndex < actions.length - 1) {
      var old = a1;
      var positions = 0;
      previousPosition = position;
      while (a1.at < ms && actionIndex < actions.length - 1) {
        a0 = a1;
        actionIndex++;
        a1 = actions[actionIndex];
        positions += a1.pos * (a1.at - a0.at);
      }
      position = Math.floor(positions / (a1.at - old.at));
    }
    var distFromNow = a1.at - ms;
    var dpos = position - previousPosition;
    var steps = Math.ceil(Math.abs(dpos) / patternGenerationTickMaxChange);
    var samplesLeft = Math.floor(distFromNow / patternGenerationRate);

    if (steps >= samplesLeft) {
      target = position;
      if (current != target) {
        if (current < target) {
          current += Math.min(target - current, patternGenerationTickMaxChange);
        } else {
          current -= Math.min(current - target, patternGenerationTickMaxChange);
        }
        current = Math.min(100, Math.max(0, current));
        if (max < current) {
          max = current;
        }
        if (min == null || min > current) {
          min = current;
        }
        newActions.push({
          'at': ms,
          'pos': current
        });
      }
      sample++;
    } else {
      var increase = (samplesLeft - steps + 1) > 1 ? samplesLeft - steps + 1 : 1;
      sample += Math.floor(increase);
    }
  }
  return {
    'min': min,
    'max': max,
    'actions': newActions
  };
}
