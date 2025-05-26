// src/context/SimulationContext.tsx
"use client";

import type { PropsWithChildren } from 'react';
import * as React from 'react';

// Define the stage names
const STAGE_NAMES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;
type StageName = typeof STAGE_NAMES[number];
type PipelineStage = "IF" | "ID" | "EX" | "MEM" | "WB" | "STALL" | "FORWARD" | "";

// Define stall handling options
type StallHandling = 'default' | 'stall' | 'forward';

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
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
  stallHandling: StallHandling;
  stalledInstructions: Set<number>;
  forwardedInstructions: Set<number>;
  stallHistory: Array<{ cycle: number, instruction: number, reason: string }>;
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
  stallHandling: 'forward',
  stalledInstructions: new Set(),
  forwardedInstructions: new Set(),
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

function simulatePipelineWithStall(hexInstructions: string[], stallHandling: StallHandling): PipelineStage[][] {
    const STAGES: PipelineStage[] = ["IF", "ID", "EX", "MEM", "WB"];
    const n = hexInstructions.length;
    let mats: PipelineStage[][] = Array(n).fill(null).map(() => []);
    let currentState: {[key: string]: string} = {"IF": "", "ID": "", "EX": "", "MEM": "", "WB": ""};
    const analyzed = hexInstructions.map(analyzeInstruction);

    let cycle = 0;
    let inst = 0;
    
    while (true) {
        let isStall = false;
        let isForward = false;

        // Check for hazards
        if (currentState["ID"] !== "" && currentState["EX"] !== "") {
            const ID = analyzed[Number(currentState["ID"])].readsFrom;
            const EX = analyzed[Number(currentState["EX"])].writesTo;
            
            if (EX && ID.includes(EX)) {
                if (stallHandling === 'forward') {
                    const isEXLoadStore = ["lw", "sw", "lb", "sb", "lh", "sh"].includes(
                        analyzed[Number(currentState["EX"])].name
                    );
                    if (isEXLoadStore) {
                        isStall = true;
                    } else {
                        isForward = true;
                    }
                } else {
                    isStall = true;
                }
            }
        }

        if (currentState["ID"] !== "" && currentState["MEM"] !== "") {
            const ID = analyzed[Number(currentState["ID"])].readsFrom;
            const MEM = analyzed[Number(currentState["MEM"])].writesTo;
            
            if (MEM && ID.includes(MEM)) {
                if (stallHandling === 'forward') {
                    const isMEMLoadStore = ["lw", "sw", "lb", "sb", "lh", "sh"].includes(
                        analyzed[Number(currentState["MEM"])].name
                    );
                    if (isMEMLoadStore) {
                        isStall = true;
                    } else {
                        isForward = true;
                    }
                } else {
                    isStall = true;
                }
            }
        }

        // Advance pipeline
        if (!isStall) {
            for (let i = STAGES.length - 1; i >= 0; i--) {
                if (i === 0) {
                    currentState[STAGES[i]] = inst < n ? String(inst++) : "";
                } else {
                    currentState[STAGES[i]] = currentState[STAGES[i-1]];
                }
            }
        } else {
            // Stall - only EX, MEM, WB advance
            currentState["WB"] = currentState["MEM"];
            currentState["MEM"] = currentState["EX"];
            currentState["EX"] = "";
        }

        // Update matrix
        for (let i = 0; i < n; i++) {
            let stage: PipelineStage = "";
            for (const [pipeStage, pipeInst] of Object.entries(currentState)) {
                if (pipeInst === String(i)) {
                    if (isStall && (pipeStage === "IF" || pipeStage === "ID")) {
                        stage = "STALL";
                    } else if (isForward && pipeStage === "ID") {
                        stage = "FORWARD";
                    } else {
                        stage = pipeStage as PipelineStage;
                    }
                }
            }
            mats[i].push(stage);
        }

        if (currentState["WB"] === String(n - 1)) break;
        cycle++;
    }

    return mats;
}

function getCurrentStageFromMatrix(
    pipelineMatrix: PipelineStage[][], 
    instructionIndex: number, 
    currentCycle: number
): number | null {
    if (!pipelineMatrix[instructionIndex] || currentCycle < 0) return null;
    
    const stage = pipelineMatrix[instructionIndex][currentCycle];
    if (!stage || stage === "STALL" || stage === "FORWARD") return null;
    
    const stageIndex = STAGE_NAMES.indexOf(stage as StageName);
    return stageIndex >= 0 ? stageIndex : null;
}

