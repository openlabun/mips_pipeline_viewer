"use client"; // Add 'use client' directive

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import * as React from "react";

// Define the stage names (optional, but good for clarity)
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = (typeof STAGE_NAMES)[number];

type InstructionType = "R" | "I" | "J";
type HazardType = "RAW" | "WAW" | "NONE"; // Could add "Control" for branch mispredicts

interface RegisterUsage {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: InstructionType;
  isLoad: boolean;
  isBranch?: boolean; // Helpful for branch logic
  branchTarget?: number; // For branch instructions
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

// Branch Prediction Types
export type BranchPredictionMode = "none" | "static" | "stateMachine";
export type StaticBranchPrediction = "taken" | "notTaken";
export type StateMachineInitialPrediction = "taken" | "notTaken";

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
  stalls: Record<number, number>; // Stalls per instruction (e.g. due to data hazard)

  currentStallCycles: number; // Global stall cycles being processed

  forwardingEnabled: boolean;
  stallsEnabled: boolean;

  // Branch Prediction State
  branchPredictionMode: BranchPredictionMode;
  staticBranchPrediction: StaticBranchPrediction;
  stateMachineInitialPrediction: StateMachineInitialPrediction;
  stateMachineFailsToSwitch: number;
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void;

  // Branch Prediction Actions
  setBranchPredictionMode: (mode: BranchPredictionMode) => void;
  setStaticBranchPrediction: (prediction: StaticBranchPrediction) => void;
  setStateMachineInitialPrediction: (
    prediction: StateMachineInitialPrediction
  ) => void;
  setStateMachineFailsToSwitch: (fails: number) => void;
}

const SimulationStateContext = createContext<SimulationState | undefined>(
  undefined
);
const SimulationActionsContext = createContext<SimulationActions | undefined>(
  undefined
);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;

const initialState: SimulationState = {
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

  // Branch Prediction Initial State
  branchPredictionMode: "none",
  staticBranchPrediction: "notTaken",
  stateMachineInitialPrediction: "notTaken",
  stateMachineFailsToSwitch: 2,
};

const parseInstruction = (hexInstruction: string): RegisterUsage => {
  const binary = parseInt(hexInstruction, 16).toString(2).padStart(32, "0");
  const opcode = parseInt(binary.substring(0, 6), 2);
  const rs = parseInt(binary.substring(6, 11), 2);
  const rt = parseInt(binary.substring(11, 16), 2);
  // const imm = parseInt(binary.substring(16, 32), 2); // For branches, etc.

  let type: InstructionType = "R";
  let rd = 0;
  let funct = 0;
  let isLoad = false;
  let isBranch = false;

  if (opcode === 0) { // R-type
    type = "R";
    rd = parseInt(binary.substring(16, 21), 2);
    funct = parseInt(binary.substring(26, 32), 2);
  } else if (opcode === 2 || opcode === 3) { // J-type (j, jal)
    type = "J";
    rd = opcode === 3 ? 31 : 0; // jal writes to $ra
  } else if (opcode === 4 || opcode === 5) { // I-type Branches (beq, bne)
    type = "I";
    isBranch = true;
    // rd is not used as a destination for beq/bne traditionally
  } else { // Other I-types
    type = "I";
    if (opcode >= 32 && opcode <= 37) { // Loads (lw, lh, lb, etc.)
      isLoad = true;
      rd = rt;
    } else if (opcode >= 8 && opcode <= 15) { // Immediate arithmetic (addi, addiu, etc.)
      rd = rt;
    } else if (opcode >= 40 && opcode <= 43) { // Stores (sw, sh, sb)
      rd = 0;
    } else {
      rd = rt; // Default assumption for other I-types, might need refinement
    }
  }
  return { rs, rt, rd, opcode, funct, type, isLoad, isBranch };
};

