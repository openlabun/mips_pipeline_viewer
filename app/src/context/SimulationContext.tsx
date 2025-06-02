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
import { executeMipsHexInstructions } from "./compiler";

// Define the stage names (optional, but good for clarity)
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = (typeof STAGE_NAMES)[number];

type InstructionType = "R" | "I" | "J";
type HazardType = "RAW" | "WAW" | "NONE";
export type PredictionMode = "TAKEN" | "NOT_TAKEN" | "STATE_MACHINE";

export interface StateMachineConfig {
  missThreshold: number;
  initialPrediction: "TAKEN" | "NOT_TAKEN";
}

interface RegisterUsage {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: InstructionType;
  isLoad: boolean;
  isBranch?: boolean;
  isBeq?: boolean;
  isBne?: boolean;
  offset?: number;
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
  predictionMode: PredictionMode;
  stateMachineConfig: StateMachineConfig;
  registerSnapshots: Record<number, Record<string, number>>; // Nuevo: snapshots por ciclo
  branchMisses: Record<number, boolean>;
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void; // Add this new action
  setPredictionMode: (mode: PredictionMode) => void;
  setStateMachineConfig: (config: StateMachineConfig) => void;
  rerunSimulation: () => void;
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
  predictionMode: "TAKEN",
  stateMachineConfig: {
    missThreshold: 2,
    initialPrediction: "TAKEN",
  },
  registerSnapshots: {},
  branchMisses: {},
};

