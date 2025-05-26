// src/context/SimulationContext.tsx
"use client";

import React, { createContext, useContext, useState, useRef, useCallback, ReactNode } from "react";

export type SimulationMode = "stall" | "forward";

export interface MipsInstruction {
  hex: string;
  mnemonic: string;
  type: "R" | "I" | "J" | "unknown";
  rs: number;
  rt: number;
  rd: number;
  shamt: number;
  funct: number;
  immediate: number;
  address: number;
}

export interface PipelineCell {
  stage: string | null;
  type: "normal" | "stall" | "forwardA" | "forwardB" | "load-use" | null;
  info?: string;
  cycle: number;
}

const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"];

interface SimulationState {
  instructions: string[];
  parsedInstructions: MipsInstruction[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  isFinished: boolean;
  mode: SimulationMode;
  pipelineMatrix: PipelineCell[][];
}

const initialState: SimulationState = {
  instructions: [],
  parsedInstructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: STAGE_NAMES.length,
  isFinished: false,
  mode: "stall",
  pipelineMatrix: [],
};

// --- PARSER DE INSTRUCCIONES MIPS ---
function parseHexInstruction(hex: string): MipsInstruction {
  const value = parseInt(hex, 16) >>> 0;
  const opcode = (value >>> 26) & 0x3f;
  const rs = (value >>> 21) & 0x1f;
  const rt = (value >>> 16) & 0x1f;
  const rd = (value >>> 11) & 0x1f;
  const shamt = (value >>> 6) & 0x1f;
  const funct = value & 0x3f;
  const immediate = value & 0xffff;
  const address = value & 0x3ffffff;

  const R_FUNCTS: Record<number, string> = {
    0x20: "add",
    0x22: "sub",
    0x24: "and",
    0x25: "or",
    0x2a: "slt",
  };

  const I_OPCODES: Record<number, string> = {
    0x23: "lw",
    0x2b: "sw",
    0x08: "addi",
    0x04: "beq",
    0x05: "bne",
  };

  const J_OPCODES: Record<number, string> = {
    0x02: "j",
  };

  let mnemonic = "unknown";
  let type: "R" | "I" | "J" | "unknown" = "unknown";

  if (opcode === 0x00 && R_FUNCTS[funct]) {
    mnemonic = R_FUNCTS[funct];
    type = "R";
  } else if (I_OPCODES[opcode]) {
    mnemonic = I_OPCODES[opcode];
    type = "I";
  } else if (J_OPCODES[opcode]) {
    mnemonic = J_OPCODES[opcode];
    type = "J";
  }

  return {
    hex,
    mnemonic,
    type,
    rs,
    rt,
    rd,
    shamt,
    funct,
    immediate,
    address,
  };
}

// Función para determinar si una instrucción escribe en un registro
function getRegWrite(instruction: MipsInstruction): boolean {
  if (instruction.type === "R") {
    return true; // Todas las instrucciones R escriben en rd
  } else if (instruction.type === "I") {
    // Solo lw y addi escriben en rt
    return ["lw", "addi"].includes(instruction.mnemonic);
  }
  return false;
}

// Función para obtener el registro destino de una instrucción
function getReg(instruction: MipsInstruction, regType: 'rs' | 'rt' | 'rd'): number {
  return instruction[regType];
}

// --- GENERA LA MATRIZ DEL PIPELINE CON HAZARDS Y FORWARDING POR CELDA ---
function buildPipelineMatrix(
  instructions: MipsInstruction[],
  mode: SimulationMode
): PipelineCell[][] {
  const n = instructions.length;
  const pipeline: PipelineCell[][] = [];
  const startCycles: number[] = [];
  let currStart = 1;

  // Primero calculamos los ciclos de inicio considerando stalls
  for (let i = 0; i < n; i++) {
    startCycles[i] = currStart ;
  
    // Verificamos si hay hazards que requieran stalls
    if (i > 0) {
      const prev = instructions[i - 1];
      const curr = instructions[i];
    
      // Registros fuente de la instrucción actual
      const currSrcs = [curr.rs, curr.rt].filter(r => r !== 0);
    
      // Registro destino de la instrucción anterior
      const prevDest = prev.type === "R" ? prev.rd : 
                      (prev.type === "I" && prev.mnemonic === "lw") ? prev.rt : 0;
    
      // Load-use hazard siempre requiere stall
      if (prev.mnemonic === "lw" && prevDest !== 0 && currSrcs.includes(prevDest)) {
        startCycles[i] += 1; // Añadir un ciclo de stall
      }
      // En modo stall, cualquier RAW hazard requiere stall
      else if (mode === "stall" && prevDest !== 0 && currSrcs.includes(prevDest)) {
        startCycles[i] += 1; // Añadir un ciclo de stall
      }
    }
  
    currStart = startCycles[i] + 1;
  }

  // Calculamos el total de ciclos
  let totalCycles = startCycles[n - 1] + STAGE_NAMES.length - 1;
  
  // Construimos la matriz del pipeline
  for (let i = 0; i < n; i++) {
    const row: PipelineCell[] = [];
    let currentStage = 0; // Comenzamos en la etapa IF
    
  
    for (let cycle = 0; cycle <= totalCycles; cycle++) {
      // Si aún no ha comenzado esta instrucción
      if (cycle < startCycles[i]) {
        row.push({ stage: null, type: null, cycle });
        continue;
      }
    
      // Si ya terminó esta instrucción
      if (currentStage >= STAGE_NAMES.length) {
        row.push({ stage: null, type: null, cycle });
        continue;
      }
    
      // Inicializa esto antes del bucle principal de ciclos (una sola vez)
const extraDelays = new Array(instructions.length).fill(0);

// Dentro del bucle que genera las etapas por ciclo e instrucción:
if (currentStage === 1) { // Estamos en ID
  const prev = i > 0 ? instructions[i - 1] : null;

  if (prev) {
    const prevDest = prev.type === "R" ? prev.rd :
                    (prev.type === "I" && prev.mnemonic === "lw") ? prev.rt : 0;

    const currSrcs = [instructions[i].rs, instructions[i].rt].filter(r => r !== 0);

    const expectedCycle = startCycles[i] + currentStage + extraDelays[i];

    // Load-use hazard
    if (prev.mnemonic === "lw" && prevDest !== 0 && currSrcs.includes(prevDest) &&
        cycle === expectedCycle) {

      row.push({
        stage: "Stall",
        type: "load-use",
        info: `Load-use hazard: r${prevDest}`,
        cycle
      });

      // Aumenta el delay de todas las instrucciones siguientes
      for (let j = i + 1; j < instructions.length; j++) {
        extraDelays[j] += 1;
      }
      totalCycles += 1; // Aumenta el total de ciclos por el stall
      continue; // No avanzamos al siguiente stage
    }

    // RAW hazard en modo stall
    else if (mode === "stall"  && prevDest !== 0 && currSrcs.includes(prevDest) &&
            cycle === expectedCycle) {

      row.push({
        stage: "Stall",
        type: "stall",
        info: `RAW hazard: r${prevDest}`,
        cycle
      });

      // Aumenta el delay de todas las instrucciones siguientes
      for (let j = i + 1; j < instructions.length; j++) {
        extraDelays[j] += 1;
      }
      totalCycles += 1; // Aumenta el total de ciclos por el stall
      continue; // No avanzamos al siguiente stage
    }
    else if (mode === "forward" && prevDest !== 0 && currSrcs.includes(prevDest) &&
            cycle === expectedCycle) {

      row.push({
        stage: "Stall",
        type: "stall",
        info: `RAW hazard: r${prevDest}`,
        cycle
      });

      // Aumenta el delay de todas las instrucciones siguientes
      for (let j = i + 1; j < instructions.length; j++) {
        extraDelays[j] += 1;
      }

      continue; // No avanzamos al siguiente stage
    }
  }
}

    
      // Verificamos forwarding en EX usando el algoritmo proporcionado
      let forwardA: string | null = null;
      let forwardB: string | null = null;
    
      if (mode === "forward" && currentStage === 2) { // Estamos en EX
        const idEx = instructions[i]; // Instrucción actual en EX
      
        // Instrucción en EX/MEM (una instrucción atrás)
        const exMem = i > 0 ? instructions[i - 1] : null;
      
        // Instrucción en MEM/WB (dos instrucciones atrás)
        const memWb = i > 1 ? instructions[i - 2] : null;
      
        // EX Hazard - Forwarding desde EX/MEM
        if (
          exMem && 
          getRegWrite(exMem) && 
          (exMem.type === "R" ? exMem.rd : exMem.rt) !== 0 && 
          (
            (exMem.type === "R" ? exMem.rd : exMem.rt) === idEx.rs || 
            (exMem.type === "R" ? exMem.rd : exMem.rt) === idEx.rt
          )
        ) {
          const destReg = exMem.type === "R" ? exMem.rd : exMem.rt;
        
          // ForwardA: cuando el registro rs coincide con el destino en EX/MEM
          if (destReg === idEx.rs) {
            forwardA = `ForwardA (EX/MEM): r${destReg}`;
          }
        
          // ForwardB: cuando el registro rt coincide con el destino en EX/MEM
          if (destReg === idEx.rt && idEx.rt !== 0) {
            forwardB = `ForwardB (EX/MEM): r${destReg}`;
          }
        }
      
        // MEM Hazard - Forwarding desde MEM/WB
        if (
          memWb && 
          getRegWrite(memWb) && 
          (memWb.type === "R" ? memWb.rd : memWb.rt) !== 0 && 
          (
            (
              (!exMem || (exMem.type === "R" ? exMem.rd : exMem.rt) !== idEx.rs) && 
              (memWb.type === "R" ? memWb.rd : memWb.rt) === idEx.rs
            ) || 
            (
              (!exMem || (exMem.type === "R" ? exMem.rd : exMem.rt) !== idEx.rt) && 
              (memWb.type === "R" ? memWb.rd : memWb.rt) === idEx.rt && 
              idEx.rt !== 0
            )
          )
        ) {
          const destReg = memWb.type === "R" ? memWb.rd : memWb.rt;
        
          // ForwardA: cuando el registro rs coincide con el destino en MEM/WB
          // y no hay ya un forwarding desde EX/MEM
          if (!forwardA && destReg === idEx.rs) {
            forwardA = `ForwardA (MEM/WB): r${destReg}`;
          }
        
          // ForwardB: cuando el registro rt coincide con el destino en MEM/WB
          // y no hay ya un forwarding desde EX/MEM
          if (!forwardB && destReg === idEx.rt && idEx.rt !== 0) {
            forwardB = `ForwardB (MEM/WB): r${destReg}`;
          }
        }
      }
    
      // Determinamos el tipo de forwarding a mostrar (priorizamos ForwardA si hay ambos)
      let forwardType: "forwardA" | "forwardB" | null = null;
      let forwardInfo = "";
    
      if (forwardA) {
        forwardType = "forwardA";
        forwardInfo = forwardA;
        if (forwardB) {
          forwardInfo += `, ${forwardB}`;
        }
      } else if (forwardB) {
        forwardType = "forwardB";
        forwardInfo = forwardB;
      }
    
      // Añadimos la celda normal o con forwarding
      row.push({
        stage: STAGE_NAMES[currentStage],
        type: forwardType || "normal",
        info: forwardInfo,
        cycle
      });
    
      currentStage++; // Avanzamos al siguiente stage
    }
  
    pipeline.push(row);
  }

  return pipeline;
}

const SimulationContext = createContext<any>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [simulationState, setSimulationState] = useState<SimulationState>(initialState);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const setMode = (mode: SimulationMode) => {
    setSimulationState((prev) => ({
      ...prev,
      mode,
    }));
  };