// Corrected detectHazards signature and usage
const detectHazards = (
  instructions: string[], // Added this parameter explicitly
  registerUsage: Record<number, RegisterUsage>,
  forwardingEnabled: boolean,
  stallsEnabled: boolean
  // Potentially add branch prediction state here later
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
    if (currentInst.type === "J") continue; // Jumps don't cause data hazards in this model

    const j = i - 1; // Previous instruction index
    const prevInst = registerUsage[j];

    // Skip if previous instruction doesn't write to a register that can cause a hazard
    // (rd=0 is $zero, or for some instructions like J, it indicates no GPR write)
    // JAL writes to $ra (rd=31), so this check is fine.
    if (prevInst.rd === 0) continue;


    let hasRawHazard = false;
    let hazardRegister = "";
    let hazardOnRs = false;
    let hazardOnRtSource = false; // rt as a source register

    // Check RAW on rs: currentInst reads rs, prevInst writes to prevInst.rd
    if (currentInst.rs !== 0 && currentInst.rs === prevInst.rd) {
        hazardOnRs = true;
        hazardRegister = `rs($${currentInst.rs})`;
    }

    // Check RAW on rt (if rt is used as a source by currentInst)
    // rt is a source for R-type.
    // rt is a source for I-type stores (e.g. sw $rt, offset($rs)) and branches (e.g. beq $rs, $rt, offset).
    if (currentInst.rt !== 0 && currentInst.rt === prevInst.rd) {
        if (currentInst.type === 'R') {
            hazardOnRtSource = true;
        } else if (currentInst.type === 'I') {
            const op = currentInst.opcode;
            // Store opcodes: 40 (sb), 41 (sh), 43 (sw)
            // Branch opcodes: 4 (beq), 5 (bne)
            // For these, rt is a source. For loads and ALU-imm, rt is destination (handled by currentInst.rd).
            if ((op >= 40 && op <= 43 && op !== 42 /* exclude swl/r for simplicity */) || op === 4 || op === 5) {
                hazardOnRtSource = true;
            }
        }
        if (hazardOnRtSource) {
             hazardRegister = hazardOnRs ? `${hazardRegister} & rt($${currentInst.rt})` : `rt($${currentInst.rt})`;
        }
    }
    hasRawHazard = hazardOnRs || hazardOnRtSource;

    if (hasRawHazard) {
      if (prevInst.isLoad) { // Load-Use Hazard
        hazards[i] = {
          type: "RAW",
          description: `Load-use hazard: Instruction ${i} (${hazardRegister}) depends on load in I${j}`,
          canForward: forwardingEnabled, // Can forward from MEM
          stallCycles: 1, // Always 1 stall for load-use, even with forwarding
        };
        stalls[i] = 1;
        if (forwardingEnabled) {
          // Forward from MEM stage of prevInst (I_j) to EX stage of currentInst (I_i)
          forwardings[i] = [
            ...(forwardings[i] || []), // Keep existing if any (e.g. if both rs and rt had hazards from different prev)
            {
              from: j,
              to: i,
              fromStage: "MEM",
              toStage: "EX",
              register: `$${prevInst.rd}`,
            },
          ];
        }
      } else { // General ALU-ALU RAW Hazard
        if (forwardingEnabled) {
          hazards[i] = {
            type: "RAW",
            description: `RAW hazard: Instruction ${i} (${hazardRegister}) depends on I${j} (forwarded)`,
            canForward: true,
            stallCycles: 0, // No stall if forwarded from EX/MEM
          };
          // Forward from EX stage of prevInst (I_j) to EX stage of currentInst (I_i)
           forwardings[i] = [
            ...(forwardings[i] || []),
            {
              from: j,
              to: i,
              fromStage: "EX", // Or MEM if it's a 2-cycle separated dependency
              toStage: "EX",
              register: `$${prevInst.rd}`,
            },
          ];
        } else { // No forwarding
          hazards[i] = {
            type: "RAW",
            description: `RAW hazard: Instruction ${i} (${hazardRegister}) depends on I${j} (no forwarding)`,
            canForward: false,
            stallCycles: 2, // Typically 2 stalls for ALU-ALU without forwarding
          };
          stalls[i] = 2;
        }
      }
    }

    // Check for WAW hazards (only for instructions that write to the same register AND no RAW)
    // rd can be 0 for instructions that don't write (e.g. sw, beq, j)
    if (
      currentInst.rd !== 0 && // Current instruction must write
      prevInst.rd !== 0 &&    // Previous instruction must write
      currentInst.rd === prevInst.rd &&
      !hasRawHazard // Prioritize RAW
    ) {
      hazards[i] = {
        type: "WAW",
        description: `WAW hazard: Both I${i} and I${j} write to $${currentInst.rd}`,
        canForward: true, // WAW handled by in-order pipeline stages or register renaming (not modeled here)
        stallCycles: 0, // Typically no stalls for WAW in a simple 5-stage in-order pipeline
      };
    }
  }
  return [hazards, forwardings, stalls];
};

