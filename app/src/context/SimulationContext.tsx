// src/context/SimulationContext.tsx
"use client";

import {
  createContext,
  // ... (otras importaciones sin cambios)
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import * as React from "react";
import { translateInstructionToMIPS, hexToBinary } from "./Converter";

// ... (STAGE_NAMES, Tipos, RegisterUsage, HazardInfo, ForwardingInfo, Tipos de Branch Prediction, regMap, initialRegisters, initialMemory sin cambios) ...

// ASEGÚRATE QUE HazardType incluya "Control"
// type HazardType = "RAW" | "WAW" | "Control" | "NONE";
// Define the stage names
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = (typeof STAGE_NAMES)[number];

type InstructionType = "R" | "I" | "J";
type HazardType = "RAW" | "WAW" | "Control" | "NONE"; // Añadido "Control"

interface RegisterUsage {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: InstructionType;
  isLoad: boolean;
  isStore: boolean;
  isBranch: boolean;
  isJump: boolean; // Para J, JAL, JR
  branchTargetAddress?: number; // Dirección de salto (índice en `instructions`)
  jumpTargetAddress?: number;   // Para J, JAL (índice en `instructions`)
  isConditionalBranch: boolean; // BEQ, BNE
}

interface HazardInfo {
  type: HazardType;
  description: string;
  canForward: boolean;
  stallCycles: number;
}

interface ForwardingInfo {
  from: number; // Instruction index
  to: number;   // Instruction index
  fromStage: StageName;
  toStage: StageName;
  register: string;
}

export type BranchPredictionMode = "none" | "static" | "stateMachine";
export type StaticBranchPrediction = "taken" | "notTaken";
export type StateMachineInitialPrediction = "taken" | "notTaken";
// Para la máquina de estados de 2 bits
type BranchPredictorState = "SN" | "WN" | "WT" | "ST"; // Strongly/Weakly Not/Taken

const regMap: { [key: string]: string } = {
  "0": "zero", "1": "at", "2": "v0", "3": "v1", "4": "a0", "5": "a1", "6": "a2", "7": "a3",
  "8": "t0", "9": "t1", "10": "t2", "11": "t3", "12": "t4", "13": "t5", "14": "t6", "15": "t7",
  "16": "s0", "17": "s1", "18": "s2", "19": "s3", "20": "s4", "21": "s5", "22": "s6", "23": "s7",
  "24": "t8", "25": "t9", "26": "k0", "27": "k1", "28": "gp", "29": "sp", "30": "fp", "31": "ra",
};

const initialRegisters: Record<string, number> = Object.values(regMap).reduce((acc, val) => {
  acc[`$${val}`] = 0;
  return acc;
}, {} as Record<string, number>);
initialRegisters["$sp"] = 0x7ffffffc; // Típica inicialización de SP en simuladores (final de la memoria de usuario)

const initialMemory = Array.from({ length: 1024 }).reduce<Record<number, number>>( // Memoria más grande (ej: 4KB = 1024 palabras)
  (acc, _, i) => {
    acc[i * 4] = 0; // Indexar por dirección de byte, valor es una palabra (32 bits)
    return acc;
  },
  {} as Record<number, number>
);

interface SimulationState {
  instructions: string[];
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, StageName | null>; // Etapa actual de la instrucción con índice `number`
  isFinished: boolean;
  registerUsage: Record<number, RegisterUsage>;
  hazards: Record<number, HazardInfo>; // CLAVE: Debe actualizarse con Control Hazards
  forwardings: Record<number, ForwardingInfo[]>;
  stalls: Record<number, number>; // Stalls de datos causados POR la instrucción

  currentDataStallCycles: number; // Stalls globales por DATOS
  branchMispredictActiveStallCycles: number; // Stalls globales por CONTROL (mispredict)

  forwardingEnabled: boolean;
  stallsEnabled: boolean;

  registers: Record<string, number>;
  memory: Record<number, number>;
  PC: number; // Dirección de byte de la instrucción que ESTÁ EN IF (o la última que entró a IF)
  // O la dirección a la que se saltó.

  branchPredictionMode: BranchPredictionMode;
  staticBranchPrediction: StaticBranchPrediction;
  stateMachineInitialPrediction: StateMachineInitialPrediction;
  stateMachineFailsToSwitch: number;
  globalStateMachineState: BranchPredictorState;
  // globalStateMachineFailCount: number; // (Mantenido pero no usado activamente)

  pipelineLatches: {
    [key: number]: { // instructionIndex (índice en el array `instructions`)
      IF_ID?: { instruction: string; pc: number; instructionIndex: number; };
      ID_EX?: { instruction: string; pc: number; instructionIndex: number; regUsage: RegisterUsage; valRs?: number; valRt?: number; imm?: number; predictedPC?: number; predictedTaken?: boolean };
      EX_MEM?: { instruction: string; pc: number; instructionIndex: number; regUsage: RegisterUsage; aluResult?: number; writeReg?: string; valRtForStore?: number; branchTakenActual?: boolean; actualTargetPC?: number };
      MEM_WB?: { instruction: string; pc: number; instructionIndex: number; regUsage: RegisterUsage; memReadValue?: number; aluResult?: number; writeReg?: string };
    }
  };
  nextPCToFetch: number; // Dirección de byte de la PRÓXIMA instrucción a introducir en IF
  lastFetchedPC: number; // PC de la última instrucción que entró a IF (para evitar re-fetch en stalls)
}

// ... (SimulationActionsContext, DEFAULT_STAGE_COUNT, INSTRUCTION_START_ADDRESS sin cambios) ...
interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void;
  setBranchPredictionMode: (mode: BranchPredictionMode) => void;
  setStaticBranchPrediction: (prediction: StaticBranchPrediction) => void;
  setStateMachineInitialPrediction: (prediction: StateMachineInitialPrediction) => void;
  setStateMachineFailsToSwitch: (fails: number) => void;
}

const SimulationStateContext = createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = createContext<SimulationActions | undefined>(undefined);

