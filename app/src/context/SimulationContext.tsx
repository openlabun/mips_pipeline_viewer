"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';

const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  forwarding: Record<number, Record<number, boolean>>;
  isFinished: boolean;
  activateFW: boolean; // Activar forwarding
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setActivateFW: (enabled: boolean) => void; // Acción para activar/desactivar forwarding
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
  forwarding: {},
  isFinished: false,
  activateFW: true, // Por defecto activado
};

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  const newForwarding: Record<number, Record<number, boolean>> = {};
  let activeInstructions = 0;

  const decodeInstruction = (hex: string) => {
    const bin = parseInt(hex, 16).toString(2).padStart(32, '0');
    const opcode = bin.slice(0, 6);
    if (opcode === '000000') {
      const rs = parseInt(bin.slice(6, 11), 2);
      const rt = parseInt(bin.slice(11, 16), 2);
      const rd = parseInt(bin.slice(16, 21), 2);
      return { type: 'R', rs, rt, rd };
    } else {
      const rs = parseInt(bin.slice(6, 11), 2);
      const rt = parseInt(bin.slice(11, 16), 2);
      return { type: 'I', rs, rt };
    }
  };

  currentState.instructions.forEach((inst, index) => {
    const isNop = inst === '00000000';
    const stageIndex = nextCycle - index - 1;

    if (isNop) {
      if (stageIndex === 0) {
        newInstructionStages[index] = 0;
        newForwarding[index] = { 0: false };
        activeInstructions++;
      } else {
        newInstructionStages[index] = null;
      }
    } else {
      if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
        newInstructionStages[index] = stageIndex;

        let didForward = false;

        if (currentState.activateFW && index > 0) {
          const prevStage = newInstructionStages[index - 1];
          if (prevStage !== null) {
            const prevInstDecoded = decodeInstruction(currentState.instructions[index - 1]);
            const currInstDecoded = decodeInstruction(inst);

            const prevWriteReg = prevInstDecoded.type === 'R' ? prevInstDecoded.rd : prevInstDecoded.rt;
            const currReadRegs = currInstDecoded.type === 'R'
              ? [currInstDecoded.rs, currInstDecoded.rt]
              : [currInstDecoded.rs];

            if ((prevStage === 2 || prevStage === 3) && (stageIndex === 2)) {
              if (typeof prevWriteReg === 'number' && currReadRegs.includes(prevWriteReg) && prevWriteReg !== 0) {
                didForward = true;
              }
            }
          }
        }

        newForwarding[index] = { [stageIndex]: didForward };
        activeInstructions++;
      } else {
        newInstructionStages[index] = null;
      }
    }
  });

  const completionCycle = currentState.instructions.length > 0
    ? currentState.instructions.length + currentState.stageCount - 1
    : 0;

  const isFinished = nextCycle > completionCycle;
  const isRunning = !isFinished;

  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : nextCycle,
    instructionStages: newInstructionStages,
    forwarding: newForwarding,
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

  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer();
    if (submittedInstructions.length === 0) {
      resetSimulation();
      return;
    }

    const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;
    const initialStages: Record<number, number | null> = {};
    const initialForwarding: Record<number, Record<number, boolean>> = {};

    submittedInstructions.forEach((_, index) => {
      const stageIndex = 1 - index - 1;
      if (stageIndex >= 0 && stageIndex < DEFAULT_STAGE_COUNT) {
        initialStages[index] = stageIndex;
        initialForwarding[index] = { [stageIndex]: false };
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
      forwarding: initialForwarding,
      isFinished: false,
    }));
  }, [resetSimulation]);

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

  const setActivateFW = (enabled: boolean) => {
    setSimulationState((prevState) => ({
      ...prevState,
      activateFW: enabled,
    }));
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

  const actionsValue: SimulationActions = React.useMemo(() => ({
    startSimulation,
    resetSimulation,
    pauseSimulation,
    resumeSimulation,
    setActivateFW,
  }), [startSimulation, resetSimulation]);

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

export function getStageInfo(stageIndex: number | null, instruction: string): string {
  if (stageIndex === null) return "Not in pipeline";
  if (instruction === "00000000") {
    if (stageIndex === 0) return "NOP in IF stage";
    return "NOP outside pipeline";
  }

  switch (stageIndex) {
    case 0: return "Instruction fetching (IF)";
    case 1: return "Instruction decoding (ID)";
    case 2: return "Execution (EX)";
    case 3: return "Memory access (MEM)";
    case 4: return "Write-back (WB)";
    default: return "Unknown stage";
  }
}
