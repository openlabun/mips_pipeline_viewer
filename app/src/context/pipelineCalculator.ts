const PIPELINE_STAGES = 5;
export interface PipelineState {
  phaseMap: Record<number, number | null>;
  activeBubbles: number;
  executionComplete: boolean;
  clockCycle: number;
}

export function calculateTotalCycles(
  instructionCount: number,
  totalBubbles: number
): number {
  return instructionCount + PIPELINE_STAGES - 1 + totalBubbles;
}

export function calculateTotalBubbles(bubbles: Record<number, number>): number {
  return Object.values(bubbles).reduce(
    (sum, bubbleCount) => sum + bubbleCount,
    0
  );
}

export function computePrecedingBubbles(
  bubbles: Record<number, number>,
  instructionIndex: number
): number {
  let totalBubbles = 0;
  for (let i = 0; i < instructionIndex; i++) {
    totalBubbles += bubbles[i] || 0;
  }
  return totalBubbles;
}

export function calculateNextPipelineState(
  currentState: PipelineState,
  instructions: string[],
  bubbles: Record<number, number>,
  totalCycles: number
): PipelineState {
  if (currentState.executionComplete) {
    return currentState;
  }

  const nextClock = currentState.clockCycle + 1;
  const updatedPhaseMap: Record<number, number | null> = {};

  let remainingBubbles = currentState.activeBubbles;
  if (remainingBubbles > 0) {
    remainingBubbles--;
    return {
      ...currentState,
      clockCycle: nextClock,
      activeBubbles: remainingBubbles,
    };
  }

  instructions.forEach((_, idx) => {
    const precedingBubbles = computePrecedingBubbles(bubbles, idx);
    const phaseIndex = nextClock - idx - 1 - precedingBubbles;

    if (phaseIndex >= 0 && phaseIndex < PIPELINE_STAGES) {
      updatedPhaseMap[idx] = phaseIndex;

      if (phaseIndex === 1 && bubbles[idx] > 0 && remainingBubbles === 0) {
        remainingBubbles = bubbles[idx];
      }
    } else {
      updatedPhaseMap[idx] = null;
    }
  });

  const isComplete = nextClock > totalCycles;

  return {
    phaseMap: updatedPhaseMap,
    activeBubbles: remainingBubbles,
    executionComplete: isComplete,
    clockCycle: isComplete ? totalCycles : nextClock,
  };
}

export function initializePipelineState(instructions: string[]): PipelineState {
  const initialPhaseMap: Record<number, number | null> = {};

  instructions.forEach((_, idx) => {
    const phaseIdx = 1 - idx - 1;
    if (phaseIdx >= 0 && phaseIdx < PIPELINE_STAGES) {
      initialPhaseMap[idx] = phaseIdx;
    } else {
      initialPhaseMap[idx] = null;
    }
  });

  return {
    phaseMap: initialPhaseMap,
    activeBubbles: 0,
    executionComplete: false,
    clockCycle: 1,
  };
}
