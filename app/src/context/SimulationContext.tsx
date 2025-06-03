"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

type PredictionMode = "always" | "machine";

interface BranchConfig {
  mode: PredictionMode;
  initialPrediction: boolean;
  missThreshold: number;
}

interface PredictorState {
  currentPrediction: boolean;
  missesRemaining: number;
}

const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = typeof STAGE_NAMES[number];

type InstructionType = "R" | "I" | "J" | "OTHER";
type HazardType = "RAW" | "WAW" | "NONE";

interface RegisterUsage {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: InstructionType;
  isLoad: boolean;
  isBranch: boolean;
  branchType?: "BEQ" | "BNE";
  immediate?: number;
}

interface HazardInfo {
  type: HazardType;
  description: string;
  canForward: boolean;
  stallCycles: number;
}

interface ForwardingInfo {
  from: number;
  to: number;
  fromStage: StageName;
  toStage: StageName;
  register: string;
}

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, number | null>;
  isFinished: boolean;

  registerUsage: Record<number, RegisterUsage>;
  hazards: Record<number, HazardInfo>;
  forwardings: Record<number, ForwardingInfo[]>;
  stalls: Record<number, number>;

  currentStallCycles: number;
  forwardingEnabled: boolean;
  stallsEnabled: boolean;

  branchConfig: BranchConfig;
  predictorState: PredictorState;
  missCount: number;
  branchMisses: Record<number, boolean>
  branchStateIndex: Record<number, number>;
  registerFileStates: Record<number, number>[];

  branchTakenTargets: Record<number, boolean>;
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[], branchConfig: BranchConfig) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void;
}

const SimulationStateContext = createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = createContext<SimulationActions | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

const initialBinaryState: SimulationState = {
  instructions: [],
  currentCycle: 0,
  maxCycles: 0,
  isRunning: false,
  stageCount: DEFAULT_STAGE_COUNT,
  instructionStages: {},
  isFinished: false,

  registerUsage: {},
  hazards: {},
  forwardings: {},
  stalls: {},

  currentStallCycles: 0,
  forwardingEnabled: true,
  stallsEnabled: true,

  branchConfig: {
    mode: "always",
    initialPrediction: false,
    missThreshold: 1,
  },
  predictorState: {
    currentPrediction: false,
    missesRemaining: 1,
  },
  missCount: 0,
  branchMisses: {},
  branchStateIndex: {},
  registerFileStates: [],
  branchTakenTargets: {},
};

const parseInstruction = (hexInstruction: string): RegisterUsage => {
  const binary = parseInt(hexInstruction, 16).toString(2).padStart(32, "0");
  const opcode = parseInt(binary.substring(0, 6), 2);
  const rs = parseInt(binary.substring(6, 11), 2);
  const rt = parseInt(binary.substring(11, 16), 2);

  let type: InstructionType = "OTHER";
  let rd = 0;
  let funct = 0;
  let isLoad = false;
  let isBranch = false;
  let branchType: "BEQ" | "BNE" | undefined = undefined;
  let immediate: number | undefined = undefined;

  if (opcode === 0) {
    type = "R";
    rd = parseInt(binary.substring(16, 21), 2);
    funct = parseInt(binary.substring(26, 32), 2);
  } else if (opcode === 2 || opcode === 3) {
    type = "J";
    rd = opcode === 3 ? 31 : 0;
  } else if (opcode === 4 || opcode === 5) {
    type = "I";
    isBranch = true;
    branchType = opcode === 4 ? "BEQ" : "BNE";
    const immRaw = binary.substring(16, 32);
    const signedImm =
      immRaw[0] === "1" ? parseInt(immRaw, 2) - 0x10000 : parseInt(immRaw, 2);
    immediate = signedImm;
  } else if (opcode >= 32 && opcode <= 37) {
    type = "I";
    isLoad = true;
    rd = rt;
    const immRaw = binary.substring(16, 32);
    const signedImm =
      immRaw[0] === "1" ? parseInt(immRaw, 2) - 0x10000 : parseInt(immRaw, 2);
    immediate = signedImm;
  } else if (opcode >= 8 && opcode <= 15) {
    type = "I";
    rd = rt;
    const immRaw = binary.substring(16, 32);
    const signedImm =
      immRaw[0] === "1" ? parseInt(immRaw, 2) - 0x10000 : parseInt(immRaw, 2);
    immediate = signedImm;
  } else {
    type = "I";
    const immRaw = binary.substring(16, 32);
    const signedImm =
      immRaw[0] === "1" ? parseInt(immRaw, 2) - 0x10000 : parseInt(immRaw, 2);
    immediate = signedImm;
  }

  return { rs, rt, rd, opcode, funct, type, isLoad, isBranch, branchType, immediate };
};