const DEFAULT_STAGE_COUNT = STAGE_NAMES.length;
const INSTRUCTION_START_ADDRESS = 0x00400000; // Dirección de inicio típica para instrucciones

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
  currentDataStallCycles: 0, // Renombrado para claridad
  branchMispredictActiveStallCycles: 0, // Renombrado para claridad
  forwardingEnabled: true,
  stallsEnabled: true,
  registers: { ...initialRegisters },
  memory: { ...initialMemory },
  PC: INSTRUCTION_START_ADDRESS,
  branchPredictionMode: "none",
  staticBranchPrediction: "notTaken",
  stateMachineInitialPrediction: "notTaken",
  stateMachineFailsToSwitch: 1,
  globalStateMachineState: "SN",
  // globalStateMachineFailCount: 0,
  pipelineLatches: {},
  nextPCToFetch: INSTRUCTION_START_ADDRESS,
  lastFetchedPC: -1, // Inicializar para que la primera instrucción se busque
};

// ... (getInstructionIndexFromPC, parseInstruction, normalizeRegister, detectHazards sin cambios significativos inmediatos,
//      pero `detectHazards` podría ser llamado dentro de `calculateNextState` si los peligros cambian dinámicamente,
//      o su resultado usado de forma más activa para los data stalls) ...
// Función para obtener el índice de una instrucción basada en su dirección de PC
const getInstructionIndexFromPC = (pc: number, startAddr: number): number => {
  return (pc - startAddr) / 4;
}

const parseInstruction = (hexInstruction: string, currentPC: number, instructionIndex: number): RegisterUsage => {
  const binary = hexToBinary(hexInstruction.replace(/^0x/i, ''));
  const opcode = parseInt(binary.substring(0, 6), 2);
  const rs = parseInt(binary.substring(6, 11), 2);
  const rt = parseInt(binary.substring(11, 16), 2);

  let type: InstructionType = "R";
  let rd = 0;
  let funct = 0;
  let isLoad = false;
  let isStore = false;
  let isBranch = false;
  let isJump = false;
  let branchTargetAddress: number | undefined = undefined;
  let jumpTargetAddress: number | undefined = undefined;
  let isConditionalBranch = false;

  if (opcode === 0) { // R-type
    type = "R";
    rd = parseInt(binary.substring(16, 21), 2);
    funct = parseInt(binary.substring(26, 32), 2);
    if (funct === 0x08) { // jr
      isJump = true;
      // El target de JR depende del valor de $rs, se calcula en EX
    }
  } else if (opcode === 0x02 || opcode === 0x03) { // J-type (j, jal)
    type = "J";
    isJump = true;
    const jumpAddrBits = parseInt(binary.substring(6, 32), 2);
    // Dirección = (PC+4)[31:28] concatenado con jumpAddrBits * 4
    const pcHighBits = (currentPC + 4) & 0xF0000000;
    jumpTargetAddress = pcHighBits | (jumpAddrBits << 2);
    if (opcode === 0x03) rd = 31; // jal escribe en $ra
  } else if (opcode === 0x04 || opcode === 0x05) { // Saltos condicionales I-type (beq, bne)
    type = "I";
    isBranch = true;
    isConditionalBranch = true;
    const offset = parseInt(binary.substring(16, 32), 2);
    const signedOffset = (offset & 0x8000) ? (offset | 0xFFFF0000) : offset; // Extensión de signo
    branchTargetAddress = currentPC + 4 + (signedOffset << 2);
  } else { // Otros I-type
    type = "I";
    if ([0x23, 0x20, 0x21, 0x24, 0x25, 0x30].includes(opcode)) { // lw, lb, lh, lbu, lhu, ll
      isLoad = true; rd = rt;
    } else if ([0x2b, 0x28, 0x29, 0x38].includes(opcode)) { // sw, sb, sh, sc
      isStore = true; rd = 0;
    } else if ([0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e].includes(opcode)) { // addi, addiu, slti, sltiu, andi, ori, xori
      rd = rt;
    } else if (opcode === 0x0f) { // lui
      rd = rt;
    } else {
      rd = 0;
    }
  }
  return { rs, rt, rd, opcode, funct, type, isLoad, isStore, isBranch, isJump, branchTargetAddress, jumpTargetAddress, isConditionalBranch };
};

const normalizeRegister = (reg: string): string => {
  reg = reg.toLowerCase().trim();
  return reg.startsWith('$') ? reg : `$${reg}`;
};

// La función executeMIPSInstruction ya no es necesaria aquí si el pipeline maneja las etapas.
// Las acciones de cada etapa se harán en calculateNextState.

