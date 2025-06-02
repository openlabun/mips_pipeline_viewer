// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

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

// Define the stage names (optional, but good for clarity)
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = (typeof STAGE_NAMES)[number];

type InstructionType = "R" | "I" | "J";
type HazardType = "RAW" | "WAW" | "NONE";

interface RegisterUsage {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: InstructionType;
  isLoad: boolean; // Add this to detect load instructions
  immediate?: number; // Immediate value for I-type instructions
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

interface BranchPredictionEntry {
  currentBit: boolean;
  missStreak: number;
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

  currentStallCycles: number;

  forwardingEnabled: boolean;
  stallsEnabled: boolean; // Add this new option
  registerFile: number[]; // Add register file state

  memory: Record<number, number>; // Add memory state

  aluResults: Record<number, number>;
  loadedFromMem: Record<number, number>;
  branchMode: "ALWAYS_TAKEN" | "ALWAYS_NOT_TAKEN" | "STATE_MACHINE"; // Add branch prediction mode
  initialPrediction: boolean; // Initial prediction state for branch instructions
  failThreshold: number; // Threshold for branch prediction failure
  branchPredictionState: Record<string, BranchPredictionEntry>; // Add branch prediction state
  branchOutcome: Record<number, boolean>; // true = hit, false = miss
  branchMissCount: number;
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void;
  setBranchMode: (mode: SimulationState["branchMode"]) => void;
  setStateMachineConfig: (
    initialPrediction: boolean,
    failThreshold: number
  ) => void;
}

// Create the contexts
const SimulationStateContext = createContext<SimulationState | undefined>(
  undefined
);
const SimulationActionsContext = createContext<SimulationActions | undefined>(
  undefined
);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length; // Use length of defined stages

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
  currentStallCycles: 0,
  forwardingEnabled: true,
  stallsEnabled: true, // Add this new option

  registerFile: Array(32).fill(0),
  memory: {}, // Simulated memory, initially empty
  aluResults: {},
  loadedFromMem: {},

  branchMode: "ALWAYS_NOT_TAKEN", // Default branch prediction mode
  initialPrediction: false, // false (Not Taken) by default
  failThreshold: 1,
  branchPredictionState: {},
  branchOutcome: {}, // true = hit, false = miss
  branchMissCount: 0,
};

const parseInstruction = (hexInstruction: string): RegisterUsage => {
  const binary = parseInt(hexInstruction, 16).toString(2).padStart(32, "0");
  const opcode = parseInt(binary.substring(0, 6), 2);
  const rs = parseInt(binary.substring(6, 11), 2);
  const rt = parseInt(binary.substring(11, 16), 2);

  let type: InstructionType = "R";
  let rd = 0;
  let funct = 0;
  let isLoad = false;

  let immediate = 0;

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

    const immRaw = parseInt(binary.substring(16, 32), 2);
    if ((immRaw & (1 << 15)) !== 0) {
      // Check if the sign bit (bit 15) is set
      immediate = immRaw | 0xffff0000;
    } else {
      // If not, it's a positive immediate
      immediate = immRaw;
    }

    // Check for load instructions (lw = 35, lh = 33, lb = 32, etc.)
    if (opcode >= 32 && opcode <= 37) {
      rd = rt; // For loads, rt is the destination
      isLoad = true;
    } else if (opcode >= 8 && opcode <= 15) {
      rd = rt; // For immediate arithmetic, rt is the destination
    } else {
      rd = 0;
    }
  }

  return { rs, rt, rd, opcode, funct, type, isLoad, immediate };
};