  const setInstructions = (instructions: string[]) => {
    setSimulationState((prev) => ({
      ...prev,
      instructions,
    }));
  };

  const resetSimulation = useCallback(() => {
    clearTimer();
    setSimulationState(initialState);
  }, []);

  const startSimulation = useCallback(
    (submittedInstructions: string[]) => {
      clearTimer();
      if (submittedInstructions.length === 0) {
        resetSimulation();
        return;
      }
      try {
        const parsedInstructions = submittedInstructions.map(parseHexInstruction);
        const pipelineMatrix = buildPipelineMatrix(parsedInstructions, simulationState.mode);
        // El número de ciclos es el máximo ciclo de cualquier celda con stage no null
        let maxCycles = 0;
        pipelineMatrix.forEach(row => {
          row.forEach(cell => {
            if (cell.stage && cell.cycle > maxCycles) maxCycles = cell.cycle;
          });
        });
        setSimulationState({
          instructions: submittedInstructions,
          parsedInstructions,
          currentCycle: 1,
          maxCycles,
          isRunning: true,
          stageCount: STAGE_NAMES.length,
          isFinished: false,
          mode: simulationState.mode,
          pipelineMatrix,
        });
      } catch (error) {
        console.error("Error starting simulation:", error);
        resetSimulation();
      }
    },
    [resetSimulation, simulationState.mode]
  );

