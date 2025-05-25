// app/src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { decodeInstruction, DecodedInstructionInfo, getDecodedInstructionText } from '@/lib/mips-decoder';

interface InstructionPipelineInfo {
  stage: number | null;
  isStalled?: boolean;
  forwardingSourceStage?: 'EX' | 'MEM' | null;
}

interface SimulationState {
  instructions: string[];
  decodedInstructions: DecodedInstructionInfo[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, InstructionPipelineInfo>;
  isFinished: boolean;
  forwardingEnabled: boolean;
  stallEnabled: boolean;
  stalledInstructionIndex: number | null;
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwarding: (enabled: boolean) => void;
  setStall: (enabled: boolean) => void;
}

const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

const SimulationStateContext = React.createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = React.createContext<SimulationActions | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

const PIPELINE_STAGES = {
  IF: 0,
  ID: 1,
  EX: 2,
  MEM: 3,
  WB: 4,
  OUT: 5,
} as const;

const initialState: SimulationState = {
  instructions: [],
  decodedInstructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  forwardingEnabled: false,
  stallEnabled: false,
  stalledInstructionIndex: null,
};

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const {
    instructions,
    decodedInstructions,
    currentCycle,
    stageCount,
    forwardingEnabled,
    stallEnabled,
  } = currentState;

  const nextCycle = currentCycle + 1;
  const newInstructionStages: Record<number, InstructionPipelineInfo> = {};
  let hazardRequiresStallGlobal = false;
  let stallingInstructionGlobalIndex: number | null = null;
  let newMaxCycles = currentState.maxCycles;
  const forwardingDecisionsForID: Record<number, 'EX' | 'MEM' | null> = {};

  if (decodedInstructions.length > 0 && instructions.length > 0) {
    console.log(`[CTX] --- Cycle ${nextCycle} PRE-CHECK (FW: ${forwardingEnabled}, Stall: ${stallEnabled}) ---`);

    for (let i = 0; i < decodedInstructions.length; i++) { 
      const consumerInfo = decodedInstructions[i];
      const consumerCurrentStageInfo = currentState.instructionStages[i];
      const consumerCurrentStage = consumerCurrentStageInfo?.stage;

      forwardingDecisionsForID[i] = null; 
      let needsStallForThisConsumer = false; // Renombrado de hazardRequiresStall a algo local

      if (consumerCurrentStage === PIPELINE_STAGES.ID && consumerInfo.sourceRegisters && consumerInfo.sourceRegisters.length > 0) {
        console.log(`[CTX] Cycle ${nextCycle}: Checking Inst ${i} ('${consumerInfo.hex}') in ID for hazards.`);
        let resolvedByForwardingWithoutLoadUseStall = false;

        for (let j = 0; j < i; j++) { 
          const producerInfo = decodedInstructions[j];
          const producerCurrentStageInfo = currentState.instructionStages[j];
          const producerCurrentStage = producerCurrentStageInfo?.stage;

          if (producerInfo.writesToRegister && producerInfo.destinationRegister !== null) {
            if (consumerInfo.sourceRegisters.includes(producerInfo.destinationRegister)) {
              const reg = producerInfo.destinationRegister;
              console.log(`[CTX] Cycle ${nextCycle}: Inst ${i} (ID) needs $${reg}. Checking Inst ${j} ('${producerInfo.hex}') in stage ${producerCurrentStage}.`);
              
              if (forwardingEnabled) {
                // PRIORIDAD 1: Stall para Load-Use si FW está ON
                if (producerInfo.isLoadWord && producerCurrentStage === PIPELINE_STAGES.EX) {
                  console.log(`[CTX] Cycle ${nextCycle}: DECISION - LOAD-USE HAZARD! Inst ${i} (ID) needs $${reg} from LW Inst ${j} (EX). Stall REQUIRED even with FW.`);
                  needsStallForThisConsumer = true; // Esta consumidora necesita stall
                  // No establecemos forwardingDecisionsForID[i] porque se stallará. El FW se aplicará después del stall.
                  break; // Salir del bucle de productoras para esta consumidora
                }

                // PRIORIDAD 2: Forwarding normal si no hubo stall por load-use
                if (!needsStallForThisConsumer) { // Solo si no se decidió stall por load-use
                  if (producerCurrentStage === PIPELINE_STAGES.EX && !producerInfo.isLoadWord) { // EX->EX (no LW)
                    console.log(`[CTX] Cycle ${nextCycle}: DECISION - FW EX->EX for Inst ${i} from Inst ${j} for $${reg}.`);
                    forwardingDecisionsForID[i] = 'EX';
                    resolvedByForwardingWithoutLoadUseStall = true;
                    break; 
                  }
                  if (producerCurrentStage === PIPELINE_STAGES.MEM && !forwardingDecisionsForID[i]) { // MEM->EX
                    console.log(`[CTX] Cycle ${nextCycle}: DECISION - FW MEM->EX for Inst ${i} from Inst ${j} for $${reg}.`);
                    forwardingDecisionsForID[i] = 'MEM';
                    resolvedByForwardingWithoutLoadUseStall = true;
                    break; 
                  }
                }
              } // Fin if (forwardingEnabled)

              // PRIORIDAD 3: Stall si FW está OFF o si FW está ON pero no se pudo forwardear Y no se stalleó por load-use
              if (!needsStallForThisConsumer && !resolvedByForwardingWithoutLoadUseStall && stallEnabled) {
                if (producerCurrentStage === PIPELINE_STAGES.EX || producerCurrentStage === PIPELINE_STAGES.MEM) {
                  console.log(`[CTX] Cycle ${nextCycle}: DECISION - STALL (No FW path or FW off): Inst ${i} ('${consumerInfo.hex}') needs $${reg} from Inst ${j} ('${producerInfo.hex}') in ${producerCurrentStage === PIPELINE_STAGES.EX ? 'EX' : 'MEM'}.`);
                  needsStallForThisConsumer = true;
                }
              }
            } 
          } 
          if (needsStallForThisConsumer || resolvedByForwardingWithoutLoadUseStall) break; 
        }

        if (needsStallForThisConsumer) {
          hazardRequiresStallGlobal = true;
          stallingInstructionGlobalIndex = i;
          break; 
        }
      } 
    } 
  }

