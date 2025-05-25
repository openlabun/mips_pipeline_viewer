// src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from "react";
import * as React from "react";

// --------------- Constantes y tipos ---------------
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;

// Agregar tipos para el forwarding
interface ForwardingInfo {
  from: number;  // índice de instrucción origen
  to: number;    // índice de instrucción destino
  source: "EX" | "MEM";  // etapa desde la que se forwardea
  target: "rs" | "rt";   // registro destino
  cycle: number;         // ciclo en que ocurre
}

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
  mode: "normal" | "stall" | "forwarding";
  // Agregamos información de forwarding
  forwardingPaths: ForwardingInfo[];
}

interface SimulationActions {
  startSimulation: (submitted: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setMode: (m: "normal" | "stall" | "forwarding") => void;
  nextCycle: () => void;
  previousCycle: () => void;
  goToCycle: (cycle: number) => void;
}

const SimulationStateContext = React.createContext<SimulationState | undefined>(
  undefined
);
const SimulationActionsContext = React.createContext<
  SimulationActions | undefined
>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

const initialState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  mode: "normal",
  forwardingPaths: [], // Inicializar paths de forwarding
};

// --------------- Utilidades extendidas ----------------

// Función auxiliar: extrae rs / rt / rd
function decodeInstruction(hex: string) {
  const instr = parseInt(hex, 16);
  const opcode = (instr >>> 26) & 0x3f; // 6 bits altos

  if (opcode === 0x00) {
    // Tipo R
    return {
      type: "R" as const,
      opcode,
      rs: (instr >>> 21) & 0x1f,
      rt: (instr >>> 16) & 0x1f,
      rd: (instr >>> 11) & 0x1f,
    };
  }
  return {
    type: "I" as const,
    opcode,
    rs: (instr >>> 21) & 0x1f,
    rt: (instr >>> 16) & 0x1f,
  };
}

// Devuelve true si la instrucción curr depende de un registro escrito por prev
function hasDataHazard(prevHex: string, currHex: string): boolean {
  const prev = decodeInstruction(prevHex);
  const curr = decodeInstruction(currHex);

  // destino de prev
  let prevDest: number | null = null;
  if (prev.type === "R") prevDest = prev.rd;
  else if (prev.opcode === 0x23) prevDest = prev.rt; // lw
  else if (prev.opcode !== 0x2b) prevDest = prev.rt; // I-tipo con destino en rt

  // fuentes de curr
  const currSrc: number[] = [];
  if (curr.type === "R") currSrc.push(curr.rs, curr.rt);
  else if (curr.opcode === 0x23) currSrc.push(curr.rs); // lw
  else if (curr.opcode === 0x2b) currSrc.push(curr.rs, curr.rt); // sw
  else currSrc.push(curr.rs);

  return prevDest !== null && currSrc.includes(prevDest);
}

// Determina si puede haber forwarding entre prev->curr y devuelve la información
function checkForwarding(
  prevHex: string,
  currHex: string,
  prevIdx: number,
  currIdx: number,
  cycle: number,
  prevStage: number,
  currStage: number
): ForwardingInfo | null {
  if (currStage !== 2) return null; // Solo forwardear a EX

  const prev = decodeInstruction(prevHex);
  const curr = decodeInstruction(currHex);

  // Obtener el registro destino de la instrucción anterior
  let prevDest: number | null = null;
  if (prev.type === "R") prevDest = prev.rd;
  else if (prev.opcode === 0x23) prevDest = prev.rt; // lw
  else if (prev.opcode !== 0x2b) prevDest = prev.rt; // I-tipo con destino en rt

  // No hay destino, no hay forwarding
  if (prevDest === null) return null;

  // Ver qué registro fuente necesita forwarding
  let targetReg: "rs" | "rt" | null = null;
  
  if (curr.rs === prevDest) {
    targetReg = "rs";
  } else if (curr.type === "R" || curr.opcode === 0x2b) { // Solo forwardear a rt en instrucciones R o sw
    if (curr.rt === prevDest) {
      targetReg = "rt";
    }
  }

  if (targetReg === null) return null;

  // Ahora determinamos desde qué etapa forwardear
  let source: "EX" | "MEM" | null = null;
  
  // Si prev está en MEM (stage=3), forward desde MEM
  if (prevStage === 3) {
    source = "MEM";
  } 
  // Si prev está en EX (stage=2), forward desde EX (ALU a ALU)
  else if (prevStage === 2) {
    source = "EX";
  }

  // Caso especial: no hacer forward desde EX para operaciones de carga (lw)
  if (prev.opcode === 0x23 && source === "EX") {
    return null; // Las cargas (lw) necesitan un stall, no se puede forwardear desde EX
  }

  if (source !== null) {
    return {
      from: prevIdx,
      to: currIdx,
      source,
      target: targetReg,
      cycle
    };
  }

  return null;
}