const detectHazards = (
  instructions: string[], // No se usa directamente, se usa registerUsage
  registerUsage: Record<number, RegisterUsage>,
  forwardingEnabled: boolean,
  stallsEnabled: boolean,
  pipelineLatches: SimulationState['pipelineLatches'] // Necesario para ver qué se escribe
): [Record<number, HazardInfo>, Record<number, ForwardingInfo[]>, Record<number, number>] => {
  const hazards: Record<number, HazardInfo> = {};
  const forwardings: Record<number, ForwardingInfo[]> = {};
  const stalls: Record<number, number> = {}; // Stalls causados POR la instrucción 'i'

  Object.keys(registerUsage).forEach(idxStr => {
    const i = parseInt(idxStr);
    hazards[i] = { type: "NONE", description: "No hazard", canForward: false, stallCycles: 0 };
    forwardings[i] = [];
    stalls[i] = 0;
  });

  if (!stallsEnabled) return [hazards, forwardings, stalls];

  const instructionIndices = Object.keys(registerUsage).map(Number).sort((a, b) => a - b);

  for (let i = 0; i < instructionIndices.length; i++) {
    const currentInstIdx = instructionIndices[i];
    const currentInst = registerUsage[currentInstIdx];
    if (!currentInst) continue;

    // Chequear con las 2 instrucciones previas en el orden del programa
    for (let k = 1; k <= 2; k++) {
      if (i - k < 0) break;
      const prevInstIdx = instructionIndices[i - k];
      const prevInst = registerUsage[prevInstIdx];
      if (!prevInst) continue;

      // ¿Qué registro escribe prevInst?
      // Si está en EX_MEM, el resultado ALU o el registro destino para cargas.
      // Si está en MEM_WB, el valor leído de memoria o el resultado ALU.
      let prevInstWritesToRegNum = -1;
      if (prevInst.type === "R" || (prevInst.type === "I" && (prevInst.isLoad || [8, 9, 10, 11, 12, 13, 14, 15].includes(prevInst.opcode)))) {
        prevInstWritesToRegNum = prevInst.rd;
      } else if (prevInst.type === "J" && prevInst.opcode === 0x03) { // jal
        prevInstWritesToRegNum = 31; // $ra
      }

      if (prevInstWritesToRegNum === 0 || prevInstWritesToRegNum === -1) continue; // No escribe o $zero

      let rawHazardOccurred = false;
      let hazardRegNum = -1;

      if (currentInst.rs !== 0 && currentInst.rs === prevInstWritesToRegNum) {
        rawHazardOccurred = true; hazardRegNum = currentInst.rs;
      }
      if (!rawHazardOccurred && currentInst.rt !== 0 && currentInst.rt === prevInstWritesToRegNum) {
        if (currentInst.type === 'R' || currentInst.isStore || currentInst.isBranch) {
          rawHazardOccurred = true; hazardRegNum = currentInst.rt;
        }
      }

      if (rawHazardOccurred) {
        const hazardRegName = `$${regMap[hazardRegNum.toString()] || `r${hazardRegNum}`}`;
        const distance = k; // 1 o 2

        if (prevInst.isLoad) { // Load-Use
          if (distance === 1) { // I(i) depende de I(i-1) que es LW
            stalls[currentInstIdx] = Math.max(stalls[currentInstIdx], 1);
            hazards[currentInstIdx] = { type: "RAW", description: `Load-use: I${currentInstIdx} (${hazardRegName}) on lw I${prevInstIdx}`, canForward: forwardingEnabled, stallCycles: 1 };
            if (forwardingEnabled) {
              forwardings[currentInstIdx].push({ from: prevInstIdx, to: currentInstIdx, fromStage: "MEM", toStage: "EX", register: hazardRegName });
            }
          }
        } else { // ALU-Use
          if (distance === 1) { // I(i) depende de I(i-1)
            if (forwardingEnabled) {
              // stalls[currentInstIdx] = 0; (No se acumula si ya hay un stall mayor)
              hazards[currentInstIdx] = { type: "RAW", description: `RAW: I${currentInstIdx} (${hazardRegName}) on I${prevInstIdx} (EX->EX forward)`, canForward: true, stallCycles: 0 };
              forwardings[currentInstIdx].push({ from: prevInstIdx, to: currentInstIdx, fromStage: "EX", toStage: "EX", register: hazardRegName });
            } else {
              stalls[currentInstIdx] = Math.max(stalls[currentInstIdx], 2);
              hazards[currentInstIdx] = { type: "RAW", description: `RAW: I${currentInstIdx} (${hazardRegName}) on I${prevInstIdx} (2 stalls)`, canForward: false, stallCycles: 2 };
            }
          } else if (distance === 2) { // I(i) depende de I(i-2)
            if (forwardingEnabled) {
              hazards[currentInstIdx] = { type: "RAW", description: `RAW: I${currentInstIdx} (${hazardRegName}) on I${prevInstIdx} (MEM->EX forward)`, canForward: true, stallCycles: 0 };
              forwardings[currentInstIdx].push({ from: prevInstIdx, to: currentInstIdx, fromStage: "MEM", toStage: "EX", register: hazardRegName });
            } else {
              stalls[currentInstIdx] = Math.max(stalls[currentInstIdx], 1);
              hazards[currentInstIdx] = { type: "RAW", description: `RAW: I${currentInstIdx} (${hazardRegName}) on I${prevInstIdx} (1 stall)`, canForward: false, stallCycles: 1 };
            }
          }
        }
      }
      // WAW Hazard (simplificado)
      let currentInstWritesToRegNum = -1;
      if (currentInst.type === "R" || (currentInst.type === "I" && (currentInst.isLoad || [8, 9, 10, 11, 12, 13, 14, 15].includes(currentInst.opcode)))) {
        currentInstWritesToRegNum = currentInst.rd;
      } else if (currentInst.type === "J" && currentInst.opcode === 0x03) { // jal
        currentInstWritesToRegNum = 31; // $ra
      }

      if (!rawHazardOccurred && currentInstWritesToRegNum !== 0 && currentInstWritesToRegNum !== -1 && currentInstWritesToRegNum === prevInstWritesToRegNum) {
        hazards[currentInstIdx] = { type: "WAW", description: `WAW: I${currentInstIdx} and I${prevInstIdx} both write to $${regMap[currentInstWritesToRegNum.toString()]}`, canForward: false, stallCycles: 0 };
      }
    }
  }
  return [hazards, forwardings, stalls];
};

// MODIFICACIONES PRINCIPALES EN calculateNextState

// Asume que STAGE_NAMES, getInstructionIndexFromPC, INSTRUCTION_START_ADDRESS,
// hexToBinary, regMap, parseInstruction están definidos como antes.

// SimulationContext.tsx

// ... (importaciones, tipos, constantes STAGE_NAMES, regMap, etc. como estaban antes)
// Asegúrate que INSTRUCTION_START_ADDRESS y getInstructionIndexFromPC estén definidos.
// Asegúrate que hexToBinary y parseInstruction estén definidos.

