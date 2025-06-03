// src/context/SimulationContext.tsx
'use client'; // Add 'use client' directive

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import * as React from 'react';

// Define the stage names (optional, but good for clarity)
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = (typeof STAGE_NAMES)[number];

type InstructionType = 'R' | 'I' | 'J';
type HazardType = 'RAW' | 'WAW' | 'CONTROL' | 'NONE';
type BranchPredictionType = 'ALWAYS_TAKEN' | 'ALWAYS_NOT_TAKEN' | 'DYNAMIC';

interface RegisterUsage {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: InstructionType;
  isLoad: boolean;
  isBranch: boolean;
  branchType?: string;
  immediate?: number; // For branch offset
}

interface HazardInfo {
  type: HazardType;
  description: string;
  canForward: boolean;
  stallCycles: number;
}

interface ForwardingInfo {
  from: number;
  to: number;
  fromStage: StageName;
  toStage: StageName;
  register: string;
}

interface BranchInfo {
  isTaken: boolean;
  isPredicted: boolean;
  isMispredicted: boolean;
  target?: number;
  flushCycles: number;
  conditionResult?: boolean; // Actual condition evaluation
}

interface DynamicPredictorState {
  prediction: boolean; // true = taken, false = not taken
  missCount: number;
}

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  isFinished: boolean;

  registerUsage: Record<number, RegisterUsage>;
  hazards: Record<number, HazardInfo>;
  forwardings: Record<number, ForwardingInfo[]>;
  stalls: Record<number, number>;
  branches: Record<number, BranchInfo>;

  currentStallCycles: number;
  currentFlushCycles: number;

  forwardingEnabled: boolean;
  stallsEnabled: boolean;
  branchPredictionEnabled: boolean;
  branchPredictionType: BranchPredictionType;

  // Dynamic predictor configuration
  dynamicPredictorInitial: boolean; // Initial prediction
  dynamicPredictorThreshold: number; // Misses before changing prediction
  dynamicPredictorState: Record<number, DynamicPredictorState>; // State per branch

  // Register state simulation
  registerFile: Record<number, number>; // Simple register file simulation

  // Statistics
  totalBranches: number;
  totalMisses: number;
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void;
  setBranchPredictionEnabled: (enabled: boolean) => void;
  setBranchPredictionType: (type: BranchPredictionType) => void;
  setDynamicPredictorInitial: (initial: boolean) => void;
  setDynamicPredictorThreshold: (threshold: number) => void;
}

// Create the contexts
const SimulationStateContext = createContext<SimulationState | undefined>(
  undefined
);
const SimulationActionsContext = createContext<SimulationActions | undefined>(
  undefined
);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

const initialState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  registerUsage: {},
  hazards: {},
  forwardings: {},
  stalls: {},
  branches: {},
  currentStallCycles: 0,
  currentFlushCycles: 0,
  forwardingEnabled: true,
  stallsEnabled: true,
  branchPredictionEnabled: true,
  branchPredictionType: 'ALWAYS_NOT_TAKEN',
  dynamicPredictorInitial: false, // Initially predict not taken
  dynamicPredictorThreshold: 2, // Change prediction after 2 misses
  dynamicPredictorState: {},
  registerFile: {},
  totalBranches: 0,
  totalMisses: 0,
};

const getBranchType = (opcode: number, rt: number): string | undefined => {
  switch (opcode) {
    case 4:
      return 'beq';
    case 5:
      return 'bne';
    case 6:
      return 'blez';
    case 7:
      return 'bgtz';
    case 1:
      if (rt === 0) return 'bltz';
      if (rt === 1) return 'bgez';
      break;
  }
  return undefined;
};

const initializeRegisterFile = (): Record<number, number> => {
  const registers: Record<number, number> = {};
  // Initialize some registers with example values for demonstration
  // In a real implementation, these would be set by previous instructions
  for (let i = 0; i < 32; i++) {
    registers[i] = Math.floor(Math.random() * 100) - 50; // Random values between -50 and 49
  }
  registers[0] = 0; // $0 is always 0
  return registers;
};

