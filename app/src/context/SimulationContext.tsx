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
  instructionStages: Record<
    number,
    { stageIndex: number | null; isForwarding?: boolean }
  >;
  isFinished: boolean; // Track if simulation completed
  forwardingPaths?: { toIndex: number; stage: string }[];
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
const initialState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  forwardingPaths: [],
};

// Function to calculate the next state based on the current state
type InstructionStageInfo = {
  stageIndex: number | null;
  isForwarding?: boolean;
};

let numero = 0;

const calculateNextState = (currentState: SimulationState): SimulationState => {
  numero++;
  console.log("contador: ", numero);

  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, InstructionStageInfo> = {};
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
    if (instrIF?.opcode === "101011" || instrIF?.opcode === "100011") {
      if (
        (instrID.type === "R" &&
          (instrID.rd === instrIF.rs || instrID.rd === instrIF.rt)) ||
        (instrID.type === "I" &&
          (instrID.rt === instrIF.rs || instrID.rt === instrIF.rt))
      ) {
        return true;
      }
    }
    if (instrID?.opcode === "100011") {
      if (
        (instrIF.type === "R" &&
          (instrID.rt === instrIF.rs || instrID.rt === instrIF.rt)) ||
        (instrID.type === "I" && instrID.rt === instrIF.rs)
      ) {
        return true;
      }
    }
    return false;
  };

  const forward = (
    instr1: DecodedInstruction,
    instr2: DecodedInstruction
  ): boolean => {
    console.log("Instruccion de la mesa ID:", instr1);
    console.log("Instruccion de la mesa EX o MEM:", instr2);
    if (
      instr1.type === "R" &&
      instr2.type === "R" &&
      (instr1.rs === instr2.rd ||
        (instr1.rt === instr2.rd && instr2.rd !== "00000"))
    ) {
      return true;
    }
    if (
      instr1.type === "R" &&
      instr2.type === "I" &&
      (instr1.rs === instr2.rt ||
        (instr1.rt === instr2.rt && instr2.opcode !== "101011"))
    ) {
      return true;
    }
    if (
      (instr1.type === "I" &&
        instr2.type === "R" &&
        instr1.rs === instr2.rd &&
        instr2.rd !== "00000") ||
      (instr1.rt === instr2.rd && instr1.opcode === "101011")
    ) {
      return true;
    }
    if (
      (instr1.type === "I" &&
        instr2.type === "I" &&
        instr1.rs === instr2.rt &&
        instr2.opcode !== "101011") ||
      (instr1.rt === instr2.rt && instr1.opcode === "101011")
    ) {
      return true;
    }
    return false;
  };

  const stageToInstructionIndex: Record<number, number | null> = {};
  Object.entries(currentState.instructionStages).forEach(
    ([instIndex, { stageIndex }]) => {
      if (stageIndex !== null) {
        stageToInstructionIndex[stageIndex] = parseInt(instIndex);
      }
    }
  );

  const idIndex = stageToInstructionIndex[1];
  const ifIndex = stageToInstructionIndex[0];

  if (typeof ifIndex === "number" && typeof idIndex === "number") {
    const instrIF = decodeInstruction(currentState.instructions[ifIndex]);
    const instrID = decodeInstruction(currentState.instructions[idIndex]);
    if (instrIF && instrID) {
      if (hasHazard(instrIF, instrID)) {
        newInstructions.splice(ifIndex, 0, "STALL");
        insertedStall = true;
      }
    }
  }

  let newIndex = 0;
  for (let i = 0; i < newInstructions.length; i++) {
    const stageIndex = nextCycle - newIndex - 1;
    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      if (!newInstructionStages[i]) {
        newInstructionStages[i] = { stageIndex };
      } else {
        newInstructionStages[i].stageIndex = stageIndex;
      }
    } else {
      if (!newInstructionStages[i]) {
        newInstructionStages[i] = { stageIndex: null };
      } else {
        newInstructionStages[i].stageIndex = null;
      }
    }
    newIndex++;
  }

  const longestPath = newInstructions.length + DEFAULT_STAGE_COUNT - 1;
  const newMaxCycles = Math.max(currentState.maxCycles, longestPath);
  const isFinished = nextCycle > longestPath;
  const isRunning = !isFinished;

  const instrucciones: Record<string, { index: number; hex: string } | null> =
    {};

  STAGE_NAMES.forEach((stageName, stageIdx) => {
    const entries = Object.entries(newInstructionStages).filter(
      ([, info]) => info.stageIndex === stageIdx
    );

    if (entries.length > 0) {
      const [instrIndexStr] = entries[0];
      const instrIndex = parseInt(instrIndexStr);
      const hex = newInstructions[instrIndex];
      instrucciones[stageName] = { index: instrIndex, hex };
      console.log(`   🛠 ${stageName}: instrucción[${instrIndex}] = ${hex}`);
    } else {
      instrucciones[stageName] = null;
      console.log(`   🛠 ${stageName}: vacío`);
    }
  });

  let instrID = null;
  let instrEX = null;
  let instrMEM = null;

  if (instrucciones["ID"] && instrucciones["ID"].hex !== "STALL") {
    instrID = decodeInstruction(instrucciones["ID"].hex);
  }
  if (instrucciones["EX"] && instrucciones["EX"].hex !== "STALL") {
    instrEX = decodeInstruction(instrucciones["EX"].hex);
  }
  if (instrucciones["MEM"] && instrucciones["MEM"].hex !== "STALL") {
    instrMEM = decodeInstruction(instrucciones["MEM"].hex);
  }

  // Forwarding desde EX
  if (instrID && instrEX && forward(instrID, instrEX)) {
    console.log("forward desde EX a ID");

    const indexEX = instrucciones["EX"]?.index;
    if (indexEX !== undefined && indexEX !== null) {
      if (!newInstructionStages[indexEX]) {
        newInstructionStages[indexEX] = { stageIndex: null };
      }
      newInstructionStages[indexEX].isForwarding = true;
    }

    const indexID = instrucciones["ID"]?.index;
    if (indexID !== undefined && indexID !== null) {
      if (!newInstructionStages[indexID]) {
        newInstructionStages[indexID] = { stageIndex: null };
      }
      newInstructionStages[indexID].isForwarding = true;
    }
  }

  // Forwarding desde MEM
  if (instrID && instrMEM && forward(instrID, instrMEM)) {
    console.log("forward desde MEM a ID");

    const indexMEM = instrucciones["MEM"]?.index;
    if (indexMEM !== undefined && indexMEM !== null) {
      if (!newInstructionStages[indexMEM]) {
        newInstructionStages[indexMEM] = { stageIndex: null };
      }
      newInstructionStages[indexMEM].isForwarding = true;
    }

    const indexID = instrucciones["ID"]?.index;
    if (indexID !== undefined && indexID !== null) {
      if (!newInstructionStages[indexID]) {
        newInstructionStages[indexID] = { stageIndex: null };
      }
      newInstructionStages[indexID].isForwarding = true;
    }
  }

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

  const clearTimer = React.useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const runClock = React.useCallback(() => {
    if (intervalRef.current !== null) return;

    intervalRef.current = setInterval(() => {
      setSimulationState((prevState) => {
        const nextState = calculateNextState(prevState);
        if (nextState.isFinished && !prevState.isFinished) {
          clearTimer();
        }
        return nextState;
      });
    }, 1000);
  }, [clearTimer]);

  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState(initialState);
  }, [clearTimer]);

  const startSimulation = React.useCallback(
    (submittedInstructions: string[]) => {
      clearTimer();
      if (submittedInstructions.length === 0) {
        resetSimulation();
        return;
      }

      const calculatedMaxCycles =
        submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;
      const initialStages: Record<number, { stageIndex: number | null }> = {};

      // Inicializar etapas para ciclo 1
      submittedInstructions.forEach((_, index) => {
        const stageIndex = 1 - index - 1;
        if (stageIndex >= 0 && stageIndex < DEFAULT_STAGE_COUNT) {
          initialStages[index] = { stageIndex };
        } else {
          initialStages[index] = { stageIndex: null };
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
      });
    },
    [resetSimulation, clearTimer]
  );

  const pauseSimulation = React.useCallback(() => {
    setSimulationState((prevState) => {
      if (prevState.isRunning) {
        clearTimer();
        return { ...prevState, isRunning: false };
      }
      return prevState;
    });
  }, [clearTimer]);

  const resumeSimulation = React.useCallback(() => {
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
  }, []);

  // Solo corre una vez cuando cambia isRunning o isFinished
  React.useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    }

    return () => {
      clearTimer(); // Cleanup al desmontar o cambio
    };
  }, [
    simulationState.isRunning,
    simulationState.isFinished,
    runClock,
    clearTimer,
  ]);

  const stateValue: SimulationState = simulationState;

  const actionsValue: SimulationActions = React.useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
    }),
    [startSimulation, resetSimulation, pauseSimulation, resumeSimulation]
  );

  return (
    <SimulationStateContext.Provider value={stateValue}>
      <SimulationActionsContext.Provider value={actionsValue}>
        {children}
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

// Custom hooks para consumir el contexto
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