const calculatePrecedingStalls = (
  stalls: Record<number, number>,
  index: number
): number => {
  let totalStalls = 0;
  for (let k = 0; k < index; k++) {
    totalStalls += stalls[k] || 0;
  }
  return totalStalls;
};


const calculateNextState = (currentState: SimulationState): SimulationState => {
  if (!currentState.isRunning || currentState.isFinished) {
    return currentState;
  }

  const nextCycle = currentState.currentCycle + 1;
  const newInstructionStages: Record<number, number | null> = {};
  let activeInstructionsInPipeline = 0; // Count instructions currently in stages IF through WB

  let newCurrentGlobalStallCycles = currentState.currentStallCycles;

  // If we are in a global stall period (e.g. due to a load-use that required a bubble)
  if (newCurrentGlobalStallCycles > 0) {
    newCurrentGlobalStallCycles--;

    // During a global stall, instructions "before" the stall point (typically IF, ID) are held.
    // Instructions "after" the stall point (EX, MEM, WB) continue to advance.
    // This is a simplified model. A real pipeline might stall more selectively.
    currentState.instructions.forEach((_, index) => {
      const currentStageOfInst = currentState.instructionStages[index];
      if (currentStageOfInst !== null) {
        // Assuming stall is injected after ID, before EX.
        // So instructions in IF (0) or ID (1) are "stalled" (don't advance).
        // Instructions in EX (2), MEM (3), WB (4) advance.
        if (currentStageOfInst < 2) { // IF or ID
          newInstructionStages[index] = currentStageOfInst; // Stay in current stage
        } else { // EX, MEM, WB
          newInstructionStages[index] = currentStageOfInst + 1;
          if (newInstructionStages[index]! >= currentState.stageCount) {
            newInstructionStages[index] = null; // Instruction completed
          }
        }
        if (newInstructionStages[index] !== null) {
          activeInstructionsInPipeline++;
        }
      } else {
        // If instruction not yet in pipeline, it remains not in pipeline,
        // unless it's the next one to be fetched (handled below).
        newInstructionStages[index] = null;
      }
    });
     // If the first instruction (index 0) is not yet in the pipeline and we are stalling,
     // it should not be fetched.
     // This logic gets complex quickly. Let's simplify for now:
     // The main loop below handles fetching new instructions.
     // If stalling, the `effectiveEntryCycle` calculation naturally delays new fetches.

    return {
      ...currentState,
      currentCycle: nextCycle,
      instructionStages: newInstructionStages,
      currentStallCycles: newCurrentGlobalStallCycles,
      isRunning: true, // Still running during stall, unless finished
      isFinished: false, // Not finished while stalling active cycles
    };
  }

  // --- Regular Cycle Progression (No Active Global Stall) ---

  // Calculate total sum of per-instruction stalls detected by detectHazards
  // These are potential stalls that trigger the `currentStallCycles` countdown.
  let totalStallsFromDetection = 0;
  Object.values(currentState.stalls).forEach((s) => {
    totalStallsFromDetection += s;
  });

  let anyInstCausedNewStallThisCycle = false;

  currentState.instructions.forEach((_, index) => {
    const precedingStallsForThisInst = calculatePrecedingStalls(currentState.stalls, index);
    
    // Effective cycle when this instruction *would* enter the IF stage without pipeline stalls from *other* instructions
    const baseEntryCycleForInst = index + 1; 
    
    // Actual entry cycle considering stalls *caused by this instruction and preceding ones*
    // This is complex. Simpler: stage an instruction is in at `nextCycle`.
    // An instruction `i` enters IF at cycle `i+1 + sum_of_stalls_before_i_and_by_i_at_ID`.
    // Let currentInstructionStage be the stage an instruction *was* in.
    const prevStageOfInst = currentState.instructionStages[index];

    let nextStageForInst: number | null = null;

    if (prevStageOfInst === null) { // Instruction not yet in pipeline
        // Can it be fetched this cycle?
        // Enters IF (stage 0) if `nextCycle` matches its `baseEntryCycle` + `precedingStalls`
        // (The `precedingStalls` here are stalls caused by *previous* instructions that have already resolved
        //  and impacted when *this* instruction can start)
        if (nextCycle >= baseEntryCycleForInst + precedingStallsForThisInst) {
            nextStageForInst = 0; // Enters IF
        } else {
            nextStageForInst = null;
        }
    } else { // Instruction already in pipeline
        nextStageForInst = prevStageOfInst + 1;
    }

    // Check if this instruction, upon reaching a certain stage (e.g., ID), causes a stall
    if (nextStageForInst === 1 /* ID stage */ && currentState.stalls[index] > 0 && !anyInstCausedNewStallThisCycle) {
        // This instruction is now in ID and requires stalls.
        // These stalls will apply starting from the *next* cycle.
        newCurrentGlobalStallCycles = currentState.stalls[index];
        anyInstCausedNewStallThisCycle = true;
        // The instruction itself still moves to ID this cycle. The stall affects subsequent progression.
    }


    if (nextStageForInst !== null && nextStageForInst >= currentState.stageCount) {
      newInstructionStages[index] = null; // Instruction completed WB
    } else {
      newInstructionStages[index] = nextStageForInst;
    }

    if (newInstructionStages[index] !== null) {
      activeInstructionsInPipeline++;
    }
  });


  const estimatedCompletionCycle =
    currentState.instructions.length > 0
      ? currentState.instructions.length + currentState.stageCount - 1 + totalStallsFromDetection
      : 0;

  // isFinished: no instructions are active in the pipeline AND we are past the initial fetch cycles.
  // A more robust check: all instructions have passed WB (are null in instructionStages)
  // AND we are at or beyond the estimatedCompletionCycle.
  let allInstructionsCompleted = true;
  if (currentState.instructions.length === 0) {
    allInstructionsCompleted = true; // No instructions, so considered completed.
  } else {
    for (let i = 0; i < currentState.instructions.length; i++) {
        if (newInstructionStages[i] !== null) {
            allInstructionsCompleted = false;
            break;
        }
    }
  }
  
  const isNowFinished = allInstructionsCompleted && (currentState.instructions.length === 0 || nextCycle > estimatedCompletionCycle);
  // If we just triggered new stalls, we are not finished.
  const finalIsFinished = isNowFinished && !anyInstCausedNewStallThisCycle && newCurrentGlobalStallCycles === 0;

  return {
    ...currentState,
    currentCycle: finalIsFinished && estimatedCompletionCycle > 0 ? estimatedCompletionCycle : nextCycle,
    instructionStages: newInstructionStages,
    isRunning: !finalIsFinished,
    isFinished: finalIsFinished,
    currentStallCycles: newCurrentGlobalStallCycles,
  };
};