const detectHazards = (
  instructions: string[],
  registerUsage: Record<number, RegisterUsage>,
  forwardingEnabled: boolean,
  stallsEnabled: boolean
): [
  Record<number, HazardInfo>,
  Record<number, ForwardingInfo[]>,
  Record<number, number>
] => {
  const hazards: Record<number, HazardInfo> = {};
  const forwardings: Record<number, ForwardingInfo[]> = {};
  const stalls: Record<number, number> = {};

  instructions.forEach((_, index) => {
    hazards[index] = {
      type: "NONE",
      description: "No hazard",
      canForward: false,
      stallCycles: 0,
    };
    forwardings[index] = [];
    stalls[index] = 0;
  });

  if (!stallsEnabled) {
    return [hazards, forwardings, stalls];
  }

  for (let i = 1; i < instructions.length; i++) {
    const currentInst = registerUsage[i];
    if (currentInst.isBranch || currentInst.type === "J") continue;

    const j = i - 1;
    const prevInst = registerUsage[j];
    if (prevInst.rd === 0) continue;

    let hasRawHazard = false;
    let hazardRegister = "";

    if (currentInst.rs === prevInst.rd) {
      hasRawHazard = true;
      hazardRegister = `rs($${currentInst.rs})`;
    } else if (
      (currentInst.rt === prevInst.rd && currentInst.type !== "I") ||
      (currentInst.type === "I" && !currentInst.isLoad)
    ) {
      hasRawHazard = true;
      hazardRegister = `rt($${currentInst.rt})`;
    }

    if (hasRawHazard) {
      if (prevInst.isLoad) {
        hazards[i] = {
          type: "RAW",
          description: `Load-use hazard: ${hazardRegister} depende de lw en instrucción ${j}`,
          canForward: forwardingEnabled,
          stallCycles: 1,
        };
        stalls[i] = 1;
        if (forwardingEnabled) {
          forwardings[i] = [
            {
              from: j,
              to: i,
              fromStage: "MEM",
              toStage: "EX",
              register: `$${prevInst.rd}`,
            },
          ];
        }
      } else {
        if (forwardingEnabled) {
          hazards[i] = {
            type: "RAW",
            description: `RAW hazard: ${hazardRegister} depende de instrucción ${j} (forwarded)`,
            canForward: true,
            stallCycles: 0,
          };
          forwardings[i] = [
            {
              from: j,
              to: i,
              fromStage: "EX",
              toStage: "EX",
              register: `$${prevInst.rd}`,
            },
          ];
        } else {
          hazards[i] = {
            type: "RAW",
            description: `RAW hazard: ${hazardRegister} depende de instrucción ${j} (no forwarding)`,
            canForward: false,
            stallCycles: 2,
          };
          stalls[i] = 2;
        }
      }
    }

    // WAW
    if (
      currentInst.rd !== 0 &&
      currentInst.rd === prevInst.rd &&
      !hasRawHazard
    ) {
      hazards[i] = {
        type: "WAW",
        description: `WAW hazard: Ambas escriben en $${currentInst.rd}`,
        canForward: true,
        stallCycles: 0,
      };
    }
  }

  return [hazards, forwardings, stalls];
};

const calculatePrecedingStalls = (
  stalls: Record<number, number>,
  index: number
): number => {
  let total = 0;
  for (let i = 0; i < index; i++) {
    total += stalls[i] || 0;
  }
  return total;
};

