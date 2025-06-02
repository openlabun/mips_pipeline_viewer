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
import { translateInstructionToMIPS } from "./Converter"; // Asumo que Converter.ts está en el mismo directorio o ajusta la ruta

// Define the stage names
const STAGE_NAMES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type StageName = (typeof STAGE_NAMES)[number];

type InstructionType = "R" | "I" | "J";
type HazardType = "RAW" | "WAW" | "NONE"; // Podrías añadir "Control" para predicciones erróneas

interface RegisterUsage {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: InstructionType;
  isLoad: boolean;
  isStore: boolean;
  isBranch?: boolean; // Añadido para identificar instrucciones de salto condicional
  // branchTarget?: number; // Podrías calcular y almacenar el objetivo del salto aquí
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

// Tipos para la Predicción de Saltos
export type BranchPredictionMode = "none" | "static" | "stateMachine";
export type StaticBranchPrediction = "taken" | "notTaken";
export type StateMachineInitialPrediction = "taken" | "notTaken";

// Mapeo de registros
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
initialRegisters["$sp"] = 28; // Ejemplo de inicialización de SP, ajusta según sea necesario

const initialMemory = Array.from({ length: 32 }).reduce<Record<number, number>>(
  (acc, _, i) => {
    acc[i] = 0;
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
  instructionStages: Record<number, number | null>;
  isFinished: boolean;
  registerUsage: Record<number, RegisterUsage>;
  hazards: Record<number, HazardInfo>;
  forwardings: Record<number, ForwardingInfo[]>;
  stalls: Record<number, number>;
  currentStallCycles: number;
  forwardingEnabled: boolean;
  stallsEnabled: boolean;
  registers: Record<string, number>;
  memory: Record<number, number>;
  PC: number; // Program Counter (índice de la instrucción actual en `instructions`)

  // Estado de Predicción de Saltos
  branchPredictionMode: BranchPredictionMode;
  staticBranchPrediction: StaticBranchPrediction;
  stateMachineInitialPrediction: StateMachineInitialPrediction;
  stateMachineFailsToSwitch: number;
  // Aquí podrías añadir estados para predictores dinámicos (tablas de historia, etc.)
}

interface SimulationActions {
  startSimulation: (submittedInstructions: string[]) => void;
  resetSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  setForwardingEnabled: (enabled: boolean) => void;
  setStallsEnabled: (enabled: boolean) => void;

  // Acciones de Predicción de Saltos
  setBranchPredictionMode: (mode: BranchPredictionMode) => void;
  setStaticBranchPrediction: (prediction: StaticBranchPrediction) => void;
  setStateMachineInitialPrediction: (prediction: StateMachineInitialPrediction) => void;
  setStateMachineFailsToSwitch: (fails: number) => void;
}

const SimulationStateContext = createContext<SimulationState | undefined>(undefined);
const SimulationActionsContext = createContext<SimulationActions | undefined>(undefined);

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
  registers: { ...initialRegisters }, // Copia para evitar mutaciones
  memory: { ...initialMemory },     // Copia para evitar mutaciones
  PC: 0,

  // Estado Inicial de Predicción de Saltos
  branchPredictionMode: "none",
  staticBranchPrediction: "notTaken",
  stateMachineInitialPrediction: "notTaken",
  stateMachineFailsToSwitch: 2, // Ej: para un contador saturante de 2 bits
};

const parseInstruction = (hexInstruction: string): RegisterUsage => {
  const binary = parseInt(hexInstruction, 16).toString(2).padStart(32, "0");
  const opcode = parseInt(binary.substring(0, 6), 2);
  const rs = parseInt(binary.substring(6, 11), 2);
  const rt = parseInt(binary.substring(11, 16), 2);

  let type: InstructionType = "R";
  let rd = 0;
  let funct = 0;
  let isLoad = false;
  let isStore = false;
  let isBranch = false; // Añadido

  if (opcode === 0) { // R-type
    type = "R";
    rd = parseInt(binary.substring(16, 21), 2);
    funct = parseInt(binary.substring(26, 32), 2);
  } else if (opcode === 2 || opcode === 3) { // J-type (j, jal)
    type = "J";
    rd = opcode === 3 ? 31 : 0; // jal escribe en $ra
  } else if (opcode === 4 || opcode === 5) { // Saltos condicionales I-type (beq, bne)
    type = "I";
    isBranch = true;
    // rd no se usa como destino para beq/bne
  } else { // Otros I-type
    type = "I";
    // Opcodes de carga: lb(32), lh(33), lw(35), lbu(36), lhu(37), ll(48)
    if ([32, 33, 35, 36, 37, 48].includes(opcode)) {
      isLoad = true;
      rd = rt; // rt es el destino para cargas
    }
    // Opcodes de almacenamiento: sb(40), sh(41), sw(43), sc(56)
    else if ([40, 41, 43, 56].includes(opcode)) {
      isStore = true;
      // rd no es destino, rt es fuente
      rd = 0;
    }
    // Opcodes aritméticos inmediatos que escriben en rt: addi(8), addiu(9), andi(12), ori(13), xori(14), slti(10), sltiu(11)
    // Nota: Tu lista original era [8, 9, 12, 13, 14, 15], donde 15 es LUI.
    // Y slti/sltiu usan opcodes 10 y 11, no 14 y 15.
    else if ([8, 9, 10, 11, 12, 13, 14].includes(opcode)) { // addi, addiu, slti, sltiu, andi, ori, xori
      rd = rt; // rt es el destino
    }
    // LUI (opcode 15)
    else if (opcode === 15) { // lui
      rd = rt; // rt es el destino
    } else {
      // Otros I-type pueden no tener rd o usarlo de forma diferente.
      // Por simplicidad, si no es carga, almacén, aritmético-imm conocido o lui.
      rd = 0; // O podría ser rt si es un tipo de instrucción que no has cubierto.
    }
  }

  return { rs, rt, rd, opcode, funct, type, isLoad, isStore, isBranch };
};


const normalizeRegister = (reg: string): string => {
  reg = reg.toLowerCase().trim();
  if (reg.startsWith('$')) {
    return reg;
  }
  return `$${reg}`;
};

const executeMIPSInstruction = (
  hexInstruction: string,
  registers: Record<string, number>,
  memory: Record<number, number>,
  PC: number, // PC actual (índice de la instrucción)
  stage: StageName,
  forwardings: ForwardingInfo[],
  currentCycle: number,
  isForwardingEnabled: boolean // Necesario para decidir si usar valores forwardeados
): { updatedRegisters: Record<string, number>, updatedMemory: Record<string, number>, nextPC?: number } => {
  const mipsInstruction = translateInstructionToMIPS(hexInstruction);
  // console.log(`Cycle ${currentCycle} - ${stage} - Executing: ${hexInstruction} (${mipsInstruction}), PC: ${PC}`);

  const [op, ...operands] = mipsInstruction.replace(/,/g, "").split(" ");
  let newPC: number | undefined = undefined; // Por defecto, PC avanza secuencialmente
  let tempRegisters = { ...registers };
  let tempMemory = { ...memory };

  const getRegName = (regNum: number) => `$${regMap[regNum.toString()] || `r${regNum}`}`;

  const getRegisterValueConsideringForwarding = (regNumStr: string, currentStage: StageName): number => {
    const regName = normalizeRegister(regNumStr);
    if (isForwardingEnabled) {
      const activeForwarding = forwardings.find(f =>
          f.register === regName &&
          // Lógica de forwarding: EX/MEM -> EX, MEM/WB -> EX, MEM/WB -> MEM
          // Esto es una simplificación. El forwarding real es más complejo.
          // Aquí asumimos que si hay un forwarding a la etapa actual, el valor ya está disponible.
          // En una simulación más detallada, se verificaría la etapa de origen del forwarding.
          ( (currentStage === "EX" && (f.fromStage === "EX" || f.fromStage === "MEM")) ||
            (currentStage === "MEM" && (f.fromStage === "MEM" || f.fromStage === "WB")) ) // WB a MEM no es usual, pero EX a MEM sí
      );
      if (activeForwarding) {
        // console.log(`Forwarding ${regName} from I${activeForwarding.from} (${activeForwarding.fromStage}) to ${currentStage} for I${PC}`);
        // El valor forwardeado es el que ya estaría en el registro si la escritura anterior completó WB,
        // o el resultado de EX/MEM si se forwardea desde esas etapas.
        // Para simplificar, asumimos que `tempRegisters` ya tiene el valor correcto si el forwarding es de una etapa anterior
        // que ya escribió (WB), o que `executeMIPSInstruction` en etapas previas (EX/MEM) ya actualizó `tempRegisters`
        // con el resultado que se está forwardeando.
        // Esta es una gran simplificación.
        return tempRegisters[regName];
      }
    }
    return tempRegisters[regName];
  };


  switch (stage) {
    case "EX": {
      switch (op) {
        case "add": case "addu": {
          const [rd, rs, rt] = operands.map(r => normalizeRegister(r));
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = (valRs + valRt) | 0;
          break;
        }
        case "sub": case "subu": {
          const [rd, rs, rt] = operands.map(r => normalizeRegister(r));
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = (valRs - valRt) | 0;
          break;
        }
        case "and": {
          const [rd, rs, rt] = operands.map(r => normalizeRegister(r));
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = valRs & valRt;
          break;
        }
        case "or": {
          const [rd, rs, rt] = operands.map(r => normalizeRegister(r));
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = valRs | valRt;
          break;
        }
        case "xor": {
          const [rd, rs, rt] = operands.map(r => normalizeRegister(r));
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = valRs ^ valRt;
          break;
        }
        case "nor": {
          const [rd, rs, rt] = operands.map(r => normalizeRegister(r));
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = ~(valRs | valRt);
          break;
        }
        case "slt": {
          const [rd, rs, rt] = operands.map(r => normalizeRegister(r));
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = valRs < valRt ? 1 : 0;
          break;
        }
        case "sltu": {
          const [rd, rs, rt] = operands.map(r => normalizeRegister(r));
          const valRs = getRegisterValueConsideringForwarding(rs, "EX") >>> 0;
          const valRt = getRegisterValueConsideringForwarding(rt, "EX") >>> 0;
          tempRegisters[rd] = valRs < valRt ? 1 : 0;
          break;
        }
        case "sll": {
          const [rd, rt, shamtStr] = operands.map(r => normalizeRegister(r));
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = valRt << parseInt(shamtStr);
          break;
        }
        case "srl": {
          const [rd, rt, shamtStr] = operands.map(r => normalizeRegister(r));
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = valRt >>> parseInt(shamtStr); // Logical shift
          break;
        }
        case "sra": {
          const [rd, rt, shamtStr] = operands.map(r => normalizeRegister(r));
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          tempRegisters[rd] = valRt >> parseInt(shamtStr); // Arithmetic shift
          break;
        }
        case "addi": case "addiu": {
          const [rt, rs, immStr] = operands;
          const normRt = normalizeRegister(rt);
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          tempRegisters[normRt] = (valRs + parseInt(immStr)) | 0;
          break;
        }
        case "andi": {
          const [rt, rs, immStr] = operands;
          const normRt = normalizeRegister(rt);
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          tempRegisters[normRt] = valRs & parseInt(immStr);
          break;
        }
        case "ori": {
          const [rt, rs, immStr] = operands;
          const normRt = normalizeRegister(rt);
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          tempRegisters[normRt] = valRs | parseInt(immStr);
          break;
        }
        case "xori": {
          const [rt, rs, immStr] = operands;
          const normRt = normalizeRegister(rt);
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          tempRegisters[normRt] = valRs ^ parseInt(immStr);
          break;
        }
        case "slti": {
          const [rt, rs, immStr] = operands;
          const normRt = normalizeRegister(rt);
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          tempRegisters[normRt] = valRs < parseInt(immStr) ? 1 : 0;
          break;
        }
        case "sltiu": {
          const [rt, rs, immStr] = operands;
          const normRt = normalizeRegister(rt);
          const valRs = getRegisterValueConsideringForwarding(rs, "EX") >>> 0;
          tempRegisters[normRt] = valRs < (parseInt(immStr) >>> 0) ? 1 : 0;
          break;
        }
        case "lui": {
          const [rt, immStr] = operands;
          tempRegisters[normalizeRegister(rt)] = parseInt(immStr) << 16;
          break;
        }
        // Saltos (Branches and Jumps)
        case "beq": {
          const [rs, rt, offsetStr] = operands;
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          if (valRs === valRt) {
            newPC = PC + 1 + parseInt(offsetStr); // PC es el índice de la instrucción actual
          }
          break;
        }
        case "bne": {
          const [rs, rt, offsetStr] = operands;
          const valRs = getRegisterValueConsideringForwarding(rs, "EX");
          const valRt = getRegisterValueConsideringForwarding(rt, "EX");
          if (valRs !== valRt) {
            newPC = PC + 1 + parseInt(offsetStr);
          }
          break;
        }
        case "j": {
          const [targetAddrStr] = operands;
          // El target en MIPS es una dirección de palabra (word address), PC se actualiza con esto.
          // Si tu `instructions` array es 0-indexed, y targetAddrStr es una dirección de byte, divide por 4.
          // Si targetAddrStr ya es un índice de instrucción, úsalo directamente.
          // Aquí asumimos que targetAddrStr es una dirección de palabra que se usa como índice.
          newPC = parseInt(targetAddrStr, 10); // o parseInt(targetAddrStr, 16) si es hexadecimal
          break;
        }
        case "jal": {
          const [targetAddrStr] = operands;
          tempRegisters["$ra"] = (PC + 1) * 4; // Guarda la dirección de la SIGUIENTE instrucción (en bytes)
          newPC = parseInt(targetAddrStr, 10);
          break;
        }
        case "jr": {
          const [rs] = operands;
          const jumpAddrBytes = getRegisterValueConsideringForwarding(rs, "EX");
          newPC = jumpAddrBytes / 4; // Convierte dirección de bytes a índice de instrucción
          break;
        }
        // lw y sw calculan la dirección en EX, pero la acción real es en MEM
        case "lw": case "sw": case "lb": case "lbu": case "lh": case "lhu": case "sb": case "sh": {
            const [rtReg, offsetAndBase] = operands;
            const offsetMatch = /(-?\d+)\(([^)]+)\)/.exec(offsetAndBase);
            if (offsetMatch) {
                const offset = parseInt(offsetMatch[1]);
                const baseRegName = normalizeRegister(offsetMatch[2]);
                const baseAddr = getRegisterValueConsideringForwarding(baseRegName, "EX");
                const effectiveAddress = baseAddr + offset;
                // Guardar la dirección efectiva para usar en MEM.
                // Esto se haría en los latches del pipeline. Aquí simulamos guardándolo en tempRegisters
                // bajo una clave especial o en un objeto de estado intermedio para la instrucción.
                // Por simplicidad, lo recalcularemos en MEM o asumiremos que se pasó.
                // Para esta función, simplemente calculamos y podríamos almacenarlo en una variable
                // que se pasa a la etapa MEM si la arquitectura lo permite.
                // console.log(`EX (${op}): Effective address calculated: ${effectiveAddress}`);
            }
            break;
        }
      }
      break; // Fin de EX
    }
    case "MEM": {
      switch (op) {
        case "lw": case "lb": case "lbu": case "lh": case "lhu": {
            const [rtReg, offsetAndBase] = operands;
            const normRt = normalizeRegister(rtReg);
            const offsetMatch = /(-?\d+)\(([^)]+)\)/.exec(offsetAndBase); // $rs
            if (offsetMatch) {
                const offset = parseInt(offsetMatch[1]);
                const baseRegName = normalizeRegister(offsetMatch[2]);
                // El valor de baseRegName debería ser el de la etapa EX
                // Si hay forwarding de EX a MEM, tempRegisters[baseRegName] ya tendría el valor correcto.
                const baseAddr = tempRegisters[baseRegName]; // Asume que EX lo calculó o fue forwardeado
                const address = (baseAddr + offset); // Dirección de byte

                // MIPS accede a memoria alineada a palabras para lw, etc.
                // La memoria simulada es por palabras (índices 0-31). Convertimos la dirección de byte.
                const wordAddress = Math.floor(address / 4);

                if (wordAddress >= 0 && wordAddress < Object.keys(tempMemory).length) {
                    let value = tempMemory[wordAddress];
                    if (op === "lb") value = (value >> ((address % 4) * 8)) & 0xFF; // Sign extend manually if needed
                    else if (op === "lbu") value = (value >> ((address % 4) * 8)) & 0xFF;
                    else if (op === "lh") value = (value >> ((address % 4 === 0 ? 0 : 16))) & 0xFFFF; // Sign extend manually
                    else if (op === "lhu") value = (value >> ((address % 4 === 0 ? 0 : 16))) & 0xFFFF;
                    // lw ya toma la palabra entera
                    tempRegisters[normRt] = value;
                } else {
                    // console.error(`MEM: Invalid memory address ${address} (word: ${wordAddress}) for ${op}`);
                }
            }
            break;
        }
        case "sw": case "sb": case "sh": {
            const [rtReg, offsetAndBase] = operands;
            const valRt = getRegisterValueConsideringForwarding(rtReg, "MEM"); // Valor a escribir
            const offsetMatch = /(-?\d+)\(([^)]+)\)/.exec(offsetAndBase);
            if (offsetMatch) {
                const offset = parseInt(offsetMatch[1]);
                const baseRegName = normalizeRegister(offsetMatch[2]);
                const baseAddr = tempRegisters[baseRegName];
                const address = (baseAddr + offset);
                const wordAddress = Math.floor(address / 4);

                if (wordAddress >= 0 && wordAddress < Object.keys(tempMemory).length) {
                    if (op === "sw") {
                        tempMemory[wordAddress] = valRt;
                    } else if (op === "sh") {
                        const shift = (address % 4 === 0) ? 0 : 16;
                        const mask = 0xFFFF << shift;
                        tempMemory[wordAddress] = (tempMemory[wordAddress] & ~mask) | ((valRt & 0xFFFF) << shift);
                    } else if (op === "sb") {
                        const shift = (address % 4) * 8;
                        const mask = 0xFF << shift;
                        tempMemory[wordAddress] = (tempMemory[wordAddress] & ~mask) | ((valRt & 0xFF) << shift);
                    }
                } else {
                    // console.error(`MEM: Invalid memory address ${address} (word: ${wordAddress}) for ${op}`);
                }
            }
            break;
        }
      }
      break; // Fin de MEM
    }
    case "WB": {
      // La escritura real a los registros maestros ocurre aquí.
      // En esta simulación, `tempRegisters` ya tiene los valores que se escribirían.
      // `executeMIPSInstruction` devuelve `tempRegisters` y el caller (calculateNextState)
      // los asignará al estado global de registros.
      // console.log(`WB: Instruction ${mipsInstruction} completed.`);
      break; // Fin de WB
    }
  }

  // Asegurar que $zero siempre sea 0
  if (tempRegisters["$zero"] !== 0) {
    tempRegisters["$zero"] = 0;
  }

  return { updatedRegisters: tempRegisters, updatedMemory: tempMemory, nextPC: newPC };
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
    hazards[index] = { type: "NONE", description: "No hazard", canForward: false, stallCycles: 0 };
    forwardings[index] = [];
    stalls[index] = 0;
  });

  if (!stallsEnabled) {
    return [hazards, forwardings, stalls];
  }

  for (let i = 0; i < instructions.length; i++) {
    const currentInst = registerUsage[i];
    if (!currentInst) continue;

    // Solo buscar dependencias con instrucciones anteriores
    for (let j = Math.max(0, i - 2); j < i; j++) { // Considerar las 2 instrucciones previas
      const prevInst = registerUsage[j];
      if (!prevInst) continue;

      // No hay hazard si la instrucción previa no escribe (rd=0) Y NO es una carga
      // (las cargas escriben en rt, que se mapea a rd en parseInstruction si esLoad es true)
      if (prevInst.rd === 0) continue;


      let rawHazardOccurred = false;
      let hazardRegName = "";

      // RAW: prevInst escribe en prevInst.rd, currentInst lee de currentInst.rs
      if (currentInst.rs !== 0 && currentInst.rs === prevInst.rd) {
        rawHazardOccurred = true;
        hazardRegName = `$${regMap[currentInst.rs.toString()] || `r${currentInst.rs}`}`;
      }
      // RAW: prevInst escribe en prevInst.rd, currentInst lee de currentInst.rt (si rt es fuente)
      // rt es fuente para R-type y para I-type stores/branches
      else if (currentInst.rt !== 0 && currentInst.rt === prevInst.rd) {
        if (currentInst.type === 'R' || currentInst.isStore || currentInst.isBranch) {
           rawHazardOccurred = true;
           hazardRegName = `$${regMap[currentInst.rt.toString()] || `r${currentInst.rt}`}`;
        }
      }

      if (rawHazardOccurred) {
        const distance = i - j; // 1 si j=i-1, 2 si j=i-2
        if (prevInst.isLoad) { // Load-Use Hazard con I_(i-1)
          if (distance === 1) { // Dependencia directa con la instrucción inmediatamente anterior
            stalls[i] = Math.max(stalls[i], 1); // Load-use siempre 1 stall
            hazards[i] = { type: "RAW", description: `Load-use: I${i} (${hazardRegName}) from lw I${j}`, canForward: forwardingEnabled, stallCycles: 1 };
            if (forwardingEnabled) {
              forwardings[i].push({ from: j, to: i, fromStage: "MEM", toStage: "EX", register: hazardRegName });
            }
          }
          // Si distance === 2, el valor de la carga ya estaría disponible de MEM->WB y luego EX de la actual,
          // o forwarding de MEM de I(i-2) a EX de I(i) (si es posible en 2 ciclos).
          // En un pipeline simple, una carga a I(i-2) no causa stall a I(i) si hay forwarding.
        } else { // ALU-Use Hazard
          if (distance === 1) { // Dependencia con I_(i-1)
            if (forwardingEnabled) {
              // stalls[i] = 0; // Forwarding EX -> EX
              hazards[i] = { type: "RAW", description: `RAW: I${i} (${hazardRegName}) from I${j} (EX->EX forward)`, canForward: true, stallCycles: 0 };
              forwardings[i].push({ from: j, to: i, fromStage: "EX", toStage: "EX", register: hazardRegName });
            } else {
              stalls[i] = Math.max(stalls[i], 2); // Sin forwarding, 2 stalls
              hazards[i] = { type: "RAW", description: `RAW: I${i} (${hazardRegName}) from I${j} (2 stalls)`, canForward: false, stallCycles: 2 };
            }
          } else if (distance === 2) { // Dependencia con I_(i-2)
            if (forwardingEnabled) {
              // stalls[i] = 0; // Forwarding MEM -> EX
              hazards[i] = { type: "RAW", description: `RAW: I${i} (${hazardRegName}) from I${j} (MEM->EX forward)`, canForward: true, stallCycles: 0 };
              forwardings[i].push({ from: j, to: i, fromStage: "MEM", toStage: "EX", register: hazardRegName });
            } else {
              stalls[i] = Math.max(stalls[i], 1); // Sin forwarding, 1 stall
              hazards[i] = { type: "RAW", description: `RAW: I${i} (${hazardRegName}) from I${j} (1 stall)`, canForward: false, stallCycles: 1 };
            }
          }
        }
      }

      // WAW Hazard: currentInst escribe en currentInst.rd, prevInst escribe en prevInst.rd
      // Y no hubo RAW (RAW tiene prioridad y se maneja con stalls/forwarding)
      if (!rawHazardOccurred && currentInst.rd !== 0 && prevInst.rd !== 0 && currentInst.rd === prevInst.rd) {
        hazards[i] = {
            type: "WAW",
            description: `WAW: I${i} and I${j} both write to $${regMap[currentInst.rd.toString()] || `r${currentInst.rd}`}`,
            canForward: false, // WAW se resuelven por orden de pipeline, no forwarding
            stallCycles: 0 // Normalmente no causan stalls en pipelines simples en orden
        };
        // No se añaden stalls por WAW en este modelo simple.
      }
    }
  }
  return [hazards, forwardings, stalls];
};


