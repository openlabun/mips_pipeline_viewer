// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

import type { PropsWithChildren } from 'react';
import * as React from 'react';

// Define the shape of the context state
interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
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

const DEFAULT_STAGE_COUNT = 5; // IF, ID, EX, MEM, WB

// Create the provider component
export function SimulationProvider({ children }: PropsWithChildren) {
  const [instructions, setInstructions] = React.useState<string[]>([]);
  const [currentCycle, setCurrentCycle] = React.useState<number>(0);
  const [maxCycles, setMaxCycles] = React.useState<number>(0);
  const [isRunning, setIsRunning] = React.useState<boolean>(false);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const stageCount = DEFAULT_STAGE_COUNT; // Keep stage count constant for now

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const runClock = React.useCallback(() => {
    clearTimer(); // Clear any existing timer
    intervalRef.current = setInterval(() => {
      setCurrentCycle((prevCycle) => {
        const nextCycle = prevCycle + 1;
        // The simulation completes *after* the last instruction finishes the last stage
        const completionCycle = instructions.length > 0 ? instructions.length + stageCount - 1 : 0;
        if (nextCycle > completionCycle) { // Use > completion cycle to stop *after* the last step
          clearTimer();
          setIsRunning(false);
          // Keep currentCycle at maxCycles to indicate completion state for rendering
          return completionCycle; // Stay at the final cycle count
        }
        return nextCycle;
      });
    }, 1000); // Advance cycle every 1 second
  }, [instructions.length, stageCount]); // Dependencies: instructions.length and stageCount affect completionCycle

  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setInstructions([]);
    setCurrentCycle(0);
    setMaxCycles(0);
    setIsRunning(false);
  }, []);

  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    resetSimulation(); // Reset first
    if (submittedInstructions.length === 0) return; // Don't start if no instructions

    setInstructions(submittedInstructions);
    const calculatedMaxCycles = submittedInstructions.length > 0 ? submittedInstructions.length + stageCount - 1 : 0;
    setMaxCycles(calculatedMaxCycles);
    setCurrentCycle(1); // Start from cycle 1
    setIsRunning(true);
    // runClock will be triggered by the useEffect below when isRunning becomes true
  }, [resetSimulation, stageCount]);

   const pauseSimulation = () => {
    if (isRunning) {
      clearTimer();
      setIsRunning(false);
    }
  };

  const resumeSimulation = () => {
    // Resume only if not running, started, and not finished
     // Ensure maxCycles is calculated before resuming
     const completionCycle = instructions.length > 0 ? instructions.length + stageCount -1 : 0;
    if (!isRunning && currentCycle > 0 && currentCycle <= completionCycle) {
       setIsRunning(true);
       // runClock will be triggered by useEffect
    }
   };


  // Effect to manage the interval timer based on isRunning state
  React.useEffect(() => {
    if (isRunning) {
      runClock();
    } else {
      clearTimer();
    }
    // Cleanup timer on unmount or when isRunning becomes false
    return clearTimer;
  }, [isRunning, runClock]); // Rerun effect if isRunning or runClock changes

  const stateValue: SimulationState = React.useMemo(
    () => ({
      instructions,
      currentCycle,
      maxCycles,
      isRunning,
      stageCount,
    }),
    [instructions, currentCycle, maxCycles, isRunning, stageCount]
  );

  const actionsValue: SimulationActions = React.useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
    }),
    [startSimulation, resetSimulation, pauseSimulation, resumeSimulation]
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