const evaluateBranchCondition = (
  instruction: RegisterUsage,
  registerFile: Record<number, number>
): boolean => {
  const rs_val = registerFile[instruction.rs] || 0;
  const rt_val = registerFile[instruction.rt] || 0;

  switch (instruction.branchType) {
    case 'beq':
      return rs_val === rt_val;
    case 'bne':
      return rs_val !== rt_val;
    case 'blez':
      return rs_val <= 0;
    case 'bgtz':
      return rs_val > 0;
    case 'bltz':
      return rs_val < 0;
    case 'bgez':
      return rs_val >= 0;
    default:
      return false;
  }
};

const parseInstruction = (hexInstruction: string): RegisterUsage => {
  const binary = parseInt(hexInstruction, 16).toString(2).padStart(32, '0');
  const opcode = parseInt(binary.substring(0, 6), 2);
  const rs = parseInt(binary.substring(6, 11), 2);
  const rt = parseInt(binary.substring(11, 16), 2);

  let type: InstructionType = 'R';
  let rd = 0;
  let funct = 0;
  let isLoad = false;
  let isBranch = false;
  let branchType: string | undefined;
  let immediate: number | undefined;

  if (opcode === 0) {
    type = 'R';
    rd = parseInt(binary.substring(16, 21), 2);
    funct = parseInt(binary.substring(26, 32), 2);
  } else if (opcode === 2 || opcode === 3) {
    type = 'J';
    rd = opcode === 3 ? 31 : 0;
    funct = 0;
  } else {
    type = 'I';
    immediate = parseInt(binary.substring(16, 32), 2);
    // Sign extend for negative immediates
    if (immediate & 0x8000) {
      immediate = immediate - 0x10000;
    }

    // Check for branch instructions
    branchType = getBranchType(opcode, rt);
    if (branchType) {
      isBranch = true;
      rd = 0; // Branches don't write to registers
    }
    // Check for load instructions
    else if (opcode >= 32 && opcode <= 37) {
      rd = rt; // For loads, rt is the destination
      isLoad = true;
    } else if (opcode >= 8 && opcode <= 15) {
      rd = rt; // For immediate arithmetic, rt is the destination
    } else {
      rd = 0;
    }
  }

  return {
    rs,
    rt,
    rd,
    opcode,
    funct,
    type,
    isLoad,
    isBranch,
    branchType,
    immediate,
  };
};

const getBranchPrediction = (
  index: number,
  predictionType: BranchPredictionType,
  dynamicState: Record<number, DynamicPredictorState>,
  dynamicInitial: boolean
): boolean => {
  switch (predictionType) {
    case 'ALWAYS_TAKEN':
      return true;
    case 'ALWAYS_NOT_TAKEN':
      return false;
    case 'DYNAMIC':
      if (!dynamicState[index]) {
        dynamicState[index] = {
          prediction: dynamicInitial,
          missCount: 0,
        };
      }
      return dynamicState[index].prediction;
    default:
      return false;
  }
};

const updateDynamicPredictor = (
  index: number,
  wasMispredicted: boolean,
  dynamicState: Record<number, DynamicPredictorState>,
  threshold: number
): void => {
  if (!dynamicState[index]) return;

  if (wasMispredicted) {
    dynamicState[index].missCount++;
    if (dynamicState[index].missCount >= threshold) {
      // Flip prediction after threshold misses
      dynamicState[index].prediction = !dynamicState[index].prediction;
      dynamicState[index].missCount = 0;
    }
  } else {
    // Reset miss count on correct prediction
    dynamicState[index].missCount = 0;
  }
};