const calculatePrecedingStalls = (
  stalls: Record<number, number>,
  index: number // Índice de la instrucción actual
): number => {
  let totalStalls = 0;
  // Sumar los stalls de todas las instrucciones *anteriores* a 'index'
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
  let newPC = currentState.PC; // PC actual (índice de la próxima instrucción a buscar si no hay salto)
  let tempRegisters = { ...currentState.registers };
  let tempMemory = { ...currentState.memory };
  const newInstructionStages: Record<number, number | null> = {}; // Etapas de las instrucciones *en este ciclo*

  // 1. Manejar stalls globales pendientes
  if (currentState.currentStallCycles > 0) {
    // Simplemente decrementamos el contador de stalls y mantenemos el estado actual del pipeline
    // Las instrucciones "congeladas" no avanzan.
    // Esto es una simplificación; un pipeline real podría permitir que algunas etapas posteriores continúen.
    return {
      ...currentState,
      currentCycle: nextCycle,
      currentStallCycles: currentState.currentStallCycles - 1,
      // instructionStages se mantiene, PC no avanza, registros y memoria no cambian por ejecución este ciclo
    };
  }

  // 2. Avanzar instrucciones y ejecutar
  let activeInstructionsInPipeline = 0;
  let maxReachedStageThisCycleForPCUpdate = -1; // Para saber si la instrucción que salta ya pasó EX
  let pcUpdateFromInstructionIndex: number | undefined = undefined; // Índice de la instrucción que causó el salto
  let jumpTakenInCycle = false;

  // Iterar sobre las instrucciones que podrían estar en el pipeline
  // El pipeline puede tener 'stageCount' instrucciones activas.
  // Consideramos un rango de instrucciones alrededor del PC actual.
  const pipelineDepth = currentState.stageCount;
  const startIndex = Math.max(0, newPC - pipelineDepth); // No ir antes de la instrucción 0
  const endIndex = Math.min(currentState.instructions.length - 1, newPC + pipelineDepth);


  for (let instIndexInArray = 0; instIndexInArray < currentState.instructions.length; instIndexInArray++) {
    const instructionHex = currentState.instructions[instIndexInArray];
    if (!instructionHex) {
        newInstructionStages[instIndexInArray] = null;
        continue;
    }

    // Calcular la etapa en la que estaría esta instrucción en `nextCycle`
    const precedingStallsForThisInst = calculatePrecedingStalls(currentState.stalls, instIndexInArray);
    // La instrucción `instIndexInArray` entra en IF en el ciclo `instIndexInArray + 1 + precedingStallsForThisInst`
    const entryCycleToIF = instIndexInArray + 1 + precedingStallsForThisInst;
    const currentStageIndex = nextCycle - entryCycleToIF;


    if (currentStageIndex >= 0 && currentStageIndex < currentState.stageCount) {
      newInstructionStages[instIndexInArray] = currentStageIndex;
      activeInstructionsInPipeline++;

      const stageName = STAGE_NAMES[currentStageIndex];
      let executionResult: { updatedRegisters: Record<string, number>, updatedMemory: Record<string, number>, nextPC?: number } | undefined;

      if (stageName === "EX" || stageName === "MEM" || stageName === "WB") {
          executionResult = executeMIPSInstruction(
            instructionHex,
            tempRegisters, // Pasar una copia para que cada instrucción opere sobre ella
            tempMemory,
            instIndexInArray, // PC de la instrucción actual
            stageName,
            currentState.forwardings[instIndexInArray] || [],
            nextCycle,
            currentState.forwardingEnabled
          );
          tempRegisters = executionResult.updatedRegisters; // Actualizar con los resultados
          tempMemory = executionResult.updatedMemory;

          if (stageName === "EX" && executionResult.nextPC !== undefined) {
            // Un salto se resuelve en EX. Si ocurre, este será el nuevo PC.
            // Solo la primera instrucción que salta en EX este ciclo debe cambiar el PC.
            if (!jumpTakenInCycle) {
                newPC = executionResult.nextPC;
                jumpTakenInCycle = true;
                pcUpdateFromInstructionIndex = instIndexInArray;
                // Aquí se necesitaría lógica para invalidar (flush) las instrucciones posteriores
                // que fueron buscadas incorrectamente.
                // console.log(`Cycle ${nextCycle}: Branch/Jump taken by I${instIndexInArray} to PC=${newPC}. Flushing subsequent fetches.`);
            }
          }
      }

      // Si esta instrucción está entrando en ID y requiere stalls, activarlos para el *próximo* ciclo.
      if (stageName === "ID" && currentState.stalls[instIndexInArray] > 0 && currentState.currentStallCycles === 0) {
        // Esta es una simplificación. currentState.currentStallCycles debería ser el nuevo valor.
        // Pero para evitar múltiples stalls en un ciclo, solo el primero lo activa.
        // Esto necesita una lógica más robusta para acumular stalls.
        // Por ahora, el `currentStallCycles` global se activa.
        return { // Devolver estado con el stall activado para el próximo ciclo.
            ...currentState,
            currentCycle: nextCycle,
            instructionStages: newInstructionStages, // Mostrar etapas actuales
            registers: tempRegisters,
            memory: tempMemory,
            PC: currentState.PC, // PC no cambia aún por el stall
            currentStallCycles: currentState.stalls[instIndexInArray], // Activar los stalls
            isRunning: true, // Sigue corriendo
            isFinished: false,
        };
      }

    } else {
      newInstructionStages[instIndexInArray] = null; // Fuera del pipeline
    }
  }


  // 3. Determinar si la simulación ha terminado
  let allInstructionsProcessed = true;
  if (currentState.instructions.length === 0) {
    allInstructionsProcessed = true;
  } else {
    // Se considera terminado si la última instrucción ha salido de WB y no hay saltos pendientes
    const lastInstIndex = currentState.instructions.length - 1;
    if (newInstructionStages[lastInstIndex] === null && currentState.instructionStages[lastInstIndex] === STAGE_NAMES.length -1){
        // La última instrucción estaba en WB y ahora es null.
    } else {
        allInstructionsProcessed = false;
    }
    // O si el PC se movió más allá del final de las instrucciones y no hay nada en el pipeline
    if (newPC >= currentState.instructions.length && activeInstructionsInPipeline === 0) {
        allInstructionsProcessed = true;
    } else if (activeInstructionsInPipeline > 0) {
        allInstructionsProcessed = false;
    }

  }

  const isNowFinished = allInstructionsProcessed && !jumpTakenInCycle; // Si hubo un salto, no hemos terminado aún

  // 4. Si hubo un salto, invalidar etapas de instrucciones posteriores
  if (jumpTakenInCycle && pcUpdateFromInstructionIndex !== undefined) {
      for (let i = pcUpdateFromInstructionIndex + 1; i < currentState.instructions.length; i++) {
          if (newInstructionStages[i] !== null && newInstructionStages[i]! < STAGE_NAMES.indexOf("EX")) {
              // Si la instrucción está antes de EX (IF, ID), se flushea
              // console.log(`Flushing I${i} from stage ${STAGE_NAMES[newInstructionStages[i]!]} due to jump by I${pcUpdateFromInstructionIndex}`);
              newInstructionStages[i] = null; // Simula el flush
          }
      }
      // El PC ya fue actualizado a `newPC`
  } else if (!jumpTakenInCycle && activeInstructionsInPipeline > 0) {
    // Si no hubo salto y hay instrucciones activas, el PC avanza para buscar la siguiente (si no estamos al final)
    // Esta lógica de avance de PC es para el *fetch* del próximo ciclo.
    // El PC que se usa para calcular las etapas es el `currentState.PC`.
    // El `newPC` aquí es el que se usará como `currentState.PC` en el *siguiente* ciclo.
    if (currentState.PC < currentState.instructions.length -1 && activeInstructionsInPipeline > 0) {
        // Este newPC es el PC para el fetch del siguiente ciclo.
        // Si no hubo saltos, el PC del fetch avanza.
        // No es el PC de la instrucción actual, sino el "puntero" a la próxima a fetchear.
        // La lógica actual de `entryCycleToIF` ya considera el índice de la instrucción,
        // por lo que el `PC` del estado debe representar el índice base para el fetch.
        // newPC = currentState.PC + 1; // Esto es si modelamos el PC como el fetch pointer.
        // La implementación actual parece tratar PC como la instrucción más temprana en el pipeline.
        // Dejaré newPC como está si no hay saltos, y el bucle de instIndexInArray maneja el progreso.
    }
  }


  return {
    ...currentState,
    currentCycle: nextCycle,
    instructionStages: newInstructionStages,
    registers: tempRegisters,
    memory: tempMemory,
    PC: newPC, // Actualizar PC si hubo un salto, o se mantiene para el próximo fetch
    isRunning: !isNowFinished,
    isFinished: isNowFinished,
    currentStallCycles: 0, // Se consumieron los stalls pendientes este ciclo
  };
};