export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] =
    useState<SimulationState>(initialState);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const runClock = useCallback(() => {
    clearTimer();
    // Check isRunning and isFinished from the state directly inside setInterval's callback
    // to ensure it uses the latest state, not the one captured by useCallback's closure.
    intervalRef.current = setInterval(() => {
      setSimulationState((prevState) => {
        if (!prevState.isRunning || prevState.isFinished) {
            clearTimer();
            return prevState; // No change if not running or finished
        }
        const nextState = calculateNextState(prevState);
        if (nextState.isFinished && !prevState.isFinished) { // If it just became finished
          clearTimer();
        }
        return nextState;
      });
    }, 1000);
  }, []); // runClock itself doesn't depend on isRunning/isFinished for its definition

  useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);


  const resetSimulation = useCallback(() => {
    clearTimer();
    setSimulationState((prevState) => ({
      ...initialState,
      forwardingEnabled: prevState.forwardingEnabled,
      stallsEnabled: prevState.stallsEnabled,
      branchPredictionMode: prevState.branchPredictionMode,
      staticBranchPrediction: prevState.staticBranchPrediction,
      stateMachineInitialPrediction: prevState.stateMachineInitialPrediction,
      stateMachineFailsToSwitch: prevState.stateMachineFailsToSwitch,
    }));
  }, []);

  const startSimulation = useCallback(
    (submittedInstructions: string[]) => {
      clearTimer();
      if (submittedInstructions.length === 0) {
        resetSimulation();
        return;
      }

      const registerUsage: Record<number, RegisterUsage> = {};
      submittedInstructions.forEach((inst, index) => {
        registerUsage[index] = parseInstruction(inst);
      });
      
      // Use current state for forwarding/stallsEnabled from simulationState
      const currentForwardingEnabled = simulationState.forwardingEnabled;
      const currentStallsEnabled = simulationState.stallsEnabled;

      // Corrected call to detectHazards
      const [hazards, forwardings, stalls] = detectHazards(
        submittedInstructions, // Pass the instructions array
        registerUsage,
        currentForwardingEnabled,
        currentStallsEnabled
      );

      let totalStallCycles = 0;
      Object.values(stalls).forEach((s) => { totalStallCycles += s; });

      const calculatedMaxCycles =
        submittedInstructions.length + DEFAULT_STAGE_COUNT - 1 + totalStallCycles;
      
      const initialStages: Record<number, number | null> = {};
      // Instructions start as null, calculateNextState will fetch I0 in the first cycle (0 -> 1)
      submittedInstructions.forEach((_, index) => {
          initialStages[index] = null;
      });


      setSimulationState((prevState) => ({
        ...initialState, // Start from a clean slate for simulation-specific data
        // Preserve configurations from prevState
        forwardingEnabled: prevState.forwardingEnabled,
        stallsEnabled: prevState.stallsEnabled,
        branchPredictionMode: prevState.branchPredictionMode,
        staticBranchPrediction: prevState.staticBranchPrediction,
        stateMachineInitialPrediction: prevState.stateMachineInitialPrediction,
        stateMachineFailsToSwitch: prevState.stateMachineFailsToSwitch,
        // Set new simulation data
        instructions: submittedInstructions,
        currentCycle: 0, // Will advance to 1 on the first tick
        maxCycles: calculatedMaxCycles,
        isRunning: true,
        stageCount: DEFAULT_STAGE_COUNT,
        instructionStages: initialStages,
        isFinished: false,
        registerUsage,
        hazards,
        forwardings,
        stalls,
        currentStallCycles: 0,
      }));
    },
    // Dependencies for startSimulation
    [ resetSimulation,
      simulationState.forwardingEnabled,
      simulationState.stallsEnabled,
      // Add branch prediction states if detectHazards starts using them
    ]
  );

  const pauseSimulation = useCallback(() => {
    setSimulationState((prevState) => {
      if (prevState.isRunning) {
        clearTimer();
        return { ...prevState, isRunning: false };
      }
      return prevState;
    });
  }, []);

  const resumeSimulation = useCallback(() => {
    setSimulationState((prevState) => {
      // Allow resume if not running, not finished, and there are instructions
      if ( !prevState.isRunning && !prevState.isFinished && prevState.instructions.length > 0 ) {
        return { ...prevState, isRunning: true };
      }
      return prevState;
    });
  }, []);

  const setForwardingEnabled = useCallback((enabled: boolean) => {
    setSimulationState((prevState) => ({
      ...prevState,
      forwardingEnabled: enabled,
    }));
  }, []);

  const setStallsEnabled = useCallback((enabled: boolean) => {
    setSimulationState((prevState) => ({
      ...prevState,
      stallsEnabled: enabled,
      // If stalls are disabled, forwarding is implicitly not relevant in the same way
      forwardingEnabled: enabled ? prevState.forwardingEnabled : false,
    }));
  }, []);

  const setBranchPredictionMode = useCallback((mode: BranchPredictionMode) => {
    setSimulationState((prevState) => ({
      ...prevState,
      branchPredictionMode: mode,
    }));
  }, []);

  const setStaticBranchPrediction = useCallback(
    (prediction: StaticBranchPrediction) => {
      setSimulationState((prevState) => ({
        ...prevState,
        staticBranchPrediction: prediction,
      }));
    },
    []
  );

  const setStateMachineInitialPrediction = useCallback(
    (prediction: StateMachineInitialPrediction) => {
      setSimulationState((prevState) => ({
        ...prevState,
        stateMachineInitialPrediction: prediction,
      }));
    },
    []
  );

  const setStateMachineFailsToSwitch = useCallback((fails: number) => {
    setSimulationState((prevState) => ({
      ...prevState,
      stateMachineFailsToSwitch: Math.max(1, fails),
    }));
  }, []);


  const actionsValue: SimulationActions = useMemo(
    () => ({
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwardingEnabled,
      setStallsEnabled,
      setBranchPredictionMode,
      setStaticBranchPrediction,
      setStateMachineInitialPrediction,
      setStateMachineFailsToSwitch,
    }),
    [
      startSimulation,
      resetSimulation,
      pauseSimulation,
      resumeSimulation,
      setForwardingEnabled,
      setStallsEnabled,
      setBranchPredictionMode,
      setStaticBranchPrediction,
      setStateMachineInitialPrediction,
      setStateMachineFailsToSwitch,
    ]
  );

  // The simulationState object is already the value for the context
  // const stateValue: SimulationState = simulationState; // This is redundant

  return (
    <SimulationStateContext.Provider value={simulationState}>
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