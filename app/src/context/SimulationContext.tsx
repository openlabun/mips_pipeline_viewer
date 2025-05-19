// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

import { Modern_Antiqua } from "next/font/google";
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
  isRunning: boolean; // está corriendo la simulación?
  stageCount: number; //cantidad de etapas
  // Map instruction index to its current stage index (0-based) or null if not started/finished
  instructionStages: Record<number, number | null>; // Mapa: instrucción → etapa actual (0-4) o null
  isFinished: boolean; // Track if simulation completed
  mode: "normal" | "stall" | "forwarding";
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setMode: (mode: "normal" | "stall" | "forwarding") => void; // Function to set the mode
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
  mode: "normal", // Default mode
};

// Function to calculate the next state based on the current state
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState; // No changes if not running or already finished
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};

  let stalled = false; // Track if any instruction is stalled

  for (let i = 0; i < currentState.instructions.length; i++) {
    const stageIndex = nextCycle - i - 1; // Calculate the stage index for this instruction

    // Si estamos en modo stall y hay dependencia con la anterior, no avanzamos
    if (currentState.mode === "stall" && i > 0 && stageIndex === 1) {
      const prevStage = currentState.instructionStages[i - 1];
      const currStage = currentState.instructionStages[i];

      // Detectar dependencia de datos entre instrucciones consecutivas
      if (prevStage === 2 && currStage === 1) {
        stalled = true;
        newInstructionStages[i] = currStage; // Mantener en la etapa actual (ID)

        console.log(
          `STALL detected at instruction ${i} in cycle ${currentState.currentCycle}`,
          {
            prevStage,
            currStage,
            stageIndex,
          }
        );

        continue; // Saltar a la siguiente instrucción
      }
    }

    // Manejo de dependencias más complejas (opcional)
    if (currentState.mode === "stall") {
      for (let j = 0; j < i; j++) {
        const prevStage = currentState.instructionStages[j];
        const currStage = currentState.instructionStages[i];

        // Si hay una dependencia entre instrucciones separadas por más de una posición
        if (prevStage === 2 && currStage === 1) {
          stalled = true;
          newInstructionStages[i] = currStage; // Mantener en la etapa actual
          break; // Salir del bucle interno
        }
      }
    }

    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[i] = stageIndex; // Actualizar la etapa de la instrucción
    } else {
      newInstructionStages[i] = null; // Marcar como finalizada
    }
  }

  // Si hay stalls, no avanzamos el ciclo
  const finalCycle = stalled ? currentState.currentCycle : nextCycle;

  const completionCycle =
    currentState.instructions.length + currentState.stageCount - 1;
  const isFinished = finalCycle > completionCycle;

  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : finalCycle,
    instructionStages: newInstructionStages,
    isRunning: !isFinished,
    isFinished: isFinished,
  };
};

// Create the provider component
export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] =
    React.useState<SimulationState>(initialState);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const setMode = (mode: "normal" | "stall" | "forwarding") => {
    setSimulationState((prev) => ({
      ...prev,
      mode,
    }));
  };

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

      setSimulationState((prev) => ({
        ...prev,
        instructions: submittedInstructions,
        currentCycle: 1,
        maxCycles: calculatedMaxCycles,
        isRunning: true,
        stageCount: DEFAULT_STAGE_COUNT,
        instructionStages: initialStages,
        isFinished: false,
      }));
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
      setMode,
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
