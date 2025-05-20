// src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from "react";
import * as React from "react";

// --------------- Constantes y tipos ---------------
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
  mode: "normal" | "stall" | "forwarding";
}

interface SimulationActions {
  startSimulation: (submitted: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setMode: (m: "normal" | "stall" | "forwarding") => void;
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
};

// --------------- Utilidades ----------------

// Devuelve true si la instrucción curr depende de un registro escrito por prev
function hasDataHazard(prevHex: string, currHex: string): boolean {
  // Función auxiliar: extrae rs / rt / rd
  const decode = (hex: string) => {
    const instr = parseInt(hex, 16);
    const opcode = (instr >>> 26) & 0x3f; // 6 bits altos

    if (opcode === 0x00) {
      // Tipo R
      return {
        type: "R" as const,
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
  };

  const prev = decode(prevHex);
  const curr = decode(currHex);

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

// --------------- Núcleo de simulación ---------------
const calculateNextState = (state: SimulationState): SimulationState => {
  if (!state.isRunning || state.isFinished) return state;

  const nextCycle = state.currentCycle + 1;
  const newStages: Record<number, number | null> = {};
  let stalled = false;

  for (let i = 0; i < state.instructions.length; i++) {
    const stageIndex = nextCycle - i - 1; // etapa teórica

    /* ---------- Stall por dependencia con instrucción inmediatamente anterior ---------- */
    if (
      state.mode === "stall" &&
      i > 0 &&
      stageIndex === 1 && // la i-ésima va a ID
      hasDataHazard(state.instructions[i - 1], state.instructions[i])
    ) {
      const prevStage = state.instructionStages[i - 1];
      const currStage = state.instructionStages[i];

      if (prevStage === 2 && currStage === 1) {
        stalled = true;
        newStages[i] = currStage; // se queda en ID
        continue;
      }
    }

    /* ---------- Stall opcional para dependencias con cualquiera de las anteriores ---------- */
    if (state.mode === "stall") {
      for (let j = 0; j < i; j++) {
        const prevStage = state.instructionStages[j];
        const currStage = state.instructionStages[i];

        const hazard = hasDataHazard(
          state.instructions[j],
          state.instructions[i]
        );

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
    setSimState((p) => ({ ...p, mode }));

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
