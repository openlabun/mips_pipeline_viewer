// app/src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';
import { decodeInstruction, DecodedInstructionInfo, getDecodedInstructionText } from '@/lib/mips-decoder'; // EXISTENTE

// EXISTENTE: Definiciones de tipos y constantes iniciales
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

// EXISTENTE: Interfaz SimulationState
interface SimulationState {
  instructions: string[];
  decodedInstructions: DecodedInstructionInfo[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, { stage: number | null; isStalled?: boolean }>; // MODIFICADO: para indicar stall
  isFinished: boolean;
  forwardingEnabled: boolean;
  stallEnabled: boolean;
  stalledInstructionIndex: number | null; // NUEVO: para rastrear qué instrucción causó el stall
}

// EXISTENTE: Interfaz SimulationActions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwarding: (enabled: boolean) => void;
  setStall: (enabled: boolean) => void;
}

// EXISTENTE: Creación de contextos
const SimulationStateContext = React.createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = React.createContext<SimulationActions | undefined>(undefined);

// EXISTENTE: Constante
const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

// EXISTENTE: Constantes para los índices de las etapas
const PIPELINE_STAGES = {
  IF: 0,
  ID: 1,
  EX: 2,
  MEM: 3,
  WB: 4,
  OUT: 5, // Etapa virtual para instrucciones que han salido
} as const;

// MODIFICADO: Estado inicial
const initialState: SimulationState = {
  instructions: [],
  decodedInstructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {}, // Ahora almacenará { stage: number | null, isStalled?: boolean }
  isFinished: false,
  forwardingEnabled: false,
  stallEnabled: false,
  stalledInstructionIndex: null, // NUEVO
};

