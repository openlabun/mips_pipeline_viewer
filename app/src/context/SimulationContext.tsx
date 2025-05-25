// app/src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';
// MODIFICADO LEVEMENTE: Se mantiene la importación del decodificador
import { decodeInstruction, DecodedInstructionInfo, getDecodedInstructionText } from '@/lib/mips-decoder';

// EXISTENTE: Definiciones de tipos y constantes iniciales
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

// EXISTENTE: Interfaz SimulationState (ya incluía decodedInstructions del Paso 1)
interface SimulationState {
  instructions: string[];
  decodedInstructions: DecodedInstructionInfo[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
  forwardingEnabled: boolean;
  stallEnabled: boolean;
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

// NUEVO: Constantes para los índices de las etapas para mayor legibilidad
const PIPELINE_STAGES = {
  IF: 0,
  ID: 1,
  EX: 2,
  MEM: 3,
  WB: 4,
} as const;

// EXISTENTE: Estado inicial (ya incluía decodedInstructions del Paso 1)
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
};

// MODIFICADO SIGNIFICATIVAMENTE: calculateNextState ahora incluye la detección de hazards
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    // EXISTENTE: No hay cambios si no está corriendo o ya terminó
    return currentState;
  }

  // EXISTENTE: Desestructuración de estado actual
  const {
    instructions,
    decodedInstructions,
    currentCycle,
    stageCount,
    // forwardingEnabled, // Aún no se usa para la lógica de pipeline
    // stallEnabled,    // Aún no se usa para la lógica de pipeline
  } = currentState;

  const nextCycle = currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};

  // --- NUEVO: INICIO DE LÓGICA DE DETECCIÓN DE HAZARDS (Solo console.log por ahora) ---
  if (decodedInstructions.length > 0 && instructions.length > 0) { // Asegurarse de que hay instrucciones
    console.log(`--- Cycle ${nextCycle} Hazard Check ---`); // Log para el ciclo actual (que será el próximo)
    for (let i = 0; i < decodedInstructions.length; i++) { // Instrucción i (consumidora potencial)
      const consumerInfo = decodedInstructions[i];
      // Obtener la etapa ACTUAL (del ciclo que acaba de pasar, `currentState`) de la instrucción consumidora
      const actualConsumerStage = currentState.instructionStages[i];

      // Nos interesa cuando la consumidora ESTABA en ID, porque leerá registros para la EX del *próximo* ciclo.
      if (actualConsumerStage === PIPELINE_STAGES.ID) {
        if (consumerInfo.sourceRegisters && consumerInfo.sourceRegisters.length > 0) {
          // Iterar sobre las instrucciones anteriores j (productoras potenciales)
          // j es anterior a i en el orden del programa (j < i)
          // Por lo tanto, j está más adelantada en el pipeline o en la misma etapa si i hizo stall
          for (let j = 0; j < i; j++) {
            const producerInfo = decodedInstructions[j];
            // Obtener la etapa ACTUAL (del ciclo que acaba de pasar) de la instrucción productora
            const actualProducerStage = currentState.instructionStages[j];

            if (producerInfo.writesToRegister && producerInfo.destinationRegister !== null) {
              consumerInfo.sourceRegisters.forEach(srcReg => {
                if (srcReg === producerInfo.destinationRegister) {
                  // Riesgo RAW detectado si la productora está en EX o MEM
                  if (actualProducerStage === PIPELINE_STAGES.EX) {
                    console.log(
                      `Hazard Detected for Cycle ${nextCycle}: Inst ${i} ('${consumerInfo.hex}') in ID reads $${srcReg}, needed for its EX. ` +
                      `Inst ${j} ('${producerInfo.hex}') in EX writes to $${srcReg}.`
                    );
                  } else if (actualProducerStage === PIPELINE_STAGES.MEM) {
                    console.log(
                      `Hazard Detected for Cycle ${nextCycle}: Inst ${i} ('${consumerInfo.hex}') in ID reads $${srcReg}, needed for its EX. ` +
                      `Inst ${j} ('${producerInfo.hex}') in MEM writes to $${srcReg}.`
                    );
                  }
                }
              });
            }
          }
        }
      }
    }
  }
  // --- NUEVO: FIN DE LÓGICA DE DETECCIÓN DE HAZARDS ---

  // EXISTENTE: Lógica para avanzar las instrucciones por las etapas
  // Esta lógica aún no considera stalls, por lo que las instrucciones siempre avanzan.
  instructions.forEach((_, index) => {
    const stageIndex = nextCycle - index - 1; // Calcula la etapa para el *próximo* ciclo

    if (stageIndex >= 0 && stageIndex < stageCount) {
      newInstructionStages[index] = stageIndex;
    } else {
      newInstructionStages[index] = null;
    }
  });

  // EXISTENTE: Determinar si la simulación ha terminado
  const completionCycle = instructions.length > 0
    ? instructions.length + stageCount - 1
    : 0;

  const isFinished = nextCycle > completionCycle;
  const isRunning = !isFinished; // Detener si ha terminado

  // EXISTENTE: Retornar el nuevo estado
  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : nextCycle, // Cap cycle at completion
    instructionStages: newInstructionStages,
    isRunning: isRunning,
    isFinished: isFinished,
  };
};