// --------------- Núcleo de simulación ---------------
const calculateNextState = (state: SimulationState): SimulationState => {
  if (!state.isRunning || state.isFinished) return state;

  const nextCycle = state.currentCycle + 1;
  const newStages: Record<number, number | null> = {};
  let stalled = false;
  const newForwardingPaths = [...state.forwardingPaths];

  // Primera pasada: detectar hazards y determinar posibles forwardings
  for (let i = 0; i < state.instructions.length; i++) {
    const stageIndex = nextCycle - i - 1; // etapa teórica

    // Si estamos en modo forwarding, intentamos resolverlo
    if (state.mode === "forwarding" && i > 0) {
      // La instrucción actual está en EX
      if (stageIndex === 2 || state.instructionStages[i] === 2) {
        // Buscar instrucciones anteriores que podrían forwardear
        for (let j = 0; j < i; j++) {
          const prevStage = state.instructionStages[j];
          if (prevStage !== 2 && prevStage !== 3) continue; // Solo considerar instrucciones en EX o MEM
          
          const hazard = hasDataHazard(state.instructions[j], state.instructions[i]);
          if (hazard) {
            const fwInfo = checkForwarding(
              state.instructions[j], 
              state.instructions[i], 
              j, i, nextCycle, 
              prevStage, 
              stageIndex
            );
            
            if (fwInfo) {
              // Si ya existe un forwarding para esta instrucción/ciclo, no duplicar
              const exists = newForwardingPaths.some(
                path => path.to === fwInfo.to && 
                       path.cycle === fwInfo.cycle && 
                       path.target === fwInfo.target
              );
              if (!exists) {
                newForwardingPaths.push(fwInfo);
              }
              // Hazard resuelto mediante forwarding
              continue;
            }
          }
        }
      }
    }

    /* ---------- Stall para cargas (incluso en modo forwarding) ---------- */
    if ((state.mode === "stall" || state.mode === "forwarding") && i > 0) {
      const prevInstr = decodeInstruction(state.instructions[i - 1]);
      
      if (prevInstr.opcode === 0x23) { // Es una instrucción lw
        const currStage = state.instructionStages[i];
        const prevStage = state.instructionStages[i - 1];

        if (prevStage === 2 && currStage === 1 && hasDataHazard(state.instructions[i - 1], state.instructions[i])) {
          stalled = true;
          newStages[i] = currStage; // Se queda en ID
          continue;
        }
      }
    }

    /* ---------- Stall normal en modo stall ---------- */
    if (state.mode === "stall" && i > 0 && stageIndex === 1) {
      for (let j = 0; j < i; j++) {
        const prevStage = state.instructionStages[j];
        const currStage = state.instructionStages[i];

        const hazard = hasDataHazard(state.instructions[j], state.instructions[i]);

        if (prevStage === 2 && currStage === 1 && hazard) {
          stalled = true;
          newStages[i] = currStage;
          break;
        }
      }
      if (stalled) continue;
    }

    // Avance normal
    if (stageIndex >= 0 && stageIndex < state.stageCount)
      newStages[i] = stageIndex;
    else newStages[i] = null;
  }

  const finalCycle = stalled ? state.currentCycle : nextCycle;
  const completion = state.instructions.length + state.stageCount - 1;
  const finished = finalCycle > completion;

  return {
    ...state,
    currentCycle: finished ? completion : finalCycle,
    instructionStages: newStages,
    isRunning: !finished,
    isFinished: finished,
    forwardingPaths: newForwardingPaths
  };
};