const detectHazards = (
  instructions: string[],
  registerUsage: Record<number, RegisterUsage>,
  forwardingEnabled: boolean,
  stallsEnabled: boolean
): [
  Record<number, HazardInfo>,
  Record<number, ForwardingInfo[]>,
  Record<number, number>
] => {
  const hazards: Record<number, HazardInfo> = {};
  const forwardings: Record<number, ForwardingInfo[]> = {};
  const stalls: Record<number, number> = {};

  // Initialize all instructions with no hazard
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

  // If stalls are disabled, skip hazard detection entirely
  if (!stallsEnabled) {
    return [hazards, forwardings, stalls];
  }

  for (let i = 1; i < instructions.length; i++) {
    const currentInst = registerUsage[i];

    // Skip if current instruction is a jump
    if (currentInst.type === "J") continue;

    // Only check the immediately previous instruction (distance = 1)
    const j = i - 1;
    const prevInst = registerUsage[j];

    // Skip if previous instruction doesn't write to any register
    if (prevInst.rd === 0) continue;

    // Check for RAW hazards
    let hasRawHazard = false;
    let hazardRegister = "";

    if (currentInst.rs === prevInst.rd) {
      hasRawHazard = true;
      hazardRegister = `rs($${currentInst.rs})`;
    } else if (
      (currentInst.rt === prevInst.rd && currentInst.type !== "I") ||
      (currentInst.type === "I" && !currentInst.isLoad)
    ) {
      // For I-type instructions, rt might be a source (like in store instructions)
      // or destination (like in load instructions)
      hasRawHazard = true;
      hazardRegister = `rt($${currentInst.rt})`;
    }

    if (hasRawHazard) {
      if (prevInst.isLoad) {
        // Load-use hazard: Always needs 1 stall, then can forward from MEM
        hazards[i] = {
          type: "RAW",
          description: `Load-use hazard: ${hazardRegister} depends on lw in instruction ${j}`,
          canForward: forwardingEnabled,
          stallCycles: 1,
        };
        stalls[i] = 1;

        if (forwardingEnabled) {
          forwardings[i] = [
            {
              from: j,
              to: i,
              fromStage: "MEM", // Forward from MEM/WB to EX
              toStage: "EX",
              register: `$${prevInst.rd}`,
            },
          ];
        }
      } else {
        // Regular RAW hazard
        if (forwardingEnabled) {
          // Can forward from EX/MEM to EX, no stall needed
          hazards[i] = {
            type: "RAW",
            description: `RAW hazard: ${hazardRegister} depends on instruction ${j} (forwarded)`,
            canForward: true,
            stallCycles: 0,
          };
          forwardings[i] = [
            {
              from: j,
              to: i,
              fromStage: "EX", // Forward from EX/MEM to EX
              toStage: "EX",
              register: `$${prevInst.rd}`,
            },
          ];
        } else {
          // No forwarding: need 2 stalls for complete bubble
          hazards[i] = {
            type: "RAW",
            description: `RAW hazard: ${hazardRegister} depends on instruction ${j} (no forwarding)`,
            canForward: false,
            stallCycles: 2,
          };
          stalls[i] = 2;
        }
      }
    }

    // Check for WAW hazards (only for instructions that write to the same register)
    if (
      currentInst.rd !== 0 &&
      currentInst.rd === prevInst.rd &&
      !hasRawHazard
    ) {
      hazards[i] = {
        type: "WAW",
        description: `WAW hazard: Both instructions write to $${currentInst.rd}`,
        canForward: true,
        stallCycles: 0,
      };
    }
  }

  return [hazards, forwardings, stalls];
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

function handleWriteBack(idx: number, state: SimulationState) {
  const usage = state.registerUsage[idx];
  const opcode = usage.opcode;
  const type = usage.type;

  // 1) R-type (ADD, SUB, etc.) → rd
  if (type === "R" && usage.rd !== 0) {
    const result = state.aluResults[idx] ?? 0;
    state.registerFile[usage.rd] = result;
  }
  // 2) I-type (ADDI, ANDI, etc.) → rt
  else if (type === "I" && opcode >= 8 && opcode <= 15) {
    const result = state.aluResults[idx] ?? 0;
    state.registerFile[usage.rt] = result;
  }
  // 3) LW (opcode 35) → rt
  else if (type === "I" && opcode === 35) {
    const loaded = state.loadedFromMem[idx] ?? 0;
    state.registerFile[usage.rt] = loaded;
  }
}

function handleBranchAtID(
  idx: number,
  state: {
    registerUsage: Record<number, RegisterUsage>;
    registerFile: number[];
    branchMode: SimulationState["branchMode"];
    initialPrediction: boolean;
    failThreshold: number;
    branchPredictionState: Record<string, BranchPredictionEntry>;
    branchOutcome: Record<number, boolean>;
  },
  newBranchPredictionState: Record<string, BranchPredictionEntry>,
  newBranchOutcome: Record<number, boolean>,
  branchMissCountRef: { value: number }
) {
  const usage = state.registerUsage[idx];
  // BEQ (opcode 4) and BNE (opcode 5) are the only branch instructions
  if (usage.type === "I" && (usage.opcode === 4 || usage.opcode === 5)) {
    // 1) Determine the prediction (predictedTaken)
    let predictedTaken: boolean;
    if (state.branchMode === "ALWAYS_TAKEN") {
      predictedTaken = true;
    } else if (state.branchMode === "ALWAYS_NOT_TAKEN") {
      predictedTaken = false;
    } else {
      // STATE_MACHINE: using "global" key
      const prevEntry = state.branchPredictionState["global"] ?? {
        currentBit: state.initialPrediction,
        missStreak: 0,
      };
      predictedTaken = prevEntry.currentBit;
    }

    // 2) Calculate ‘realTaken’ using registerFile[rs] and registerFile[rt]
    const rsVal = state.registerFile[usage.rs];
    const rtVal = state.registerFile[usage.rt];
    let isTakenReal: boolean;
    if (usage.opcode === 4) {
      // BEQ: taken if rsVal === rtVal
      isTakenReal = rsVal === rtVal;
    } else {
      // BNE: taken if rsVal !== rtVal
      isTakenReal = rsVal !== rtVal;
    } // 3) Compare prediction vs reality
    const wasCorrect = predictedTaken === isTakenReal;
    newBranchOutcome[idx] = wasCorrect;

    if (!wasCorrect) {
      branchMissCountRef.value += 1;
    }

    // 4) In STATE_MACHINE, update the prediction state
    if (state.branchMode === "STATE_MACHINE") {
      const prevEntry = state.branchPredictionState["global"] ?? {
        currentBit: state.initialPrediction,
        missStreak: 0,
      };

      let newMissStreak = prevEntry.missStreak;

      if (!wasCorrect) {
        newMissStreak = prevEntry.missStreak + 1;
        if (newMissStreak >= state.failThreshold) {
          newBranchPredictionState["global"] = {
            currentBit: !prevEntry.currentBit,
            missStreak: 0,
          };
        } else {
          newBranchPredictionState["global"] = {
            currentBit: prevEntry.currentBit,
            missStreak: newMissStreak,
          };
        }
      } else {
        newBranchPredictionState["global"] = {
          currentBit: prevEntry.currentBit,
          missStreak: 0,
        };
      }
    }
  }
}

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }
  const nextCycle = currentState.currentCycle + 1;

  const newInstructionStages: Record<number, number | null> = {
    ...currentState.instructionStages,
  };
  const newRegisterFile = [...currentState.registerFile];
  const newMemory = { ...currentState.memory };
  const newAluResults = { ...currentState.aluResults };
  const newLoadedFromMem = { ...currentState.loadedFromMem };
  const newBranchPredictionState: Record<string, BranchPredictionEntry> = {
    ...currentState.branchPredictionState,
  };
  const newBranchOutcome: Record<number, boolean> = {
    ...currentState.branchOutcome,
  };
  const branchMissCountRef = { value: currentState.branchMissCount };
  let newStallCycles = currentState.currentStallCycles;
  if (newStallCycles > 0) {
    newStallCycles--;
    return {
      ...currentState,
      currentCycle: nextCycle,
      instructionStages: currentState.instructionStages, // Keep same stages during stall
      currentStallCycles: newStallCycles,
    };
  }

  let totalStallCycles = 0;
  Object.values(currentState.stalls).forEach((s) => {
    totalStallCycles += s;
  });
  currentState.instructions.forEach((_, idx) => {
    const prevStage = currentState.instructionStages[idx] ?? -1;

    let newStage: number | null;

    if (prevStage === -1) {
      // Instruction hasn't entered pipeline yet
      const idealStageIndex = nextCycle - idx - 1;
      if (idealStageIndex >= 0 && idealStageIndex < currentState.stageCount) {
        newStage = idealStageIndex;
      } else {
        newStage = null;
      }
    } else {
      // Instruction is already in pipeline - advance sequentially
      // Check if this instruction should be stalled in ID stage
      if (prevStage === 1 && currentState.stalls[idx] > 0) {
        // Stay in ID stage due to stall
        newStage = 1;
      } else {
        // Advance to next stage
        const nextStage = prevStage + 1;
        if (nextStage < currentState.stageCount) {
          newStage = nextStage;
        } else {
          // Instruction completes
          newStage = null;
        }
      }
    }
    newInstructionStages[idx] = newStage; // Constants for stage indices
    const ID_STAGE = 1;
    const EX_STAGE = 2;
    const MEM_STAGE = 3;
    const WB_STAGE = 4;

    // WB_STAGE is the last stage, so we handle it first
    if (newStage === WB_STAGE && (prevStage === null || prevStage < WB_STAGE)) {
      handleWriteBack(idx, {
        ...currentState,
        registerFile: newRegisterFile,
        aluResults: newAluResults,
        loadedFromMem: newLoadedFromMem,
      });
    }

    // MEM_STAGE is before WB_STAGE, so we handle it next
    if (
      newStage === MEM_STAGE &&
      (prevStage === null || prevStage < MEM_STAGE)
    ) {
      // Handle memory operations (load/store)
      const usage = currentState.registerUsage[idx];
      if (usage.type === "I" && usage.opcode === 35) {
        // Load instruction
        const address = newAluResults[idx] ?? 0; // Use ALU result as address
        const wordIndex = address / 4;
        const value = currentState.memory[wordIndex] ?? 0;
        newLoadedFromMem[idx] = value;
      } else if (usage.type === "I" && usage.opcode === 43) {
        // Store instruction
        const address = newAluResults[idx] ?? 0;
        const wordIndex = address / 4;
        const rtVal = newRegisterFile[usage.rt];
        newMemory[wordIndex] = rtVal;
      }
    }

    // EX_STAGE is before MEM_STAGE
    if (newStage === EX_STAGE && (prevStage === null || prevStage < EX_STAGE)) {
      const usage = currentState.registerUsage[idx];
      if (usage.type === "R") {
        // R-type instruction: perform ALU operation
        const rsVal = newRegisterFile[usage.rs];
        const rtVal = newRegisterFile[usage.rt];
        let result = 0;
        switch (usage.funct) {
          case 0: // SLL
            result = rtVal << (rsVal & 0x1f);
            break;
          case 2: // SRL
            result = rtVal >>> (rsVal & 0x1f);
            break;
          case 3: // SRA
            result = rtVal >> (rsVal & 0x1f);
            break;
          case 32: // ADD
            result = rsVal + rtVal;
            break;
          case 34: // SUB
            result = rsVal - rtVal;
            break;
          case 36: // AND
            result = rsVal & rtVal;
            break;
          case 37: // OR
            result = rsVal | rtVal;
            break;
          case 38: // XOR
            result = rsVal ^ rtVal;
            break;
          case 39: // NOR
            result = ~(rsVal | rtVal);
            break;
          case 42: // SLT
            result = rsVal < rtVal ? 1 : 0;
            break;
        }
        newAluResults[idx] = result;
      } else if (usage.type === "I") {
        const rsVal = newRegisterFile[usage.rs];
        const imm = usage.immediate ?? 0;
        if (usage.opcode >= 8 && usage.opcode <= 15) {
          // I-type arithmetic (ADDI, ANDI, etc.)
          newAluResults[idx] = rsVal + imm;
        } else if (usage.opcode === 35 || usage.opcode === 43) {
          // Load/Store instructions
          newAluResults[idx] = rsVal + imm;
        }
      }
    } // ID_STAGE is before EX_STAGE
    if (newStage === ID_STAGE && (prevStage === null || prevStage < ID_STAGE)) {
      handleBranchAtID(
        idx,
        {
          registerUsage: currentState.registerUsage,
          registerFile: newRegisterFile,
          branchMode: currentState.branchMode,
          initialPrediction: currentState.initialPrediction,
          failThreshold: currentState.failThreshold,
          branchPredictionState: newBranchPredictionState, // Use updated state
          branchOutcome: newBranchOutcome, // Use updated state
        },
        newBranchPredictionState,
        newBranchOutcome,
        branchMissCountRef
      );
    }
    if (
      newStage !== null &&
      currentState.stalls[idx] > 0 &&
      newStallCycles === 0
    ) {
      newStallCycles = currentState.stalls[idx];
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
    isRunning,
    isFinished,
    currentStallCycles: newStallCycles,
    registerFile: newRegisterFile,
    memory: newMemory,
    aluResults: newAluResults,
    loadedFromMem: newLoadedFromMem,
    branchPredictionState: newBranchPredictionState,
    branchOutcome: newBranchOutcome,
    branchMissCount: branchMissCountRef.value,
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
    }));
  }, []);

  const startSimulation = useCallback(
    (submittedInstructions: string[]) => {
      clearTimer(); // Clear previous timer just in case
      if (submittedInstructions.length === 0) {
        resetSimulation(); // Reset if no instructions submitted
        return;
      } // Parse instructions to extract register usage
      const registerUsage: Record<number, RegisterUsage> = {};
      submittedInstructions.forEach((inst, index) => {
        const parsed = parseInstruction(inst);
        registerUsage[index] = parsed;
      }); // Detect hazards and determine forwarding/stalls
      const [hazards, forwardings, stalls] = detectHazards(
        submittedInstructions,
        registerUsage,
        simulationState.forwardingEnabled,
        simulationState.stallsEnabled
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
        const stageIndex = 1 - index - 1; // Calculate stage for cycle 1
        if (stageIndex >= 0 && stageIndex < DEFAULT_STAGE_COUNT) {
          initialStages[index] = stageIndex;
        } else {
          initialStages[index] = null;
        }
      });

      setSimulationState((prev) => ({
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
        currentStallCycles: 0,
        forwardingEnabled: prev.forwardingEnabled,
        stallsEnabled: prev.stallsEnabled,

        // Memory and register file initialization
        registerFile: Array(32).fill(0),
        memory: {},

        aluResults: {},
        loadedFromMem: {},

        // Branch prediction settings
        branchMode: prev.branchMode,
        initialPrediction: prev.initialPrediction,
        failThreshold: prev.failThreshold,

        // Branch prediction state
        branchPredictionState: {},
        branchOutcome: {},
        branchMissCount: 0,
      }));
    },
    [
      resetSimulation,
      simulationState.forwardingEnabled,
      simulationState.stallsEnabled,
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

  const setBranchMode = useCallback((mode: SimulationState["branchMode"]) => {
    setSimulationState((prevState) => ({
      ...prevState,
      branchMode: mode,
      branchPredictionState: {},
      branchOutcome: {},
      branchMissCount: 0,
    }));
  }, []);

  const setStateMachineConfig = useCallback(
    (initialPrediction: boolean, failThreshold: number) => {
      setSimulationState((prevState) => ({
        ...prevState,
        initialPrediction,
        failThreshold,
        branchPredictionState: {},
        branchOutcome: {},
        branchMissCount: 0,
      }));
    },
    []
  );

  useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);

  const actionsValue: SimulationActions = useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwardingEnabled,
      setStallsEnabled,
      setBranchMode,
      setStateMachineConfig,
    }),
    [
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwardingEnabled,
      setStallsEnabled,
      setBranchMode,
      setStateMachineConfig,
    ]
  );

  // State value derived directly from simulationState
  const stateValue: SimulationState = simulationState;

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
      "useSimulationState must be used within a SimulationProvider"
    );
  }
  return context;
}

export function useSimulationActions() {
  const context = useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error(
      "useSimulationActions must be used within a SimulationProvider"
    );
  }
  return context;
}