const simulateRegisterFiles = (
  submittedInstructions: string[],
  registerUsage: Record<number, RegisterUsage>
): Record<number, number>[] => {
  const states: Record<number, number>[] = [];
  const regFile: Record<number, number> = {};
  for (let r = 0; r < 32; r++) regFile[r] = 0;

  submittedInstructions.forEach((_, idx) => {
    const usage = registerUsage[idx];
    states.push({ ...regFile });

    if (usage.type === "R") {
      const funct = usage.funct;
      const rsVal = regFile[usage.rs];
      const rtVal = regFile[usage.rt];
      let result = 0;
      switch (funct) {
        case 32: // add
          result = rsVal + rtVal;
          break;
        case 34: // sub
          result = rsVal - rtVal;
          break;
        case 36: // and
          result = rsVal & rtVal;
          break;
        case 37: // or
          result = rsVal | rtVal;
          break;
        case 42: // slt
          result = rsVal < rtVal ? 1 : 0;
          break;
        default:
          result = 0;
      }
      if (usage.rd !== 0) {
        regFile[usage.rd] = result;
      }
    } else if (usage.type === "I" && usage.isBranch) {
      // BEQ/BNE
    } else if (usage.type === "I" && usage.isLoad) {
      // lw: asigns 0 to rd
      if (usage.rd !== 0) {
        regFile[usage.rd] = 0;
      }
    } else if (usage.type === "I" && !usage.isBranch) {
      // ADDI, ANDI, ORI, SLTI, etc.
      const opc = usage.opcode;
      const rsVal = regFile[usage.rs];
      const imm = usage.immediate ?? 0;
      let result = 0;
      switch (opc) {
        case 8: // addi
          result = rsVal + imm;
          break;
        case 12: // andi
          result = rsVal & imm;
          break;
        case 13: // ori
          result = rsVal | imm;
          break;
        case 14: // xori
          result = rsVal ^ imm;
          break;
        case 10: // slti
          result = rsVal < imm ? 1 : 0;
          break;
        default:
          result = 0;
      }
      if (usage.rd !== 0) {
        regFile[usage.rd] = result;
      }
    }
  });

  return states;
};

const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  console.log(
    `>>> [calculateNextState] Ciclo=${currentState.currentCycle} | predictorState.currentPrediction=`,
    currentState.predictorState.currentPrediction,
    "| missesRemaining=",
    currentState.predictorState.missesRemaining,
    "| mode=",
    currentState.branchConfig.mode
  );

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let newStallCycles = currentState.currentStallCycles;

  if (newStallCycles > 0) {
    newStallCycles--;
    return {
      ...currentState,
      currentCycle: nextCycle,
      instructionStages: currentState.instructionStages,
      currentStallCycles: newStallCycles,
    };
  }

  let totalStallCycles = 0;
  Object.values(currentState.stalls).forEach((s) => {
    totalStallCycles += s;
  });

  const updatedBranchMisses = { ...currentState.branchMisses };
  const updatedBranchStateIndex = { ...currentState.branchStateIndex };
  const updatedPredictor: PredictorState = { ...currentState.predictorState };
  let totalMissCount = currentState.missCount;

  currentState.instructions.forEach((_, index) => {
    const precedingStalls = calculatePrecedingStalls(
      currentState.stalls,
      index
    );
    const stageIndex = nextCycle - index - 1 - precedingStalls;

    if (stageIndex >= 0 && stageIndex < currentState.stageCount) {
      newInstructionStages[index] = stageIndex;

      const usage = currentState.registerUsage[index];
      if (usage.isBranch && stageIndex === 1) {
        const threshold = currentState.branchConfig.missThreshold;
        const currPred = currentState.predictorState.currentPrediction;
        const missesRem = currentState.predictorState.missesRemaining;
        let stateIdx: number;
        if (currPred) {
          stateIdx = threshold - missesRem + 1;
        } else {
          stateIdx = threshold + (threshold - missesRem + 1);
        }
        updatedBranchStateIndex[index] = stateIdx;

        const regState = currentState.registerFileStates[index];
        const rsVal = regState[usage.rs] ?? 0;
        const rtVal = regState[usage.rt] ?? 0;
        let actualTaken = false;
        if (usage.branchType === "BEQ") {
          actualTaken = rsVal === rtVal;
        } else if (usage.branchType === "BNE") {
          actualTaken = rsVal !== rtVal;
        }

        const prediction = updatedPredictor.currentPrediction;

        if (prediction !== actualTaken) {
          totalMissCount++;
          updatedBranchMisses[index] = true;

          if (currentState.branchConfig.mode === "machine") {
            updatedPredictor.missesRemaining -= 1;
            if (updatedPredictor.missesRemaining <= 0) {
              updatedPredictor.currentPrediction = !updatedPredictor.currentPrediction;
              updatedPredictor.missesRemaining =
                currentState.branchConfig.missThreshold;
            }
          }

        } else {
          updatedBranchMisses[index] = false;

          if (currentState.branchConfig.mode === "machine") {
            if (!prediction) {
              updatedPredictor.missesRemaining = Math.min(
                updatedPredictor.missesRemaining + 1,
                currentState.branchConfig.missThreshold
              );
            }
          }
        }
      }

      if (
        stageIndex === 1 &&
        currentState.stalls[index] > 0 &&
        newStallCycles === 0
      ) {
        newStallCycles = currentState.stalls[index];
      }
    } else {
      newInstructionStages[index] = null;
    }
  });

  const completionCycle =
    currentState.instructions.length > 0
      ? currentState.instructions.length +
        currentState.stageCount -
        1 +
        totalStallCycles
      : 0;
  const isFinished = nextCycle > completionCycle;
  const isRunning = !isFinished;

  return {
    ...currentState,
    currentCycle: isFinished ? completionCycle : nextCycle,
    instructionStages: newInstructionStages,
    isRunning: isRunning,
    isFinished: isFinished,
    currentStallCycles: newStallCycles,
    predictorState: updatedPredictor,
    missCount: totalMissCount,
    branchMisses: updatedBranchMisses,
    branchStateIndex: updatedBranchStateIndex,
  };
};