// MODIFICADO SIGNIFICATIVAMENTE: calculateNextState ahora incluye la lógica de STALL
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const {
    instructions,
    decodedInstructions,
    currentCycle,
    stageCount,
    forwardingEnabled, // Ahora lo usaremos
    stallEnabled,    // Ahora lo usaremos
  } = currentState;

  const nextCycle = currentCycle + 1;
  const newInstructionStages: Record<number, { stage: number | null; isStalled?: boolean }> = {};
  let hazardRequiresStall = false;
  let stallingInstructionIndex: number | null = null; // Índice de la instrucción que causa el stall (la que está en ID)

  // --- LÓGICA DE DETECCIÓN DE HAZARDS Y DECISIÓN DE STALL ---
  if (decodedInstructions.length > 0 && instructions.length > 0) {
    // Solo aplicar stall si está habilitado y forwarding NO
    if (stallEnabled && !forwardingEnabled) {
      // Iterar de la instrucción más temprana en el programa a la más tardía
      for (let i = 0; i < decodedInstructions.length; i++) {
        const consumerInfo = decodedInstructions[i];
        const actualConsumerStageInfo = currentState.instructionStages[i];
        const actualConsumerStage = actualConsumerStageInfo ? actualConsumerStageInfo.stage : null;

        if (actualConsumerStage === PIPELINE_STAGES.ID && consumerInfo.sourceRegisters && consumerInfo.sourceRegisters.length > 0) {
          for (let j = 0; j < i; j++) { // j es la productora, i es la consumidora
            const producerInfo = decodedInstructions[j];
            const actualProducerStageInfo = currentState.instructionStages[j];
            const actualProducerStage = actualProducerStageInfo ? actualProducerStageInfo.stage : null;

            if (producerInfo.writesToRegister && producerInfo.destinationRegister !== null) {
              if (consumerInfo.sourceRegisters.includes(producerInfo.destinationRegister)) {
                // Riesgo RAW: i lee lo que j escribe.
                // ¿Necesita stall? Sí, si j no ha llegado a WB y no hay forwarding.
                // El stall ocurre si la productora está en EX o MEM.
                if (actualProducerStage === PIPELINE_STAGES.EX || actualProducerStage === PIPELINE_STAGES.MEM) {
                  console.log(
                    `Cycle ${nextCycle} STALL: Inst ${i} ('${consumerInfo.hex}') in ID needs reg $${producerInfo.destinationRegister} from Inst ${j} ('${producerInfo.hex}') in ${actualProducerStage === PIPELINE_STAGES.EX ? 'EX' : 'MEM'}.`
                  );
                  hazardRequiresStall = true;
                  stallingInstructionIndex = i; // La instrucción 'i' (en ID) es la que se detiene
                  break; // Un hazard es suficiente para detener el pipeline en este ciclo
                }
              }
            }
          }
        }
        if (hazardRequiresStall) break; // Salir del bucle exterior si ya se detectó un stall
      }
    }
  }
  // --- FIN LÓGICA DE DETECCIÓN Y DECISIÓN DE STALL ---

  // --- LÓGICA PARA AVANZAR INSTRUCCIONES (CON STALL) ---
  if (hazardRequiresStall && stallingInstructionIndex !== null) {
    // Aplicar stall
    instructions.forEach((_, index) => {
      const currentStageInfo = currentState.instructionStages[index] || { stage: null };
      let currentStage = currentStageInfo.stage;

      if (index === stallingInstructionIndex) { // Instrucción en ID que causa el stall
        newInstructionStages[index] = { stage: PIPELINE_STAGES.ID, isStalled: true }; // Permanece en ID, marcada como stall
      } else if (index === stallingInstructionIndex - 1 && currentStage === PIPELINE_STAGES.IF) {
         // Instrucción en IF detrás de la que stallea en ID también se detiene
        newInstructionStages[index] = { stage: PIPELINE_STAGES.IF, isStalled: true }; // Permanece en IF
      } else if (currentStage !== null && currentStage < PIPELINE_STAGES.EX) {
        // Si una instrucción está antes de EX y no es la que causa el stall directamente
        // o la que está justo antes en IF, podría avanzar si no está bloqueada,
        // pero nuestra regla de stall simple es: PC y IF/ID se congelan, ID/EX se convierte en burbuja.
        // Para este caso, si la instrucción estaba en IF y no es stallingInstructionIndex -1, avanzará a IF
        // Si la instrucción stallingInstructionIndex es la 0, no hay stallingInstructionIndex -1.
        // La que causa stall es la `stallingInstructionIndex` (en ID)
        // La que está en IF (que sería `stallingInstructionIndex + 1` en orden de programa, pero `stallingInstructionIndex -1` en `currentState.instructions`
        // si la simulación avanza de `instructions[0]` primero)
        // Corrijamos el índice: la instrucción EN IF es la que tiene índice `stallingInstructionIndex` y estaba en IF
        // No, la instrucción que causa stall (`stallingInstructionIndex`) está en ID.
        // La instrucción que *sigue en el programa* a `stallingInstructionIndex` es `stallingInstructionIndex + 1`.
        // Esta instrucción `stallingInstructionIndex + 1` estaría en IF. Esta es la que debe detenerse.

        // Simplificación: La instrucción en ID (stallingInstructionIndex) y la instrucción en IF (stallingInstructionIndex + 1) se detienen.
        // Las que están en EX, MEM, WB avanzan. La etapa EX recibe una burbuja.
        // Las instrucciones que están "detrás" de IF (aún no cargadas) no entran.

        if (index === stallingInstructionIndex + 1 && currentStage === PIPELINE_STAGES.IF) {
            newInstructionStages[index] = { stage: PIPELINE_STAGES.IF, isStalled: true };
        } else if (currentStage !== null && currentStage >= PIPELINE_STAGES.EX) {
             // Instrucciones en EX, MEM, WB avanzan normalmente
            newInstructionStages[index] = { stage: currentStage + 1 > PIPELINE_STAGES.WB ? PIPELINE_STAGES.OUT : currentStage + 1 };
        } else if (index < stallingInstructionIndex) {
            // Instrucciones antes de la que está en ID (y que no son la que está en IF) avanzan
             // Esto es para las que ya pasaron ID y están en EX, MEM, WB
            const nextStageValue = (currentStage !== null ? currentStage + 1 : PIPELINE_STAGES.IF);
            newInstructionStages[index] = { stage: nextStageValue > PIPELINE_STAGES.WB ? PIPELINE_STAGES.OUT : nextStageValue };
        } else {
            // Instrucciones que aún no han llegado a IF o están muy atrás, o las que se quedan quietas
            newInstructionStages[index] = currentState.instructionStages[index] || { stage: null };
        }
      } else {
         // Instrucciones en EX, MEM, WB avanzan normalmente
         // Y las que están antes de la zona de stall también
         const prevStage = currentState.instructionStages[index]?.stage;
         if (prevStage !== null) {
             const nextStageValue = prevStage + 1;
             newInstructionStages[index] = { stage: nextStageValue > PIPELINE_STAGES.WB ? PIPELINE_STAGES.OUT : nextStageValue };
         } else {
             // Instrucción nueva entrando a IF
             const stageForNewInst = nextCycle - index - 1;
             if (stageForNewInst === PIPELINE_STAGES.IF) {
                 newInstructionStages[index] = { stage: PIPELINE_STAGES.IF };
             } else {
                 newInstructionStages[index] = { stage: null };
             }
         }
      }
    });
    // La etapa EX se convierte en burbuja si la instrucción que iba a entrar (stallingInstructionIndex) se detuvo en ID.
    // Esto se maneja visualmente: si ninguna instrucción entra a EX, EX está vacía (es una burbuja).

  } else {
    // Sin stall, avanzar todas las instrucciones normalmente
    instructions.forEach((_, index) => {
      const stageIndex = nextCycle - index - 1;
      if (stageIndex >= 0 && stageIndex < stageCount) {
        newInstructionStages[index] = { stage: stageIndex, isStalled: false };
      } else if (stageIndex >= stageCount) {
        newInstructionStages[index] = { stage: PIPELINE_STAGES.OUT, isStalled: false };
      }
      else {
        newInstructionStages[index] = { stage: null, isStalled: false };
      }
    });
  }
  // --- FIN LÓGICA PARA AVANZAR INSTRUCCIONES ---

  // MODIFICADO: Ajustar maxCycles si ocurre un stall
  let newMaxCycles = currentState.maxCycles;
  if (hazardRequiresStall) {
    newMaxCycles = Math.max(newMaxCycles, nextCycle + stageCount); // Extender si es necesario
    console.log(`Stall occurred, currentCycle: ${nextCycle}, newMaxCycles potentially: ${newMaxCycles}`);
  }

  // Determinar si la simulación ha terminado
  // La simulación termina cuando la última instrucción ha pasado la etapa WB
  let allInstructionsFinished = true;
  if (instructions.length === 0) {
    allInstructionsFinished = true; // O false si se considera que no ha empezado
  } else {
    const lastInstructionIndex = instructions.length - 1;
    const lastInstStageInfo = newInstructionStages[lastInstructionIndex];
    if (!lastInstStageInfo || lastInstStageInfo.stage === null || lastInstStageInfo.stage < PIPELINE_STAGES.OUT) {
      allInstructionsFinished = false;
    }
  }
  
  const isFinished = allInstructionsFinished && nextCycle > currentState.currentCycle; // Asegurarse que avanzó un ciclo
  const isRunning = !isFinished && currentState.isRunning; // Mantener isRunning si no ha terminado

  return {
    ...currentState,
    currentCycle: nextCycle, // Siempre avanzamos el ciclo del simulador
    instructionStages: newInstructionStages,
    isRunning: hazardRequiresStall ? true : isRunning, // Si hay stall, la simulación sigue corriendo
    isFinished: hazardRequiresStall ? false : isFinished,
    maxCycles: newMaxCycles, // Usar el maxCycles ajustado
    stalledInstructionIndex: hazardRequiresStall ? stallingInstructionIndex : null,
  };
};

