// src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from "react";
import * as React from "react";

const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = typeof STAGE_NAMES[number];

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
}

const SimulationStateContext = React.createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = React.createContext<SimulationActions | undefined>(undefined);

// NUEVO CONTEXTO: estado del forwarding
const SimulationForwardingContext = React.createContext<{
  isForwarding: boolean;
  toggleForwarding: () => void;
} | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

const initialState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
};

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let activeInstructions = 0;

  currentState.instructions.forEach((_, index) => {
    const stageIndex = nextCycle - index - 1;
    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;
      activeInstructions++;
    } else {
      newInstructionStages[index] = null;
    }
  });

  const completionCycle =
    currentState.instructions.length > 0
      ? currentState.instructions.length + currentState.stageCount - 1
      : 0;

  const isFinished = nextCycle > completionCycle;
  const isRunning = !isFinished;

  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : nextCycle,
    instructionStages: newInstructionStages,
    isRunning,
    isFinished,
  };
};

export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = React.useState<SimulationState>(initialState);
  const [isForwarding, setIsForwarding] = React.useState<boolean>(false); // NUEVO ESTADO
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const runClock = React.useCallback(() => {
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

  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState(initialState);
  }, []);

  const startSimulation = React.useCallback(
    (submittedInstructions: string[]) => {
      clearTimer();
      if (submittedInstructions.length === 0) {
        resetSimulation();
        return;
      }

      const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;
      const initialStages: Record<number, number | null> = {};
      submittedInstructions.forEach((_, index) => {
        const stageIndex = 1 - index - 1;
        initialStages[index] = stageIndex >= 0 && stageIndex < DEFAULT_STAGE_COUNT ? stageIndex : null;
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
    [resetSimulation]
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
      if (!prevState.isRunning && prevState.currentCycle > 0 && !prevState.isFinished) {
        return { ...prevState, isRunning: true };
      }
      return prevState;
    });
  };

  React.useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);

  const toggleForwarding = () => setIsForwarding((prev) => !prev); // NUEVA FUNCIÓN

  return (
    <SimulationStateContext.Provider value={simulationState}>
      <SimulationActionsContext.Provider
        value={{
          startSimulation,
          resetSimulation,
          pauseSimulation,
          resumeSimulation,
        }}
      >
        <SimulationForwardingContext.Provider
          value={{
            isForwarding,
            toggleForwarding,
          }}
        >
          {children}
        </SimulationForwardingContext.Provider>
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

// Hooks
export function useSimulationState() {
  const context = React.useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error("useSimulationState must be used within a SimulationProvider");
  }
  return context;
}

export function useSimulationActions() {
  const context = React.useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error("useSimulationActions must be used within a SimulationProvider");
  }
  return context;
}

// NUEVO HOOK
export function useSimulationForwarding() {
  const context = React.useContext(SimulationForwardingContext);
  if (context === undefined) {
    throw new Error("useSimulationForwarding must be used within a SimulationProvider");
  }
  return context;
}
