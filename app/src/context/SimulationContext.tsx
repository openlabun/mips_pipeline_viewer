// src/context/SimulationContext.tsx

"use client"; // Add 'use client' directive

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { decodeHexInstruction } from '@/utils/decodeInstruction';
import type { decodedInstruction } from '@/utils/decodeInstruction';

// Define the stage names (optional, but good for clarity)
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

// Define the shape of the simulation mode
// This can be 'stall', 'forward', or null (not set)
export type SimulationMode = 'default' | 'stall' | 'forward';

// Define the shape of the context state
interface SimulationState {
  instructions: string[];
  decodedInstructions: decodedInstruction []; // Add decoded instructions
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  // Map instruction index to its current stage index (0-based) or null if not started/finished
  instructionStages: Record<number, number | null>;
  isFinished: boolean; // Track if simulation completed
  mode: SimulationMode;
  stageHistory?: Record<number, Record<number, number | null>>; // ciclo -> {instIndex: stageIndex}
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[], mode: SimulationMode) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
}

// Create the contexts
const SimulationStateContext = React.createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = React.createContext<SimulationActions | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length; // Use length of defined stages

//  Max Cycles Calculation
const calculateMaxCycles = (instructions: string[], mode: SimulationMode, decoded: decodedInstruction[]): number => {
  const baseCycles = instructions.length + DEFAULT_STAGE_COUNT - 1;
  if (mode === 'default') return baseCycles;

  let totalStalls = 0;

  for (let i = 1; i < instructions.length; i++) {
    const currInstr = decoded[i];
    if (!currInstr) continue;

    // Buscar dependencia con la instrucción inmediatamente anterior
    const prevInstr = decoded[i - 1];
    if (!prevInstr) continue;

    // Determinar el registro destino de la instrucción anterior
    let prevDest: number | undefined = undefined;
    let isLoad = false;

    if (prevInstr.format === 'R') {
      prevDest = prevInstr.rd;
    } else if (prevInstr.format === 'I') {
      prevDest = prevInstr.rt;
      isLoad = prevInstr.opcode === 35; 
    }

    // Obtener los registros fuente de la instrucción actual
    const currSources = [currInstr.rs, currInstr.rt].filter(Boolean);

    // Verificar si hay dependencia RAW
    if (prevDest && currSources.includes(prevDest)) {
      if (mode === 'stall') {
        // En modo stall, siempre son 3 ciclos de stall para RAW
        totalStalls += 3;
      } else if (mode === 'forward') {
        // En modo forwarding, los stalls dependen del tipo de instrucción
        if (isLoad) {
          // Load-use hazard: 2 stalls (espera hasta MEM)
          totalStalls += 2;
        } else {
          // ALU-use hazard: 1 stall (espera hasta EX)
          totalStalls += 1;
        }
      }
    }
  }

  // console.log(`Modo: ${mode}, Instrucciones: ${instructions.length}, Ciclos base: ${baseCycles}, Stalls totales: ${totalStalls}, Ciclos máximos: ${baseCycles + totalStalls}`);
  return baseCycles + totalStalls;
};

const initialState: SimulationState = {
  instructions: [],
  decodedInstructions: [], // Initialize with empty array
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  mode: 'default',
  stageHistory: {},
};

// Function to calculate the next state based on the current state
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState; // No changes if not running or already finished
  }

  switch (currentState.mode) {
    case 'stall':
      // console.log('Stall mode');
      return calculateStallNextState(currentState);
   case 'forward':
      return calculateForwardNextState(currentState);
    case 'default':
    default:
      return calculateDefaultNextState(currentState);
  }
};

function calculateDefaultNextState(currentState: SimulationState): SimulationState {
  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let allFinished = true;

  currentState.instructions.forEach((_, index) => {
    const stageIndex = nextCycle - index - 1;
   
    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;
      allFinished = false;
    } else {
      newInstructionStages[index] = null;
    }
  });

  // Solo marcamos como finished cuando el último ciclo COMPLETÓ todas las etapas
  const isFinished = nextCycle > currentState.maxCycles;

  return {
    ...currentState,
    currentCycle: isFinished ? currentState.maxCycles : nextCycle,
    instructionStages: newInstructionStages,
    isRunning: !isFinished,
    isFinished,
  };
}