export function SimulationProvider({ children }: PropsWithChildren) {
  const [simulationState, setSimulationState] = useState<SimulationState>(initialState);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // runClock ahora no depende de simulationState.isRunning/isFinished directamente
  const runClock = useCallback(() => {
    clearTimer();
    intervalRef.current = setInterval(() => {
      setSimulationState((prevState) => { // Usar prevState para obtener el estado más reciente
        if (!prevState.isRunning || prevState.isFinished) {
          clearTimer();
          return prevState; // No hacer nada si no está corriendo o ya terminó
        }
        const nextState = calculateNextState(prevState);
        if (nextState.isFinished && !prevState.isFinished) {
          clearTimer(); // Detener el timer si acaba de terminar
        }
        return nextState;
      });
    }, 700); // Intervalo ajustado
  }, []); // No hay dependencias externas para la definición de runClock

  useEffect(() => {
    if (simulationState.isRunning && !simulationState.isFinished) {
      runClock();
    } else {
      clearTimer();
    }
    return clearTimer; // Limpieza al desmontar o cuando cambian las dependencias
  }, [simulationState.isRunning, simulationState.isFinished, runClock]);


  const resetSimulation = useCallback(() => {
    clearTimer();
    setSimulationState((prevState) => ({
      ...initialState, // Reinicia a los valores por defecto del simulador
      // Pero conserva la configuración del usuario
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

      // Usar el estado actual para forwardingEnabled y stallsEnabled
      const currentForwardingEnabled = simulationState.forwardingEnabled;
      const currentStallsEnabled = simulationState.stallsEnabled;

      const [hazards, forwardings, stalls] = detectHazards(
        submittedInstructions,
        registerUsage,
        currentForwardingEnabled, // Usar el valor actual del estado
        currentStallsEnabled    // Usar el valor actual del estado
      );

      let totalStallCycles = 0;
      Object.values(stalls).forEach((stall) => { totalStallCycles += stall; });

      const calculatedMaxCycles = submittedInstructions.length + DEFAULT_STAGE_COUNT - 1 + totalStallCycles;
      
      const initialStagesAfterParse: Record<number, number | null> = {};
        submittedInstructions.forEach((_, index) => {
            initialStagesAfterParse[index] = null; // Todas las instrucciones comienzan fuera del pipeline
      });


      setSimulationState(prevState => ({
        ...initialState, // Base limpia para datos de simulación
        // Conservar configuración de prevState
        forwardingEnabled: prevState.forwardingEnabled,
        stallsEnabled: prevState.stallsEnabled,
        branchPredictionMode: prevState.branchPredictionMode,
        staticBranchPrediction: prevState.staticBranchPrediction,
        stateMachineInitialPrediction: prevState.stateMachineInitialPrediction,
        stateMachineFailsToSwitch: prevState.stateMachineFailsToSwitch,
        // Nuevos datos de simulación
        instructions: submittedInstructions,
        currentCycle: 0, // El primer ciclo real será 1
        maxCycles: calculatedMaxCycles,
        isRunning: true,
        stageCount: DEFAULT_STAGE_COUNT,
        instructionStages: initialStagesAfterParse, // Se poblará en calculateNextState
        isFinished: false,
        registerUsage,
        hazards,
        forwardings,
        stalls,
        currentStallCycles: 0,
        PC: 0, // PC comienza en la primera instrucción
        registers: { ...initialState.registers }, // Reinicia registros
        memory: { ...initialState.memory },       // Reinicia memoria
      }));
    },
    [ resetSimulation, simulationState.forwardingEnabled, simulationState.stallsEnabled ]
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
    [ startSimulation, resetSimulation, pauseSimulation, resumeSimulation, setForwardingEnabled, setStallsEnabled,
      setBranchPredictionMode, setStaticBranchPrediction, setStateMachineInitialPrediction, setStateMachineFailsToSwitch,
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