// --- El resto del componente SimulationProvider y los hooks useSimulationState/Actions ---
// --- permanecen igual que al final del Paso 1, solo asegúrate de que         ---
// --- las dependencias de useMemo y useCallback estén actualizadas si es necesario ---
// --- (en este caso, no deberían haber cambiado significativamente para este paso). ---

// EXISTENTE: SimulationProvider con su lógica de timers, start, reset, pause, resume, setForwarding, setStall
export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = React.useState<SimulationState>(initialState);
  const intervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // MODIFICADO LEVEMENTE: runClock ahora llama a calculateNextState que tiene la lógica de hazard
  const runClock = React.useCallback(() => {
    clearTimer();
    if (!simulationState.isRunning || simulationState.isFinished) return;

    intervalRef.current = setInterval(() => {
      setSimulationState((prevState) => { // prevState es el estado del ciclo actual ANTES de avanzar
        const nextState = calculateNextState(prevState); // Calcula el estado del SIGUIENTE ciclo
        if (nextState.isFinished && !prevState.isFinished) {
           clearTimer();
        }
        return nextState;
      });
    }, 1000);
  }, [simulationState.isRunning, simulationState.isFinished]); // Dependencias de runClock


  // EXISTENTE: resetSimulation
  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState(prevState => ({
        ...initialState,
        forwardingEnabled: prevState.forwardingEnabled,
        stallEnabled: prevState.stallEnabled,
      }));
  }, []);

  // EXISTENTE: startSimulation (los console.log de decodificación pueden ser comentados si ya se verificaron)
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
    
    // console.log("Decoded Instructions Input:", submittedInstructions); // Comentar si ya está verificado
    // console.log("Decoded Instructions Output:", decoded.map(info => getDecodedInstructionText(info))); // Comentar si ya está verificado

    const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;

    setSimulationState(prevState => ({
      ...initialState, 
      forwardingEnabled: prevState.forwardingEnabled, 
      stallEnabled: prevState.stallEnabled,      
      instructions: submittedInstructions,
      decodedInstructions: decoded, 
      currentCycle: 0, // Iniciar en ciclo 0, el primer avance por runClock será al ciclo 1
      maxCycles: calculatedMaxCycles,
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: {}, // Las etapas se calcularán en el primer tick del reloj
      isFinished: false,
    }));
  }, []); 


  // EXISTENTE: pauseSimulation
   const pauseSimulation = () => {
     setSimulationState((prevState) => {
       if (prevState.isRunning) {
         clearTimer();
         return { ...prevState, isRunning: false };
       }
       return prevState;
     });
   };

  // EXISTENTE: resumeSimulation
  const resumeSimulation = () => {
     setSimulationState((prevState) => {
        if (!prevState.isRunning && prevState.currentCycle > 0 && !prevState.isFinished) {
            return { ...prevState, isRunning: true };
        }
        return prevState;
     });
   };

  // EXISTENTE: setForwarding
   const setForwarding = (enabled: boolean) => {
    // Si la simulación ha corrido o está pausada, resetear el ciclo para que los cambios tengan efecto al reiniciar
    setSimulationState(prevState => {
        const shouldResetProgress = prevState.currentCycle > 0;
        return {
            ...prevState,
            forwardingEnabled: enabled,
            currentCycle: shouldResetProgress ? 0 : prevState.currentCycle,
            isRunning: shouldResetProgress ? false : prevState.isRunning,
            isFinished: shouldResetProgress ? false : prevState.isFinished,
            instructionStages: shouldResetProgress ? {} : prevState.instructionStages,
        };
    });
  };

  // EXISTENTE: setStall
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
        };
    });
  };

  // EXISTENTE: useEffect para runClock
  React.useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer(); // Asegura limpiar el timer si no está corriendo o está finalizado
    }
    return clearTimer; // Limpieza al desmontar o cuando cambian las dependencias
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);


  // EXISTENTE: stateValue
  const stateValue: SimulationState = simulationState;

  // MODIFICADO LEVEMENTE: Asegurarse que todas las acciones estén en las dependencias de useMemo
  const actionsValue: SimulationActions = React.useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwarding,
      setStall,
    }),
    [startSimulation, resetSimulation, pauseSimulation, resumeSimulation] // setForwarding y setStall son estables por useCallback implícito de useState
  );

  // EXISTENTE: Provider JSX
  return (
    <SimulationStateContext.Provider value={stateValue}>
      <SimulationActionsContext.Provider value={actionsValue}>
        {children}
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

// EXISTENTE: Hooks
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