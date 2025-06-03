"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import * as React from "react";

import { cambioboton, haybranch, labelsigno, saltobranch } from "@/components/instruction-input";
import { setomabranch } from "@/components/instruction-input";

let pc: number = 0;
let pipelineChangePending: boolean;

export let alarma: boolean = false;
export let misses: number = 0;
export let botonn: boolean = false;

console.log("Debug botonn init:", botonn);

let currentBranchTakenState: boolean;
let branchLogicEntryCounter = 2;

const PIPELINE_STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type PipelineStageName = (typeof PIPELINE_STAGE_NAMES)[number];

type InstructionFormatType = "R" | "I" | "J";
type HazardSeverityType = "RAW" | "WAW" | "NONE";

interface InstructionRegisterDetails {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: InstructionFormatType;
  isLoad: boolean;
}

interface HazardEncounteredInfo {
  type: HazardSeverityType;
  description: string;
  canForward: boolean;
  stallCycles: number;
}

interface ForwardingPathInfo {
  from: number;
  to: number;
  fromStage: PipelineStageName;
  toStage: PipelineStageName;
  register: string;
}

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
  registerUsage: Record<number, InstructionRegisterDetails>;
  hazards: Record<number, HazardEncounteredInfo>;
  forwardings: Record<number, ForwardingPathInfo[]>;
  stalls: Record<number, number>;
  currentStallCycles: number;
  forwardingEnabled: boolean;
  stallsEnabled: boolean;
  branchEnabled?: boolean;
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void;
  setBranchEnabled: (enabled: boolean) => void;
}

const SimulationStateContext = createContext<SimulationState | undefined>(
  undefined
);
const SimulationActionsContext = createContext<SimulationActions | undefined>(
  undefined
);

const DEFAULT_PIPELINE_STAGE_COUNT = PIPELINE_STAGE_NAMES.length;

const initialSimulationState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_PIPELINE_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  registerUsage: {},
  hazards: {},
  forwardings: {},
  stalls: {},
  currentStallCycles: 0,
  forwardingEnabled: true,
  stallsEnabled: true,
};

const parseHexInstructionToDetails = (hexInstruction: string): InstructionRegisterDetails => {
  const binary = parseInt(hexInstruction, 16).toString(2).padStart(32, "0");
  const opcode = parseInt(binary.substring(0, 6), 2);
  const rs = parseInt(binary.substring(6, 11), 2);
  const rt = parseInt(binary.substring(11, 16), 2);

  let type: InstructionFormatType = "R";
  let rd = 0;
  let funct = 0;
  let isLoad = false;

  if (opcode === 0) {
    type = "R";
    rd = parseInt(binary.substring(16, 21), 2);
    funct = parseInt(binary.substring(26, 32), 2);
  } else if (opcode === 2 || opcode === 3) {
    type = "J";
    rd = opcode === 3 ? 31 : 0;
    funct = 0;
  } else {
    type = "I";
    if (opcode >= 32 && opcode <= 37) {
      rd = rt;
      isLoad = true;
    } else if (opcode >= 8 && opcode <= 15) {
      rd = rt;
    } else {
      rd = 0;
    }
  }
  return { rs, rt, rd, opcode, funct, type, isLoad };
};