const simulateBranchExecution = (
  instruction: RegisterUsage,
  index: number,
  registerFile: Record<number, number>,
  predictionType: BranchPredictionType,
  dynamicState: Record<number, DynamicPredictorState>,
  dynamicInitial: boolean,
  dynamicThreshold: number
): BranchInfo => {
  // Evaluate actual branch condition
  const conditionResult = evaluateBranchCondition(instruction, registerFile);
  const isTaken = conditionResult;

  // Get prediction
  const isPredicted = getBranchPrediction(
    index,
    predictionType,
    dynamicState,
    dynamicInitial
  );

  const isMispredicted = isTaken !== isPredicted;

  // Update dynamic predictor if applicable
  if (predictionType === 'DYNAMIC') {
    updateDynamicPredictor(
      index,
      isMispredicted,
      dynamicState,
      dynamicThreshold
    );
  }

  return {
    isTaken,
    isPredicted,
    isMispredicted,
    target: isTaken ? index + 1 + (instruction.immediate || 0) : index + 1,
    flushCycles: isMispredicted ? 2 : 0, // 2 cycles penalty for misprediction
    conditionResult,
  };
};

const detectHazards = (
  instructions: string[],
  registerUsage: Record<number, RegisterUsage>,
  forwardingEnabled: boolean,
  stallsEnabled: boolean,
  branchPredictionEnabled: boolean,
  branchPredictionType: BranchPredictionType,
  dynamicPredictorInitial: boolean,
  dynamicPredictorThreshold: number,
  registerFile: Record<number, number>
): [
  Record<number, HazardInfo>,
  Record<number, ForwardingInfo[]>,
  Record<number, number>,
  Record<number, BranchInfo>,
  Record<number, DynamicPredictorState>,
  number,
  number
] => {
  const hazards: Record<number, HazardInfo> = {};
  const forwardings: Record<number, ForwardingInfo[]> = {};
  const stalls: Record<number, number> = {};
  const branches: Record<number, BranchInfo> = {};
  const dynamicState: Record<number, DynamicPredictorState> = {};
  let totalBranches = 0;
  let totalMisses = 0;

  // Initialize all instructions with no hazard
  instructions.forEach((_, index) => {
    hazards[index] = {
      type: 'NONE',
      description: 'No hazard',
      canForward: false,
      stallCycles: 0,
    };
    forwardings[index] = [];
    stalls[index] = 0;

    // Initialize branch info for branch instructions
    if (registerUsage[index]?.isBranch) {
      totalBranches++;
      branches[index] = simulateBranchExecution(
        registerUsage[index],
        index,
        registerFile,
        branchPredictionType,
        dynamicState,
        dynamicPredictorInitial,
        dynamicPredictorThreshold
      );
      if (branches[index].isMispredicted) {
        totalMisses++;
      }
    }
  });

  // If stalls are disabled, skip hazard detection entirely
  if (!stallsEnabled) {
    return [
      hazards,
      forwardings,
      stalls,
      branches,
      dynamicState,
      totalBranches,
      totalMisses,
    ];
  }

  for (let i = 1; i < instructions.length; i++) {
    const currentInst = registerUsage[i];

    // Check for control hazards (branch instructions)
    if (currentInst.isBranch && branchPredictionEnabled) {
      const branchInfo = branches[i];
      if (branchInfo?.isMispredicted) {
        hazards[i] = {
          type: 'CONTROL',
          description: `Control hazard: Branch misprediction in ${
            currentInst.branchType || 'branch'
          } instruction (predicted ${
            branchInfo.isPredicted ? 'taken' : 'not taken'
          }, actually ${branchInfo.isTaken ? 'taken' : 'not taken'})`,
          canForward: false,
          stallCycles: branchInfo.flushCycles,
        };
        stalls[i] = branchInfo.flushCycles;
      } else if (branchInfo) {
        hazards[i] = {
          type: 'CONTROL',
          description: `Control hazard: Branch correctly predicted (${
            currentInst.branchType || 'branch'
          } - predicted ${branchInfo.isPredicted ? 'taken' : 'not taken'})`,
          canForward: false,
          stallCycles: 0,
        };
      }
      continue; // Skip data hazard detection for branch instructions
    }

    // Skip if current instruction is a jump or branch
    if (currentInst.type === 'J' || currentInst.isBranch) continue;

    // Check data hazards with previous instructions
    for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
      const prevInst = registerUsage[j];

      // Skip if previous instruction doesn't write to any register or is a branch
      if (prevInst.rd === 0 || prevInst.isBranch) continue;

      // Check for RAW hazards
      let hasRawHazard = false;
      let hazardRegister = '';
      const distance = i - j;

      if (currentInst.rs === prevInst.rd) {
        hasRawHazard = true;
        hazardRegister = `rs($${currentInst.rs})`;
      } else if (
        (currentInst.rt === prevInst.rd && currentInst.type !== 'I') ||
        (currentInst.type === 'I' &&
          !currentInst.isLoad &&
          currentInst.rt === prevInst.rd)
      ) {
        hasRawHazard = true;
        hazardRegister = `rt($${currentInst.rt})`;
      }

      if (hasRawHazard && distance === 1) {
        if (prevInst.isLoad) {
          // Load-use hazard: Always needs 1 stall, then can forward from MEM
          hazards[i] = {
            type: 'RAW',
            description: `Load-use hazard: ${hazardRegister} depends on lw in instruction ${j}`,
            canForward: forwardingEnabled,
            stallCycles: 1,
          };
          stalls[i] = Math.max(stalls[i], 1);

          if (forwardingEnabled) {
            forwardings[i] = [
              ...forwardings[i],
              {
                from: j,
                to: i,
                fromStage: 'MEM',
                toStage: 'EX',
                register: `$${prevInst.rd}`,
              },
            ];
          }
        } else {
          // Regular RAW hazard
          if (forwardingEnabled) {
            // Can forward from EX/MEM to EX, no stall needed
            hazards[i] = {
              type: 'RAW',
              description: `RAW hazard: ${hazardRegister} depends on instruction ${j} (forwarded)`,
              canForward: true,
              stallCycles: 0,
            };
            forwardings[i] = [
              ...forwardings[i],
              {
                from: j,
                to: i,
                fromStage: 'EX',
                toStage: 'EX',
                register: `$${prevInst.rd}`,
              },
            ];
          } else {
            // No forwarding: need 2 stalls for complete bubble
            hazards[i] = {
              type: 'RAW',
              description: `RAW hazard: ${hazardRegister} depends on instruction ${j} (no forwarding)`,
              canForward: false,
              stallCycles: 2,
            };
            stalls[i] = Math.max(stalls[i], 2);
          }
        }
        break; // Take the first (closest) hazard
      }
    }

    // Check for WAW hazards (only with immediately previous instruction)
    const prevInst = registerUsage[i - 1];
    if (
      currentInst.rd !== 0 &&
      currentInst.rd === prevInst?.rd &&
      !prevInst.isBranch &&
      hazards[i].type === 'NONE'
    ) {
      hazards[i] = {
        type: 'WAW',
        description: `WAW hazard: Both instructions write to $${currentInst.rd}`,
        canForward: true,
        stallCycles: 0,
      };
    }
  }

  return [
    hazards,
    forwardings,
    stalls,
    branches,
    dynamicState,
    totalBranches,
    totalMisses,
  ];
};

