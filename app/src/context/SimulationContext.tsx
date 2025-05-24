// src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { hexToBinary, BinaryToInstruction, FetchInstruction } from '../utils/InstructionFetch'; // Import the hexToBinary function

const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = typeof STAGE_NAMES[number];

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  isFinished: boolean; // Track if simulation completed
  pipelineHistory: (FetchInstruction | null)[][];
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
  pipelineHistory: []
};

function calculatePipelineCyclesWithStalls(
  instructions: FetchInstruction[]
): { pipeline: (FetchInstruction | null)[][]; finalStageInstructions: string[] } {
  const stageCount = DEFAULT_STAGE_COUNT;
  const pipeline: (FetchInstruction | null)[][] = [];
  const finalStageInstructions: string[] = [];

  const queue = [...instructions];
  const currentStage: (FetchInstruction | null)[] = Array(stageCount).fill(null);
  const stall: FetchInstruction = { instruction: 'STALL', opcode: '111111', RegWrite: false };

  const getReg = (inst: any, reg: 'rs' | 'rt' | 'rd') =>
    inst && inst[reg] ? inst[reg] : null;
  const getRegWrite = (inst: any) =>
    typeof inst?.RegWrite === 'boolean' ? inst.RegWrite : false;

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
        idEx &&
        idEx.instruction !== 'STALL' &&
        getRegWrite(idEx) &&
        getReg(idEx, 'rd') &&
        getReg(idEx, 'rd') !== '00000' &&
        (getReg(idEx, 'rd') === rs || getReg(idEx, 'rd') === rt)
      ) {
        hazardDetection = 'EX';
      }

      if (
        (exMem &&
          exMem.instruction !== 'STALL' &&
          getRegWrite(exMem) &&
          getReg(exMem, 'rd') &&
          getReg(exMem, 'rd') !== '00000' &&
          (getReg(exMem, 'rd') === rs || getReg(exMem, 'rd') === rt)) ||
        (memWb &&
          memWb.instruction !== 'STALL' &&
          getRegWrite(memWb) &&
          getReg(memWb, 'rd') &&
          getReg(memWb, 'rd') !== '00000' &&
          (getReg(memWb, 'rd') === rs || getReg(memWb, 'rd') === rt))
      ) {
        hazardDetection = 'MEM';
      }
    }

    const stageCalc =
      hazardDetection === 'EX'
        ? stageCount - 4
        : hazardDetection === 'MEM'
        ? stageCount - 3
        : 0;

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

    // Verificar si ya no hay instrucciones y el pipeline está vacío antes de guardar estado
    if (queue.length === 0 && currentStage.every(stage => stage === null)) {
      break;
    }

    // Guardar instrucción que sale del pipeline (WB)
    const exiting = currentStage[stageCount - 1];
    if (exiting !== null) {
      finalStageInstructions.push(exiting.instruction);
    }

    // Guardar el estado del pipeline
    pipeline.push([...currentStage]);
  }

  return { pipeline, finalStageInstructions };
}


// Function to calculate the next state based on the current state
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

  // The simulation completes *after* the last instruction finishes the last stage
  const completionCycle = currentState.instructions.length > 0
    ? currentState.maxCycles
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


  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer(); // Clear previous timer just in case
    if (submittedInstructions.length === 0) { 
      resetSimulation(); // Reset if no instructions submitted
      return;
    }

    const Instructions: FetchInstruction[] = submittedInstructions.map(hexToBinary).map(BinaryToInstruction).filter((inst): inst is FetchInstruction => inst !== null);
    const {pipeline,finalStageInstructions} = calculatePipelineCyclesWithStalls(Instructions);
    console.log('finalStageInstructions', finalStageInstructions);
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
      });
    },
    [resetSimulation]
  );

    setSimulationState({
      instructions: finalStageInstructions,
      currentCycle: 1, // Start from cycle 1
      maxCycles: pipeline.length,
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: initialStages, // Set initial stages for cycle 1
      isFinished: false,
      pipelineHistory: pipeline // Store the pipeline history
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
