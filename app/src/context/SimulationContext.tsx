// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

import type { PropsWithChildren } from "react";
import * as React from "react";

// Define the stage names (optional, but good for clarity)
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = (typeof STAGE_NAMES)[number];

// Define the shape of the context state
interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  // Map instruction index to its current stage index (0-based) or null if not started/finished
  instructionStages: Record<number, number | null>;
  isFinished: boolean; // Track if simulation completed
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
}

interface DecodedInstruction {
  opcode: string;
  type: "R" | "I";
  rs: string;
  rt: string;
  rd: string;
}

// Create the contexts
const SimulationStateContext = React.createContext<SimulationState | undefined>(
  undefined
);
const SimulationActionsContext = React.createContext<
  SimulationActions | undefined
>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length; // Use length of defined stages
let sw: number = 0; // Valida si una instruccion es store o load para la deteccion de hazards
let lw: number = 0;
const initialState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
};

// Function to calculate the next state based on the current state
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let newInstructions = [...currentState.instructions];
  let insertedStall = false;

  const hexToBin = (hex: string): string =>
    parseInt(hex, 16).toString(2).padStart(32, "0");

  const getInstructionType = (binary: string): "R" | "I" | "Unsupported" => {
    const opcode = binary.substring(0, 6);
    if (opcode === "000000") return "R";
    const unsupportedOpcodes = ["000100", "000101", "000010"];
    return unsupportedOpcodes.includes(opcode) ? "Unsupported" : "I";
  };

  const decodeInstruction = (hex: string): DecodedInstruction | null => {
    if (hex === "STALL") return null;
    const bin = hexToBin(hex);
    const opcode = bin.substring(0, 6);
    const type = getInstructionType(bin);
    if (type === "Unsupported") return null;

    const rs = bin.substring(6, 11);
    const rt = bin.substring(11, 16);
    let rd = "";
    if (type === "R") {
      rd = bin.substring(16, 21);
    }

    return { opcode, type, rs, rt, rd };
  };

  const hasHazard = (
    instrIF: DecodedInstruction,
    instrID: DecodedInstruction
  ): boolean => {
    if (instrIF?.opcode === "101011") {
      sw = 1;
    } else {
      sw = 0;
    }
    if (instrID?.opcode === "100011") {
      lw = 1;
    } else {
      lw = 0;
    }
    if (instrIF.type === "R") {
      if (instrID.type === "R") {
        if (instrIF.rs === instrID.rd || instrIF.rt === instrID.rd) {
          return true;
        }
        if (
          (lw === 1 && instrIF.rs === instrID.rt) ||
          instrIF.rt === instrID.rt
        ) {
          return true;
        }
      } else {
        if (instrIF.rs === instrID.rd || instrIF.rt === instrID.rt) {
          return true;
        }
        if (lw === 1 && instrIF.rs === instrID.rt) {
          return true;
        }
      }
    } else {
      if (instrID.type === "R") {
        if (instrIF.rs === instrID.rd) {
          return true;
        }
        if (sw === 1 && instrIF.rt === instrID.rd) {
          return true;
        }
      } else {
        if (instrIF.rs === instrID.rt) {
          return true;
        }
        if (sw === 1 && instrIF.rt === instrID.rt) {
          return true;
        }
      }
    }
    return false;
  };

  for (let i = 1; i < currentState.instructions.length; i++) {
    const stageIF = currentState.instructionStages[i];
    const stageID = currentState.instructionStages[i - 1];

    if (stageIF === 0 && stageID === 1) {
      const instrIF = decodeInstruction(currentState.instructions[i]);
      const instrID = decodeInstruction(currentState.instructions[i - 1]);
      if (instrIF && instrID) {
        console.log(instrIF);
        console.log(instrID);
        console.log("El opcode en la mesa IF es: ", instrIF?.opcode);
        console.log("El opcode en la mesa ID es: ", instrID?.opcode);
        const isStore = instrIF.opcode === "101011";
        const isLoad = instrID.opcode === "100011";
        if (hasHazard(instrIF, instrID) && (isStore || isLoad)) {
          console.log("El estado del hazard es: ", hasHazard(instrIF, instrID));
          newInstructions.splice(i, 0, "STALL");
          insertedStall = true;
          break;
        } else {
          console.log("El estado del hazard es: false");
        }
      }
      const instrEX = decodeInstruction(currentState.instructions[i - 2]);
      if (instrEX) {
        const instrMEM = decodeInstruction(currentState.instructions[i - 3]);
        if (instrMEM && hasHazard(instrEX, instrMEM)) {
          console.log("El forward viene de la mesa MEM");
        } else {
          const instrWB = decodeInstruction(currentState.instructions[i - 4]);
          if (instrWB && hasHazard(instrEX, instrWB)) {
            console.log("El forward viene de la mesa WB");
          } else{
            console.log("El forward viene de la mesa ID");
          }
        }
      }
    }
  }

  let newIndex = 0;
  for (let i = 0; i < newInstructions.length; i++) {
    const stageIndex = nextCycle - newIndex - 1;
    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[i] = stageIndex;
    } else {
      newInstructionStages[i] = null;
    }
    newIndex++;
  }

  const longestPath = newInstructions.length + DEFAULT_STAGE_COUNT - 1;
  const newMaxCycles = Math.max(currentState.maxCycles, longestPath);
  const isFinished = nextCycle > longestPath;
  const isRunning = !isFinished;

  return {
    ...currentState,
    instructions: newInstructions,
    currentCycle: isFinished ? longestPath : nextCycle,
    instructionStages: newInstructionStages,
    isRunning,
    isFinished,
    maxCycles: newMaxCycles,
  };
};