const calculatePrecedingStalls = (
  stalls: Record<number, number>,
  index: number
): number => {
  let totalStalls = 0;
  for (let i = 0; i < index; i++) {
    totalStalls += stalls[i] || 0;
  }
  return totalStalls;
};

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let activeInstructions = 0;

  let newStallCycles = currentState.currentStallCycles;
  let newFlushCycles = currentState.currentFlushCycles;

  // Handle ongoing stalls
  if (newStallCycles > 0) {
    newStallCycles--;
    return {
      ...currentState,
      currentCycle: nextCycle,
      instructionStages: currentState.instructionStages,
      currentStallCycles: newStallCycles,
    };
  }

  // Handle ongoing flushes
  if (newFlushCycles > 0) {
    newFlushCycles--;
    return {
      ...currentState,
      currentCycle: nextCycle,
      instructionStages: {}, // Clear pipeline during flush
      currentFlushCycles: newFlushCycles,
    };
  }

  let totalStallCycles = 0;
  Object.values(currentState.stalls).forEach((stalls) => {
    totalStallCycles += stalls;
  });

  currentState.instructions.forEach((_, index) => {
    const precedingStalls = calculatePrecedingStalls(
      currentState.stalls,
      index
    );
    const stageIndex = nextCycle - index - 1 - precedingStalls;

    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;
      activeInstructions++;

      // Check for new stalls
      if (
        stageIndex === 1 &&
        currentState.stalls[index] > 0 &&
        newStallCycles === 0
      ) {
        newStallCycles = currentState.stalls[index];
      }

      // Check for branch flush (happens in ID stage)
      if (
        stageIndex === 1 &&
        currentState.registerUsage[index]?.isBranch &&
        currentState.branches[index]?.isMispredicted &&
        newFlushCycles === 0
      ) {
        newFlushCycles = currentState.branches[index].flushCycles;
      }
    } else {
      newInstructionStages[index] = null;
    }
  });

  const completionCycle =
    currentState.instructions.length > 0
      ? currentState.instructions.length +
        currentState.stageCount -
        1 +
        totalStallCycles
      : 0;

  const isFinished = nextCycle > completionCycle;
  const isRunning = !isFinished;

  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : nextCycle,
    instructionStages: newInstructionStages,
    isRunning: isRunning,
    isFinished: isFinished,
    currentStallCycles: newStallCycles,
    currentFlushCycles: newFlushCycles,
  };
};