export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = useState<SimulationState>(
    initialBinaryState
  );
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const runClock = useCallback(() => {
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

  const resetSimulation = useCallback(() => {
    clearTimer();
    setSimulationState((prevState) => {
      let initialMisses: number;
      if (prevState.branchConfig.mode === "machine") {
        initialMisses = prevState.branchConfig.initialPrediction
          ? prevState.branchConfig.missThreshold
          : 1;
      } else {
        initialMisses = 0;
      }

      return {
        ...initialBinaryState,
        forwardingEnabled: prevState.forwardingEnabled,
        stallsEnabled: prevState.stallsEnabled,
        branchConfig: prevState.branchConfig,
        predictorState: {
          currentPrediction: prevState.branchConfig.initialPrediction,
          missesRemaining: initialMisses,
        },
      };
    });
  }, []);

  const startSimulation = useCallback(
    (submittedInstructions: string[], branchConfig: BranchConfig) => {
      clearTimer();
      if (submittedInstructions.length === 0) {
        resetSimulation();
        return;
      }

      const registerUsageOriginal: Record<number, RegisterUsage> = {};
      submittedInstructions.forEach((inst, index) => {
        registerUsageOriginal[index] = parseInstruction(inst);
      });

      const regFileStatesOriginal = simulateRegisterFiles(
        submittedInstructions,
        registerUsageOriginal
      );

      const executedOriginalIndices: number[] = [];
      const originalTargetSet = new Set<number>();

      let i = 0;
      const n = submittedInstructions.length;
      while (i < n) {
        const usage = registerUsageOriginal[i];
        if (!executedOriginalIndices.includes(i)) {
          executedOriginalIndices.push(i);
        }

        if (usage.isBranch && typeof usage.immediate === "number") {
          const regState = regFileStatesOriginal[i];
          const rsVal = regState[usage.rs] ?? 0;
          const rtVal = regState[usage.rt] ?? 0;
          let actualTaken = false;
          if (usage.branchType === "BEQ") {
            actualTaken = rsVal === rtVal;
          } else if (usage.branchType === "BNE") {
            actualTaken = rsVal !== rtVal;
          }

          const predictedTaken = branchConfig.initialPrediction;

          if (actualTaken) {
            if (!predictedTaken) {
              const fallThroughIdx = i + 1;
              if (fallThroughIdx < n && !executedOriginalIndices.includes(fallThroughIdx)) {
                executedOriginalIndices.push(fallThroughIdx);
              }
            }
            const targetOriginalIndex = i + 1 + usage.immediate;
            const nextI = Math.max(0, Math.min(n - 1, targetOriginalIndex));
            originalTargetSet.add(nextI);
            if (nextI < n && !executedOriginalIndices.includes(nextI)) {
              executedOriginalIndices.push(nextI);
            }
            i = nextI;
          } else {
            if (predictedTaken) {
              const targetSpecIdx = i + 1 + usage.immediate;
              if (
                targetSpecIdx >= 0 &&
                targetSpecIdx < n &&
                !executedOriginalIndices.includes(targetSpecIdx)
              ) {
                executedOriginalIndices.push(targetSpecIdx);
              }
            }
            i = i + 1;
          }
        } else {
          i = i + 1;
        }
      }

      const filteredInstructions: string[] = [];
      const registerUsageFiltered: Record<number, RegisterUsage> = {};
      const filteredTargets: Record<number, boolean> = {};

      executedOriginalIndices.forEach((origIdx, newIdx) => {
        filteredInstructions.push(submittedInstructions[origIdx]);
        registerUsageFiltered[newIdx] = registerUsageOriginal[origIdx];
        if (originalTargetSet.has(origIdx)) {
          filteredTargets[newIdx] = true;
        }
      });

      const regFileStatesFiltered = simulateRegisterFiles(
        filteredInstructions,
        registerUsageFiltered
      );

      const [hazards, forwardings, stalls] = detectHazards(
        filteredInstructions,
        registerUsageFiltered,
        simulationState.forwardingEnabled,
        simulationState.stallsEnabled
      );

      let totalStalls = 0;
      Object.values(stalls).forEach((s) => {
        totalStalls += s;
      });

      const filteredCount = filteredInstructions.length;
      const calculatedMaxCycles =
        filteredCount + DEFAULT_STAGE_COUNT - 1 + totalStalls;

      const initialStages: Record<number, number | null> = {};
      for (let idx = 0; idx < filteredCount; idx++) {
        const stageIdx = 1 - idx - 1;
        initialStages[idx] =
          stageIdx >= 0 && stageIdx < DEFAULT_STAGE_COUNT
            ? stageIdx
            : null;
      }

      const branchMissesInit: Record<number, boolean> = {};
      const branchStateIndexInit: Record<number, number> = {};
      for (let idx = 0; idx < filteredCount; idx++) {
        branchMissesInit[idx] = false;
        branchStateIndexInit[idx] = 0;
      }

      console.log(
        ">>> SimulationContext.startSimulation (filtrado) recibe branchConfig =",
        branchConfig
      );
      console.log(
        "      → predictor inicial =",
        {
          currentPrediction: branchConfig.initialPrediction,
          missesRemaining: branchConfig.missThreshold,
        }
      );

      let initialMisses: number;
      if (branchConfig.mode === "machine") {
        initialMisses = branchConfig.initialPrediction
          ? branchConfig.missThreshold
          : 1;
      } else {
        initialMisses = 0;
      }

      setSimulationState({
        instructions: filteredInstructions,
        currentCycle: 1,
        maxCycles: calculatedMaxCycles,
        isRunning: true,
        stageCount: DEFAULT_STAGE_COUNT,
        instructionStages: initialStages,
        isFinished: false,

        registerUsage: registerUsageFiltered,
        hazards,
        forwardings,
        stalls,
        currentStallCycles: 0,
        forwardingEnabled: simulationState.forwardingEnabled,
        stallsEnabled: simulationState.stallsEnabled,

        branchConfig: branchConfig,
        predictorState: {
          currentPrediction: branchConfig.initialPrediction,
          missesRemaining: initialMisses,
        },
        missCount: 0,
        branchMisses: branchMissesInit,
        branchStateIndex: branchStateIndexInit,
        registerFileStates: regFileStatesFiltered,

        branchTakenTargets: filteredTargets,
      });
    },
    [
      resetSimulation,
      simulationState.forwardingEnabled,
      simulationState.stallsEnabled,
    ]
  );

  const pauseSimulation = () => {
    setSimulationState((prev) => {
      if (prev.isRunning) {
        clearTimer();
        return { ...prev, isRunning: false };
      }
      return prev;
    });
  };

  const resumeSimulation = () => {
    setSimulationState((prev) => {
      if (!prev.isRunning && prev.currentCycle > 0 && !prev.isFinished) {
        return { ...prev, isRunning: true };
      }
      return prev;
    });
  };

  const setForwardingEnabled = (enabled: boolean) => {
    setSimulationState((prev) => {
      return { ...prev, forwardingEnabled: enabled };
    });
  };

  const setStallsEnabled = (enabled: boolean) => {
    setSimulationState((prev) => {
      return { ...prev, stallsEnabled: enabled };
    });
  };

  useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);

  const stateValue: SimulationState = simulationState;
  const actionsValue: SimulationActions = useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwardingEnabled,
      setStallsEnabled,
    }),
    [startSimulation, resetSimulation]
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
  const context = useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error(
      "useSimulationState must be used within a SimulationProvider"
    );
  }
  return context;
}

export function useSimulationActions() {
  const context = useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error(
      "useSimulationActions must be used within a SimulationProvider"
    );
  }
  return context;
}