const analyzeHazardsAndForwarding = (
  instructions: string[],
  regUsage: Record<number, InstructionRegisterDetails>,
  isForwardingAllowed: boolean,
  isStallDetectionActive: boolean
): [
  Record<number, HazardEncounteredInfo>,
  Record<number, ForwardingPathInfo[]>,
  Record<number, number>
] => {
  const hazards: Record<number, HazardEncounteredInfo> = {};
  const forwardings: Record<number, ForwardingPathInfo[]> = {};
  const stalls: Record<number, number> = {};

  instructions.forEach((_, index) => {
    hazards[index] = {
      type: "NONE",
      description: "No hazard",
      canForward: false,
      stallCycles: 0,
    };
    forwardings[index] = [];
    stalls[index] = 0;
  });

  botonn = isStallDetectionActive;

  if (!isStallDetectionActive) {
    return [hazards, forwardings, stalls];
  }

  for (let i = 1; i < instructions.length; i++) {
    const currentInst = regUsage[i];
    if (currentInst.type === "J") continue;

    const j = i - 1;
    const prevInst = regUsage[j];
    if (prevInst.rd === 0) continue;

    let hasRawHazard = false;
    let hazardRegister = "";

    if (currentInst.rs === prevInst.rd) {
      hasRawHazard = true;
      hazardRegister = `rs($${currentInst.rs})`;
    } else if (
      (currentInst.rt === prevInst.rd && currentInst.type !== "I") ||
      (currentInst.type === "I" && !currentInst.isLoad && currentInst.opcode !== 40 && currentInst.opcode !== 41 && currentInst.opcode !== 43)
    ) {
      hasRawHazard = true;
      hazardRegister = `rt($${currentInst.rt})`;
    }

    if (hasRawHazard) {
      if (prevInst.isLoad) {
        hazards[i] = {
          type: "RAW",
          description: `Load-use hazard: ${hazardRegister} depends on lw in instruction ${j}`,
          canForward: isForwardingAllowed,
          stallCycles: 1,
        };
        stalls[i] = 1;
        if (isForwardingAllowed) {
          forwardings[i] = [{
            from: j, to: i, fromStage: "MEM", toStage: "EX", register: `$${prevInst.rd}`,
          }];
        }
      } else {
        if (isForwardingAllowed) {
          hazards[i] = {
            type: "RAW",
            description: `RAW hazard: ${hazardRegister} depends on instruction ${j} (forwarded)`,
            canForward: true, stallCycles: 0,
          };
          forwardings[i] = [{
            from: j, to: i, fromStage: "EX", toStage: "EX", register: `$${prevInst.rd}`,
          }];
        } else {
          hazards[i] = {
            type: "RAW",
            description: `RAW hazard: ${hazardRegister} depends on instruction ${j} (no forwarding)`,
            canForward: false, stallCycles: 2,
          };
          stalls[i] = 2;
        }
      }
    }

    if (currentInst.rd !== 0 && currentInst.rd === prevInst.rd && !hasRawHazard) {
      hazards[i] = {
        type: "WAW",
        description: `WAW hazard: Both instructions write to $${currentInst.rd}`,
        canForward: true, stallCycles: 0,
      };
    }
  }
  return [hazards, forwardings, stalls];
};

const calculateStallsBeforeIndex = (
  stallsRecord: Record<number, number>,
  instructionIndex: number
): number => {
  let totalStalls = 0;
  for (let k = 0; k < instructionIndex; k++) {
    totalStalls += stallsRecord[k] || 0;
  }
  return totalStalls;
};