  if (hazardRequiresStallGlobal && stallingInstructionGlobalIndex !== null) {
    newMaxCycles = Math.max(newMaxCycles, nextCycle + stageCount + 1); 
    console.log(`[CTX] STALLING CYCLE: Inst ${stallingInstructionGlobalIndex} (in ID) is stalled. Cycle ${nextCycle}.`);
    instructions.forEach((_, index) => {
      const currentStageInfo = currentState.instructionStages[index];
      const currentStage = currentStageInfo?.stage;

      if (index === stallingInstructionGlobalIndex) { 
        newInstructionStages[index] = { stage: PIPELINE_STAGES.ID, isStalled: true };
      } else if (index === stallingInstructionGlobalIndex + 1 && currentStage === PIPELINE_STAGES.IF) {
        newInstructionStages[index] = { stage: PIPELINE_STAGES.IF, isStalled: true };
      } else if (currentStage !== null && currentStage < PIPELINE_STAGES.OUT) {
        const nextStageValue = currentStage + 1;
        newInstructionStages[index] = { stage: nextStageValue > PIPELINE_STAGES.WB ? PIPELINE_STAGES.OUT : nextStageValue, isStalled: false };
      } else if (currentStage === null) { 
         const entryCycleForIF = index + 1;
         if (nextCycle === entryCycleForIF && !(index === stallingInstructionGlobalIndex + 1)) {
            newInstructionStages[index] = { stage: PIPELINE_STAGES.IF };
         } else {
            newInstructionStages[index] = { stage: null };
         }
      } else { 
        newInstructionStages[index] = { stage: currentStage, isStalled: !!currentStageInfo?.isStalled };
      }
    });
  } else { 
    instructions.forEach((_, index) => {
      const prevStageInfo = currentState.instructionStages[index];
      const prevStage = prevStageInfo?.stage;
      let nextStageValue: number | null = null;

      if (prevStage === null) {
        if (nextCycle === index + 1) { 
            nextStageValue = PIPELINE_STAGES.IF;
        } else {
            nextStageValue = null;
        }
      } else if (prevStage === PIPELINE_STAGES.OUT) {
        nextStageValue = PIPELINE_STAGES.OUT;
      } else {
        nextStageValue = prevStage + 1;
      }
      
      if (nextStageValue !== null && nextStageValue > PIPELINE_STAGES.WB) {
        nextStageValue = PIPELINE_STAGES.OUT;
      }
      
      const forwardingSourceToApply = (nextStageValue === PIPELINE_STAGES.EX) ? (forwardingDecisionsForID[index] || null) : null;
      if (forwardingSourceToApply) {
          console.log(`[CTX] Cycle ${nextCycle}: Inst ${index} ('${decodedInstructions[index].hex}') entering EX, APPLYING FW from ${forwardingSourceToApply}.`);
      }

      newInstructionStages[index] = { 
        stage: nextStageValue, 
        isStalled: false, 
        forwardingSourceStage: forwardingSourceToApply 
      };
    });
  }