const calculateNextState = (prevState: SimulationState): SimulationState => {
  if (!prevState.isRunning || prevState.isFinished) {
    return prevState;
  }

  // Clonar el estado para modificarlo. Usar structuredClone para una copia más profunda y segura.
  const state: SimulationState = structuredClone(prevState);
  state.currentCycle++;
  console.log(`\nSIM_CTX Cycle: ${state.currentCycle} START -----------------------------------`);
  console.log(`SIM_CTX Prev Stages: ${JSON.stringify(prevState.instructionStages)}`);
  // console.log(`SIM_CTX Prev Latches: ${JSON.stringify(prevState.pipelineLatches)}`);


  let mispredictJustOccurredThisCycle = false;
  // hazards se actualiza directamente en state.hazards si ocurre un Control hazard
  
  // Estos serán los latches *después* de que las etapas de este ciclo hayan escrito en ellos
  const latchesAfterCurrentCycleExecution: SimulationState['pipelineLatches'] = structuredClone(prevState.pipelineLatches);
  // Estas serán las etapas de las instrucciones *después* de este ciclo de reloj
  const stagesAfterCurrentCycleExecution: Record<number, StageName | null> = {};

  let pcHasBeenRedirectedByEXMEM = false; // Si EX/MEM redirige el PC (branch/jump)
  let dataStallActivatedByIDThisCycle = false; // Si ID activa un data stall este ciclo

  // --- 1. MANEJAR STALLS GLOBALES ACTIVOS (efecto de stalls del ciclo ANTERIOR) ---
  if (prevState.currentDataStallCycles > 0) {
    state.currentDataStallCycles = prevState.currentDataStallCycles - 1;
    console.log(`SIM_CTX Cycle: ${state.currentCycle} - DATA STALL ACTIVE, remaining: ${state.currentDataStallCycles}`);
    Object.keys(prevState.instructionStages).forEach(idxStr => {
      const idx = parseInt(idxStr);
      const prevStageName = prevState.instructionStages[idx];
      if (prevStageName) {
        const prevStageNum = STAGE_NAMES.indexOf(prevStageName);
        if (prevStageNum >= STAGE_NAMES.indexOf("EX")) { // EX, MEM, WB avanzan
          const nextStageNum = prevStageNum + 1;
          stagesAfterCurrentCycleExecution[idx] = nextStageNum < STAGE_NAMES.length ? STAGE_NAMES[nextStageNum] : null;
        } else { // IF, ID se quedan donde estaban
          stagesAfterCurrentCycleExecution[idx] = prevStageName;
        }
      }
    });
    state.instructionStages = stagesAfterCurrentCycleExecution;
    state.pipelineLatches = latchesAfterCurrentCycleExecution; // Los latches no se "ejecutan"
    state.nextPCToFetch = prevState.nextPCToFetch; // Fetch congelado
    console.log(`SIM_CTX Cycle: ${state.currentCycle} END (DUE TO DATA STALL), instructionStages: ${JSON.stringify(state.instructionStages, null, 2)}`);
    return state;
  }

  if (prevState.branchMispredictActiveStallCycles > 0) {
    state.branchMispredictActiveStallCycles = prevState.branchMispredictActiveStallCycles - 1;
    console.log(`SIM_CTX Cycle: ${state.currentCycle} - MISPREDICT STALL ACTIVE, remaining: ${state.branchMispredictActiveStallCycles}`);
    Object.keys(prevState.instructionStages).forEach(idxStr => {
      const idx = parseInt(idxStr);
      const prevStageName = prevState.instructionStages[idx];
      if (prevStageName) {
        const prevStageNum = STAGE_NAMES.indexOf(prevStageName);
        if (prevStageNum >= STAGE_NAMES.indexOf("EX")) {
          const nextStageNum = prevStageNum + 1;
          stagesAfterCurrentCycleExecution[idx] = nextStageNum < STAGE_NAMES.length ? STAGE_NAMES[nextStageNum] : null;
        } else { // IF/ID fueron flusheadas
          stagesAfterCurrentCycleExecution[idx] = null;
        }
      }
    });
    state.instructionStages = stagesAfterCurrentCycleExecution;
    state.pipelineLatches = latchesAfterCurrentCycleExecution;
    // nextPCToFetch ya fue corregido cuando ocurrió el mispredict.
    console.log(`SIM_CTX Cycle: ${state.currentCycle} END (DUE TO MISPREDICT STALL), instructionStages: ${JSON.stringify(state.instructionStages, null, 2)}`);
    return state;
  }

  // --- 2. PROCESAMIENTO NORMAL DEL PIPELINE ---
  // Las etapas escriben en los latches para el *siguiente* ciclo.
  // Las etapas leen de los latches escritos por etapas *anteriores en este mismo ciclo de procesamiento lógico*
  // o del `prevState.pipelineLatches` si es la primera etapa que lee ese latch.

  const tempNextLatches: SimulationState['pipelineLatches'] = {}; // Latches que se formarán este ciclo

  // --- ETAPA WRITEBACK (WB) ---
  // Lee de MEM_WB llenado en el ciclo anterior (o por la etapa MEM en este procesamiento)
  // Actualiza state.registers
  // No escribe a ningún latch. La instrucción sale.
  for (const instIdxStr of Object.keys(prevState.instructionStages)) {
    const instIdx = parseInt(instIdxStr);
    if (prevState.instructionStages[instIdx] === "WB") {
      console.log(`SIM_CTX Cycle: ${state.currentCycle} - WB: Processing I${instIdx}`);
      const latchMEM_WB = prevState.pipelineLatches[instIdx]?.MEM_WB; // Latch de entrada
      if (latchMEM_WB) {
        const { regUsage, memReadValue, aluResult, writeReg } = latchMEM_WB;
        if (writeReg && writeReg !== "$zero") {
          let valueToWrite: number | undefined = undefined;
          if (regUsage.isLoad) valueToWrite = memReadValue;
          else if (regUsage.type === "R" || (regUsage.type === "I" && !regUsage.isStore && !regUsage.isBranch && !regUsage.isJump) || regUsage.opcode === 0x03 /*jal*/)
            valueToWrite = aluResult;
          if (valueToWrite !== undefined) {
            console.log(`SIM_CTX WB: I${instIdx} writing ${valueToWrite} to ${writeReg}`);
            state.registers[writeReg] = valueToWrite;
          }
        }
      }
      stagesAfterCurrentCycleExecution[instIdx] = null; // Sale del pipeline
    }
  }

  // --- ETAPA MEMORY (MEM) ---
  // Lee de EX_MEM llenado por la etapa EX en este procesamiento.
  // Realiza acceso a memoria. Escribe a MEM_WB para el siguiente ciclo.
  for (const instIdxStr of Object.keys(prevState.instructionStages)) {
    const instIdx = parseInt(instIdxStr);
    if (prevState.instructionStages[instIdx] === "MEM") {
      console.log(`SIM_CTX Cycle: ${state.currentCycle} - MEM: Processing I${instIdx}`);
      const latchEX_MEM = tempNextLatches[instIdx]?.EX_MEM || prevState.pipelineLatches[instIdx]?.EX_MEM; // Priorizar lo escrito este ciclo
      if (latchEX_MEM) {
        const { instruction, pc, instructionIndex, regUsage, aluResult, writeReg, valRtForStore } = latchEX_MEM;
        let memReadValue: number | undefined = undefined;

        if (regUsage.isLoad && aluResult !== undefined) { // CORRECCIÓN: Chequear aluResult
            const address = aluResult; const wordAddress = Math.floor(address / 4) * 4;
            console.log(`SIM_CTX MEM: I${instIdx} LW from addr 0x${address.toString(16)}`);
            if (state.memory[wordAddress] !== undefined) {
                let value = state.memory[wordAddress];
                if(regUsage.opcode === 0x20){value = (value >> ((address % 4)*8)) & 0xFF; if(value & 0x80) value |= 0xFFFFFF00;}
                // ... (más lógica de lb, lbu, etc.)
                memReadValue = value;
            } else { memReadValue = 0xDEAF; console.warn(`SIM_CTX MEM: I${instIdx} Read uninit mem 0x${wordAddress.toString(16)}`);}
        } else if (regUsage.isStore && aluResult !== undefined && valRtForStore !== undefined) { // CORRECCIÓN
            const address = aluResult; const valueToStore = valRtForStore; const wordAddress = Math.floor(address/4)*4;
            console.log(`SIM_CTX MEM: I${instIdx} SW ${valueToStore} to 0x${address.toString(16)}`);
            if(regUsage.opcode === 0x2B){state.memory[wordAddress]=valueToStore;}
            // ... (más lógica de sh, sb) ...
        }
        if(!tempNextLatches[instIdx]) tempNextLatches[instIdx] = {};
        tempNextLatches[instIdx]!.MEM_WB = { instruction, pc, instructionIndex, regUsage, memReadValue, aluResult, writeReg };
      }
      stagesAfterCurrentCycleExecution[instIdx] = "WB";
    }
  }

  // --- ETAPA EXECUTE (EX) ---
  // Lee de ID_EX. Realiza ALU, resuelve branches. Escribe a EX_MEM.
  for (const instIdxStr of Object.keys(prevState.instructionStages)) {
    const instIdx = parseInt(instIdxStr);
    if (prevState.instructionStages[instIdx] === "EX" && stagesAfterCurrentCycleExecution[instIdx] !== null /* Aún no flusheada por un branch anterior procesado en este ciclo */) {
      console.log(`SIM_CTX Cycle: ${state.currentCycle} - EX: Processing I${instIdx}`);
      const latchID_EX = tempNextLatches[instIdx]?.ID_EX || prevState.pipelineLatches[instIdx]?.ID_EX;
      if (latchID_EX) {
        const { instruction, pc, instructionIndex, regUsage, valRs, valRt, imm, predictedPC, predictedTaken } = latchID_EX;
        let aluResult: number | undefined, finalWriteReg: string | undefined, branchTakenActual = false, actualTargetPC: number | undefined;
        // ... TU LÓGICA ALU COMPLETA AQUÍ ...
        if(regUsage.type==="R"){finalWriteReg=`$${regMap[regUsage.rd.toString()]}`;switch(regUsage.funct){case 0x20:case 0x21:aluResult=valRs!+valRt!;break;case 0x22:case 0x23:aluResult=valRs!-valRt!;break;/*...*/case 0x08:actualTargetPC=valRs!;break;}}
        else if(regUsage.type==="I"){if(regUsage.isLoad||regUsage.isStore){aluResult=valRs!+(imm??0)!;}else if(regUsage.isConditionalBranch){if(valRs!==undefined && valRt!==undefined){if(regUsage.opcode===0x04&&valRs===valRt)branchTakenActual=true;if(regUsage.opcode===0x05&&valRs!==valRt)branchTakenActual=true;}actualTargetPC=branchTakenActual?regUsage.branchTargetAddress:pc+4;}else{finalWriteReg=`$${regMap[regUsage.rt.toString()]}`;switch(regUsage.opcode){/*...*/}}}
        else if(regUsage.type==="J"){actualTargetPC=regUsage.jumpTargetAddress!;if(regUsage.opcode===0x03){finalWriteReg="$ra";aluResult=pc+4;}}
        if (regUsage.isLoad) finalWriteReg = `$${regMap[regUsage.rd.toString()]}`;

        if (regUsage.isConditionalBranch && actualTargetPC !== undefined) {
          console.log(`SIM_CTX EX I${instIdx}: PredTaken=${predictedTaken}, PredPC=0x${predictedPC?.toString(16)}, ActualTaken=${branchTakenActual}, ActualTarget=0x${actualTargetPC.toString(16)}`);
          if (predictedTaken !== branchTakenActual || (predictedTaken && predictedPC !== actualTargetPC)) {
            console.warn(`SIM_CTX EX: MISPREDICT I${instIdx}!`);
            mispredictJustOccurredThisCycle = true; pcHasBeenRedirectedByEXMEM = true;
            state.nextPCToFetch = actualTargetPC;
            state.branchMispredictActiveStallCycles = 2;
            state.hazards[instIdx] = { type: "Control", description: `Branch I${instIdx} MISPREDICT.`, canForward: false, stallCycles: 2 };
            if(state.branchPredictionMode==="stateMachine"){/* ... */}
            console.log(`SIM_CTX EX: Flushing due to I${instIdx} mispredict. nextPCToFetch=0x${state.nextPCToFetch.toString(16)}`);
            for (let i = instIdx + 1; i < state.instructions.length; i++) {
                // Si la instrucción 'i' estaba destinada a estar en IF o ID en este ciclo, anularla.
                if (stagesAfterCurrentCycleExecution[i] === "IF" || stagesAfterCurrentCycleExecution[i] === "ID" || prevState.instructionStages[i] === "IF" || prevState.instructionStages[i] === "ID" ) {
                    console.log(`SIM_CTX FLUSH: I${i} (was ${prevState.instructionStages[i] ?? 'not in pipe'})`);
                    stagesAfterCurrentCycleExecution[i] = null;
                    if (tempNextLatches[i]) delete tempNextLatches[i]; // Limpiar sus futuros latches
                }
            }
          }
        } else if (regUsage.isJump && actualTargetPC !== undefined) {
            pcHasBeenRedirectedByEXMEM = true; state.nextPCToFetch = actualTargetPC;
            console.log(`SIM_CTX EX: Jump I${instIdx} to 0x${actualTargetPC.toString(16)}. Flushing.`);
            for (let i = instIdx + 1; i < state.instructions.length; i++) { /* ... FLUSH ... */ 
                if (stagesAfterCurrentCycleExecution[i] === "IF" || stagesAfterCurrentCycleExecution[i] === "ID" || prevState.instructionStages[i] === "IF" || prevState.instructionStages[i] === "ID" ) {
                    stagesAfterCurrentCycleExecution[i] = null; if (tempNextLatches[i]) delete tempNextLatches[i];
                }
            }
        }
        if(!tempNextLatches[instIdx]) tempNextLatches[instIdx] = {};
        tempNextLatches[instIdx]!.EX_MEM = { instruction, pc, instructionIndex, regUsage, aluResult, writeReg: finalWriteReg, valRtForStore: valRt, branchTakenActual, actualTargetPC };
      }
      if (stagesAfterCurrentCycleExecution[instIdx] !== null) stagesAfterCurrentCycleExecution[instIdx] = "MEM";
    }
  }

  // --- ETAPA INSTRUCTION DECODE (ID) ---
  for (const instIdxStr of Object.keys(prevState.instructionStages)) {
    const instIdx = parseInt(instIdxStr);
    if (prevState.instructionStages[instIdx] === "ID" && stagesAfterCurrentCycleExecution[instIdx] !== null) {
      console.log(`SIM_CTX Cycle: ${state.currentCycle} - ID: Processing I${instIdx}`);
      const latchIF_ID = prevState.pipelineLatches[instIdx]?.IF_ID;
      if (latchIF_ID) {
        const { instruction, pc, instructionIndex } = latchIF_ID;
        const regUsage = state.registerUsage[instructionIndex];
        if (!regUsage) { console.error(`SIM_CTX ID: Missing regUsage I${instIdx}`); stagesAfterCurrentCycleExecution[instIdx] = null; continue; }
        
        const valRs = regUsage.rs !== undefined ? state.registers[`$${regMap[regUsage.rs.toString()]}`] : undefined;
        const valRt = regUsage.rt !== undefined ? state.registers[`$${regMap[regUsage.rt.toString()]}`] : undefined;
        let imm: number | undefined; /* ... cálculo de imm ... */
        if(regUsage.type === "I"){const bin=hexToBinary(instruction.replace(/^0x/i,''));imm=parseInt(bin.substring(16,32),2);if(![0x0c,0x0d,0x0e,0x0f].includes(regUsage.opcode)){if(imm&0x8000)imm|=0xFFFF0000;}}
        else if(regUsage.type==="R"&&(regUsage.funct===0x00||regUsage.funct===0x02||regUsage.funct===0x03)){const bin=hexToBinary(instruction.replace(/^0x/i,''));imm=parseInt(bin.substring(21,26),2);}

        let predictedPCForNextFetch = pc + 4; let branchPredictedTaken = false;
        if (regUsage.isConditionalBranch) { /* ... lógica de predicción ... */ 
            switch(state.branchPredictionMode){case "static":branchPredictedTaken=state.staticBranchPrediction==="taken";break;case "stateMachine":branchPredictedTaken=state.globalStateMachineState==="WT"||state.globalStateMachineState==="ST";break;default:branchPredictedTaken=false;break;}
            if(branchPredictedTaken)predictedPCForNextFetch=regUsage.branchTargetAddress!;
            console.log(`SIM_CTX ID: Branch I${instIdx} pred ${branchPredictedTaken ? 'T' : 'NT'} to 0x${predictedPCForNextFetch.toString(16)}`);
        }
        else if (regUsage.isJump && regUsage.jumpTargetAddress !== undefined && regUsage.funct !== 0x08) {
          predictedPCForNextFetch = regUsage.jumpTargetAddress; branchPredictedTaken = true;
        }
        
        if (!pcHasBeenRedirectedByEXMEM && state.branchMispredictActiveStallCycles === 0) {
            state.nextPCToFetch = predictedPCForNextFetch;
        }
        if(!tempNextLatches[instIdx]) tempNextLatches[instIdx] = {};
        tempNextLatches[instIdx]!.ID_EX = { instruction, pc, instructionIndex, regUsage, valRs, valRt, imm, predictedPC: predictedPCForNextFetch, predictedTaken: branchPredictedTaken };
        
        if (state.stalls[instIdx] > 0 && !prevState.currentDataStallCycles && !prevState.branchMispredictActiveStallCycles) {
            console.warn(`SIM_CTX ID: DATA STALL for I${instIdx}, ${state.stalls[instIdx]} cycles. Freezing in ID.`);
            state.currentDataStallCycles = state.stalls[instIdx]; dataStallActivatedByIDThisCycle = true;
            stagesAfterCurrentCycleExecution[instIdx] = "ID"; // Congelar
            if (branchPredictedTaken && !pcHasBeenRedirectedByEXMEM) {state.nextPCToFetch = pc + 4;}
        } else {
            stagesAfterCurrentCycleExecution[instIdx] = "EX";
        }
      } else { stagesAfterCurrentCycleExecution[instIdx] = null; }
    }
  }

  // --- ETAPA INSTRUCTION FETCH (IF) ---
  // Avanzar la instrucción que ESTABA en IF
  for (const instIdxStr of Object.keys(prevState.instructionStages)) {
      const instIdx = parseInt(instIdxStr);
      if (prevState.instructionStages[instIdx] === "IF" && stagesAfterCurrentCycleExecution[instIdx] !== null /* no flusheada */) {
          console.log(`SIM_CTX Cycle: ${state.currentCycle} - IF->ID: Advancing I${instIdx}`);
          stagesAfterCurrentCycleExecution[instIdx] = "ID"; // Avanza a ID
          // El latch IF_ID ya fue escrito en el ciclo anterior y está en prevState.pipelineLatches
          // y se copiará a tempNextLatches si no se sobrescribe.
          // Aseguramos que el latch IF_ID esté disponible para la etapa ID en el siguiente ciclo de procesamiento
          if (prevState.pipelineLatches[instIdx]?.IF_ID) {
            if(!tempNextLatches[instIdx]) tempNextLatches[instIdx] = {};
             // @ts-ignore // Sobrescribir IF_ID del latch anterior con el mismo dato es redundante pero inofensivo
            tempNextLatches[instIdx]!.IF_ID = prevState.pipelineLatches[instIdx]!.IF_ID;
          }
      }
  }

  // Ahora, realizar el NUEVO FETCH
  if (!dataStallActivatedByIDThisCycle && !prevState.currentDataStallCycles && 
      !mispredictJustOccurredThisCycle && !prevState.branchMispredictActiveStallCycles) {
    const pcToFetch = state.nextPCToFetch;
    const indexToFetch = getInstructionIndexFromPC(pcToFetch, INSTRUCTION_START_ADDRESS);

    if (indexToFetch < state.instructions.length && indexToFetch >= 0) {
      // Solo fetchear si no está ya en el pipeline con una etapa válida
      if (stagesAfterCurrentCycleExecution[indexToFetch] === undefined || stagesAfterCurrentCycleExecution[indexToFetch] === null) {
          console.log(`SIM_CTX Cycle: ${state.currentCycle} - IF: Fetching NEW I${indexToFetch} from PC 0x${pcToFetch.toString(16)}`);
          const instructionHex = state.instructions[indexToFetch];
          if (!state.registerUsage[indexToFetch]) {
              state.registerUsage[indexToFetch] = parseInstruction(instructionHex, pcToFetch, indexToFetch);
          }
          if(!tempNextLatches[indexToFetch]) tempNextLatches[indexToFetch] = {};
          tempNextLatches[indexToFetch]!.IF_ID = { instruction: instructionHex, pc: pcToFetch, instructionIndex: indexToFetch };
          stagesAfterCurrentCycleExecution[indexToFetch] = "IF";
          state.lastFetchedPC = pcToFetch;

          if (!pcHasBeenRedirectedByEXMEM) { // Si EX/MEM no tomaron un salto este ciclo
              state.nextPCToFetch = pcToFetch + 4;
          }
      }
    }
  } else {
      console.log(`SIM_CTX IF: Fetch STALLED this cycle.`);
  }
  state.PC = state.nextPCToFetch;


  // Asignación final al estado
  state.instructionStages = stagesAfterCurrentCycleExecution;
  state.pipelineLatches = tempNextLatches; // Estos son los latches al *final* del ciclo actual

  // ... (lógica de isFinished) ...
  let activeInstructionsCount = 0;
  Object.values(state.instructionStages).forEach(stage => { if (stage !== null) activeInstructionsCount++; });
  const noMoreInstructionsToFetch = state.nextPCToFetch >= (INSTRUCTION_START_ADDRESS + state.instructions.length * 4);
  if (activeInstructionsCount === 0 && (noMoreInstructionsToFetch || state.instructions.length === 0)) {
    if (!mispredictJustOccurredThisCycle && !dataStallActivatedByIDThisCycle && state.currentDataStallCycles === 0 && state.branchMispredictActiveStallCycles === 0) {
        state.isFinished = true; state.isRunning = false;
        console.log(`SIM_CTX Cycle: ${state.currentCycle} - SIMULATION FINISHED.`);
    }
  }
  
  console.log(`SIM_CTX Cycle: ${state.currentCycle} END, instructionStages: ${JSON.stringify(state.instructionStages, null, 2)}`);
  console.log(`PC: 0x${state.PC.toString(16)}, nextPCToFetch: 0x${state.nextPCToFetch.toString(16)}, DataStalls: ${state.currentDataStallCycles}, MispredStalls: ${state.branchMispredictActiveStallCycles}`);
  console.log(`--------------------------------------------------------------------`);

  return state;
};
// ... (SimulationProvider, Hooks useSimulationState, useSimulationActions sin cambios en su definición,
//      pero startSimulation y resetSimulation se ajustan abajo) ...

