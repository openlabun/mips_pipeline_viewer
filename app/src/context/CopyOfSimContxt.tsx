// src/context/SimulationContext.tsx
"use client";

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
import { translateInstructionToMIPS, hexToBinary } from "./Converter"; // Asegúrate que la ruta sea correcta

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
  instructions: string[]; // Array de instrucciones en hexadecimal
  currentCycle: number;
  maxCycles: number;
  isRunning: boolean;
  stageCount: number;
  instructionStages: Record<number, StageName | null>; // Almacena la ETAPA actual de cada instrucción
  isFinished: boolean;
  registerUsage: Record<number, RegisterUsage>; // Información parseada por índice de instrucción
  hazards: Record<number, HazardInfo>; // Peligros por índice de instrucción
  forwardings: Record<number, ForwardingInfo[]>; // Forwardings para la instrucción en el índice
  stalls: Record<number, number>; // Stalls causados POR la instrucción en el índice
  
  currentStallCycles: number; // Contador de ciclos de stall globales activos
  branchMispredictStallCycles: number; // Contador de stalls por predicción errónea

  forwardingEnabled: boolean;
  stallsEnabled: boolean; // Para peligros de datos

  registers: Record<string, number>; // Estado de los registros
  memory: Record<number, number>;    // Estado de la memoria (dirección de byte -> valor de palabra)
  PC: number; // Program Counter (dirección de byte de la próxima instrucción a buscar)

  // Estado de Predicción de Saltos
  branchPredictionMode: BranchPredictionMode;
  staticBranchPrediction: StaticBranchPrediction;
  stateMachineInitialPrediction: StateMachineInitialPrediction;
  stateMachineFailsToSwitch: number;
  // Para un predictor de máquina de estados más real, se necesitaría un estado por cada dirección de salto:
  // branchPredictorStates: Record<number, BranchPredictorState>; // PC del salto -> estado del predictor
  // Por ahora, usaremos una máquina de estados global simplificada:
  globalStateMachineState: BranchPredictorState;
  globalStateMachineFailCount: number;

  // Estado para simular el pipeline
  pipelineLatches: { // Contenido de los latches entre etapas para cada instrucción en el pipeline
      [key: number]: { // instructionIndex
          IF_ID?: any; // Datos pasados de IF a ID
          ID_EX?: { instruction: string; pc: number; regUsage: RegisterUsage; valRs?: number; valRt?: number; imm?: number; predictedPC?: number; predictedTaken?: boolean };
          EX_MEM?: { instruction: string; pc: number; regUsage: RegisterUsage; aluResult?: number; writeReg?: string; valRtForStore?: number; branchTakenActual?: boolean; actualTargetPC?: number };
          MEM_WB?: { instruction: string; pc: number; regUsage: RegisterUsage; memReadValue?: number; aluResult?: number; writeReg?: string };
      }
  };
  nextPCToFetch: number; // PC de la siguiente instrucción a introducir en IF
}

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
  currentStallCycles: 0,
  branchMispredictStallCycles: 0,
  forwardingEnabled: true,
  stallsEnabled: true,
  registers: { ...initialRegisters },
  memory: { ...initialMemory },
  PC: INSTRUCTION_START_ADDRESS, // PC inicial
  branchPredictionMode: "none",
  staticBranchPrediction: "notTaken",
  stateMachineInitialPrediction: "notTaken",
  stateMachineFailsToSwitch: 1, // 1 fallo para cambiar en un predictor de 2 bits simple
  globalStateMachineState: "SN", // Iniciar en Strongly Not Taken
  globalStateMachineFailCount: 0,
  pipelineLatches: {},
  nextPCToFetch: INSTRUCTION_START_ADDRESS,
};

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
      if (prevInst.type === "R" || (prevInst.type === "I" && (prevInst.isLoad || [8,9,10,11,12,13,14,15].includes(prevInst.opcode) ) ) ) {
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
      if (currentInst.type === "R" || (currentInst.type === "I" && (currentInst.isLoad || [8,9,10,11,12,13,14,15].includes(currentInst.opcode) ) ) ) {
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


const calculateNextState = (prevState: SimulationState): SimulationState => {
  if (!prevState.isRunning || prevState.isFinished) {
    return prevState;
  }

  const state: SimulationState = JSON.parse(JSON.stringify(prevState)); // Deep copy para trabajar
  state.currentCycle++;
  let newHazards = { ...state.hazards };
  let mispredictHappenedThisCycle = false;

  // 1. Manejar Stalls Globales (de datos o predicción errónea)
  if (state.currentStallCycles > 0) {
    state.currentStallCycles--;
    // Las instrucciones en IF/ID se congelan, el resto avanza. PC de fetch no avanza.
    Object.keys(state.instructionStages).forEach(idxStr => {
        const idx = parseInt(idxStr);
        const currentStageName = state.instructionStages[idx];
        if (currentStageName && (STAGE_NAMES.indexOf(currentStageName) >= STAGE_NAMES.indexOf("EX"))) {
            const nextStageIdx = STAGE_NAMES.indexOf(currentStageName) + 1;
            state.instructionStages[idx] = nextStageIdx < STAGE_NAMES.length ? STAGE_NAMES[nextStageIdx] : null;
        }
    });
    return state; // No más procesamiento este ciclo
  }
  if (state.branchMispredictStallCycles > 0) {
    state.branchMispredictStallCycles--;
    state.nextPCToFetch = state.PC; // Mantener el PC de fetch corregido
    // Similar al stall de datos, IF/ID congelados.
     Object.keys(state.instructionStages).forEach(idxStr => {
        const idx = parseInt(idxStr);
        const currentStageName = state.instructionStages[idx];
        if (currentStageName && (STAGE_NAMES.indexOf(currentStageName) >= STAGE_NAMES.indexOf("EX"))) {
            const nextStageIdx = STAGE_NAMES.indexOf(currentStageName) + 1;
            state.instructionStages[idx] = nextStageIdx < STAGE_NAMES.length ? STAGE_NAMES[nextStageIdx] : null;
        }
    });
    return state;
  }


  // Pipeline Stages (WB -> MEM -> EX -> ID -> IF) - Procesar en orden inverso para simular flujo de datos correcto
  const newPipelineLatches: SimulationState['pipelineLatches'] = {};
  const nextInstructionStages: Record<number, StageName | null> = {};
  const instructionIndicesInPipeline = Object.keys(state.instructionStages)
      .map(Number)
      .filter(idx => state.instructionStages[idx] !== null)
      .sort((a, b) => b - a); // Procesar de WB hacia IF

  // --- ETAPA WRITEBACK (WB) ---
  for (const instIdx of instructionIndicesInPipeline) {
    if (state.instructionStages[instIdx] === "WB") {
      const wbLatch = state.pipelineLatches[instIdx]?.MEM_WB;
      if (wbLatch) {
        const regUsage = wbLatch.regUsage;
        if (wbLatch.writeReg && wbLatch.writeReg !== "$zero") { // Hay algo que escribir
          if (regUsage.isLoad) {
            state.registers[wbLatch.writeReg] = wbLatch.memReadValue!;
          } else if (regUsage.type === "R" || (regUsage.type === "I" && !regUsage.isStore && !regUsage.isBranch) || regUsage.opcode === 0x03 /*jal*/) {
            state.registers[wbLatch.writeReg] = wbLatch.aluResult!;
          }
        }
      }
      nextInstructionStages[instIdx] = null; // Sale del pipeline
      delete newPipelineLatches[instIdx]; // Limpiar latches
    }
  }

  // --- ETAPA MEMORY (MEM) ---
  for (const instIdx of instructionIndicesInPipeline) {
    if (state.instructionStages[instIdx] === "MEM") {
      const memLatch = state.pipelineLatches[instIdx]?.EX_MEM;
      if (memLatch) {
        const regUsage = memLatch.regUsage;
        let memReadValue: number | undefined = undefined;

        if (regUsage.isLoad) {
          const address = memLatch.aluResult!; // Dirección calculada en EX
          // La memoria está indexada por dirección de byte, cada entrada es una palabra
          const wordAddress = Math.floor(address / 4) * 4; // Alineado a palabra
          if (state.memory[wordAddress] !== undefined) {
              let value = state.memory[wordAddress];
              if(regUsage.opcode === 0x20) { // lb
                const byteOffset = address % 4;
                value = (value >> (byteOffset * 8)) & 0xFF;
                if (value & 0x80) value |= 0xFFFFFF00; // Sign extend
              } else if (regUsage.opcode === 0x24) { // lbu
                const byteOffset = address % 4;
                value = (value >> (byteOffset * 8)) & 0xFF;
              } else if (regUsage.opcode === 0x21) { // lh
                const halfWordOffset = (address % 4) / 2; // 0 o 1
                value = (value >> (halfWordOffset * 16)) & 0xFFFF;
                if (value & 0x8000) value |= 0xFFFF0000; // Sign extend
              } else if (regUsage.opcode === 0x25) { // lhu
                const halfWordOffset = (address % 4) / 2;
                value = (value >> (halfWordOffset * 16)) & 0xFFFF;
              }
              // lw (0x23) and ll (0x30) take the whole word
              memReadValue = value;
          } else { /* console.error(`MEM Access Error: Address ${address} not found`);*/ memReadValue = 0; }
        } else if (regUsage.isStore) {
          const address = memLatch.aluResult!;
          const valueToStore = memLatch.valRtForStore!;
          const wordAddress = Math.floor(address / 4) * 4;

          if (regUsage.opcode === 0x2B) { // sw
            state.memory[wordAddress] = valueToStore;
          } else if (regUsage.opcode === 0x29) { // sh
            const halfWordOffset = (address % 4) / 2;
            const currentWord = state.memory[wordAddress] || 0;
            const mask = ~(0xFFFF << (halfWordOffset * 16));
            state.memory[wordAddress] = (currentWord & mask) | ((valueToStore & 0xFFFF) << (halfWordOffset * 16));
          } else if (regUsage.opcode === 0x28) { // sb
            const byteOffset = address % 4;
            const currentWord = state.memory[wordAddress] || 0;
            const mask = ~(0xFF << (byteOffset * 8));
            state.memory[wordAddress] = (currentWord & mask) | ((valueToStore & 0xFF) << (byteOffset * 8));
          }
          // sc (0x38) es más complejo (atómico)
        }
        newPipelineLatches[instIdx] = {
            ...state.pipelineLatches[instIdx],
            MEM_WB: { ...memLatch, memReadValue }
        };
      }
      nextInstructionStages[instIdx] = "WB";
    }
  }

  // --- ETAPA EXECUTE (EX) ---
  for (const instIdx of instructionIndicesInPipeline) {
    if (state.instructionStages[instIdx] === "EX") {
      const exLatch = state.pipelineLatches[instIdx]?.ID_EX;
      if (exLatch) {
        const { instruction, pc, regUsage, valRs, valRt, imm, predictedPC, predictedTaken } = exLatch;
        let aluResult: number | undefined = undefined;
        let writeReg: string | undefined = undefined; // Registro destino
        let branchTakenActual = false;
        let actualTargetPC: number | undefined = undefined;
        let valRtForStore: number | undefined = valRt; // Para sw, sh, sb

        // Lógica ALU
        if (regUsage.type === "R") {
          writeReg = `$${regMap[regUsage.rd.toString()]}`;
          switch (regUsage.funct) {
            case 0x20: case 0x21: aluResult = valRs! + valRt!; break; // add, addu
            case 0x22: case 0x23: aluResult = valRs! - valRt!; break; // sub, subu
            case 0x24: aluResult = valRs! & valRt!; break;   // and
            case 0x25: aluResult = valRs! | valRt!; break;   // or
            case 0x26: aluResult = valRs! ^ valRt!; break;   // xor
            case 0x27: aluResult = ~(valRs! | valRt!); break; // nor
            case 0x2a: aluResult = valRs! < valRt! ? 1 : 0; break; // slt
            case 0x2b: aluResult = (valRs!>>>0) < (valRt!>>>0) ? 1 : 0; break; // sltu
            case 0x00: aluResult = valRt! << imm!; break; // sll (imm tiene shamt)
            case 0x02: aluResult = valRt! >>> imm!; break; // srl
            case 0x03: aluResult = valRt! >> imm!; break;  // sra
            case 0x08: actualTargetPC = valRs!; break; // jr
          }
        } else if (regUsage.type === "I") {
          if (regUsage.isLoad || regUsage.isStore) { // lw, sw, etc.
            aluResult = valRs! + imm!; // Dirección efectiva
            if (regUsage.isLoad) writeReg = `$${regMap[regUsage.rt.toString()]}`;
            // valRtForStore ya está seteado
          } else if (regUsage.isConditionalBranch) { // beq, bne
            if (regUsage.opcode === 0x04 && valRs === valRt) branchTakenActual = true; // beq
            if (regUsage.opcode === 0x05 && valRs !== valRt) branchTakenActual = true; // bne
            actualTargetPC = branchTakenActual ? regUsage.branchTargetAddress : pc + 4;

            // Comparar predicción con resultado real
            if (predictedTaken !== branchTakenActual || (predictedTaken && predictedPC !== actualTargetPC)) {
              mispredictHappenedThisCycle = true;
              state.PC = actualTargetPC!; // Corregir PC para el fetch
              state.nextPCToFetch = actualTargetPC!;
              state.branchMispredictStallCycles = 2; // Penalización
              newHazards[instIdx] = { type: "Control", description: `Branch mispredict I${instIdx}. Predicted ${predictedTaken ? 'Taken' : 'Not-Taken'} to 0x${predictedPC?.toString(16)}, Actual: ${branchTakenActual ? 'Taken' : 'Not-Taken'} to 0x${actualTargetPC?.toString(16)}`, canForward: false, stallCycles: 2 };
              
              // Actualizar predictor de máquina de estados (simplificado global)
              if (state.branchPredictionMode === "stateMachine") {
                const wasTaken = branchTakenActual;
                let currentState = state.globalStateMachineState;
                if (wasTaken) {
                    if (currentState === "SN") currentState = "WN";
                    else if (currentState === "WN") currentState = "WT";
                    else if (currentState === "WT") currentState = "ST";
                    // ST se queda en ST
                } else { // No fue tomado
                    if (currentState === "ST") currentState = "WT";
                    else if (currentState === "WT") currentState = "WN";
                    else if (currentState === "WN") currentState = "SN";
                    // SN se queda en SN
                }
                state.globalStateMachineState = currentState;
              }

              // --- FLUSH PIPELINE ---
              // Invalidar instrucciones en IF e ID que fueron buscadas incorrectamente
              Object.keys(state.instructionStages).forEach(key => {
                const flushIdx = parseInt(key);
                if (flushIdx > instIdx) { // Instrucciones posteriores a la de branch
                    const stage = state.instructionStages[flushIdx];
                    if (stage === "IF" || stage === "ID") {
                        // console.log(`Flushing I${flushIdx} from ${stage} due to mispredict by I${instIdx}`);
                        nextInstructionStages[flushIdx] = null;
                        delete newPipelineLatches[flushIdx];
                    }
                }
              });
            }
          } else { // Aritméticas I-type
            writeReg = `$${regMap[regUsage.rt.toString()]}`;
            switch (regUsage.opcode) {
              case 0x08: case 0x09: aluResult = valRs! + imm!; break; // addi, addiu
              case 0x0c: aluResult = valRs! & imm!; break; // andi
              case 0x0d: aluResult = valRs! | imm!; break; // ori
              case 0x0e: aluResult = valRs! ^ imm!; break; // xori
              case 0x0a: aluResult = valRs! < imm! ? 1 : 0; break; // slti
              case 0x0b: aluResult = (valRs!>>>0) < (imm!>>>0) ? 1 : 0; break; // sltiu
              case 0x0f: aluResult = imm! << 16; break; // lui
            }
          }
        } else if (regUsage.type === "J") { // j, jal
            actualTargetPC = regUsage.jumpTargetAddress!;
            if (regUsage.opcode === 0x03) { // jal
                writeReg = "$ra";
                aluResult = pc + 4; // Dirección de retorno
            }
            state.PC = actualTargetPC; // Salto incondicional, actualizar PC para fetch
            state.nextPCToFetch = actualTargetPC;
             // --- FLUSH PIPELINE para Jumps ---
            Object.keys(state.instructionStages).forEach(key => {
                const flushIdx = parseInt(key);
                if (flushIdx > instIdx) {
                    const stage = state.instructionStages[flushIdx];
                    if (stage === "IF" || stage === "ID") {
                        nextInstructionStages[flushIdx] = null;
                        delete newPipelineLatches[flushIdx];
                    }
                }
            });
        }
        newPipelineLatches[instIdx] = {
            ...state.pipelineLatches[instIdx],
            EX_MEM: { instruction, pc, regUsage, aluResult, writeReg, valRtForStore, branchTakenActual, actualTargetPC }
        };
      }
      if (!mispredictHappenedThisCycle) nextInstructionStages[instIdx] = "MEM"; // Avanzar si no hubo mispredict
      else nextInstructionStages[instIdx] = null; // Si hubo mispredict, esta instrucción se flushea también (o se convierte en NOP)
                                                // Por ahora, la dejamos avanzar pero su resultado no importa si hay stall.
                                                // Una mejor simulación la convertiría en NOP o la sacaría.
                                                // Con los stalls de mispredict, las etapas IF/ID se limpian.
    }
  }

  // --- ETAPA INSTRUCTION DECODE (ID) ---
  for (const instIdx of instructionIndicesInPipeline) {
    if (state.instructionStages[instIdx] === "ID") {
      const idLatch = state.pipelineLatches[instIdx]?.IF_ID; // IF_ID contiene { instruction: string, pc: number }
      if (idLatch && idLatch.instruction) {
        const regUsage = state.registerUsage[instIdx];
        if (!regUsage) { // Debería estar parseada
             console.error("Error: regUsage no encontrado para ", instIdx, " en ID");
             nextInstructionStages[instIdx] = null; continue;
        }

        // Leer operandos (rs, rt)
        const valRs = regUsage.rs !== undefined ? state.registers[`$${regMap[regUsage.rs.toString()]}`] : undefined;
        const valRt = regUsage.rt !== undefined ? state.registers[`$${regMap[regUsage.rt.toString()]}`] : undefined;
        let imm: number | undefined;
        if(regUsage.type === "I") {
            const binary = hexToBinary(idLatch.instruction.replace(/^0x/i, ''));
            imm = parseInt(binary.substring(16, 32), 2);
            if ((regUsage.opcode !== 0x0c && regUsage.opcode !== 0x0d && regUsage.opcode !== 0x0e && regUsage.opcode !== 0x0f)) { // andi, ori, xori, lui son unsigned
                 if (imm & 0x8000) imm |= 0xFFFF0000; // Sign-extend para addi, slti, loads, stores, branches
            }
        } else if (regUsage.type === "R" && (regUsage.funct === 0x00 || regUsage.funct === 0x02 || regUsage.funct === 0x03 )) { // sll, srl, sra
            const binary = hexToBinary(idLatch.instruction.replace(/^0x/i, ''));
            imm = parseInt(binary.substring(21, 26), 2); // shamt
        }

        let predictedPC = idLatch.pc + 4;
        let predictedTaken = false;

        // Lógica de Predicción de Salto
        if (regUsage.isConditionalBranch) {
          switch (state.branchPredictionMode) {
            case "static":
              predictedTaken = state.staticBranchPrediction === "taken";
              break;
            case "stateMachine":
              // Usar predictor global simplificado
              predictedTaken = state.globalStateMachineState === "WT" || state.globalStateMachineState === "ST";
              break;
            case "none": // No predecir, o asumir no tomado
            default:
              predictedTaken = false;
              break;
          }
          if (predictedTaken) {
            predictedPC = regUsage.branchTargetAddress!;
          }
        }
        
        // Si la predicción indica un salto (o es un salto incondicional no JR), actualizar nextPCToFetch
        if (predictedTaken && regUsage.isConditionalBranch) {
            if (!mispredictHappenedThisCycle) state.nextPCToFetch = predictedPC;
        }
        // Para Jumps (J, JAL), el target es conocido en ID
        if (regUsage.isJump && !regUsage.isConditionalBranch && regUsage.jumpTargetAddress !== undefined && regUsage.funct !== 0x08 /* no jr */) {
            if (!mispredictHappenedThisCycle) state.nextPCToFetch = regUsage.jumpTargetAddress;
        }
        // Para JR, el target se conoce en EX, así que aquí asumimos PC+4 si no hay otra predicción.

        newPipelineLatches[instIdx] = {
            ...state.pipelineLatches[instIdx],
            ID_EX: { instruction: idLatch.instruction, pc: idLatch.pc, regUsage, valRs, valRt, imm, predictedPC, predictedTaken }
        };

        // Comprobar si esta instrucción causa un stall de datos que debe empezar ahora
        if (state.stalls[instIdx] > 0 && state.currentStallCycles === 0 && state.branchMispredictStallCycles === 0) {
            state.currentStallCycles = state.stalls[instIdx];
            // La instrucción actual se mueve a EX, pero el pipeline se detendrá DESPUÉS de este ciclo.
            // Las instrucciones en IF e ID (si las hay) se congelarán en el próximo ciclo.
            // El PC de fetch (nextPCToFetch) no debería avanzar si hay stall.
            state.nextPCToFetch = idLatch.pc; // Revertir el avance especulativo del fetch
        }
      }
      if (!mispredictHappenedThisCycle) nextInstructionStages[instIdx] = "EX";
      else nextInstructionStages[instIdx] = null;
    }
  }

  // --- ETAPA INSTRUCTION FETCH (IF) ---
  const currentFetchingPC = state.nextPCToFetch; // PC de la instrucción a buscar este ciclo
  const fetchedInstIdx = getInstructionIndexFromPC(currentFetchingPC, INSTRUCTION_START_ADDRESS);

  if (fetchedInstIdx < state.instructions.length && !mispredictHappenedThisCycle && state.currentStallCycles === 0 && state.branchMispredictStallCycles === 0) {
      const instructionHex = state.instructions[fetchedInstIdx];
      if (instructionHex && nextInstructionStages[fetchedInstIdx] === undefined) { // Solo si no está ya en el pipeline
        // Parsear la instrucción aquí si no se ha hecho globalmente al inicio
        if (!state.registerUsage[fetchedInstIdx]) {
            state.registerUsage[fetchedInstIdx] = parseInstruction(instructionHex, currentFetchingPC, fetchedInstIdx);
        }
        newPipelineLatches[fetchedInstIdx] = {
            ...(newPipelineLatches[fetchedInstIdx] || {}), // Mantener si ya hay algo (poco probable para IF)
            IF_ID: { instruction: instructionHex, pc: currentFetchingPC }
        };
        nextInstructionStages[fetchedInstIdx] = "IF";

        // Actualizar PC para el *próximo* fetch, a menos que ID/EX lo cambien por un salto
        state.nextPCToFetch = currentFetchingPC + 4;
      }
  }
  state.PC = state.nextPCToFetch; // El PC del estado es el que se usará para el próximo fetch

  // Actualizar instructionStages con las nuevas etapas calculadas
  Object.keys(nextInstructionStages).forEach(idxStr => {
      const idx = parseInt(idxStr);
      state.instructionStages[idx] = nextInstructionStages[idx];
  });
  // Limpiar etapas para instrucciones que ya no están
   instructionIndicesInPipeline.forEach(idx => {
        if (nextInstructionStages[idx] === undefined && state.instructionStages[idx] !== null) {
             state.instructionStages[idx] = null; // Si no fue procesada y estaba, se asume que salió
        }
   });


  state.pipelineLatches = newPipelineLatches;
  state.hazards = mispredictHappenedThisCycle ? { ...prevState.hazards, ...newHazards } : prevState.hazards; // Actualizar hazards si hubo mispredict

  // Comprobar si ha terminado
  let activeInstructions = 0;
  Object.values(state.instructionStages).forEach(stage => { if (stage !== null) activeInstructions++; });
  if (activeInstructions === 0 && fetchedInstIdx >= state.instructions.length) {
      const lastInstProcessedPC = INSTRUCTION_START_ADDRESS + (state.instructions.length -1) * 4;
      // Si el PC de fetch está más allá de la última instrucción y no hay nada en pipeline
      if (state.nextPCToFetch > lastInstProcessedPC || state.instructions.length === 0) {
         state.isFinished = true;
         state.isRunning = false;
      }
  }

  return state;
};


export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = useState<SimulationState>(initialState);
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
        if (nextSimState.isFinished && !prevState.isFinished) clearTimer();
        return nextSimState;
      });
    }, 700);
  }, []);

  useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) runClock();
    else clearTimer();
    return clearTimer;
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);

  const resetSimulation = useCallback(() => {
    clearTimer();
    setSimulationState(prevState => ({
      ...initialState,
      PC: INSTRUCTION_START_ADDRESS, // Reiniciar PC
      nextPCToFetch: INSTRUCTION_START_ADDRESS,
      forwardingEnabled: prevState.forwardingEnabled,
      stallsEnabled: prevState.stallsEnabled,
      branchPredictionMode: prevState.branchPredictionMode,
      staticBranchPrediction: prevState.staticBranchPrediction,
      stateMachineInitialPrediction: prevState.stateMachineInitialPrediction,
      stateMachineFailsToSwitch: prevState.stateMachineFailsToSwitch,
      globalStateMachineState: prevState.stateMachineInitialPrediction === "taken" ? "ST" : "SN", // Resetear predictor
      globalStateMachineFailCount: 0,
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
        parsedRegisterUsage[index] = parseInstruction(instHex, pcForInstruction, index);
      });

      // La detección de hazards ahora se hará dinámicamente en cada ciclo si es necesario,
      // o se puede hacer una detección inicial aquí para propósitos de display.
      // Por ahora, `detectHazards` no se llama en start, se llamaría dentro de `calculateNextState`
      // o se actualiza el estado de hazards dinámicamente.
      // Para el display inicial, podemos calcularlos una vez.
      const [initialHazards, initialForwardings, initialStalls] = detectHazards(
          submittedInstructions,
          parsedRegisterUsage,
          simulationState.forwardingEnabled, // Usar del estado actual
          simulationState.stallsEnabled,     // Usar del estado actual
          initialState.pipelineLatches // Latches iniciales vacíos
      );


      setSimulationState(prevState => ({
        ...initialState,
        PC: INSTRUCTION_START_ADDRESS,
        nextPCToFetch: INSTRUCTION_START_ADDRESS,
        forwardingEnabled: prevState.forwardingEnabled,
        stallsEnabled: prevState.stallsEnabled,
        branchPredictionMode: prevState.branchPredictionMode,
        staticBranchPrediction: prevState.staticBranchPrediction,
        stateMachineInitialPrediction: prevState.stateMachineInitialPrediction,
        stateMachineFailsToSwitch: prevState.stateMachineFailsToSwitch,
        globalStateMachineState: prevState.stateMachineInitialPrediction === "taken" ? "ST" : "SN",
        globalStateMachineFailCount: 0,
        instructions: submittedInstructions,
        registerUsage: parsedRegisterUsage,
        hazards: initialHazards, // Peligros iniciales
        forwardings: initialForwardings,
        stalls: initialStalls,
        currentCycle: 0,
        isRunning: true,
        isFinished: false,
        // maxCycles puede ser más dinámico ahora
      }));
    },
    [resetSimulation, simulationState.forwardingEnabled, simulationState.stallsEnabled] // Añadir dependencias de config si detectHazards las usa
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
      if ( !prevState.isRunning && prevState.instructions.length > 0 && !prevState.isFinished ) {
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
      forwardingEnabled: enabled ? prevState.forwardingEnabled : false, // Si se desactivan stalls, forwarding también se desactiva visualmente/lógicamente
    }));
  }, []);

  // Implementación de Acciones de Predicción de Saltos
  const setBranchPredictionMode = useCallback((mode: BranchPredictionMode) => {
    setSimulationState((prevState) => ({ ...prevState, branchPredictionMode: mode }));
  }, []);

  const setStaticBranchPrediction = useCallback((prediction: StaticBranchPrediction) => {
    setSimulationState((prevState) => ({ ...prevState, staticBranchPrediction: prediction }));
  }, []);

  const setStateMachineInitialPrediction = useCallback((prediction: StateMachineInitialPrediction) => {
    setSimulationState((prevState) => ({ ...prevState, stateMachineInitialPrediction: prediction }));
  }, []);

  const setStateMachineFailsToSwitch = useCallback((fails: number) => {
    setSimulationState((prevState) => ({ ...prevState, stateMachineFailsToSwitch: Math.max(1, fails) })); // Asegurar que sea al menos 1
  }, []);

  const actionsValue: SimulationActions = useMemo(
    () => ({
      startSimulation, resetSimulation, pauseSimulation, resumeSimulation,
      setForwardingEnabled, setStallsEnabled, setBranchPredictionMode,
      setStaticBranchPrediction, setStateMachineInitialPrediction, setStateMachineFailsToSwitch,
    }),
    [ startSimulation, resetSimulation, pauseSimulation, resumeSimulation,
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