function calculateStallNextState(currentState: SimulationState): SimulationState {
  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let exOccupied = false;
  let idBlocked = false;

  function hasRAWDependency(currIdx: number): boolean {
    const currInstr = currentState.decodedInstructions[currIdx];
    if (!currInstr) return false;
    if (currentState.instructionStages[currIdx] !== 1) return false;

    for (let prevIdx = 0; prevIdx < currIdx; prevIdx++) {
      const prevInstr = currentState.decodedInstructions[prevIdx];
      const prevStage = currentState.instructionStages[prevIdx];
      if (prevStage === null) continue;

      let prevDest: number | undefined = undefined;
      if (prevInstr.format === 'R') prevDest = prevInstr.rd;
      if (prevInstr.format === 'I') prevDest = prevInstr.rt;

      const currSources = [
        currInstr.rs,
        currInstr.rt
      ].filter(x => x !== undefined);

      if (
        prevDest !== undefined &&
        currSources.includes(prevDest) &&
        [2, 3, 4].includes(prevStage) // EX, MEM, WB
      ) {
        // console.log(`Stall detectado: instr ${currIdx} (ID) depende de instr ${prevIdx} (stage ${prevStage})`);
        return true;
      }
    }
    return false;
  }

  for (let i = 0; i < currentState.instructions.length; i++) {
    const prevStage = currentState.instructionStages[i];
    if (prevStage === null) {
      const stageIndex = nextCycle - i - 1;
      newInstructionStages[i] = stageIndex >= 0 && stageIndex < currentState.stageCount ? stageIndex : null;
      continue;
    }

    if (prevStage === 1) {
      if (idBlocked) {
        newInstructionStages[i] = 1; // Bloqueada por una anterior en ID
      } else if (hasRAWDependency(i)) {
        newInstructionStages[i] = 1; // Stall en ID
        idBlocked = true; // Bloquea a las siguientes
      } else if (!exOccupied) {
        newInstructionStages[i] = 2; // Avanza a EX
        exOccupied = true;
      } else {
        newInstructionStages[i] = 1; // EX ya ocupado, espera en ID
      }
    } else if (prevStage !== null && prevStage < currentState.stageCount - 1) {
      newInstructionStages[i] = prevStage + 1;
    } else {
      newInstructionStages[i] = null;
    }
  }

  const allInstructionsFinished = Object.values(newInstructionStages).every(stage => stage === null);
  const isFinished = allInstructionsFinished;
  const isRunning = !isFinished;
  
  
  return {
    ...currentState,
    currentCycle: isFinished ? currentState.currentCycle : nextCycle,
    instructionStages: newInstructionStages,
    isRunning,
    isFinished,
  };
}