  const nextCycle = useCallback(() => {
    setSimulationState((prev) => {
      if (prev.isFinished || !prev.isRunning) return prev;
      const nextCycle = prev.currentCycle + 1;
      if (nextCycle > prev.maxCycles) {
        clearTimer();
        return { ...prev, isFinished: true, isRunning: false };
      }
      return { ...prev, currentCycle: nextCycle };
    });
  }, []);

  const prevCycle = useCallback(() => {
    setSimulationState((prev) => {
      if (prev.currentCycle <= 1) return prev;
      return { ...prev, currentCycle: prev.currentCycle - 1 };
    });
  }, []);

  const pauseSimulation = useCallback(() => {
    clearTimer();
    setSimulationState((prev) => ({
      ...prev,
      isRunning: false,
    }));
  }, []);

  const resumeSimulation = useCallback(() => {
    setSimulationState((prev) => ({
      ...prev,
      isRunning: true,
    }));
  }, []);

  // Auto-advance simulation if running
  React.useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      timerRef.current = setTimeout(() => {
        nextCycle();
      }, 1000);
    }
    return () => clearTimer();
    // eslint-disable-next-line
  }, [simulationState.isRunning, simulationState.currentCycle, simulationState.isFinished]);

  const value = {
    ...simulationState,
    setMode,
    startSimulation,
    nextCycle,
    prevCycle,
    pauseSimulation,
    resumeSimulation,
    resetSimulation,
    setInstructions,
  };

  return (
    <SimulationContext.Provider value={value}>
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulationState() {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error("useSimulationState must be used within a SimulationProvider");
  }
  return context;
}

export function useSimulationActions() {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error("useSimulationActions must be used within a SimulationProvider");
  }
  const {
    setMode,
    startSimulation,
    nextCycle,
    prevCycle,
    pauseSimulation,
    resumeSimulation,
    resetSimulation,
    setInstructions,
  } = context;
  return {
    setMode,
    startSimulation,
    nextCycle,
    prevCycle,
    pauseSimulation,
    resumeSimulation,
    resetSimulation,
    setInstructions,
  };
}