  let allDone = instructions.length > 0;
  for (let i = 0; i < instructions.length; i++) {
    if (!newInstructionStages[i] || newInstructionStages[i].stage !== PIPELINE_STAGES.OUT) {
      allDone = false;
      break;
    }
  }
  
  const isSimFinished = allDone && (instructions.length > 0);
  const isSimRunning = !isSimFinished && currentState.isRunning;

  return {
    ...currentState,
    currentCycle: nextCycle,
    instructionStages: newInstructionStages,
    isRunning: isSimRunning,
    isFinished: isSimFinished,
    maxCycles: newMaxCycles,
    stalledInstructionIndex: hazardRequiresStallGlobal ? stallingInstructionGlobalIndex : null,
  };
};

// --- PROVIDER Y HOOKS (El resto del archivo sin cambios) ---
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
        if (!prevState.isRunning || prevState.isFinished) {
          clearTimer();
          return prevState;
        }
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
    setSimulationState(prevState => ({
      ...initialState,
      forwardingEnabled: prevState.forwardingEnabled,
      stallEnabled: prevState.stallEnabled,
    }));
  }, []);

  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer();
    if (submittedInstructions.length === 0) {
      setSimulationState(prevState => ({
        ...initialState,
        forwardingEnabled: prevState.forwardingEnabled,
        stallEnabled: prevState.stallEnabled,
      }));
      return;
    }
    const decoded = submittedInstructions.map(hex => decodeInstruction(hex));    
    let calculatedMaxCycles = submittedInstructions.length > 0 
                           ? submittedInstructions.length + DEFAULT_STAGE_COUNT - 1 
                           : 0;
    const initialStages: Record<number, InstructionPipelineInfo> = {};
    for (let i = 0; i < submittedInstructions.length; i++) {
        initialStages[i] = { stage: null, isStalled: false, forwardingSourceStage: null };
    }

    setSimulationState(prevState => ({
      ...initialState,
      forwardingEnabled: prevState.forwardingEnabled,
      stallEnabled: prevState.stallEnabled,
      instructions: submittedInstructions,
      decodedInstructions: decoded,
      currentCycle: 0, 
      maxCycles: calculatedMaxCycles,
      isRunning: true,
      isFinished: false,
      instructionStages: initialStages, 
      stalledInstructionIndex: null,
    }));
  }, []);

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

  const setForwarding = (enabled: boolean) => {
    setSimulationState(prevState => {
      const shouldResetProgress = prevState.currentCycle > 0;
      if (shouldResetProgress) clearTimer();
      return {
        ...prevState,
        forwardingEnabled: enabled,
        ...(shouldResetProgress && { 
          currentCycle: 0, isRunning: false, isFinished: false,
          instructionStages: {}, stalledInstructionIndex: null,
          maxCycles: prevState.instructions.length > 0 ? prevState.instructions.length + DEFAULT_STAGE_COUNT -1 : 0,
        })
      };
    });
  };

  const setStall = (enabled: boolean) => {
    setSimulationState(prevState => {
      const shouldResetProgress = prevState.currentCycle > 0;
      if (shouldResetProgress) clearTimer();
      return {
        ...prevState,
        stallEnabled: enabled,
        ...(shouldResetProgress && { 
          currentCycle: 0, isRunning: false, isFinished: false,
          instructionStages: {}, stalledInstructionIndex: null,
          maxCycles: prevState.instructions.length > 0 ? prevState.instructions.length + DEFAULT_STAGE_COUNT -1 : 0,
        })
      };
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
      startSimulation, resetSimulation, pauseSimulation, resumeSimulation, setForwarding, setStall,
    }),
    [startSimulation, resetSimulation, pauseSimulation, resumeSimulation, setForwarding, setStall]
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