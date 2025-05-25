import type { InstructionDescriptor } from './instructionDecoder';

export type ConflictType =
  | 'DATA_HAZARD'
  | 'STRUCTURAL_HAZARD'
  | 'CONTROL_HAZARD'
  | 'NO_CONFLICT';
export type PipelinePhase = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';

export interface ConflictDetails {
  conflictType: ConflictType;
  conflictDescription: string;
  bypassAvailable: boolean;
  bubblesRequired: number;
}

export interface DataPathForward {
  sourceInstruction: number;
  targetInstruction: number;
  sourcePhase: PipelinePhase;
  targetPhase: PipelinePhase;
  forwardedRegister: string;
}

export interface HazardAnalysisResult {
  conflicts: Record<number, ConflictDetails>;
  forwards: Record<number, DataPathForward[]>;
  bubbles: Record<number, number>;
}

export function analyzeInstructionConflicts(
  instructions: string[],
  instructionFormats: Record<number, InstructionDescriptor>,
  forwardingEnabled: boolean,
  stallsEnabled: boolean
): HazardAnalysisResult {
  const conflicts: Record<number, ConflictDetails> = {};
  const forwards: Record<number, DataPathForward[]> = {};
  const bubbles: Record<number, number> = {};
  instructions.forEach((_, idx) => {
    conflicts[idx] = {
      conflictType: 'NO_CONFLICT',
      conflictDescription: 'No dependency detected',
      bypassAvailable: false,
      bubblesRequired: 0,
    };
    forwards[idx] = [];
    bubbles[idx] = 0;
  });

  for (let i = 1; i < instructions.length; i++) {
    const currentDesc = instructionFormats[i];
    if (currentDesc.format === 'J_FORMAT') continue;
    const j = i - 1;
    const prevDesc = instructionFormats[j];
    if (prevDesc.targetReg === 0) continue;
    const hasRAW = checkRAWDependency(currentDesc, prevDesc);

    if (hasRAW) {
      const dependentRegister = getDependentRegister(currentDesc, prevDesc);
      const hazardResult = processHazard(
        i,
        j,
        dependentRegister,
        prevDesc,
        forwardingEnabled,
        stallsEnabled
      );

      conflicts[i] = hazardResult.conflict;
      if (hazardResult.forward) {
        forwards[i] = [hazardResult.forward];
      }
      if (hazardResult.bubbleCount > 0) {
        bubbles[i] = hazardResult.bubbleCount;
      }
    }
  }

  return { conflicts, forwards, bubbles };
}

function checkRAWDependency(
  current: InstructionDescriptor,
  previous: InstructionDescriptor
): boolean {
  return (
    (current.sourceReg1 === previous.targetReg && current.sourceReg1 !== 0) ||
    (current.sourceReg2 === previous.targetReg && current.sourceReg2 !== 0)
  );
}

function getDependentRegister(
  current: InstructionDescriptor,
  previous: InstructionDescriptor
): number {
  return current.sourceReg1 === previous.targetReg
    ? current.sourceReg1
    : current.sourceReg2;
}

function processHazard(
  currentIdx: number,
  previousIdx: number,
  dependentRegister: number,
  prevDesc: InstructionDescriptor,
  forwardingEnabled: boolean,
  stallsEnabled: boolean
) {
  if (prevDesc.isLoadWord) {
    return processLoadUseHazard(
      currentIdx,
      previousIdx,
      dependentRegister,
      forwardingEnabled,
      stallsEnabled
    );
  } else {
    return processRegularRAWHazard(
      currentIdx,
      previousIdx,
      dependentRegister,
      forwardingEnabled,
      stallsEnabled
    );
  }
}

function processLoadUseHazard(
  currentIdx: number,
  previousIdx: number,
  dependentRegister: number,
  forwardingEnabled: boolean,
  stallsEnabled: boolean
) {
  if (stallsEnabled) {
    const conflict: ConflictDetails = {
      conflictType: 'DATA_HAZARD',
      conflictDescription: `Load-use hazard on $${dependentRegister}`,
      bypassAvailable: forwardingEnabled,
      bubblesRequired: 1,
    };

    const forward = forwardingEnabled
      ? {
          sourceInstruction: previousIdx,
          targetInstruction: currentIdx,
          sourcePhase: 'MEM' as PipelinePhase,
          targetPhase: 'EX' as PipelinePhase,
          forwardedRegister: `${dependentRegister}`,
        }
      : null;

    return {
      conflict,
      forward,
      bubbleCount: 1,
    };
  } else {
    return {
      conflict: {
        conflictType: 'NO_CONFLICT',
        conflictDescription: 'Load-use dependency ignored (stalls disabled)',
        bypassAvailable: false,
        bubblesRequired: 0,
      } as ConflictDetails,
      forward: null,
      bubbleCount: 0,
    };
  }
}

function processRegularRAWHazard(
  currentIdx: number,
  previousIdx: number,
  dependentRegister: number,
  forwardingEnabled: boolean,
  stallsEnabled: boolean
) {
  if (forwardingEnabled) {
    const conflict: ConflictDetails = {
      conflictType: 'NO_CONFLICT',
      conflictDescription: `RAW on $${dependentRegister} (forwarded)`,
      bypassAvailable: true,
      bubblesRequired: 0,
    };

    const forward: DataPathForward = {
      sourceInstruction: previousIdx,
      targetInstruction: currentIdx,
      sourcePhase: 'EX',
      targetPhase: 'EX',
      forwardedRegister: `${dependentRegister}`,
    };

    return { conflict, forward, bubbleCount: 0 };
  } else if (stallsEnabled) {
    const conflict: ConflictDetails = {
      conflictType: 'DATA_HAZARD',
      conflictDescription: `RAW on $${dependentRegister} (no forwarding)`,
      bypassAvailable: false,
      bubblesRequired: 2,
    };

    return { conflict, forward: null, bubbleCount: 2 };
  } else {
    return {
      conflict: {
        conflictType: 'NO_CONFLICT',
        conflictDescription:
          'RAW dependency ignored (forwarding and stalls disabled)',
        bypassAvailable: false,
        bubblesRequired: 0,
      } as ConflictDetails,
      forward: null,
      bubbleCount: 0,
    };
  }
}
