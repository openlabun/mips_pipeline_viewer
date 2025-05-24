// src/context/SimulationContext.tsx
"use client"; // Add 'use client' directive

import type { PropsWithChildren } from 'react';
import * as React from 'react';

// Define the stage names
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];
type PipelineStage = "IF" | "ID" | "EX" | "MEM" | "WB" | "STALL" | "";

// Define stall handling options
type StallHandling = 'default' | 'stall';

// Interfaces for instruction analysis
interface InstructionMeta {
    type: "R" | "I" | "J";
    raw: string;
    opcode: string;
    name: string;
    readsFrom: string[];
    writesTo?: string;
    rs?: string;
    rt?: string;
    rd?: string;
}

// Define the shape of the context state
interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  // Map instruction index to its current stage index (0-based) or null if not started/finished
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
  stallHandling: StallHandling;
  stalledInstructions: Set<number>;
  stallHistory: Array<{ cycle: number, instruction: number, reason: string }>;
  // New: Store the complete pipeline simulation result
  pipelineMatrix: PipelineStage[][];
  analyzedInstructions: InstructionMeta[];
}

// Define the shape of the context actions
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setStallHandling: (handling: StallHandling) => void;
}

// Create the contexts
const SimulationStateContext = React.createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = React.createContext<SimulationActions | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

const initialState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,
  stallHandling: 'stall', //aqui se cambia el valor
  stalledInstructions: new Set(),
  stallHistory: [],
  pipelineMatrix: [],
  analyzedInstructions: [],
};

// Utility functions for instruction analysis
function hexToBinary(hex: string): string {
    return parseInt(hex, 16).toString(2).padStart(32, '0');
}