export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = useState<SimulationState>(initialState);
  // ... (intervalRef, clearTimer, runClock, useEffect para el timer sin cambios) ...
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  const runClock = useCallback(() => {
    clearTimer();
    intervalRef.current = setInterval(() => {
      setSimulationState(prevState => {
        if (!prevState.isRunning || prevState.isFinished) {
          clearTimer(); return prevState;
        }
        const nextSimState = calculateNextState(prevState);
        // Recalcular hazards de datos aquí si fuera necesario para el display,
        // o asegurar que calculateNextState los mantenga actualizados.
        // nextSimState.hazards = ... recalcular data hazards si es necesario ...
        if (nextSimState.isFinished && !prevState.isFinished) clearTimer();
        return nextSimState;
      });
    }, 700); // Ajustar velocidad
  }, []); // runClock no tiene dependencias que cambien su definición

  useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) runClock();
    else clearTimer();
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);


  const resetSimulation = useCallback(() => {
    clearTimer();
    setSimulationState(prevState => ({
      ...initialState,
      PC: INSTRUCTION_START_ADDRESS,
      nextPCToFetch: INSTRUCTION_START_ADDRESS,
      lastFetchedPC: -1,
      // Mantener configuraciones del usuario
      forwardingEnabled: prevState.forwardingEnabled,
      stallsEnabled: prevState.stallsEnabled,
      branchPredictionMode: prevState.branchPredictionMode,
      staticBranchPrediction: prevState.staticBranchPrediction,
      stateMachineInitialPrediction: prevState.stateMachineInitialPrediction,
      stateMachineFailsToSwitch: prevState.stateMachineFailsToSwitch,
      globalStateMachineState: prevState.stateMachineInitialPrediction === "taken" ? "ST" : "SN",
    }));
  }, []);

  const startSimulation = useCallback(
    (submittedInstructions: string[]) => {
      clearTimer();
      if (submittedInstructions.length === 0) {
        resetSimulation(); return;
      }

      const parsedRegisterUsage: Record<number, RegisterUsage> = {};
      submittedInstructions.forEach((instHex, index) => {
        const pcForInstruction = INSTRUCTION_START_ADDRESS + (index * 4);
        // El índice para registerUsage es el índice del array de instrucciones
        parsedRegisterUsage[index] = parseInstruction(instHex, pcForInstruction, index);
      });

      // Detectar hazards de datos iniciales
      const [initialDataHazards, initialForwardings, initialDataStalls] = detectHazards(
        submittedInstructions, // No se usa aquí, se usa parsedRegisterUsage
        parsedRegisterUsage,
        simulationState.forwardingEnabled, // Del estado actual de configuración
        simulationState.stallsEnabled,
        initialState.pipelineLatches // Vacío al inicio
      );

      setSimulationState(prevState => ({
        ...initialState, // Base limpia
        PC: INSTRUCTION_START_ADDRESS,
        nextPCToFetch: INSTRUCTION_START_ADDRESS,
        lastFetchedPC: -1,
        // Mantener configuraciones
        forwardingEnabled: prevState.forwardingEnabled,
        stallsEnabled: prevState.stallsEnabled,
        branchPredictionMode: prevState.branchPredictionMode,
        staticBranchPrediction: prevState.staticBranchPrediction,
        stateMachineInitialPrediction: prevState.stateMachineInitialPrediction,
        stateMachineFailsToSwitch: prevState.stateMachineFailsToSwitch,
        globalStateMachineState: prevState.stateMachineInitialPrediction === "taken" ? "ST" : "SN",
        // Nuevos datos de simulación
        instructions: submittedInstructions,
        registerUsage: parsedRegisterUsage,
        hazards: initialDataHazards, // Solo peligros de datos al inicio
        forwardings: initialForwardings,
        stalls: initialDataStalls, // Solo stalls de datos al inicio
        currentCycle: 0,
        isRunning: true,
        isFinished: false,
      }));
    },
    [resetSimulation, simulationState.forwardingEnabled, simulationState.stallsEnabled]
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
      if (!prevState.isRunning && prevState.instructions.length > 0 && !prevState.isFinished) {
        return { ...prevState, isRunning: true };
      }
      return prevState;
    });
  }, []);

  const setForwardingEnabled = useCallback((enabled: boolean) => {
    setSimulationState((prevState) => ({ ...prevState, forwardingEnabled: enabled }));
  }, []);

  const setStallsEnabled = useCallback((enabled: boolean) => {
    setSimulationState((prevState) => ({
      ...prevState,
      stallsEnabled: enabled,
      forwardingEnabled: enabled ? prevState.forwardingEnabled : false,
    }));
  }, []);

  const setBranchPredictionMode = useCallback((mode: BranchPredictionMode) => {
    setSimulationState((prevState) => ({ ...prevState, branchPredictionMode: mode }));
  }, []);

  const setStaticBranchPrediction = useCallback((prediction: StaticBranchPrediction) => {
    setSimulationState((prevState) => ({ ...prevState, staticBranchPrediction: prediction }));
  }, []);

  const setStateMachineInitialPrediction = useCallback((prediction: StateMachineInitialPrediction) => {
    setSimulationState((prevState) => ({
      ...prevState,
      stateMachineInitialPrediction: prediction,
      globalStateMachineState: prediction === "taken" ? "ST" : "SN", // Resetear el predictor global
    }));
  }, []);

  const setStateMachineFailsToSwitch = useCallback((fails: number) => {
    setSimulationState((prevState) => ({ ...prevState, stateMachineFailsToSwitch: Math.max(1, fails) }));
  }, []);


  const actionsValue: SimulationActions = useMemo(
    () => ({
      startSimulation, resetSimulation, pauseSimulation, resumeSimulation,
      setForwardingEnabled, setStallsEnabled, setBranchPredictionMode,
      setStaticBranchPrediction, setStateMachineInitialPrediction, setStateMachineFailsToSwitch,
    }),
    [startSimulation, resetSimulation, pauseSimulation, resumeSimulation,
      setForwardingEnabled, setStallsEnabled, setBranchPredictionMode,
      setStaticBranchPrediction, setStateMachineInitialPrediction, setStateMachineFailsToSwitch,
    ]
  );

  return (
    <SimulationStateContext.Provider value={simulationState}>
      <SimulationActionsContext.Provider value={actionsValue}>
        {children}
      </SimulationActionsContext.Provider>
    </SimulationStateContext.Provider>
  );
}

// Custom hooks
export function useSimulationState() {
  const context = useContext(SimulationStateContext);
  if (context === undefined) {
    throw new Error("useSimulationState must be used within a SimulationProvider");
  }
  return context;
}

export function useSimulationActions() {
  const context = useContext(SimulationActionsContext);
  if (context === undefined) {
    throw new Error("useSimulationActions must be used within a SimulationProvider");
  }
  return context;
}