// --------------- Provider ----------------
export function SimulationProvider({ children }: PropsWithChildren) {
  const [simState, setSimState] = React.useState<SimulationState>(initialState);
  const timer = React.useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const runClock = React.useCallback(() => {
    clearTimer();
    if (!simState.isRunning || simState.isFinished) return;

    timer.current = setInterval(() => {
      setSimState((prev) => calculateNextState(prev));
    }, 1000);
  }, [simState.isRunning, simState.isFinished]);

  /* ---------- Acciones ---------- */
  const setMode = (mode: SimulationState["mode"]) =>
    setSimState((p) => ({ ...p, mode, forwardingPaths: [] })); // Reiniciar paths al cambiar de modo

  const resetSimulation = () => {
    clearTimer();
    setSimState(initialState);
  };

  const startSimulation = (instrs: string[]) => {
    clearTimer();
    if (instrs.length === 0) return resetSimulation();

    const max = instrs.length + DEFAULT_STAGE_COUNT - 1;
    const initStages: Record<number, number | null> = {};
    instrs.forEach((_, idx) => {
      const s0 = 1 - idx - 1;
      initStages[idx] = s0 >= 0 && s0 < DEFAULT_STAGE_COUNT ? s0 : null;
    });

    setSimState((prev) => ({
      ...prev,
      instructions: instrs,
      currentCycle: 1,
      maxCycles: max,
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: initStages,
      isFinished: false,
      forwardingPaths: [], // Resetear paths de forwarding
    }));
  };

  const pauseSimulation = () =>
    setSimState((p) => {
      if (p.isRunning) clearTimer();
      return { ...p, isRunning: false };
    });

  const resumeSimulation = () =>
    setSimState((p) =>
      !p.isRunning && p.currentCycle > 0 && !p.isFinished
        ? { ...p, isRunning: true }
        : p
    );

  const nextCycle = () => {
    setSimState((prev) => {
      // Solo avanza si no está en el último ciclo y la simulación no está corriendo
      if (prev.currentCycle < prev.maxCycles && !prev.isRunning) {
        const next = prev.currentCycle + 1;
        // Calcular nuevo estado para ese ciclo
        const newStages = { ...prev.instructionStages };
        // Lógica para actualizar etapas según el nuevo ciclo
        for (let i = 0; i < prev.instructions.length; i++) {
          const stageIndex = next - i - 1;
          if (stageIndex >= 0 && stageIndex < prev.stageCount) {
            newStages[i] = stageIndex;
          } else {
            newStages[i] = null;
          }
        }
        
        return {
          ...prev,
          currentCycle: next,
          instructionStages: newStages,
          isFinished: next >= prev.maxCycles,
        };
      }
      return prev;
    });
  };

  const previousCycle = () => {
    setSimState((prev) => {
      // Solo retrocede si no está en el primer ciclo y no está corriendo
      if (prev.currentCycle > 1 && !prev.isRunning) {
        const previous = prev.currentCycle - 1;
        // Calcular nuevo estado para ese ciclo
        const newStages = { ...prev.instructionStages };
        // Lógica para actualizar etapas según el nuevo ciclo
        for (let i = 0; i < prev.instructions.length; i++) {
          const stageIndex = previous - i - 1;
          if (stageIndex >= 0 && stageIndex < prev.stageCount) {
            newStages[i] = stageIndex;
          } else {
            newStages[i] = null;
          }
        }
        
        return {
          ...prev,
          currentCycle: previous,
          instructionStages: newStages,
          isFinished: false,
        };
      }
      return prev;
    });
  };

  const goToCycle = (cycle: number) => {
    setSimState((prev) => {
      // Validar que el ciclo sea válido
      if (cycle >= 1 && cycle <= prev.maxCycles && !prev.isRunning) {
        // Calcular nuevo estado para ese ciclo
        const newStages = { ...prev.instructionStages };
        // Actualizar etapas para todas las instrucciones
        for (let i = 0; i < prev.instructions.length; i++) {
          const stageIndex = cycle - i - 1;
          if (stageIndex >= 0 && stageIndex < prev.stageCount) {
            newStages[i] = stageIndex;
          } else {
            newStages[i] = null;
          }
        }
        
        return {
          ...prev,
          currentCycle: cycle,
          instructionStages: newStages,
          isFinished: cycle >= prev.maxCycles,
        };
      }
      return prev;
    });
  };

  /* ---------- Reloj ---------- */
  React.useEffect(() => {
    if (simState.isRunning && !simState.isFinished) runClock();
    else clearTimer();
    return clearTimer;
  }, [simState.isRunning, simState.isFinished, runClock]);

  /* ---------- Context values ---------- */
  const stateValue = simState;
  const actionsValue = React.useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setMode,
      nextCycle,
      previousCycle,
      goToCycle,
    }),
    []
  );

  return (
    <SimulationStateContext.Provider value={stateValue}>
      <SimulationActionsContext.Provider value={actionsValue}>
        {children}
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

/* ---------- Hooks ---------- */
export const useSimulationState = () => {
  const ctx = React.useContext(SimulationStateContext);
  if (!ctx) throw new Error("useSimulationState fuera de proveedor");
  return ctx;
};

export const useSimulationActions = () => {
  const ctx = React.useContext(SimulationActionsContext);
  if (!ctx) throw new Error("useSimulationActions fuera de proveedor");
  return ctx;
};