const computeNextSimulationState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  let nextCycleVal = currentState.currentCycle + 1;
  const nextInstructionStages: Record<number, number | null> = {};
  let numberOfActiveInstructions = 0;

  let pendingStallDuration = currentState.currentStallCycles;
  if (pendingStallDuration > 0) {
    pendingStallDuration--;
    return {
      ...currentState,
      currentCycle: nextCycleVal,
      instructionStages: currentState.instructionStages,
      currentStallCycles: pendingStallDuration,
    };
  }

  let cumulativeStallCycles = 0;
  Object.values(currentState.stalls).forEach((stallCount) => {
    cumulativeStallCycles += stallCount;
  });

  currentState.instructions.forEach((_, index) => {
    const stallsBeforeThis = calculateStallsBeforeIndex(currentState.stalls, index);
    const stageIdx = nextCycleVal - index - 1 - stallsBeforeThis;

    if (stageIdx >= 0 && stageIdx < currentState.stageCount) {
      nextInstructionStages[index] = stageIdx;
      numberOfActiveInstructions++;
      if (stageIdx === 1 && currentState.stalls[index] > 0 && pendingStallDuration === 0) {
        pendingStallDuration = currentState.stalls[index];
      }
    } else {
      nextInstructionStages[index] = null;
    }
  });

  currentBranchTakenState = setomabranch;
  branchLogicEntryCounter += 1;

  console.log("Branch logic counter:", branchLogicEntryCounter);

  if (branchLogicEntryCounter > 2) {
    console.log("Processing potential branch effects");

    if (haybranch && haybranch.length > 0) {
      const firstQueuedOpcode = haybranch[0];
      let branchEffectApplied = false;

      if ((firstQueuedOpcode === "bne" || firstQueuedOpcode === "beq") && currentBranchTakenState) {
        console.log(`Branch instruction (${firstQueuedOpcode}) confirmed taken.`);
        misses++;
        console.log("Updated misses count:", misses);
        alarma = true;
        console.log("Branch jump effect calculated for next cycle base:", nextCycleVal);
        branchEffectApplied = true;
      } else {
        alarma = false; 
      }

     
      pipelineChangePending = branchEffectApplied; 
      pipelineChangePending = false;

      haybranch.shift(); 
      console.log("Remaining opcodes in haybranch queue:", haybranch);
    } else {

        alarma = false;
        pipelineChangePending = false;
    }
    branchLogicEntryCounter = 0; 
  }

  currentBranchTakenState = false;

  console.log("Cycle value after branch logic processing:", nextCycleVal); 


  const simulationCompletionCycle = 
    currentState.instructions.length > 0
      ? currentState.instructions.length + currentState.stageCount - 1 + cumulativeStallCycles
      : 0;

  const hasSimulationConcluded = nextCycleVal > simulationCompletionCycle; 
  const isSimulationStillRunning = !hasSimulationConcluded; 

  return {
    ...currentState,
    currentCycle: hasSimulationConcluded ? simulationCompletionCycle : nextCycleVal,
    instructionStages: nextInstructionStages,
    isRunning: isSimulationStillRunning,
    isFinished: hasSimulationConcluded,
    currentStallCycles: pendingStallDuration,
  };
};

