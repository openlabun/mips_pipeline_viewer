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
  // Add new state properties
  forwardingEnabled: boolean;
  stallingEnabled: boolean;
  // Track hazards in the pipeline
  hazards: Record<string, { type: 'stall' | 'forward' }>;
  // Track bubbles in the pipeline
  bubbles: Record<string, boolean>;
  historicalBubbles: Record<string, { cycle: number, stageIndex: number }>;
  // Añadir historial de hazards para persistencia visual
  historicalHazards: Record<string, { type: 'stall' | 'forward', cycle: number }>;
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  // Add toggle actions
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
  stallingEnabled: true, // Default to stalling
  hazards: {}, // Empty hazards initially
  bubbles: {}, // Empty bubbles initially
  historicalBubbles: {},
  historicalHazards: {}, // Nuevo campo para el historial
};

// Helper to detect hazards with more realistic behavior
const detectHazards = (state: SimulationState): Record<string, { type: 'stall' | 'forward' }> => {
  const hazards: Record<string, { type: 'stall' | 'forward' }> = {};
  const { instructions, currentCycle, instructionStages, forwardingEnabled, stallingEnabled } = state;
  
  // Si ambos están desactivados, no detectar hazards
  if (!forwardingEnabled && !stallingEnabled) {
    return hazards;
  }
  
  // Track instructions at each pipeline stage for dependency analysis
  const instructionsAtStage: Record<number, number[]> = {};
  
  // Populate instructions at each stage
  instructions.forEach((instruction, instIndex) => {
    const stageIndex = instructionStages[instIndex];
    if (stageIndex !== null) {
      if (!instructionsAtStage[stageIndex]) {
        instructionsAtStage[stageIndex] = [];
      }
      instructionsAtStage[stageIndex].push(instIndex);
    }
  });
  
  // Detect RAW hazards
  // Instructions in ID stage (1) may need values from instructions in EX (2) or MEM (3)
  const instructionsInID = instructionsAtStage[1] || [];
  const instructionsInEX = instructionsAtStage[2] || [];
  const instructionsInMEM = instructionsAtStage[3] || [];
  
  instructionsInID.forEach(idIndex => {
    // Simple pattern-based dependency detection using last hex digit of instruction
    // In a real system, you'd analyze register fields in the instructions
    const idInstruction = instructions[idIndex];
    const lastDigit = idInstruction.slice(-1);
    
    // Check for dependency with EX stage instructions (simulating ALU result dependency)
    for (const exIndex of instructionsInEX) {
      const exInstruction = instructions[exIndex];
      // If last hex digit matches, simulate a RAW hazard
      if (exInstruction.slice(-1) === lastDigit) {
        const key = `${idIndex}-${currentCycle}`;
        // Determinar tipo de hazard basado en qué está habilitado
        if (forwardingEnabled) {
          hazards[key] = { type: 'forward' };
        } else if (stallingEnabled) {
          hazards[key] = { type: 'stall' };
        }
        break;
      }
    }
    
    // Check for dependency with MEM stage instructions (simulating load-use hazard)
    if (!hazards[`${idIndex}-${currentCycle}`]) {
      for (const memIndex of instructionsInMEM) {
        const memInstruction = instructions[memIndex];
        // If instruction in MEM starts with '8' (simulating a load)
        // and its last digit matches the ID instruction
        if (memInstruction.startsWith('8') && memInstruction.slice(-1) === lastDigit) {
          const key = `${idIndex}-${currentCycle}`;
          // Load-use hazards need stalling even with forwarding
          // But for demo purposes, allow forwarding to work for all hazards if enabled
          hazards[key] = { type: forwardingEnabled ? 'forward' : 'stall' };
          break;
        }
      }
    }
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
  let activeInstructions = 0;
  
  // Copy the current stages first to apply hazard resolution
  const tempStages = { ...currentState.instructionStages };
  
  // Detect hazards in current state
  const hazards = detectHazards(currentState);
  
  // Update historical hazards - add new hazards to the history
  const newHistoricalHazards = { ...currentState.historicalHazards };

// Add all current hazards to historical record with their stage
Object.entries(hazards).forEach(([key, value]) => {
  const [instIndex, cycleStr] = key.split('-');
  // Obtener la etapa actual de esta instrucción cuando ocurrió el hazard
  const stageIndex = currentState.instructionStages[Number(instIndex)];
  if (stageIndex !== null) {
    // Crear una clave histórica basada en instrucción y etapa (NO ciclo)
    const historicalKey = `${instIndex}-${stageIndex}`;
    newHistoricalHazards[historicalKey] = { 
      type: value.type,
      cycle: Number(cycleStr)
    };
  }
});
  
  // Check if we need to apply stalling
  const stallingApplied = currentState.stallingEnabled && Object.keys(hazards).length > 0 &&
    Object.values(hazards).some(h => h.type === 'stall');
  
  // Crear burbujas para el ciclo actual
  const bubbles: Record<string, boolean> = {};
  
  // First pass: Identify stalled instructions and create bubbles
  if (stallingApplied) {
    // Find the earliest instruction that's stalled
    let earliestStalledIdx = -1;
    
    for (let i = 0; i < currentState.instructions.length; i++) {
      const hazardKey = Object.keys(hazards).find(k => k.startsWith(`${i}-`));
      if (hazardKey && hazards[hazardKey].type === 'stall') {
        if (earliestStalledIdx === -1 || i < earliestStalledIdx) {
          earliestStalledIdx = i;
        }
      }
    }
    
    // If we found a stalled instruction, insert a bubble after it in the pipeline
    if (earliestStalledIdx !== -1) {
      // Mark where bubble will appear (stage after the stalled instruction)
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
        // This instruction is stalled - it stays at the same stage
        stageIndex = tempStages[index] || 0;
      } else {
        // Check if any earlier instruction is stalled (all earlier instructions must wait)
        for (let i = 0; i < index; i++) {
          const earlierHazardKey = Object.keys(hazards).find(k => k.startsWith(`${i}-`));
          if (earlierHazardKey && hazards[earlierHazardKey].type === 'stall') {
            // An earlier instruction is stalled, so this one must also wait
            stageIndex = tempStages[index] || 0;
            break;
          }
        }
      }
    }

    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;
      activeInstructions++;
    } else {
      newInstructionStages[index] = null;
    }
  });

  // Calculate completion cycle accounting for stalls
  const stallCycles = stallingApplied ? 1 : 0; // For simplicity, assume 1 cycle of stall at a time
  const completionCycle = currentState.instructions.length > 0
    ? currentState.instructions.length + currentState.stageCount - 1 + stallCycles
    : 0;

  const isFinished = nextCycle > completionCycle;
  
  // Create a new historical bubbles record that preserves existing history
  const newHistoricalBubbles = { ...currentState.historicalBubbles };
  
  // Add current bubbles to the historical record
  Object.keys(bubbles).forEach(key => {
    // Asegurarse de preservar la clave original completa, no solo la etapa
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
    hazards, // Store detected hazards in state
    bubbles, // Store bubbles in state for visualization
    historicalBubbles: newHistoricalBubbles, // Use the merged historical bubbles
    historicalHazards: newHistoricalHazards, // Actualizar el historial
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

  // Add toggle handlers
  const toggleForwarding = React.useCallback(() => {
    setSimulationState(prevState => {
      const newForwardingEnabled = !prevState.forwardingEnabled;
      return {
        ...prevState,
        forwardingEnabled: newForwardingEnabled,
        // Si activamos forwarding, desactivamos stalling automáticamente
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
        // Si activamos stalling, desactivamos forwarding automáticamente
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