const parseInstruction = (hexInstruction: string): RegisterUsage => {
  const binary = parseInt(hexInstruction, 16).toString(2).padStart(32, "0");
  const opcode = parseInt(binary.substring(0, 6), 2);
  const rs = parseInt(binary.substring(6, 11), 2);
  const rt = parseInt(binary.substring(11, 16), 2);
  const imm16 = binary.substring(16, 32);

  let type: InstructionType = "R";
  let rd = 0;
  let funct = 0;
  let isLoad = false;
  let isBranch = false;
  let isBeq = false;
  let isBne = false;
  let offset: number | undefined = undefined;

  if (opcode === 0) {
    // R-type
    type = "R";
    rd = parseInt(binary.substring(16, 21), 2);
    funct = parseInt(binary.substring(26, 32), 2);
  } else if (opcode === 2 || opcode === 3) {
    // J-type
    type = "J";
    rd = opcode === 3 ? 31 : 0;
  } else {
    // I-type
    type = "I";

    if (opcode >= 32 && opcode <= 37) {
      rd = rt;
      isLoad = true;
    } else if (opcode >= 8 && opcode <= 15) {
      rd = rt;
    }

    if (opcode === 4 || opcode === 5) {
      // beq o bne
      isBranch = true;
      offset = parseInt(imm16, 2);
      if (imm16[0] === "1") {
        // Sign extension for negative values
        offset = offset - (1 << 16);
      }

      if (opcode === 4) isBeq = true;
      if (opcode === 5) isBne = true;
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
    isBeq,
    isBne,
    offset,
  };
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

const registerNumberToName: Record<number, string> = {
  0: "$zero",
  1: "$at",
  2: "$v0",
  3: "$v1",
  4: "$a0",
  5: "$a1",
  6: "$a2",
  7: "$a3",
  8: "$t0",
  9: "$t1",
  10: "$t2",
  11: "$t3",
  12: "$t4",
  13: "$t5",
  14: "$t6",
  15: "$t7",
  16: "$s0",
  17: "$s1",
  18: "$s2",
  19: "$s3",
  20: "$s4",
  21: "$s5",
  22: "$s6",
  23: "$s7",
  24: "$t8",
  25: "$t9",
  26: "$k0",
  27: "$k1",
  28: "$gp",
  29: "$sp",
  30: "$fp",
  31: "$ra",
};

const clearBranchHistory = () => {
  for (const key in branchHistory) {
    delete branchHistory[key];
  }
};

export const branchHistory: Record<string, { taken: boolean }> = {};
const evaluatedThisCycle = new Set<number>();
let consecutiveMisses = 0;
export let totalMisses = 0;

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }
  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let newStallCycles = currentState.currentStallCycles;
  const updatedBranchMisses: Record<number, boolean> = {
    ...currentState.branchMisses,
  };

  if (newStallCycles > 0) {
    newStallCycles--;
    return {
      ...currentState,
      currentCycle: nextCycle,
      instructionStages: currentState.instructionStages,
      currentStallCycles: newStallCycles,
    };
  }

  currentState.instructions.forEach((_, index) => {
    const precedingStalls = calculatePrecedingStalls(
      currentState.stalls,
      index
    );
    const stageIndex = nextCycle - index - 1 - precedingStalls;

    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;

      if (stageIndex === 1) {
        const usage = currentState.registerUsage[index];
        if (usage.isBranch && !evaluatedThisCycle.has(index)) {
          evaluatedThisCycle.add(index);
          const snapshot = currentState.registerSnapshots[index];
          /*console.log(usage);
          console.log(snapshot);
          console.log(index);*/
          const rsName = registerNumberToName[usage.rs];
          const rtName = registerNumberToName[usage.rt];
          const rsVal = snapshot?.[rsName] ?? 0;
          const rtVal = snapshot?.[rtName] ?? 0;
          //console.log("RS: ", rsVal);
          //console.log("RT: ", rtVal);

          const actualTaken =
            (usage.isBeq && rsVal === rtVal) ||
            (usage.isBne && rsVal !== rtVal);

          let predictedTaken = false;

          switch (currentState.predictionMode) {
            case "TAKEN":
              predictedTaken = true;
              break;
            case "NOT_TAKEN":
              predictedTaken = false;
              break;
            case "STATE_MACHINE": {
              const history = branchHistory["global"];
              const defaultTaken =
                currentState.stateMachineConfig.initialPrediction === "TAKEN";
              predictedTaken = history ? history.taken : defaultTaken;

              console.log(`🔍 Evaluating instruction ${index}:`, {
                type: usage.isBeq ? "BEQ" : usage.isBne ? "BNE" : "UNKNOWN",
                rs: usage.rs,
                rt: usage.rt,
                rsVal,
                rtVal,
                currentPrediction: predictedTaken ? "TAKEN" : "NOT_TAKEN",
              });
              break;
            }
          }

          const wasMiss = predictedTaken !== actualTaken;
          if (wasMiss) {
            consecutiveMisses++;
            totalMisses++;
            updatedBranchMisses[index] = true;
            console.log(
              `❌ MISPREDICT at instruction ${index} (cycle ${nextCycle}):`,
              {
                rsVal,
                rtVal,
                predictedTaken,
                actualTaken,
              }
            );
          } else {
            console.log("Prediccion correcta");
          }

          if (currentState.predictionMode === "STATE_MACHINE") {
            const config = currentState.stateMachineConfig;
            const current = branchHistory["global"] ?? {
              taken: config.initialPrediction === "TAKEN",
            };

            //const nextMisses = wasMiss ? current.misses + 1 : current.misses;
            const shouldFlip = consecutiveMisses >= config.missThreshold;
            const nextTaken = shouldFlip ? !current.taken : current.taken;
            //const resetMisses = shouldFlip ? 0 : nextMisses;*/
            console.log(`🔁 Predictor for [${index}]:`, {
              newPrediction: nextTaken,
              numFallos: consecutiveMisses,
            });
            if (shouldFlip) {
              consecutiveMisses = 0;
            }
            branchHistory["global"] = { taken: nextTaken };
          }
        }
      }
    } else {
      newInstructionStages[index] = null;
    }
  });

  const totalStalls = Object.values(currentState.stalls).reduce(
    (a, b) => a + b,
    0
  );
  const completionCycle =
    currentState.instructions.length +
    currentState.stageCount -
    1 +
    totalStalls;

  return {
    ...currentState,
    currentCycle: nextCycle > completionCycle ? completionCycle : nextCycle,
    instructionStages: newInstructionStages,
    isRunning: nextCycle <= completionCycle,
    isFinished: nextCycle > completionCycle,
    currentStallCycles: newStallCycles,
    branchMisses: updatedBranchMisses,
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
    clearBranchHistory();
    evaluatedThisCycle.clear();
    consecutiveMisses = 0;
    totalMisses = 0;
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
      }
      // Ejecuta las instrucciones y genera los snapshots
      const snapshots = executeMipsHexInstructions(submittedInstructions);
      console.log("Snapshots generados por el compilador:", snapshots);
      const snapshotMap: Record<number, Record<string, number>> = {};
      snapshots.forEach((snapshot, index) => {
        snapshotMap[index] = snapshot;
      });

      // Parse instructions to extract register usage
      const registerUsage: Record<number, RegisterUsage> = {};
      submittedInstructions.forEach((inst, index) => {
        registerUsage[index] = parseInstruction(inst);
      });

      // Detect hazards and determine forwarding/stalls
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
        currentStallCycles: 0,
        forwardingEnabled: simulationState.forwardingEnabled,
        stallsEnabled: simulationState.stallsEnabled,
        predictionMode: simulationState.predictionMode,
        stateMachineConfig: simulationState.stateMachineConfig,
        registerSnapshots: snapshotMap, // Nuevo: agregar snapshots
        branchMisses: {},
      });
    },
    [
      resetSimulation,
      simulationState.forwardingEnabled,
      simulationState.stallsEnabled,
      simulationState.predictionMode,
      simulationState.stateMachineConfig,
    ]
  );

  const rerunSimulation = useCallback(() => {
    clearTimer();
    clearBranchHistory();
    evaluatedThisCycle.clear();
    consecutiveMisses = 0;
    totalMisses = 0;

    setSimulationState((prevState) => {
      const prevInstructions = prevState.instructions;
      // Volver a ejecutar la simulación como en startSimulation
      startSimulation(prevInstructions);
      return prevState;
    });
  }, [startSimulation]);

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

  const setPredictionMode = (mode: PredictionMode) => {
    setSimulationState((prevState) => ({
      ...prevState,
      predictionMode: mode,
    }));
  };

  const setStateMachineConfig = (config: StateMachineConfig) => {
    setSimulationState((prevState) => ({
      ...prevState,
      stateMachineConfig: config,
    }));
  };

  useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);

  // State value derived directly from simulationState
  const stateValue: SimulationState = simulationState;

  const actionsValue: SimulationActions = useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwardingEnabled,
      setStallsEnabled,
      setPredictionMode,
      setStateMachineConfig,
      rerunSimulation,
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