function analyzeInstruction(hex: string): InstructionMeta {
    const binary = hexToBinary(hex);
    const opcode = binary.slice(0, 6);

    const opcodeMap = {
        "001000": "addi",
        "001001": "addiu",
        "001100": "andi",
        "000100": "beq",
        "000101": "bne",
        "000010": "j",
        "000011": "jal",
        "100100": "lbu",
        "100101": "lhu",
        "110000": "ll",
        "001111": "lui",
        "100011": "lw",
        "001101": "ori",
        "001010": "slti",
        "001011": "sltiu",
        "101000": "sb",
        "111000": "sc",
        "101001": "sh",
        "101011": "sw",
        "000000": "R"
    };

    const funcMap = {
        "100000": "add",
        "100001": "addu",
        "100100": "and",
        "001000": "jr",
        "100111": "nor",
        "100101": "or",
        "101010": "slt",
        "101011": "sltu",
        "000000": "sll",
        "000010": "srl",
        "100010": "sub",
        "100011": "subu"
    };

    const regMap = {
        "00000": "zero", "00001": "at", "00010": "v0", "00011": "v1",
        "00100": "a0", "00101": "a1", "00110": "a2", "00111": "a3",
        "01000": "t0", "01001": "t1", "01010": "t2", "01011": "t3",
        "01100": "t4", "01101": "t5", "01110": "t6", "01111": "t7",
        "10000": "s0", "10001": "s1", "10010": "s2", "10011": "s3",
        "10100": "s4", "10101": "s5", "10110": "s6", "10111": "s7",
        "11000": "t8", "11001": "t9", "11010": "k0", "11011": "k1",
        "11100": "gp", "11101": "sp", "11110": "fp", "11111": "ra"
    };

    const meta: InstructionMeta = {
        type: "I",
        raw: hex,
        opcode,
        name: "",
        readsFrom: [],
    };

    const name = opcodeMap[opcode as keyof typeof opcodeMap] || "unknown";
    meta.name = name;

    if (opcode === "000000") {
        // R-type
        meta.type = "R";
        const rsBin = binary.slice(6, 11);
        const rtBin = binary.slice(11, 16);
        const rdBin = binary.slice(16, 21);
        const shamt = binary.slice(21, 26);
        const func = binary.slice(26, 32);
        const funcName = funcMap[func as keyof typeof funcMap] || "unknown";
        meta.name = funcName;

        const rs = regMap[rsBin as keyof typeof regMap];
        const rt = regMap[rtBin as keyof typeof regMap];
        const rd = regMap[rdBin as keyof typeof regMap];

        meta.rs = rs;
        meta.rt = rt;
        meta.rd = rd;

        if (funcName === "sll" || funcName === "srl") {
            meta.readsFrom = [rt];
        } else if (funcName === "jr") {
            meta.readsFrom = [rs];
        } else {
            meta.readsFrom = [rs, rt];
        }

        if (funcName !== "jr") {
            meta.writesTo = rd;
        }
    } else if (["lw", "lbu", "lhu", "ll"].includes(name)) {
        const rs = regMap[binary.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rs = rs;
        meta.rt = rt;
        meta.readsFrom = [rs];
        meta.writesTo = rt;
    } else if (["sw", "sb", "sh", "sc"].includes(name)) {
        const rs = regMap[binary.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rs = rs;
        meta.rt = rt;
        meta.readsFrom = [rs, rt];
    } else if (["beq", "bne"].includes(name)) {
        const rs = regMap[binary.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rs = rs;
        meta.rt = rt;
        meta.readsFrom = [rs, rt];
    } else if (["addi", "addiu", "andi", "ori", "slti", "sltiu"].includes(name)) {
        const rs = regMap[binary.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rs = rs;
        meta.rt = rt;
        meta.readsFrom = [rs];
        meta.writesTo = rt;
    } else if (name === "lui") {
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rt = rt;
        meta.readsFrom = [];
        meta.writesTo = rt;
    }

    return meta;
}

function simulatePipelineWithStall(hexInstructions: string[]): PipelineStage[][] {
    const STAGES: PipelineStage[] = ["IF", "ID", "EX", "MEM", "WB"];
    const n = hexInstructions.length;
    const analyzed = hexInstructions.map(analyzeInstruction);

    // Calcula el máximo de ciclos posible (instrucciones + etapas + stalls)
    let maxCycles = n + STAGES.length + 10; // margen extra

    // Inicializa la matriz de pipeline
    const pipeline: PipelineStage[][] = Array.from({ length: n }, () =>
        Array(maxCycles).fill("")
    );

    // Lleva el ciclo de inicio de cada instrucción
    const startCycles: number[] = [];

    let currentCycle = 0;
    for (let i = 0; i < n; i++) {
        // Determina el ciclo de inicio considerando stalls por dependencias
        let stall = 0;
        if (i > 0) {
            for (let j = 0; j < i; j++) {
                // ¿Hay dependencia RAW?
                const prev = analyzed[j];
                const curr = analyzed[i];
                if (
                    prev.writesTo &&
                    curr.readsFrom.includes(prev.writesTo)
                ) {
                    // ¿Cuándo estará disponible el registro?
                    const prevStart = startCycles[j];
                    const writeStage = prev.name === "lw" ? 3 : 4; // MEM o WB (0-indexed: 3 o 4)
                    const availableCycle = prevStart + writeStage;
                    const neededCycle = currentCycle + 1; // La instrucción lo necesita en ID
                    if (neededCycle < availableCycle) {
                        stall = Math.max(stall, availableCycle - neededCycle);
                    }
                }
            }
        }
        
        // Agregar stalls antes de empezar la instrucción
        for (let s = 0; s < stall; s++) {
            pipeline[i][currentCycle + s] = "STALL";
        }
        
        currentCycle += stall;
        startCycles.push(currentCycle);

        // Rellena la matriz con las etapas
        for (let stageIdx = 0; stageIdx < STAGES.length; stageIdx++) {
            pipeline[i][currentCycle + stageIdx] = STAGES[stageIdx];
        }
        
        currentCycle++; // La siguiente instrucción entra al siguiente ciclo
    }

    // Recorta las columnas vacías al final
    let lastUsed = 0;
    for (let i = 0; i < n; i++) {
        for (let c = pipeline[i].length - 1; c >= 0; c--) {
            if (pipeline[i][c] !== "") {
                lastUsed = Math.max(lastUsed, c);
                break;
            }
        }
    }
    
    // Devuelve solo las columnas necesarias
    return pipeline.map(row => row.slice(0, lastUsed + 1));
}

// Function to get current stage of instruction based on pipeline matrix
function getCurrentStageFromMatrix(
    pipelineMatrix: PipelineStage[][], 
    instructionIndex: number, 
    currentCycle: number
): number | null {
    if (!pipelineMatrix[instructionIndex] || currentCycle < 0) return null;
    
    const stage = pipelineMatrix[instructionIndex][currentCycle];
    if (!stage || stage === "STALL") return null;
    
    const stageIndex = STAGE_NAMES.indexOf(stage as StageName);
    return stageIndex >= 0 ? stageIndex : null;
}

// Function to check if instruction is stalled
function isInstructionStalled(
    pipelineMatrix: PipelineStage[][], 
    instructionIndex: number, 
    currentCycle: number
): boolean {
    if (!pipelineMatrix[instructionIndex] || currentCycle < 0) return false;
    return pipelineMatrix[instructionIndex][currentCycle] === "STALL";
}

// Function to calculate the next state based on the current state
const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  const newStalledInstructions = new Set<number>();
  const newStallHistory = [...currentState.stallHistory];
  let activeInstructions = 0;

  if (currentState.stallHandling === 'default') {
    // Original logic for default mode
    currentState.instructions.forEach((_, index) => {
      const stageIndex = nextCycle - index - 1;
      if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
        newInstructionStages[index] = stageIndex;
        activeInstructions++;
      } else {
        newInstructionStages[index] = null;
      }
    });
  } else {
    // Use pipeline matrix for stall mode
    currentState.instructions.forEach((_, index) => {
      if (currentState.pipelineMatrix.length > 0) {
        const stage = getCurrentStageFromMatrix(currentState.pipelineMatrix, index, nextCycle - 1);
        newInstructionStages[index] = stage;
        
        if (stage !== null) {
          activeInstructions++;
        }
        
        // Check if instruction is stalled
        if (isInstructionStalled(currentState.pipelineMatrix, index, nextCycle - 1)) {
          newStalledInstructions.add(index);
          newStallHistory.push({
            cycle: nextCycle,
            instruction: index,
            reason: `Data hazard detected`
          });
        }
      } else {
        // Fallback to default behavior if no pipeline matrix
        const stageIndex = nextCycle - index - 1;
        if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
          newInstructionStages[index] = stageIndex;
          activeInstructions++;
        } else {
          newInstructionStages[index] = null;
        }
      }
    });
  }

  // Calculate completion
  let completionCycle = currentState.maxCycles;
  if (currentState.stallHandling === 'stall' && currentState.pipelineMatrix.length > 0) {
    // Use the actual pipeline matrix length to determine completion
    completionCycle = currentState.pipelineMatrix[0]?.length || currentState.maxCycles;
  }

  const isFinished = nextCycle > completionCycle || activeInstructions === 0;
  const isRunning = !isFinished;

  return {
    ...currentState,
    currentCycle: nextCycle,
    instructionStages: newInstructionStages,
    isRunning: isRunning,
    isFinished: isFinished,
    stalledInstructions: newStalledInstructions,
    stallHistory: newStallHistory,
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

  const resetSimulation = React.useCallback(() => {
    clearTimer();
    setSimulationState({
      ...initialState,
      stallHandling: simulationState.stallHandling,
    });
  }, [simulationState.stallHandling]);

  const startSimulation = React.useCallback((submittedInstructions: string[]) => {
    clearTimer();
    if (submittedInstructions.length === 0) {
      resetSimulation();
      return;
    }

    let pipelineMatrix: PipelineStage[][] = [];
    let analyzedInstructions: InstructionMeta[] = [];
    let calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1;
    
    // Check if instructions are hex (for pipeline simulation with stalls)
    const areHexInstructions = submittedInstructions.every(instr => 
      /^[0-9A-Fa-f]{8}$/.test(instr.trim())
    );

    if (areHexInstructions && simulationState.stallHandling === 'stall') {
      try {
        pipelineMatrix = simulatePipelineWithStall(submittedInstructions);
        analyzedInstructions = submittedInstructions.map(analyzeInstruction);
        calculatedMaxCycles = pipelineMatrix[0]?.length || calculatedMaxCycles;
      } catch (error) {
        console.warn('Error analyzing hex instructions, falling back to default simulation:', error);
      }
    }

    const initialStages: Record<number, number | null> = {};
    
    // Initialize stages for cycle 1
    if (simulationState.stallHandling === 'stall' && pipelineMatrix.length > 0) {
      // Use pipeline matrix for initial state
      submittedInstructions.forEach((_, index) => {
        const stage = getCurrentStageFromMatrix(pipelineMatrix, index, 0);
        initialStages[index] = stage;
      });
    } else {
      // Default initialization
      submittedInstructions.forEach((_, index) => {
          const stageIndex = 1 - index - 1;
          if (stageIndex >= 0 && stageIndex < DEFAULT_STAGE_COUNT) {
              initialStages[index] = stageIndex;
          } else {
              initialStages[index] = null;
          }
      });
    }

    setSimulationState(prevState => ({
      ...prevState,
      instructions: submittedInstructions,
      currentCycle: 1,
      maxCycles: calculatedMaxCycles,
      isRunning: true,
      stageCount: DEFAULT_STAGE_COUNT,
      instructionStages: initialStages,
      isFinished: false,
      stalledInstructions: new Set(),
      stallHistory: [],
      pipelineMatrix,
      analyzedInstructions,
    }));
  }, [resetSimulation, simulationState.stallHandling]);

   const pauseSimulation = React.useCallback(() => {
     setSimulationState((prevState) => {
       if (prevState.isRunning) {
         clearTimer();
         return { ...prevState, isRunning: false };
       }
       return prevState;
     });
   }, []);

  const resumeSimulation = React.useCallback(() => {
     setSimulationState((prevState) => {
        if (!prevState.isRunning && prevState.currentCycle > 0 && !prevState.isFinished) {
            return { ...prevState, isRunning: true };
        }
        return prevState;
     });
   }, []);

  const setStallHandling = React.useCallback((handling: StallHandling) => {
    setSimulationState((prevState) => ({
      ...prevState,
      stallHandling: handling,
      stalledInstructions: new Set(),
      stallHistory: handling === 'default' ? [] : prevState.stallHistory,
      pipelineMatrix: handling === 'default' ? [] : prevState.pipelineMatrix,
    }));
  }, []);


  // Effect to manage the interval timer based on isRunning state
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
      setStallHandling,
    }),
    [startSimulation, resetSimulation, pauseSimulation, resumeSimulation, setStallHandling]
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

// Additional helper hooks for stall-specific functionality
export function useStallInformation() {
  const state = useSimulationState();
  
  return React.useMemo(() => ({
    isStallEnabled: state.stallHandling === 'stall',
    stalledInstructions: Array.from(state.stalledInstructions),
    stallHistory: state.stallHistory,
    hasActiveStalls: state.stalledInstructions.size > 0,
    pipelineMatrix: state.pipelineMatrix,
    analyzedInstructions: state.analyzedInstructions,
  }), [
    state.stallHandling, 
    state.stalledInstructions, 
    state.stallHistory, 
    state.pipelineMatrix,
    state.analyzedInstructions
  ]);
}