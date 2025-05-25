// src/context/SimulationContext.tsx
"use client"; 

import type { PropsWithChildren } from 'react';
import * as React from 'react';
// Asegúrate de que la ruta de importación sea correcta según tu estructura de carpetas
import { decodeInstruction, DecodedInstructionInfo, getDecodedInstructionText } from '@/lib/mips-decoder';

const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];

// 1. Actualiza la interfaz SimulationState
interface SimulationState {
  instructions: string[]; // Instrucciones originales en hexadecimal
  decodedInstructions: DecodedInstructionInfo[]; // <--- NUEVA PROPIEDAD
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>; // Etapa actual (índice) de cada instrucción
  isFinished: boolean;
  forwardingEnabled: boolean;
  stallEnabled: boolean;
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwarding: (enabled: boolean) => void;
  setStall: (enabled: boolean) => void;
}

const SimulationStateContext = React.createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = React.createContext<SimulationActions | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

// 2. Actualiza initialState
const initialState: SimulationState = {
  instructions: [],
  decodedInstructions: [], // <--- INICIALIZAR
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  forwardingEnabled: false, // Por defecto desactivado
  stallEnabled: false,     // Por defecto desactivado
};

// calculateNextState no cambia para ESTE PASO en particular
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  // let activeInstructions = 0; // No se usa actualmente

  currentState.instructions.forEach((_, index) => {
    const stageIndex = nextCycle - index - 1;

    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;
      // activeInstructions++; // No se usa actualmente
    } else {
      newInstructionStages[index] = null;
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
    isRunning: isRunning,
    isFinished: isFinished,
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


  // 3. Modifica resetSimulation para mantener las opciones de forwarding/stall
  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState(prevState => ({
        ...initialState, // Restablece a los valores iniciales por defecto
        forwardingEnabled: prevState.forwardingEnabled, // Pero mantiene la selección del usuario
        stallEnabled: prevState.stallEnabled,           // para estas opciones
      }));
  }, []);

  // 4. Modifica startSimulation
  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer();
    if (submittedInstructions.length === 0) {
      // Al resetear con instrucciones vacías, también mantener las opciones
      setSimulationState(prevState => ({
        ...initialState,
        forwardingEnabled: prevState.forwardingEnabled,
        stallEnabled: prevState.stallEnabled,
      }));
      return;
    }

    // Decodificar las instrucciones aquí
    const decoded = submittedInstructions.map(hex => decodeInstruction(hex));
    
    // --- INICIO DE PRUEBA DE CONSOLA ---
    console.log("Decoded Instructions Input:", submittedInstructions);
    console.log("Decoded Instructions Output:", decoded.map(info => getDecodedInstructionText(info)));
    // --- FIN DE PRUEBA DE CONSOLA ---

    const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;
    // const initialStages: Record<number, number | null> = {}; // Se establecerá en el primer ciclo de calculateNextState

    setSimulationState(prevState => ({
      ...initialState, // Restablece la mayoría del estado
      forwardingEnabled: prevState.forwardingEnabled, // Mantener opción de fw
      stallEnabled: prevState.stallEnabled,           // Mantener opción de stall
      instructions: submittedInstructions,
      decodedInstructions: decoded, // Guardar instrucciones decodificadas
      currentCycle: 0, // Iniciar en ciclo 0, el primer avance será al ciclo 1
      maxCycles: calculatedMaxCycles,
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: {}, // Las etapas se calcularán en el primer tick del reloj
      isFinished: false,
    }));
  }, []); // No es necesario resetSimulation como dependencia aquí


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
    setSimulationState(prevState => ({ ...prevState, forwardingEnabled: enabled, currentCycle: prevState.isRunning ? prevState.currentCycle: 0, isRunning: prevState.isRunning ? prevState.isRunning : false, isFinished: prevState.isRunning ? prevState.isFinished : false }));
    // Si la simulación está corriendo y se cambia una opción, podría ser necesario resetear o recalcular
    // Por ahora, solo actualizamos el estado. Considerar reiniciar la simulación si se cambian opciones durante la ejecución.
    // Si la simulación ya ha corrido, cambiar estas opciones no tendrá efecto retroactivo sin reiniciar.
    // Para simplificar, asumimos que estas opciones se configuran ANTES de "Start Simulation".
    // Si se cambian después de iniciar, se aplicarán al siguiente "Start Simulation" o si la lógica de `calculateNextState` las usa dinámicamente.
    // Una opción más robusta sería reiniciar la simulación (o al menos su progreso de ciclo) si estas se cambian mientras está pausada o después de haber corrido.
  };

  const setStall = (enabled: boolean) => {
    setSimulationState(prevState => ({ ...prevState, stallEnabled: enabled, currentCycle: prevState.isRunning ? prevState.currentCycle: 0, isRunning: prevState.isRunning ? prevState.isRunning : false, isFinished: prevState.isRunning ? prevState.isFinished : false }));
    // Misma consideración que para setForwarding
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
    [startSimulation, resetSimulation, pauseSimulation, resumeSimulation, setForwarding, setStall] // Añadir las nuevas acciones
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