function calculateForwardNextState(currentState: SimulationState): SimulationState {
  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let exOccupied = false;
  let idBlocked = false; // Nueva bandera para bloquear ID

  function hasRAWDependencyWithForwarding(currIdx: number): boolean {
    const currInstr = currentState.decodedInstructions[currIdx];
    if (!currInstr) return false;
    if (currentState.instructionStages[currIdx] !== 1) return false;

    for (let prevIdx = 0; prevIdx < currIdx; prevIdx++) {
      const prevInstr = currentState.decodedInstructions[prevIdx];
      const prevStage = currentState.instructionStages[prevIdx];
      if (prevStage === null) continue;

      let prevDest: number | undefined = undefined;
      let isLoad = false;
      if (prevInstr.format === 'R') prevDest = prevInstr.rd;
      if (prevInstr.format === 'I') {
        prevDest = prevInstr.rt;
        isLoad = prevInstr.opcode === 35; 
      }

      const currSources = [currInstr.rs, currInstr.rt].filter(x => x !== undefined);

      if (
        prevDest !== undefined &&
        currSources.includes(prevDest)
      ) {
        // Si la previa es load y está en EX o MEM, stall
        if (isLoad && [2, 3].includes(prevStage)) {
          // console.log(`Stall (forwarding): instr ${currIdx} (ID) depende de LOAD instr ${prevIdx} (stage ${prevStage})`);
          return true;
        }
        // Si la previa es ALU y está en EX, stall
        if (!isLoad && prevStage === 2) {
          // console.log(`Stall (forwarding): instr ${currIdx} (ID) depende de ALU instr ${prevIdx} (stage ${prevStage})` );
          return true;
        }
      }
    }
    return false;
  }

  for (let i = 0; i < currentState.instructions.length; i++) {
    const prevStage = currentState.instructionStages[i];
    if (prevStage === null) {
      const stageIndex = nextCycle - i - 1;
      newInstructionStages[i] = stageIndex >= 0 && stageIndex < currentState.stageCount ? stageIndex : null;
      continue;
    }

    if (prevStage === 1) {
      if (idBlocked) {
        newInstructionStages[i] = 1; // Bloqueada por una anterior en ID
      } else if (hasRAWDependencyWithForwarding(i)) {
        newInstructionStages[i] = 1; // Stall en ID
        idBlocked = true; // Bloquea a las siguientes
      } else if (!exOccupied) {
        newInstructionStages[i] = 2; // Avanza a EX
        exOccupied = true;
      } else {
        newInstructionStages[i] = 1; // EX ya ocupado, espera en ID
      }
    } else if (prevStage !== null && prevStage < currentState.stageCount - 1) {
      newInstructionStages[i] = prevStage + 1;
    } else {
      newInstructionStages[i] = null;
    }
  }

  const allInstructionsFinished = Object.values(newInstructionStages).every(stage => stage === null);
  const isFinished = allInstructionsFinished;
  const isRunning = !isFinished;
  // console.log(`Ciclo ${nextCycle} (forwarding):`, newInstructionStages);
  
  return {
    ...currentState,
    currentCycle: isFinished ? currentState.currentCycle : nextCycle,
    instructionStages: newInstructionStages,
    isRunning,
    isFinished,
  };
}

// Create the provider component
export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = React.useState<SimulationState>(initialState);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const runClock = React.useCallback(() => {
    clearTimer();
    if (!simulationState.isRunning || simulationState.isFinished) return;

    intervalRef.current = setInterval(() => {
      setSimulationState(prev => {
        const nextState = calculateNextState(prev);
        const newHistory = { ...prev.stageHistory, [nextState.currentCycle]: nextState.instructionStages };
        return { ...nextState, stageHistory: newHistory };
      });
    }, 1000);
  }, [simulationState.isRunning, simulationState.isFinished]);

  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState(initialState);
  }, []);

  const startSimulation = React.useCallback((submittedInstructions: string[], mode: SimulationMode) => {
    clearTimer();
    if (submittedInstructions.length === 0) {
      resetSimulation();
      return;
    }

    const decoded = submittedInstructions.map(decodeHexInstruction);
    const calculatedMaxCycles = calculateMaxCycles(submittedInstructions, mode, decoded);

    const initialStages: Record<number, number | null> = {};
    submittedInstructions.forEach((_, index) => {
      initialStages[index] = (1 - index - 1 >= 0) ? 0 : null;
    });

    setSimulationState({
      instructions: submittedInstructions,
      decodedInstructions: decoded,
      currentCycle: 1,
      maxCycles: calculatedMaxCycles,
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: initialStages,
      isFinished: false,
      mode,
      stageHistory: { 1: initialStages },
    });
  }, [resetSimulation]);

  React.useEffect(() => {
    if (simulationState.isRunning) runClock();
    return clearTimer;
  }, [simulationState.isRunning, runClock]);

  return (
    <SimulationStateContext.Provider value={simulationState}>
      <SimulationActionsContext.Provider value={{
        startSimulation,
        resetSimulation,
        pauseSimulation: () => setSimulationState(prev => ({ ...prev, isRunning: false })),
        resumeSimulation: () => setSimulationState(prev => ({ ...prev, isRunning: true })),
      }}>
        {children}
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

export const useSimulationState = () => {
  const context = React.useContext(SimulationStateContext);
  if (!context) throw new Error('useSimulationState must be used within a SimulationProvider');
  return context;
};

export const useSimulationActions = () => {
  const context = React.useContext(SimulationActionsContext);
  if (!context) throw new Error('useSimulationActions must be used within a SimulationProvider');
  return context;
};