export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] =
    useState<SimulationState>(initialState);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const runClock = useCallback(() => {
    clearTimer();
    if (!simulationState.isRunning || simulationState.isFinished) return;

    intervalRef.current = setInterval(() => {
      setSimulationState((prevState) => {
        const nextState = calculateNextState(prevState);
        if (nextState.isFinished && !prevState.isFinished) {
          clearTimer();
        }
        return nextState;
      });
    }, 1000);
  }, [simulationState.isRunning, simulationState.isFinished]);

  const resetSimulation = useCallback(() => {
    clearTimer();
    setSimulationState((prevState) => ({
      ...initialState,
      forwardingEnabled: prevState.forwardingEnabled,
      stallsEnabled: prevState.stallsEnabled,
      branchPredictionEnabled: prevState.branchPredictionEnabled,
      branchPredictionType: prevState.branchPredictionType,
      dynamicPredictorInitial: prevState.dynamicPredictorInitial,
      dynamicPredictorThreshold: prevState.dynamicPredictorThreshold,
    }));
  }, []);

  const startSimulation = useCallback(
    (submittedInstructions: string[]) => {
      clearTimer();
      if (submittedInstructions.length === 0) {
        resetSimulation();
        return;
      }

      // Initialize register file with random values for simulation
      const registerFile = initializeRegisterFile();

      // Parse instructions to extract register usage
      const registerUsage: Record<number, RegisterUsage> = {};
      submittedInstructions.forEach((inst, index) => {
        registerUsage[index] = parseInstruction(inst);
      });

      // Detect hazards and determine forwarding/stalls
      const [
        hazards,
        forwardings,
        stalls,
        branches,
        dynamicState,
        totalBranches,
        totalMisses,
      ] = detectHazards(
        submittedInstructions,
        registerUsage,
        simulationState.forwardingEnabled,
        simulationState.stallsEnabled,
        simulationState.branchPredictionEnabled,
        simulationState.branchPredictionType,
        simulationState.dynamicPredictorInitial,
        simulationState.dynamicPredictorThreshold,
        registerFile
      );

      // Calculate total stall cycles
      let totalStallCycles = 0;
      Object.values(stalls).forEach((stall) => {
        totalStallCycles += stall;
      });

      const calculatedMaxCycles =
        submittedInstructions.length +
        DEFAULT_STAGE_COUNT -
        1 +
        totalStallCycles;
      const initialStages: Record<number, number | null> = {};

      // Initialize stages for cycle 1
      submittedInstructions.forEach((_, index) => {
        const stageIndex = 1 - index - 1;
        if (stageIndex >= 0 && stageIndex < DEFAULT_STAGE_COUNT) {
          initialStages[index] = stageIndex;
        } else {
          initialStages[index] = null;
        }
      });

      setSimulationState({
        instructions: submittedInstructions,
        currentCycle: 1,
        maxCycles: calculatedMaxCycles,
        isRunning: true,
        stageCount: DEFAULT_STAGE_COUNT,
        instructionStages: initialStages,
        isFinished: false,
        registerUsage,
        hazards,
        forwardings,
        stalls,
        branches,
        currentStallCycles: 0,
        currentFlushCycles: 0,
        forwardingEnabled: simulationState.forwardingEnabled,
        stallsEnabled: simulationState.stallsEnabled,
        branchPredictionEnabled: simulationState.branchPredictionEnabled,
        branchPredictionType: simulationState.branchPredictionType,
        dynamicPredictorInitial: simulationState.dynamicPredictorInitial,
        dynamicPredictorThreshold: simulationState.dynamicPredictorThreshold,
        dynamicPredictorState: dynamicState,
        registerFile,
        totalBranches,
        totalMisses,
      });
    },
    [
      resetSimulation,
      simulationState.forwardingEnabled,
      simulationState.stallsEnabled,
      simulationState.branchPredictionEnabled,
      simulationState.branchPredictionType,
      simulationState.dynamicPredictorInitial,
      simulationState.dynamicPredictorThreshold,
    ]
  );

  const pauseSimulation = () => {
    setSimulationState((prevState) => {
      if (prevState.isRunning) {
        clearTimer();
        return { ...prevState, isRunning: false };
      }
      return prevState;
    });
  };

  const resumeSimulation = () => {
    setSimulationState((prevState) => {
      if (
        !prevState.isRunning &&
        prevState.currentCycle > 0 &&
        !prevState.isFinished
      ) {
        return { ...prevState, isRunning: true };
      }
      return prevState;
    });
  };

  const setForwardingEnabled = (enabled: boolean) => {
    setSimulationState((prevState) => {
      return { ...prevState, forwardingEnabled: enabled };
    });
  };

  const setStallsEnabled = (enabled: boolean) => {
    setSimulationState((prevState) => {
      return { ...prevState, stallsEnabled: enabled };
    });
  };

  const setBranchPredictionEnabled = (enabled: boolean) => {
    setSimulationState((prevState) => {
      return { ...prevState, branchPredictionEnabled: enabled };
    });
  };

  const setBranchPredictionType = (type: BranchPredictionType) => {
    setSimulationState((prevState) => {
      return { ...prevState, branchPredictionType: type };
    });
  };

  const setDynamicPredictorInitial = (initial: boolean) => {
    setSimulationState((prevState) => {
      return { ...prevState, dynamicPredictorInitial: initial };
    });
  };

  const setDynamicPredictorThreshold = (threshold: number) => {
    setSimulationState((prevState) => {
      return { ...prevState, dynamicPredictorThreshold: threshold };
    });
  };

  useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);

  const stateValue: SimulationState = simulationState;

  const actionsValue: SimulationActions = useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwardingEnabled,
      setStallsEnabled,
      setBranchPredictionEnabled,
      setBranchPredictionType,
      setDynamicPredictorInitial,
      setDynamicPredictorThreshold,
    }),
    [startSimulation, resetSimulation]
  );

  return (
    <SimulationStateContext.Provider value={stateValue}>
      <SimulationActionsContext.Provider value={actionsValue}>
        {children}
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

// Custom hooks for easy context consumption
export function useSimulationState() {
  const context = useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error(
      'useSimulationState must be used within a SimulationProvider'
    );
  }
  return context;
}

export function useSimulationActions() {
  const context = useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error(
      'useSimulationActions must be used within a SimulationProvider'
    );
  }
  return context;
}
