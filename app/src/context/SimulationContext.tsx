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

import { cambioboton, haybranch, labelsigno, saltobranch } from "@/components/instruction-input";
import { setomabranch } from "@/components/instruction-input";

let pc: number=0;
let branchMisses = 0; // contador global
let cambiopip: boolean;
let alarma: boolean;
alarma = false;
let misses: number = 0;
let branch: boolean;
let cambioboton2: boolean = true;



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
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void; // Add this new action
  setBranchEnabled: (enabled: boolean) => void; // Add this new action

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
    cambioboton2 = false;
    return [hazards, forwardings, stalls];
  }
  if (stallsEnabled) {
    cambioboton2 = true;
    
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


let entryCounter2 = 2; // Contador de entradas


const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  let nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let activeInstructions = 0;

  let newStallCycles = currentState.currentStallCycles;
  if (newStallCycles > 0) {
    newStallCycles--;
    return {
      ...currentState,
      currentCycle: nextCycle,
      instructionStages: currentState.instructionStages,
      currentStallCycles: newStallCycles,
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

      if (
        stageIndex === 1 &&
        currentState.stalls[index] > 0 &&
        newStallCycles === 0
      ) {
        newStallCycles = currentState.stalls[index];
      }
    } else {
      newInstructionStages[index] = null;
    }
  });


  branch = setomabranch;
  if (entryCounter2 > 2){
    console.log("entrro a branches")
        if ((haybranch[0] === "bne" || haybranch[0] === "beq") && branch == true && cambioboton2 == true){
        console.log("hay branch")
        
        misses++;
        console.log(misses)
        alarma = true;
        cambiopip = true;
        console.log("salto del label",nextCycle)
        if(labelsigno == false){

            nextCycle = nextCycle + (saltobranch-2);
        }
        

      }else{
        alarma = false;
      }
      cambiopip = false;
      haybranch.shift()
      entryCounter2 = 0
      console.log(haybranch)



}
branch = false;
entryCounter2 +=1
console.log(entryCounter2)




console.log(nextCycle)




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
      misses = 0;
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

    const setBranchEnabled = (enabled: boolean) => {
    setSimulationState((prevState) => {
      return { ...prevState, branchEnabled: enabled };
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
      setForwardingEnabled,
      setStallsEnabled,
      setBranchEnabled,
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


export {alarma };
export { misses };
export {cambioboton2 }; 