// Create the provider component
export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] =
    React.useState<SimulationState>(initialState);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const runClock = React.useCallback(() => {
    clearTimer(); // Clear any existing timer
    if (!simulationState.isRunning || simulationState.isFinished) return; // Don't start timer if not running or finished

    intervalRef.current = setInterval(() => {
      setSimulationState((prevState) => {
        const nextState = calculateNextState(prevState);
        // Check if the simulation just finished in this step
        if (nextState.isFinished && !prevState.isFinished) {
          clearTimer(); // Stop the clock immediately
        }
        return nextState;
      });
    }, 1000); // Advance cycle every 1 second
  }, [simulationState.isRunning, simulationState.isFinished]); // Dependencies

  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState(initialState);
  }, []);

  const startSimulation = React.useCallback(
    (submittedInstructions: string[]) => {
      clearTimer(); // Clear previous timer just in case
      if (submittedInstructions.length === 0) {
        resetSimulation(); // Reset if no instructions submitted
        return;
      }

      const calculatedMaxCycles =
        submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;
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
        currentCycle: 1, // Start from cycle 1
        maxCycles: calculatedMaxCycles,
        isRunning: true,
        stageCount: DEFAULT_STAGE_COUNT,
        instructionStages: initialStages, // Set initial stages for cycle 1
        isFinished: false,
      });
      // runClock will be triggered by the useEffect below when isRunning becomes true
    },
    [resetSimulation]
  );

  const pauseSimulation = () => {
    setSimulationState((prevState) => {
      if (prevState.isRunning) {
        clearTimer();
        return { ...prevState, isRunning: false };
      }
      return prevState; // No change if already paused
    });
  };

  const resumeSimulation = () => {
    setSimulationState((prevState) => {
      // Resume only if paused, started, and not finished
      if (
        !prevState.isRunning &&
        prevState.currentCycle > 0 &&
        !prevState.isFinished
      ) {
        return { ...prevState, isRunning: true };
      }
      return prevState; // No change if running, not started, or finished
    });
    // runClock will be triggered by useEffect
  };

  // Effect to manage the interval timer based on isRunning state
  React.useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    // Cleanup timer on unmount or when isRunning/isFinished changes
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);

  // State value derived directly from simulationState
  const stateValue: SimulationState = simulationState;

  const actionsValue: SimulationActions = React.useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
    }),
    [startSimulation, resetSimulation] // pause/resume don't change
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
  const context = React.useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error(
      "useSimulationState must be used within a SimulationProvider"
    );
  }
  return context;
}

export function useSimulationActions() {
  const context = React.useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error(
      "useSimulationActions must be used within a SimulationProvider"
    );
  }
  return context;
}