// --- El resto del componente SimulationProvider y los hooks ---
// (Asegúrate de que las dependencias de useMemo/useCallback estén bien,
//  y que startSimulation/resetSimulation inicialicen stalledInstructionIndex a null
//  y instructionStages como {} o con el formato { stage: null, isStalled: false })

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
    // Corregido: La dependencia es de simulationState.isRunning y simulationState.isFinished
    // que vienen del estado actual, no del estado que se pasa a runClock.
    if (!simulationState.isRunning || simulationState.isFinished) return;

    intervalRef.current = setInterval(() => {
      setSimulationState((prevState) => {
        if (!prevState.isRunning || prevState.isFinished) { // Doble chequeo por si el estado cambió mientras el intervalo estaba pendiente
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
  // Quitar simulationState de las dependencias directas de useCallback para evitar re-creaciones excesivas
  // Las variables que usa de simulationState ya están cubiertas por su uso dentro del setInterval o al inicio de runClock
  }, [simulationState.isRunning, simulationState.isFinished]);


  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState(prevState => ({
        ...initialState,
        forwardingEnabled: prevState.forwardingEnabled,
        stallEnabled: prevState.stallEnabled,
        stalledInstructionIndex: null, // Asegurar reset
        instructionStages: {},       // Asegurar reset
      }));
  }, []);

  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer();
    if (submittedInstructions.length === 0) {
      setSimulationState(prevState => ({
        ...initialState,
        forwardingEnabled: prevState.forwardingEnabled,
        stallEnabled: prevState.stallEnabled,
        stalledInstructionIndex: null,
        instructionStages: {},
      }));
      return;
    }

    const decoded = submittedInstructions.map(hex => decodeInstruction(hex));
    const initialMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;

    setSimulationState(prevState => ({
      ...initialState,
      forwardingEnabled: prevState.forwardingEnabled,
      stallEnabled: prevState.stallEnabled,
      instructions: submittedInstructions,
      decodedInstructions: decoded,
      currentCycle: 0,
      maxCycles: initialMaxCycles, // MaxCycles inicial
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: {}, // Se llenará en el primer ciclo
      isFinished: false,
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
        return {
            ...prevState,
            forwardingEnabled: enabled,
            currentCycle: shouldResetProgress ? 0 : prevState.currentCycle,
            isRunning: shouldResetProgress ? false : prevState.isRunning,
            isFinished: shouldResetProgress ? false : prevState.isFinished,
            instructionStages: shouldResetProgress ? {} : prevState.instructionStages,
            stalledInstructionIndex: shouldResetProgress ? null : prevState.stalledInstructionIndex,
        };
    });
  };

  const setStall = (enabled: boolean) => {
    setSimulationState(prevState => {
        const shouldResetProgress = prevState.currentCycle > 0;
        return {
            ...prevState,
            stallEnabled: enabled,
            currentCycle: shouldResetProgress ? 0 : prevState.currentCycle,
            isRunning: shouldResetProgress ? false : prevState.isRunning,
            isFinished: shouldResetProgress ? false : prevState.isFinished,
            instructionStages: shouldResetProgress ? {} : prevState.instructionStages,
            stalledInstructionIndex: shouldResetProgress ? null : prevState.stalledInstructionIndex,
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
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwarding,
      setStall,
    }),
    // Quitar dependencias que son estables por estar definidas con useCallback sin deps,
    // o cuyas dependencias internas ya están manejadas.
    // Esto es una optimización, pero si causa problemas, se pueden re-añadir selectivamente.
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