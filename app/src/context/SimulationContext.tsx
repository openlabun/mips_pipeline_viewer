// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { hexToBinary, BinaryToInstruction, FetchInstruction } from '../utils/InstructionFetch'; // Import the hexToBinary function


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
  pipelineHistory: (FetchInstruction | null)[][];
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
  pipelineHistory: []
};

/*function simulatePipeline(instructions: FetchInstruction[]): (FetchInstruction | null)[][] {
  const stageCount = DEFAULT_STAGE_COUNT;
  const pipeline: (FetchInstruction | null)[][] = [];

  const queue = [...instructions];
  const currentStage: (FetchInstruction | null)[] = Array(stageCount).fill(null);

  while (true) {
    // Mover instrucciones una etapa hacia adelante
    for (let i = stageCount - 1; i > 0; i--) {
      currentStage[i] = currentStage[i - 1];
    }

    // Ingresar nueva instrucción en IF si hay
    currentStage[0] = queue.length > 0 ? queue.shift()! : null;
    
    // Si el pipeline está completamente vacío, cortar aquí y no guardar más ciclos
    if (queue.length === 0 && currentStage.every(stage => stage === null)) {
      break;
    }

    pipeline.push([...currentStage]);
  }

  return pipeline;
}*/
function calculatePipelineCyclesWithStalls(
  instructions: FetchInstruction[]
): { pipeline: (FetchInstruction | null)[][]; finalStageInstructions: FetchInstruction[] } {
  const stageCount = DEFAULT_STAGE_COUNT;
  const pipeline: (FetchInstruction | null)[][] = [];
  const finalStageInstructions: FetchInstruction[] = [];

  const queue = [...instructions];
  const currentStage: (FetchInstruction | null)[] = Array(stageCount).fill(null);
  const stall: FetchInstruction = { instruction: 'STALL', RegWrite: false };

  const getReg = (inst: any, reg: 'rs' | 'rt' | 'rd') => (inst && inst[reg] ? inst[reg] : null);
  const getRegWrite = (inst: any) => (typeof inst?.RegWrite === 'boolean' ? inst.RegWrite : false);

  while (true) {
    let hazardDetection: 'EX' | 'MEM' | null = null;
    const ifId = currentStage[0];
    const idEx = currentStage[1];
    const exMem = currentStage[2];
    const memWb = currentStage[3];

    if (ifId && ifId.instruction !== 'STALL') {
      const rs = getReg(ifId, 'rs');
      const rt = getReg(ifId, 'rt');

      if (
        idEx && idEx.instruction !== 'STALL' &&
        getRegWrite(idEx) && getReg(idEx, 'rd') && getReg(idEx, 'rd') !== '00000' &&
        (getReg(idEx, 'rd') === rs || getReg(idEx, 'rd') === rt)
      ) {
        hazardDetection = 'EX';
      }

      if (
        (exMem && exMem.instruction !== 'STALL' &&
        getRegWrite(exMem) && getReg(exMem, 'rd') && getReg(exMem, 'rd') !== '00000' &&
        (getReg(exMem, 'rd') === rs || getReg(exMem, 'rd') === rt)) ||
        (memWb && memWb.instruction !== 'STALL' &&
        getRegWrite(memWb) && getReg(memWb, 'rd') && getReg(memWb, 'rd') !== '00000' &&
        (getReg(memWb, 'rd') === rs || getReg(memWb, 'rd') === rt))
      ) {
        hazardDetection = 'MEM';
      }
    }

    const stageCalc = hazardDetection === 'EX' ? stageCount - 4 :
                      hazardDetection === 'MEM' ? stageCount - 3 : 0;

    for (let i = stageCount - 1; i > stageCalc; i--) {
      currentStage[i] = currentStage[i - 1];
    }

    switch (hazardDetection) {
      case 'EX':
        currentStage[1] = stall;
        break;
      case 'MEM':
        currentStage[2] = stall;
        break;
      default:
        currentStage[0] = queue.length > 0 ? queue.shift()! : null;
        break;
    }

    // Guardar la instrucción que sale del pipeline (WB)
    const exiting = currentStage[stageCount - 1];
    if (exiting !== null) {
      finalStageInstructions.push(exiting);
    }

    pipeline.push([...currentStage]);

    if (queue.length === 0 && currentStage.every(stage => stage === null)) {
      break;
    }
  }

  return { pipeline, finalStageInstructions };
}


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
    ? currentState.maxCycles
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

  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer(); // Clear previous timer just in case
    if (submittedInstructions.length === 0) { 
      resetSimulation(); // Reset if no instructions submitted
      return;
    }

    const Instructions: FetchInstruction[] = submittedInstructions.map(hexToBinary).map(BinaryToInstruction).filter((inst): inst is FetchInstruction => inst !== null);
    const { pipeline, finalStageInstructions } = calculatePipelineCyclesWithStalls(Instructions);
    console.log('Orden', finalStageInstructions);;
    const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;
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
      maxCycles: pipeline.length,
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: initialStages, // Set initial stages for cycle 1
      isFinished: false,
      pipelineHistory: pipeline // Store the pipeline history
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