function isInstructionStalled(
    pipelineMatrix: PipelineStage[][], 
    instructionIndex: number, 
    currentCycle: number
): boolean {
    if (!pipelineMatrix[instructionIndex] || currentCycle < 0) return false;
    return pipelineMatrix[instructionIndex][currentCycle] === "STALL";
}

function isInstructionForwarded(
    pipelineMatrix: PipelineStage[][], 
    instructionIndex: number, 
    currentCycle: number
): boolean {
    if (!pipelineMatrix[instructionIndex] || currentCycle < 0) return false;
    return pipelineMatrix[instructionIndex][currentCycle] === "FORWARD";
}

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  const newStalledInstructions = new Set<number>();
  const newForwardedInstructions = new Set<number>();
  const newStallHistory = [...currentState.stallHistory];
  let activeInstructions = 0;

  if (currentState.stallHandling === 'default') {
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
    currentState.instructions.forEach((_, index) => {
      if (currentState.pipelineMatrix.length > 0) {
        const stage = getCurrentStageFromMatrix(currentState.pipelineMatrix, index, nextCycle - 1);
        newInstructionStages[index] = stage;
        
        if (stage !== null) {
          activeInstructions++;
        }
        
        if (isInstructionStalled(currentState.pipelineMatrix, index, nextCycle - 1)) {
          newStalledInstructions.add(index);
          newStallHistory.push({
            cycle: nextCycle,
            instruction: index,
            reason: "Data hazard detected (load/store dependency)"
          });
        } else if (isInstructionForwarded(currentState.pipelineMatrix, index, nextCycle - 1)) {
          newForwardedInstructions.add(index);
        }
      } else {
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

  let completionCycle = currentState.maxCycles;
  if ((currentState.stallHandling === 'stall' || currentState.stallHandling === 'forward') && 
      currentState.pipelineMatrix.length > 0) {
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
    forwardedInstructions: newForwardedInstructions,
    stallHistory: newStallHistory,
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
    
    const areHexInstructions = submittedInstructions.every(instr => 
      /^[0-9A-Fa-f]{8}$/.test(instr.trim())
    );

    if (areHexInstructions && (simulationState.stallHandling === 'stall' || simulationState.stallHandling === 'forward')) {
      try {
        pipelineMatrix = simulatePipelineWithStall(submittedInstructions, simulationState.stallHandling);
        analyzedInstructions = submittedInstructions.map(analyzeInstruction);
        calculatedMaxCycles = pipelineMatrix[0]?.length || calculatedMaxCycles;
      } catch (error) {
        console.warn('Error analyzing hex instructions, falling back to default simulation:', error);
      }
    }

    const initialStages: Record<number, number | null> = {};
    
    if ((simulationState.stallHandling === 'stall' || simulationState.stallHandling === 'forward') && pipelineMatrix.length > 0) {
      submittedInstructions.forEach((_, index) => {
        const stage = getCurrentStageFromMatrix(pipelineMatrix, index, 0);
        initialStages[index] = stage;
      });
    } else {
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
      forwardedInstructions: new Set(),
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
      forwardedInstructions: new Set(),
      stallHistory: handling === 'default' ? [] : prevState.stallHistory,
      pipelineMatrix: handling === 'default' ? [] : prevState.pipelineMatrix,
    }));
  }, []);

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

export function useStallInformation() {
  const state = useSimulationState();
  
  return React.useMemo(() => ({
    isStallEnabled: state.stallHandling === 'stall',
    isForwardEnabled: state.stallHandling === 'forward',
    stalledInstructions: Array.from(state.stalledInstructions),
    forwardedInstructions: Array.from(state.forwardedInstructions),
    stallHistory: state.stallHistory,
    hasActiveStalls: state.stalledInstructions.size > 0,
    hasActiveForwards: state.forwardedInstructions.size > 0,
    pipelineMatrix: state.pipelineMatrix,
    analyzedInstructions: state.analyzedInstructions,
  }), [
    state.stallHandling, 
    state.stalledInstructions,
    state.forwardedInstructions,
    state.stallHistory, 
    state.pipelineMatrix,
    state.analyzedInstructions
  ]);
}