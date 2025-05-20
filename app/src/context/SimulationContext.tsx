"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { haylwvec } from '@/components/instruction-input';
import { stallprev } from '@/components/instruction-input';
import { cuantosstall } from '@/components/instruction-input';




const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];
// ✅ Tipo de forwarding (puede ir en otro archivo si lo necesitas global)
type ForwardingInfo = {
  fromIndex: number;
  toIndex: number;
  register: string;
};



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

// Función auxiliar para parsear instrucciones MIPS
function parseInstruction(inst: string): { rd?: string; rs?: string; rt?: string } {
  const [op, rest] = inst.trim().split(/\s+/, 2);
  const args = rest ? rest.split(',').map(a => a.trim()) : [];

  if (op === 'add' || op === 'sub' || op === 'and' || op === 'or') {
    return { rd: args[0], rs: args[1], rt: args[2] };
  } else if (op === 'addi') {
    return { rt: args[0], rs: args[1] };
  } else if (op === 'lw') {
    const match = args[1].match(/\((\$[a-z0-9]+)\)/i);
    return { rt: args[0], rs: match?.[1] };
  } else if (op === 'sw') {
    const match = args[1].match(/\((\$[a-z0-9]+)\)/i);
    return { rt: args[0], rs: match?.[1] };
  }
  return {};
  
}

// Detecta dependencia RAW, usada solo para fines de demostración si se quisiera stalling
function hasRawDependency(prevInst: string, currInst: string): boolean {
  const prev = parseInstruction(prevInst);
  const curr = parseInstruction(currInst);
  const writtenReg = prev.rd || prev.rt;
  const readRegs = [curr.rs, curr.rt].filter(Boolean);
  return readRegs.includes(writtenReg);
}

// Lógica principal de actualización de estado
// Lógica principal de actualización de estado



let entryCounter = 0; // Contador de entradas


const calculateNextState = (currentState: SimulationState): SimulationState => {
  
  if (!currentState.isRunning || currentState.isFinished) return currentState;

  let nextCycle = currentState.currentCycle;
  let nextCycle2 = currentState.currentCycle;
  console.log("Haylwvec:", haylwvec);

  // Verificar la etapa actual del ciclo
  const currentStage = STAGE_NAMES[(nextCycle - 1) % STAGE_NAMES.length]; 
  

  

// Solo si estamos en ID y hay lwvec tiene true
if (currentStage === "ID" && haylwvec.length > 0 && haylwvec[0] === true) {
  entryCounter++;
  console.log(`Stall Detected. Counter: ${entryCounter}`);

  if (entryCounter === 4) {
    haylwvec.shift(); // Elimina el primer elemento
    console.log("Stall aplicado, nuevo haylwvec:", haylwvec);
    entryCounter = 0;
  } else {
    nextCycle += 0; // Stall (no avanza el ciclo)
    
    
  }
} else {
  nextCycle += 1; // Avanza normalmente
  
}









  const newInstructionStages: Record<number, number | null> = {};
  let activeInstructions = 0;

  currentState.instructions.forEach((inst, index) => {
    let stageIndex = nextCycle - index - 1;

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

      const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT;
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

  const stateValue: SimulationState = simulationState;

  const actionsValue: SimulationActions = React.useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
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






