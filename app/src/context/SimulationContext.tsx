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
}

const getRegisterName = (reg: number): string => {
  const names = [
    "$zero", "$at", "$v0", "$v1", "$a0", "$a1", "$a2", "$a3",
    "$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7",
    "$s0", "$s1", "$s2", "$s3", "$s4", "$s5", "$s6", "$s7",
    "$t8", "$t9", "$k0", "$k1", "$gp", "$sp", "$fp", "$ra"
  ];
  return names[reg] || `$${reg}`;
};

export const disassembleInstruction = (hex: string, usage?: RegisterUsage): string => {
  if (!hex) return "---";
  if (hex.toLowerCase() === "0x00000000" || hex === "00000000") return "nop";

  const u = usage || parseInstruction(hex);
  const binary = parseInt(hex.replace(/^0x/i, ''), 16).toString(2).padStart(32, "0");
  const immediate = parseInt(binary.substring(16, 32), 2);
  const signedImmediate = immediate >= 0x8000 ? immediate - 0x10000 : immediate;
  const address = parseInt(binary.substring(6, 32), 2);

  const rs = getRegisterName(u.rs);
  const rt = getRegisterName(u.rt);
  const rd = getRegisterName(u.rd);

  if (u.type === "R") {
    const functMap: Record<number, string> = {
      0x20: "add", 0x21: "addu", 0x24: "and", 0x08: "jr", 0x27: "nor",
      0x25: "or", 0x2a: "slt", 0x2b: "sltu", 0x00: "sll", 0x02: "srl",
      0x22: "sub", 0x23: "subu", 0x26: "xor"
    };
    const op = functMap[u.funct] || `op_${u.funct.toString(16)}`;
    if (op === "jr") return `${op} ${rs}`;
    if (op === "sll" || op === "srl") {
      const shamt = parseInt(binary.substring(21, 26), 2);
      return `${op} ${rd}, ${rt}, ${shamt}`;
    }
    return `${op} ${rd}, ${rs}, ${rt}`;
  } else if (u.type === "I") {
    const opMap: Record<number, string> = {
      0x08: "addi", 0x09: "addiu", 0x0c: "andi", 0x04: "beq", 0x05: "bne",
      0x0f: "lui", 0x23: "lw", 0x0d: "ori", 0x0a: "slti", 0x0b: "sltiu",
      0x2b: "sw", 0x0e: "xori"
    };
    const op = opMap[u.opcode] || `op_${u.opcode.toString(16)}`;
    if (op === "beq" || op === "bne") return `${op} ${rs}, ${rt}, ${signedImmediate}`;
    if (op === "lui") return `${op} ${rt}, ${immediate}`;
    if (op === "lw" || op === "sw") return `${op} ${rt}, ${signedImmediate}(${rs})`;
    return `${op} ${rt}, ${rs}, ${immediate}`;
  } else if (u.type === "J") {
    const op = u.opcode === 2 ? "j" : "jal";
    return `${op} 0x${(address << 2).toString(16).padStart(8, '0')}`;
  }

  return `0x${hex.replace(/^0x/i, '')}`;
};

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
  stallsEnabled: boolean;

  stallVictimIndex: number | null;
  nextFetchIndex: number;

}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  stepSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void;
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
  stallsEnabled: true,
  stallVictimIndex: null,
  nextFetchIndex: 0,
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

  return { rs, rt, rd, opcode, funct, type, isLoad };
};