export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationRunState, setSimulationRunState] = 
    useState<SimulationState>(initialSimulationState);
  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null); 

  const clearSimulationTimer = () => { 
    if (simulationIntervalRef.current) {
      clearInterval(simulationIntervalRef.current);
      simulationIntervalRef.current = null;
    }
  };

  const executeSimulationClockTick = useCallback(() => { 
    clearSimulationTimer();
 
    if (!simulationRunState.isRunning || simulationRunState.isFinished) return;

    simulationIntervalRef.current = setInterval(() => {
      setSimulationRunState((previousState) => { 
        const nextStateSnapshot = computeNextSimulationState(previousState); 
        if (nextStateSnapshot.isFinished && !previousState.isFinished) {
          clearSimulationTimer();
        }
        return nextStateSnapshot;
      });
    }, 1000); 
  }, [simulationRunState.isRunning, simulationRunState.isFinished]); 

  const performSimulationReset = useCallback(() => { 
    clearSimulationTimer();
    setSimulationRunState((previousState) => ({
      ...initialSimulationState,
      forwardingEnabled: previousState.forwardingEnabled,
      stallsEnabled: previousState.stallsEnabled,
      branchEnabled: previousState.branchEnabled, 
    }));
  }, []);

  const initializeAndStartSimulation = useCallback( 
    (submittedInstructions: string[]) => {
      clearSimulationTimer();
     
      misses = 0;

      if (submittedInstructions.length === 0) {
        performSimulationReset();
        return;
      }

      const instructionDetails: Record<number, InstructionRegisterDetails> = {}; 
      submittedInstructions.forEach((inst, index) => {
        instructionDetails[index] = parseHexInstructionToDetails(inst); 
      });

      const [detectedHazards, activeForwardingPaths, determinedStalls] = analyzeHazardsAndForwarding( 
        submittedInstructions,
        instructionDetails,
        simulationRunState.forwardingEnabled, 
        simulationRunState.stallsEnabled    
      );

      let totalStallDuration = 0; 
      Object.values(determinedStalls).forEach((stall) => {
        totalStallDuration += stall;
      });

      const calculatedMaxCyclesForRun = 
        submittedInstructions.length +
        DEFAULT_PIPELINE_STAGE_COUNT - 1 +
        totalStallDuration;

      const initialCycleStages: Record<number, number | null> = {}; 
      submittedInstructions.forEach((_, index) => {
        const stageIdx = 1 - index - 1; // For cycle 1
        if (stageIdx >= 0 && stageIdx < DEFAULT_PIPELINE_STAGE_COUNT) {
          initialCycleStages[index] = stageIdx;
        } else {
          initialCycleStages[index] = null;
        }
      });

      setSimulationRunState({
        instructions: submittedInstructions,
        currentCycle: 1,
        maxCycles: calculatedMaxCyclesForRun,
        isRunning: true,
        stageCount: DEFAULT_PIPELINE_STAGE_COUNT,
        instructionStages: initialCycleStages,
        isFinished: false,
        registerUsage: instructionDetails,
        hazards: detectedHazards,
        forwardings: activeForwardingPaths,
        stalls: determinedStalls,
        currentStallCycles: 0,
        forwardingEnabled: simulationRunState.forwardingEnabled, 
        stallsEnabled: simulationRunState.stallsEnabled,       
      });
    },
    [performSimulationReset, simulationRunState.forwardingEnabled, simulationRunState.stallsEnabled, simulationRunState.branchEnabled] // Added branchEnabled to deps
  );

  const triggerPauseSimulation = () => { 
    setSimulationRunState((previousState) => {
      if (previousState.isRunning) {
        clearSimulationTimer();
        return { ...previousState, isRunning: false };
      }
      return previousState;
    });
  };

  const triggerResumeSimulation = () => {
    setSimulationRunState((previousState) => {
      if (!previousState.isRunning && previousState.currentCycle > 0 && !previousState.isFinished) {
        return { ...previousState, isRunning: true };
      }
      return previousState;
    });
  };

  const toggleForwardingOption = (enabled: boolean) => { 
    setSimulationRunState((previousState) => {
      return { ...previousState, forwardingEnabled: enabled };
    });
  };

  const toggleStallDetectionOption = (enabled: boolean) => { 
    setSimulationRunState((previousState) => {
      
      return { ...previousState, stallsEnabled: enabled };
    });
  };

 
  const toggleBranchPredictionLogic = (enabled: boolean) => { 
    setSimulationRunState((previousState) => {
      return { ...previousState, branchEnabled: enabled }; 
    });
  };
 

  useEffect(() => {
    if (simulationRunState.isRunning && !simulationRunState.isFinished) {
      executeSimulationClockTick();
    } else {
      clearSimulationTimer();
    }
    return clearSimulationTimer;
  }, [simulationRunState.isRunning, simulationRunState.isFinished, executeSimulationClockTick]);

  const memoizedStateValue: SimulationState = simulationRunState; 

  const memoizedActionsValue: SimulationActions = useMemo( 
    () => ({
      startSimulation: initializeAndStartSimulation,
      resetSimulation: performSimulationReset,
      pauseSimulation: triggerPauseSimulation,
      resumeSimulation: triggerResumeSimulation,
      setForwardingEnabled: toggleForwardingOption,
      setStallsEnabled: toggleStallDetectionOption,
      setBranchEnabled: toggleBranchPredictionLogic, 
    }),
  
    [initializeAndStartSimulation, performSimulationReset, triggerPauseSimulation, triggerResumeSimulation, toggleForwardingOption, toggleStallDetectionOption, toggleBranchPredictionLogic]
  );

  return (
    <SimulationStateContext.Provider value={memoizedStateValue}>
      <SimulationActionsContext.Provider value={memoizedActionsValue}>
        {children}
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

export function useSimulationState() {
  const context = useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error("useSimulationState must be used within a SimulationProvider");
  }
  return context;
}

export function useSimulationActions() {
  const context = useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error("useSimulationActions must be used within a SimulationProvider");
  }
  return context;
}