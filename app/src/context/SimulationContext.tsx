// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { ForwardInfo, insertStallsForDataHazards, insertStallsForForwarding } from '@/lib/utils'; 

// Define the stage names (optional, but good for clarity)
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

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
  forwards: ForwardInfo[]; // Add forwards property
  instructionsWithStalls?: string[];
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  startSimulationWithStalls: (submittedInstructions: string[]) => void;
  startSimulationWithForwarding: (submittedInstructions: string[]) => void;
}

// Create the contexts
const SimulationStateContext = React.createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = React.createContext<SimulationActions | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length; // Use length of defined stages

const initialState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  forwards: [],
};

// Function to calculate the next state based on the current state
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState; // No changes if not running or already finished
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let activeInstructions = 0;

  currentState.instructions.forEach((_, index) => {
    // Calculate the stage index for the instruction in the next cycle
    // Instruction `index` enters stage `s` (0-based) at cycle `index + s + 1`
    // So, in cycle `c`, the stage is `c - index - 1`
    const stageIndex = nextCycle - index - 1;

    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;
      activeInstructions++; // Count instructions currently in the pipeline
    } else {
      newInstructionStages[index] = null; // Not in pipeline (either hasn't started or has finished)
    }
  });

  // The simulation completes *after* the last instruction finishes the last stage
  const completionCycle = currentState.instructions.length > 0
    ? currentState.instructions.length + currentState.stageCount - 1
    : 0;

  const isFinished = nextCycle > completionCycle;
  const isRunning = !isFinished; // Stop running when finished

  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : nextCycle, // Cap cycle at completion
    instructionStages: newInstructionStages,
    isRunning: isRunning,
    isFinished: isFinished,
  };
};


// Create the provider component
export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = React.useState<SimulationState>(initialState);
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

const startSimulation = React.useCallback((submittedInstructions: string[], forwards?: ForwardInfo[],instructionsWithStalls?: string[]) => {
  clearTimer();
  if (submittedInstructions.length === 0) {
    resetSimulation();
    return;
  }
  const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;
  const initialStages: Record<number, number | null> = {};
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
    forwards: forwards ?? [],
    instructionsWithStalls: instructionsWithStalls ?? [],
  });
}, [resetSimulation]);

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
        if (!prevState.isRunning && prevState.currentCycle > 0 && !prevState.isFinished) {
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
  const startSimulationWithStalls = React.useCallback((submittedInstructions: string[]) => {
  const withStalls = insertStallsForDataHazards(submittedInstructions);
  startSimulation(withStalls); 
  }, [startSimulation]);

  const startSimulationWithForwarding = React.useCallback((submittedInstructions: string[]) => {
  const { forwards, instructions } = insertStallsForForwarding(submittedInstructions);
  const instructionsWithStalls = insertStallsForDataHazards(submittedInstructions);
  startSimulation(instructions, forwards, instructionsWithStalls);
  }, [startSimulation]);

  const actionsValue: SimulationActions = React.useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      startSimulationWithStalls, 
      startSimulationWithForwarding,
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
  const context = React.useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error('useSimulationState must be used within a SimulationProvider');
  }
  return context;
}

export function useSimulationActions() {
  const context = React.useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error('useSimulationActions must be used within a SimulationProvider');
  }
  return context;
}

export function useForwards() {
  const context = React.useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error('useForwards must be used within a SimulationProvider');
  }
  return context.forwards ?? [];
}