const isStore = (opcode: number) => opcode >= 40 && opcode <= 43;

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

    // Check back up to 3 previous instructions for dependencies
    for (let dist = 1; dist <= 3; dist++) {
      const j = i - dist;
      if (j < 0) break;

      const prevInst = registerUsage[j];

      // Skip if previous instruction doesn't write to any register
      if (prevInst.rd === 0) continue;

      // Check for RAW hazards
      let hasRawHazard = false;
      let hazardRegister = "";

      if (currentInst.rs === prevInst.rd) {
        hasRawHazard = true;
        hazardRegister = `rs(${getRegisterName(currentInst.rs)})`;
      } else if (currentInst.type === "R" && currentInst.rt === prevInst.rd) {
        // R-type uses both rs and rt as sources
        hasRawHazard = true;
        hazardRegister = `rt(${getRegisterName(currentInst.rt)})`;
      } else if (isStore(currentInst.opcode) && currentInst.rt === prevInst.rd) {
        // Store uses rt as source (data to be stored)
        hasRawHazard = true;
        hazardRegister = `rt(${getRegisterName(currentInst.rt)})`;
      } else if (currentInst.opcode === 4 || currentInst.opcode === 5) {
        // Branch instructions use both rs and rt as sources
        if (currentInst.rt === prevInst.rd) {
          hasRawHazard = true;
          hazardRegister = `rt(${getRegisterName(currentInst.rt)})`;
        }
      }

      if (hasRawHazard) {
        if (forwardingEnabled) {
          // With forwarding, we only care if distance is 1 and it's a load-use
          if (dist === 1 && prevInst.isLoad) {
            hazards[i] = {
              type: "RAW",
              description: `Load-use hazard: ${hazardRegister} depends on lw in instruction ${j}`,
              canForward: true,
              stallCycles: 1,
            };
            stalls[i] = Math.max(stalls[i], 1);
            forwardings[i].push({
              from: j,
              to: i,
              fromStage: "MEM",
              toStage: "EX",
              register: getRegisterName(prevInst.rd),
            });
          } else if (dist === 1) {
            // Regular RAW distance 1 with forwarding: 0 stalls
            hazards[i] = {
              type: "RAW",
              description: `RAW hazard: ${hazardRegister} depends on ${j} (forwarded from EX)`,
              canForward: true,
              stallCycles: 0,
            };
            forwardings[i].push({
              from: j,
              to: i,
              fromStage: "EX",
              toStage: "EX",
              register: getRegisterName(prevInst.rd),
            });
          } else if (dist === 2) {
            // Distance 2 with forwarding: 0 stalls
            hazards[i] = {
              type: "RAW",
              description: `RAW hazard: ${hazardRegister} depends on ${j} (forwarded from MEM)`,
              canForward: true,
              stallCycles: 0,
            };
            forwardings[i].push({
              from: j,
              to: i,
              fromStage: "MEM",
              toStage: "EX",
              register: getRegisterName(prevInst.rd),
            });
          }
        } else {
          // No forwarding: stall until producer exits WB
          // Dist 1: needs 3 stalls (to wait for producer's EX, MEM, WB)
          // Dist 2: needs 2 stalls (to wait for producer's MEM, WB)
          // Dist 3: needs 1 stall (to wait for producer's WB)
          const neededStalls = 4 - dist;
          if (neededStalls > stalls[i]) {
            stalls[i] = neededStalls;
            hazards[i] = {
              type: "RAW",
              description: `RAW hazard: ${hazardRegister} depends on ${j}. Stalling ${neededStalls} cycles until ${j} exits pipeline.`,
              canForward: false,
              stallCycles: neededStalls,
            };
          }
        }
      }

      // Check for WAW hazards
      if (
        currentInst.rd !== 0 &&
        currentInst.rd === prevInst.rd &&
        !hasRawHazard &&
        dist === 1
      ) {
        hazards[i] = {
          type: "WAW",
          description: `WAW hazard: Both instructions write to ${getRegisterName(currentInst.rd)}`,
          canForward: true,
          stallCycles: 0,
        };
      }
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

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;

  // Completion check 
  let totalStallCycles = 0;
  Object.values(currentState.stalls).forEach((s) => (totalStallCycles += s || 0));
  const completionCycle =
    currentState.instructions.length > 0
      ? currentState.instructions.length + currentState.stageCount - 1 + totalStallCycles
      : 0;

  // Helper: advance a stage by +1 
  const adv = (s: number | null): number | null => {
    if (s === null) return null;
    const ns = s + 1;
    return ns < currentState.stageCount ? ns : null;
  };

  const prev = currentState.instructionStages;
  const newStages: Record<number, number | null> = {};
  Object.keys(prev).forEach((k) => (newStages[Number(k)] = prev[Number(k)]));

  let nextFetchIndex = currentState.nextFetchIndex;
  let nextStallCycles = currentState.currentStallCycles;
  let stallVictimIndex = currentState.stallVictimIndex;

  if (currentState.currentStallCycles > 0) {
    // Freeze IF (stage 0); advance only ID/EX/MEM/WB by +1
    // Note: To the user, the stalled instruction stays in IF/ID.
    for (const [iStr, s] of Object.entries(prev)) {
      const i = Number(iStr);
      if (s === null) {
        newStages[i] = null;
      } else if (s >= 1) {
        newStages[i] = adv(s);      // Everything from ID onwards moves
      } else {
        newStages[i] = s;           // Instruction in IF stage (IF/ID register) stays frozen
      }
    }

    // Keep victim index, decrease stall counter
    nextStallCycles = currentState.currentStallCycles - 1;

    const isFinished = nextCycle > completionCycle;
    return {
      ...currentState,
      currentCycle: isFinished ? completionCycle : nextCycle,
      instructionStages: newStages,
      isRunning: !isFinished,
      isFinished,
      currentStallCycles: nextStallCycles,
      stallVictimIndex,
      nextFetchIndex,
    };
  }

  // Move everything that is already in the pipe by +1
  for (const [iStr, s] of Object.entries(prev)) {
    const i = Number(iStr);
    newStages[i] = adv(s);
  }

  // If IF is empty now, fetch exactly one new instruction into IF
  const IFisEmpty =
    !Object.values(newStages).some((s) => s === 0);

  if (IFisEmpty && nextFetchIndex < currentState.instructions.length) {
    newStages[nextFetchIndex] = 0; // enters via IF/ID
    nextFetchIndex += 1;
  }

  // If we just finished a stall last tick, promote ID -> EX 
  if (currentState.stallVictimIndex !== null) {
    const k = currentState.stallVictimIndex;
    // Instruction is in IF/ID (stage 0 for the simulator logic context, but actually stage 1 in common pipeline terms)
    // The previous logic stayed in stage 1 (ID), but now we ensure it stays in stage 0 (IF/ID) if stalling
    if (prev[k] === 0) {
      newStages[k] = 1;
    }
    stallVictimIndex = null; // clear after promotion
  }

  // Check if any instruction is now in IF/ID (stage 0) and requires stalls to schedule for next tick
  for (const [iStr, s] of Object.entries(newStages)) {
    const i = Number(iStr);
    if (s === 0 && (currentState.stalls[i] || 0) > 0) {
      nextStallCycles = currentState.stalls[i];
      stallVictimIndex = i;
      break; // only the closest hazard 
    }
  }

  const isFinished = nextCycle > completionCycle;
  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : nextCycle,
    instructionStages: newStages,
    isRunning: !isFinished,
    isFinished,
    currentStallCycles: nextStallCycles,
    stallVictimIndex,
    nextFetchIndex,
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
      }

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
        stallVictimIndex: null,
        nextFetchIndex: 1
      });
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

  const stepSimulation = () => {
    setSimulationState((prevState) => {
      if (!prevState.isFinished) {
        // Temporarily set isRunning to true just to calculate next state
        const next = calculateNextState({ ...prevState, isRunning: true });
        // But ensure it stays paused after the step
        return { ...next, isRunning: false };
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
      stepSimulation,
      setForwardingEnabled,
      setStallsEnabled,
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
