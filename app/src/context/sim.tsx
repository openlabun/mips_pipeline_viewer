// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { analyzeInstruction } from './utils'; // Import the analyzeInstruction function
// Define the stage names (optional, but good for clarity)
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB', 'STALL'] as const;
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
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
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
};

export type PipelineOption = "default" | "stall" | "forward";
interface SimulationProviderProps extends PropsWithChildren {
  pipelineOption: PipelineOption;
}


// Create the provider component
export function SimulationProvider({ children, pipelineOption }: SimulationProviderProps) {
  const [simulationState, setSimulationState] = React.useState<SimulationState>(initialState);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };
  const calculateNextState = (currentState: SimulationState): SimulationState => {
    if (!currentState.isRunning || currentState.isFinished) {
      return currentState;
    }

    const nextCycle = currentState.currentCycle + 1;
    const stageCount = currentState.stageCount;
    const newInstructionStages: Record<number, number | null> = {};
    const instructions = currentState.instructions;
    pipelineOption = pipelineOption || "default"; // Default to "default" if not provided
    switch (pipelineOption) {
      case "default": {
        console.log("Instructions: ", instructions);
        instructions.forEach((_, index) => {
          const stageIndex = nextCycle - index - 1;
          if (stageIndex >= 0 && stageIndex < stageCount) {
            newInstructionStages[index] = stageIndex;
          } else {
            newInstructionStages[index] = null;
          }
        });
        break;
      }

     case "stall": {
      // Detecta el primer conflicto de dependencia de datos
      let stallIndex = -1;
      for (let i = 1; i < instructions.length; i++) {
        const currentMeta = analyzeInstruction(instructions[i]);
        for (let j = 0; j < i; j++) {
          const prevMeta = analyzeInstruction(instructions[j]);
          const prevStage = simulationState.instructionStages[j];
          if (
            prevStage !== null &&
            prevMeta.writesTo &&
            currentMeta.readsFrom.includes(prevMeta.writesTo)
          ) {
            // Para lw: MEM (stage 3), para otras: WB (stage 4)
            const writeStage = prevMeta.name === "lw" ? 3 : 4;
            if (prevStage < writeStage) {
              stallIndex = i;
              break;
            }
          }
        }
        if (stallIndex !== -1) break;
      }

      for (let i = 0; i < instructions.length; i++) {
        const prevStage = simulationState.instructionStages[i];
        if (prevStage === null || prevStage === undefined) {
          newInstructionStages[i] = null;
          continue;
        }
        if (prevStage === -1) {
          // Si estaba en STALL, verifica si ya puede avanzar a IF
          // Solo avanza si ya no hay dependencia
          let hasDependency = false;
          for (let j = 0; j < i; j++) {
            const prevMeta = analyzeInstruction(instructions[j]);
            const prevStageJ = simulationState.instructionStages[j];
            const currentMeta = analyzeInstruction(instructions[i]);
            const writeStage = prevMeta.name === "lw" ? 3 : 4;
            if (
              prevStageJ !== null &&
              prevMeta.writesTo &&
              currentMeta.readsFrom.includes(prevMeta.writesTo) &&
              prevStageJ < writeStage
            ) {
              hasDependency = true;
              break;
            }
          }
          if (hasDependency) {
            newInstructionStages[i] = -1; // Sigue en STALL
          } else {
            newInstructionStages[i] = 0; // Avanza a IF
          }
        } else if (stallIndex !== -1 && i === stallIndex) {
          // Esta instrucción debe entrar en STALL
          newInstructionStages[i] = -1;
        } else if (stallIndex !== -1 && i > stallIndex) {
          // Las siguientes tampoco avanzan
          newInstructionStages[i] = prevStage;
        } else {
          // Avanza normalmente
          const nextStage = prevStage + 1;
          newInstructionStages[i] = (nextStage >= 0 && nextStage < stageCount) ? nextStage : null;
        }
      }
      break;
    }


      case "forward": {
        instructions.forEach((_, index) => {
          const stageIndex = nextCycle - index - 1;
          if (stageIndex >= 0 && stageIndex < stageCount) {
            newInstructionStages[index] = stageIndex;
          } else {
            newInstructionStages[index] = null;
          }
        });
        break;
      }

      default:
        return currentState;
    }

    const completionCycle = instructions.length + stageCount - 1;
    const allFinished = Object.values(newInstructionStages).every(stage => stage === null);

    return {
      ...currentState,
      currentCycle: nextCycle,
      instructionStages: newInstructionStages,
      isRunning: !allFinished,
      isFinished: allFinished,
    };
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

  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer(); // Clear previous timer just in case
    if (submittedInstructions.length === 0) {
      resetSimulation(); // Reset if no instructions submitted
      return;
    }
    const stallCount = countStalls(submittedInstructions, DEFAULT_STAGE_COUNT);
    const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1 + stallCount;
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

function countStalls(instructions: string[], stageCount: number): number {
  let stallCount = 0;
  for (let i = 1; i < instructions.length; i++) {
    const currentMeta = analyzeInstruction(instructions[i]);
    for (let j = 0; j < i; j++) {
      const prevMeta = analyzeInstruction(instructions[j]);
      const prevStage = stageCount - (i - j); // Calculate the stage based on the distance
      if (
        prevStage >= 0 &&
        prevMeta.writesTo &&
        currentMeta.readsFrom.includes(prevMeta.writesTo)
      ) {
        // Para lw: MEM (stage 3), para otras: WB (stage 4)
        const writeStage = prevMeta.name === "lw" ? 3 : 4;
        if (prevStage < writeStage) {
          stallCount++;
          break;
        }
      }
    }
  }
  return stallCount;
}