// src/context/SimulationContext.tsx
'use client';

import type { PropsWithChildren } from 'react';
import * as React from 'react';

// Import utility functions
import {
  decodeInstructions,
  type InstructionDescriptor,
} from './instructionDecoder';
import {
  analyzeInstructionConflicts,
  type ConflictDetails,
  type DataPathForward,
  type HazardAnalysisResult,
} from './hazardAnalyzer';
import {
  calculateTotalCycles,
  calculateTotalBubbles,
  calculateNextPipelineState,
  initializePipelineState,
  type PipelineState,
} from './pipelineCalculator';

// Main simulation state
interface ProcessorState {
  programInstructions: string[];
  clockCycle: number;
  totalCycles: number;
  executionActive: boolean;
  pipelineDepth: number;
  phaseMap: Record<number, number | null>;
  executionComplete: boolean;

  // Conflict analysis
  instructionFormats: Record<number, InstructionDescriptor>;
  conflictAnalysis: Record<number, ConflictDetails>;
  dataForwarding: Record<number, DataPathForward[]>;
  pipelineBubbles: Record<number, number>;

  // Execution control
  activeBubbles: number;

  // Pipeline configuration
  forwardingEnabled: boolean;
  stallsEnabled: boolean;
}

// Action interface
interface ProcessorActions {
  initializeExecution: (
    instructions: string[],
    enableForwarding: boolean,
    enableStalls: boolean
  ) => void;
  resetProcessor: () => void;
  haltExecution: () => void;
  resumeExecution: () => void;
}

// React contexts
const ProcessorStateContext = React.createContext<ProcessorState | undefined>(
  undefined
);
const ProcessorActionsContext = React.createContext<
  ProcessorActions | undefined
>(undefined);

const PIPELINE_STAGES = 5;

const defaultProcessorState: ProcessorState = {
  programInstructions: [],
  clockCycle: 0,
  totalCycles: 0,
  executionActive: false,
  pipelineDepth: PIPELINE_STAGES,
  phaseMap: {},
  executionComplete: false,

  instructionFormats: {},
  conflictAnalysis: {},
  dataForwarding: {},
  pipelineBubbles: {},
  activeBubbles: 0,

  forwardingEnabled: true,
  stallsEnabled: true,
};

// State transition calculator using the utility function
const calculateNextProcessorState = (
  currentState: ProcessorState
): ProcessorState => {
  if (!currentState.executionActive || currentState.executionComplete) {
    return currentState;
  }

  const pipelineState: PipelineState = {
    phaseMap: currentState.phaseMap,
    activeBubbles: currentState.activeBubbles,
    executionComplete: currentState.executionComplete,
    clockCycle: currentState.clockCycle,
  };

  const nextPipelineState = calculateNextPipelineState(
    pipelineState,
    currentState.programInstructions,
    currentState.pipelineBubbles,
    currentState.totalCycles
  );

  return {
    ...currentState,
    clockCycle: nextPipelineState.clockCycle,
    phaseMap: nextPipelineState.phaseMap,
    executionActive: !nextPipelineState.executionComplete,
    executionComplete: nextPipelineState.executionComplete,
    activeBubbles: nextPipelineState.activeBubbles,
  };
};

// Main provider component
export function SimulationProvider({ children }: PropsWithChildren) {
  const [processorState, setProcessorState] = React.useState<ProcessorState>(
    defaultProcessorState
  );
  const clockInterval = React.useRef<NodeJS.Timeout | null>(null);

  const stopClock = () => {
    if (clockInterval.current) {
      clearInterval(clockInterval.current);
      clockInterval.current = null;
    }
  };

  const startClock = React.useCallback(() => {
    stopClock();
    if (!processorState.executionActive || processorState.executionComplete)
      return;

    clockInterval.current = setInterval(() => {
      setProcessorState((prevState) => {
        const nextState = calculateNextProcessorState(prevState);
        if (nextState.executionComplete && !prevState.executionComplete) {
          stopClock();
        }
        return nextState;
      });
    }, 1000);
  }, [processorState.executionActive, processorState.executionComplete]);

  const resetProcessor = React.useCallback(() => {
    stopClock();
    setProcessorState(defaultProcessorState);
  }, []);

  const initializeExecution = React.useCallback(
    (
      instructions: string[],
      enableForwarding: boolean,
      enableStalls: boolean
    ) => {
      stopClock();
      if (instructions.length === 0) {
        resetProcessor();
        return;
      }

      // Decode all instructions
      const instructionFormats = decodeInstructions(instructions);

      // Analyze hazards
      const hazardAnalysis: HazardAnalysisResult = analyzeInstructionConflicts(
        instructions,
        instructionFormats,
        enableForwarding,
        enableStalls
      );

      // Calculate execution parameters
      const totalBubbleCycles = calculateTotalBubbles(hazardAnalysis.bubbles);
      const calculatedTotalCycles = calculateTotalCycles(
        instructions.length,
        totalBubbleCycles
      );

      // Initialize pipeline state
      const initialPipelineState = initializePipelineState(instructions);

      setProcessorState({
        programInstructions: instructions,
        clockCycle: initialPipelineState.clockCycle,
        totalCycles: calculatedTotalCycles,
        executionActive: true,
        pipelineDepth: PIPELINE_STAGES,
        phaseMap: initialPipelineState.phaseMap,
        executionComplete: false,

        instructionFormats,
        conflictAnalysis: hazardAnalysis.conflicts,
        dataForwarding: hazardAnalysis.forwards,
        pipelineBubbles: hazardAnalysis.bubbles,
        activeBubbles: 0,

        forwardingEnabled: enableForwarding,
        stallsEnabled: enableStalls,
      });
    },
    [resetProcessor]
  );

  const haltExecution = () => {
    setProcessorState((prevState) => {
      if (prevState.executionActive) {
        stopClock();
        return { ...prevState, executionActive: false };
      }
      return prevState;
    });
  };

  const resumeExecution = () => {
    setProcessorState((prevState) => {
      if (
        !prevState.executionActive &&
        prevState.clockCycle > 0 &&
        !prevState.executionComplete
      ) {
        return { ...prevState, executionActive: true };
      }
      return prevState;
    });
  };

  React.useEffect(() => {
    if (processorState.executionActive && !processorState.executionComplete) {
      startClock();
    } else {
      stopClock();
    }
    return stopClock;
  }, [
    processorState.executionActive,
    processorState.executionComplete,
    startClock,
  ]);

  const stateValue: ProcessorState = processorState;

  const actionsValue: ProcessorActions = React.useMemo(
    () => ({
      initializeExecution,
      resetProcessor,
      haltExecution,
      resumeExecution,
    }),
    [initializeExecution, resetProcessor]
  );

  return (
    <ProcessorStateContext.Provider value={stateValue}>
      <ProcessorActionsContext.Provider value={actionsValue}>
        {children}
      </ProcessorActionsContext.Provider>
    </ProcessorStateContext.Provider>
  );
}

export function useSimulationState() {
  const context = React.useContext(ProcessorStateContext);
  if (context === undefined) {
    throw new Error(
      'useSimulationState must be used within a SimulationProvider'
    );
  }
  return context;
}

export function useSimulationActions() {
  const context = React.useContext(ProcessorActionsContext);
  if (context === undefined) {
    throw new Error(
      'useSimulationActions must be used within a SimulationProvider'
    );
  }
  return context;
}
