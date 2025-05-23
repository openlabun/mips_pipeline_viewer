// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

import type { PropsWithChildren } from 'react';
import * as React from 'react';

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
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
  forwardingEnabled: boolean;
  stallingEnabled: boolean;
  hazards: Record<string, { type: 'stall' | 'forward' }>;
  bubbles: Record<string, boolean>;
  historicalBubbles: Record<string, { cycle: number, stageIndex: number }>;
  historicalHazards: Record<string, { type: 'stall' | 'forward', cycle: number }>;
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  toggleForwarding: () => void;
  toggleStalling: () => void;
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
  forwardingEnabled: false,
  stallingEnabled: false,
  hazards: {},
  bubbles: {},
  historicalBubbles: {},
  historicalHazards: {},
};

const detectHazards = (state: SimulationState): Record<string, { type: 'stall' | 'forward' }> => {
  const hazards: Record<string, { type: 'stall' | 'forward' }> = {};
  const { instructions, currentCycle, instructionStages, forwardingEnabled, stallingEnabled } = state;
  
  if (!forwardingEnabled && !stallingEnabled) {
    return hazards;
  }
  
  interface InstructionInfo {
    type: string;
    regsRead: number[];
    regsWritten: number[];
    isLoad: boolean;
  }

  const parseInstruction = (hexInst: string): InstructionInfo => {
    if (!/^[0-9a-fA-F]{8}$/.test(hexInst)) {
      return {
        type: 'invalid',
        regsRead: [],
        regsWritten: [],
        isLoad: false,
      };
    }
    
    const instruction = parseInt(hexInst, 16);
    
    const opcode = (instruction >>> 26) & 0x3F;        // bits 31-26
    const rs = (instruction >>> 21) & 0x1F;            // bits 25-21
    const rt = (instruction >>> 16) & 0x1F;            // bits 20-16
    const rd = (instruction >>> 11) & 0x1F;            // bits 15-11
    const funct = instruction & 0x3F;                  // bits 5-0
    
    let type = '';
    let regsRead: number[] = [];
    let regsWritten: number[] = [];
    
    if (opcode === 0) {
      switch (funct) {
        case 0x20:
        case 0x21:
        case 0x22:
        case 0x23:
        case 0x24:
        case 0x25:
        case 0x26:
        case 0x27:
          type = 'R-arithmetic';
          regsRead = [rs, rt].filter(r => r !== 0);
          regsWritten = rd !== 0 ? [rd] : [];
          break;
          
        default:
          type = 'R-unknown';
          regsRead = [rs, rt].filter(r => r !== 0);
          regsWritten = rd !== 0 ? [rd] : [];
      }
    }
    else if ((opcode >= 0x20 && opcode <= 0x26) || opcode === 0x30 || opcode === 0x31 || opcode === 0x34 || opcode === 0x35) {
      type = 'load';
      regsRead = [rs].filter(r => r !== 0);
      regsWritten = rt !== 0 ? [rt] : []; 
    }
    else if (opcode >= 0x28 && opcode <= 0x2E) {
      type = 'store';
      regsRead = [rs, rt].filter(r => r !== 0); 
      regsWritten = []; 
    }
    else if ([0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E].includes(opcode)) {
      type = 'I-arithmetic';
      regsRead = [rs].filter(r => r !== 0);
      regsWritten = rt !== 0 ? [rt] : [];
    }
    else if (opcode === 0x0F) {
      type = 'lui';
      regsRead = [];
      regsWritten = rt !== 0 ? [rt] : [];
    }
    else {
      type = 'unknown';
      regsRead = [rs, rt].filter(r => r !== 0);
      regsWritten = [];
    }
    
    return {
      type,
      regsRead,
      regsWritten,
      isLoad: type === 'load',
    };
  };
  
  const instructionsAtStage: Record<number, Array<{
    index: number,
    info: ReturnType<typeof parseInstruction>
  }>> = {};
  
  instructions.forEach((instruction, instIndex) => {
    const stageIndex = instructionStages[instIndex];
    if (stageIndex !== null) {
      if (!instructionsAtStage[stageIndex]) {
        instructionsAtStage[stageIndex] = [];
      }
      instructionsAtStage[stageIndex].push({
        index: instIndex,
        info: parseInstruction(instruction)
      });
    }
  });
  
  const instructionsInID = instructionsAtStage[1] || [];
  const instructionsInEX = instructionsAtStage[2] || [];
  const instructionsInMEM = instructionsAtStage[3] || [];
  const instructionsInWB = instructionsAtStage[4] || [];

  instructionsInID.forEach(({ index: idIndex, info: idInfo }) => {
    const hazardKey = `${idIndex}-${currentCycle}`;
    if (idInfo.type === 'invalid') return;

    idInfo.regsRead.forEach(readReg => {
      if (readReg === 0) return;
  
      const exProducer = instructionsInEX.find(({ info }) => 
        info.regsWritten.includes(readReg)
      );
      
      if (exProducer) {
        if (exProducer.info.isLoad && stallingEnabled) {
          hazards[hazardKey] = { type: 'stall' };
        } 
        else if (forwardingEnabled) {
          hazards[hazardKey] = { type: 'forward' };
        }
        else if (stallingEnabled) {
          hazards[hazardKey] = { type: 'stall' };
        }
      }
      
      if (hazards[hazardKey]) return;
      
      const memProducer = instructionsInMEM.find(({ info }) => 
        info.regsWritten.includes(readReg)
      );
      
      if (memProducer) {
        if (forwardingEnabled) {
          hazards[hazardKey] = { type: 'forward' };
        } 
        else if (stallingEnabled) {
          hazards[hazardKey] = { type: 'stall' };
        }
      }
      
      if (hazards[hazardKey] || forwardingEnabled) return;
    
      const wbProducer = instructionsInWB.find(({ info }) => 
        info.regsWritten.includes(readReg)
      );
      
      if (wbProducer && stallingEnabled) {
        hazards[hazardKey] = { type: 'stall' };
      }
    });
  });
  
  return hazards;
};

// Function to calculate the next state based on the current state
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState; // No changes if not running or already finished
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  const tempStages = { ...currentState.instructionStages };
  const hazards = detectHazards(currentState);
  const newHistoricalHazards = { ...currentState.historicalHazards };

Object.entries(hazards).forEach(([key, value]) => {
  const [instIndex, cycleStr] = key.split('-');
  const stageIndex = currentState.instructionStages[Number(instIndex)];
  if (stageIndex !== null) {
    const historicalKey = `${instIndex}-${cycleStr}-${stageIndex}`;
    newHistoricalHazards[historicalKey] = { 
      type: value.type,
      cycle: Number(cycleStr)
    };
  }
});
  
  const stallingApplied = currentState.stallingEnabled && Object.keys(hazards).length > 0 &&
    Object.values(hazards).some(h => h.type === 'stall');

  const bubbles: Record<string, boolean> = {};
  
  if (stallingApplied) {
    let earliestStalledIdx = -1;
    let earliestStalledStage = 5;
    
    for (let i = 0; i < currentState.instructions.length; i++) {
      const hazardKey = Object.keys(hazards).find(k => k.startsWith(`${i}-`));
      if (hazardKey && hazards[hazardKey].type === 'stall') {
        const stage = tempStages[i] || 0;
        if (earliestStalledIdx === -1 || stage < earliestStalledStage) {
          earliestStalledIdx = i;
          earliestStalledStage = stage;
        }
      }
    }
    
    if (earliestStalledIdx !== -1) {
      const stalledStage = tempStages[earliestStalledIdx];
      if (stalledStage !== null) {
        const bubbleKey = `bubble-${nextCycle}-${stalledStage + 1}`;
        bubbles[bubbleKey] = true;
      }
    }
  }

  // Second pass: Update all instruction stages with stalling logic
  currentState.instructions.forEach((_, index) => {
    // Calculate the stage index for the instruction in the next cycle
    let stageIndex = nextCycle - index - 1;

    // Apply stalling logic - if stalling is active, any instruction at or before the hazard doesn't progress
    if (stallingApplied) {
      const instHazardKey = Object.keys(hazards).find(k => k.startsWith(`${index}-`));
      if (instHazardKey && hazards[instHazardKey].type === 'stall') {
        stageIndex = tempStages[index] || 0;
      } else {
        for (let i = 0; i < index; i++) {
          const earlierHazardKey = Object.keys(hazards).find(k => k.startsWith(`${i}-`));
          if (earlierHazardKey && hazards[earlierHazardKey].type === 'stall') {
            stageIndex = tempStages[index] || 0;
            break;
          }
        }
      }
    }

    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;
    } else {
      newInstructionStages[index] = null;
    }
  });

  const stallCycles = stallingApplied ? 1 : 0;
  const completionCycle = currentState.instructions.length > 0
    ? currentState.instructions.length + currentState.stageCount - 1 + stallCycles
    : 0;

  const isFinished = nextCycle > completionCycle;
  const newHistoricalBubbles = { ...currentState.historicalBubbles };
  
  Object.keys(bubbles).forEach(key => {
    newHistoricalBubbles[key] = {
      cycle: nextCycle,
      stageIndex: Number(key.split('-')[2])
    };
  });
  
  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : nextCycle,
    instructionStages: newInstructionStages,
    isRunning: !isFinished,
    isFinished,
    hazards,
    bubbles,
    historicalBubbles: newHistoricalBubbles,
    historicalHazards: newHistoricalHazards,
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


    setSimulationState(prevState => ({
      ...prevState,
      instructions: submittedInstructions,
      currentCycle: 1,
      maxCycles: calculatedMaxCycles,
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: initialStages,
      isFinished: false,
      hazards: {},
      bubbles: {},
      historicalBubbles: {},
      historicalHazards: {}, // Importante: resetear el historial de hazards
    }));
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

  const toggleForwarding = React.useCallback(() => {
    setSimulationState(prevState => {
      const newForwardingEnabled = !prevState.forwardingEnabled;
      return {
        ...prevState,
        forwardingEnabled: newForwardingEnabled,
        stallingEnabled: newForwardingEnabled ? false : prevState.stallingEnabled
      };
    });
  }, []);

  const toggleStalling = React.useCallback(() => {
    setSimulationState(prevState => {
      const newStallingEnabled = !prevState.stallingEnabled;
      return {
        ...prevState,
        stallingEnabled: newStallingEnabled,
        forwardingEnabled: newStallingEnabled ? false : prevState.forwardingEnabled
      };
    });
  }, []);

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
      toggleForwarding,
      toggleStalling,
    }),
    [startSimulation, resetSimulation, toggleForwarding, toggleStalling] 
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
