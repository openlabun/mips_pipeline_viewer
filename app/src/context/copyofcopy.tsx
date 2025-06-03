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

const calculateNextState = (prevState: SimulationState): SimulationState => {
    if (!prevState.isRunning || prevState.isFinished) {
        return prevState;
    }

    const state: SimulationState = JSON.parse(JSON.stringify(prevState)); // Deep copy
    state.currentCycle++;
    let mispredictJustOccurred = false; // Flag para este ciclo
    state.hazards = { ...prevState.hazards }; // Copiar hazards para poder modificarlos si hay mispredict


    // 1. Manejar Stalls Globales Activos
    if (state.currentDataStallCycles > 0) {
        state.currentDataStallCycles--;
        // Lógica de stall de datos: IF/ID congelados, EX/MEM/WB avanzan. `nextPCToFetch` no cambia.
        Object.keys(state.instructionStages).forEach(idxStr => {
            const idx = parseInt(idxStr);
            const stageName = state.instructionStages[idx];
            if (stageName) {
                const stageNum = STAGE_NAMES.indexOf(stageName);
                if (stageNum >= STAGE_NAMES.indexOf("EX")) { // EX, MEM, WB avanzan
                    const nextStageNum = stageNum + 1;
                    state.instructionStages[idx] = nextStageNum < STAGE_NAMES.length ? STAGE_NAMES[nextStageNum] : null;
                }
                // IF, ID se quedan donde están
            }
        });
        state.nextPCToFetch = prevState.nextPCToFetch; // No buscar nuevas instrucciones
        return state;
    }

    if (state.branchMispredictActiveStallCycles > 0) {
        state.branchMispredictActiveStallCycles--;
        // Lógica de stall por mispredict: IF/ID congelados (o NOPs), EX/MEM/WB avanzan.
        // `nextPCToFetch` ya debería estar corregido al target del branch.
        Object.keys(state.instructionStages).forEach(idxStr => {
            const idx = parseInt(idxStr);
            const stageName = state.instructionStages[idx];
            if (stageName) {
                const stageNum = STAGE_NAMES.indexOf(stageName);
                if (stageNum >= STAGE_NAMES.indexOf("EX")) {
                    const nextStageNum = stageNum + 1;
                    state.instructionStages[idx] = nextStageNum < STAGE_NAMES.length ? STAGE_NAMES[nextStageNum] : null;
                }
                // Durante el mispredict stall, las instrucciones en IF/ID ya deberían haber sido flusheadas.
                // Si alguna quedó por error, se podría limpiar aquí, o simplemente no avanzar.
                else if (stageNum < STAGE_NAMES.indexOf("EX")) {
                    // state.instructionStages[idx] = null; // Alternativamente, mantenerlas congeladas
                }
            }
        });
        return state;
    }

    // Pipeline Stages (WB -> MEM -> EX -> ID -> IF)
    const newPipelineLatches: SimulationState['pipelineLatches'] = {};
    const nextInstructionStages: Record<number, StageName | null> = {}; // Etapas para el *siguiente* ciclo

    const activeInstructionIndices = Object.keys(state.instructionStages)
        .map(Number)
        .filter(idx => state.instructionStages[idx] !== null) // Solo las que están en el pipeline
        .sort((a, b) => b - a); // Procesar de WB hacia IF (de la instrucción más vieja a la más nueva en pipeline)

    let pcUpdatedByJumpOrBranchInEXMEM = false; // Para evitar que IF busque si EX/MEM ya cambió el PC

    // --- ETAPA WRITEBACK (WB) ---
    activeInstructionIndices.forEach(instIdx => {
        if (state.instructionStages[instIdx] === "WB") {
            const wbLatch = state.pipelineLatches[instIdx]?.MEM_WB;
            if (wbLatch) {
                const regUsage = wbLatch.regUsage; // Nota: este regUsage es de cuando se parseó, no necesariamente el actualizado
                if (wbLatch.writeReg && wbLatch.writeReg !== "$zero") {
                    let valueToWrite: number | undefined = undefined;
                    if (regUsage.isLoad) {
                        valueToWrite = wbLatch.memReadValue;
                    } else if (regUsage.type === "R" || (regUsage.type === "I" && !regUsage.isStore && !regUsage.isBranch && !regUsage.isJump) || regUsage.opcode === 0x03 /*jal*/) {
                        valueToWrite = wbLatch.aluResult;
                    }
                    if (valueToWrite !== undefined) {
                        state.registers[wbLatch.writeReg] = valueToWrite;
                    }
                }
            }
            nextInstructionStages[instIdx] = null; // Sale del pipeline
            // No necesita `delete newPipelineLatches[instIdx]` porque `newPipelineLatches` se reconstruye
        }
    });

    // --- ETAPA MEMORY (MEM) ---
    activeInstructionIndices.forEach(instIdx => {
        if (state.instructionStages[instIdx] === "MEM") {
            const memLatch = state.pipelineLatches[instIdx]?.EX_MEM;
            if (memLatch) {
                const { instruction, pc, instructionIndex, regUsage, aluResult, writeReg, valRtForStore, branchTakenActual, actualTargetPC } = memLatch;
                let memReadValue: number | undefined = undefined;

                if (regUsage.isLoad) {
                    const address = aluResult!; // Dirección calculada en EX
                    const wordAddress = Math.floor(address / 4) * 4;
                    if (state.memory[wordAddress] !== undefined) {
                        let value = state.memory[wordAddress];
                        // ... (lógica de lb, lbu, lh, lhu como antes) ...
                        if (regUsage.opcode === 0x20) { value = (value >> ((address % 4) * 8)) & 0xFF; if (value & 0x80) value |= 0xFFFFFF00; }
                        else if (regUsage.opcode === 0x24) { value = (value >> ((address % 4) * 8)) & 0xFF; }
                        else if (regUsage.opcode === 0x21) { value = (value >> ((address % 4 === 0 ? 0 : 2) * 8)) & 0xFFFF; if (value & 0x8000) value |= 0xFFFF0000; }
                        else if (regUsage.opcode === 0x25) { value = (value >> ((address % 4 === 0 ? 0 : 2) * 8)) & 0xFFFF; }
                        memReadValue = value;
                    } else { memReadValue = 0xDEADBEEF; /* Error o valor por defecto */ }
                } else if (regUsage.isStore) {
                    // ... (lógica de sw, sh, sb como antes) ...
                    const address = aluResult!; const valueToStore = valRtForStore!; const wordAddress = Math.floor(address / 4) * 4;
                    if (regUsage.opcode === 0x2B) { state.memory[wordAddress] = valueToStore; }
                    else if (regUsage.opcode === 0x29) { const cW = state.memory[wordAddress] || 0; const m = ~(0xFFFF << ((address % 4 === 0 ? 0 : 2) * 16)); state.memory[wordAddress] = (cW & m) | ((valueToStore & 0xFFFF) << ((address % 4 === 0 ? 0 : 2) * 16)); }
                    else if (regUsage.opcode === 0x28) { const cW = state.memory[wordAddress] || 0; const m = ~(0xFF << ((address % 4) * 8)); state.memory[wordAddress] = (cW & m) | ((valueToStore & 0xFF) << ((address % 4) * 8)); }
                }
                // Pasar datos importantes al latch MEM_WB
                newPipelineLatches[instIdx] = {
                    ...newPipelineLatches[instIdx], // Conservar si ya hay algo (poco probable)
                    MEM_WB: { instruction, pc, instructionIndex, regUsage, memReadValue, aluResult, writeReg }
                };
            }
            nextInstructionStages[instIdx] = "WB";
        }
    });

    // --- ETAPA EXECUTE (EX) ---
    activeInstructionIndices.forEach(instIdx => {
        if (state.instructionStages[instIdx] === "EX") {
            const exLatch = state.pipelineLatches[instIdx]?.ID_EX;
            if (exLatch) {
                const { instruction, pc, instructionIndex, regUsage, valRs, valRt, imm, predictedPC, predictedTaken } = exLatch;
                let aluResult: number | undefined = undefined;
                let finalWriteReg: string | undefined = undefined;
                let branchTakenActual = false;
                let actualTargetPC: number | undefined = undefined; // Dirección de byte

                // ... (Lógica ALU como antes, actualizando aluResult y finalWriteReg) ...
                // Ejemplo para add: if (regUsage.funct === 0x20) { aluResult = valRs! + valRt!; finalWriteReg = `$${regMap[regUsage.rd.toString()]}`; }
                if (regUsage.type === "R") { finalWriteReg = `$${regMap[regUsage.rd.toString()]}`; switch (regUsage.funct) { case 0x20: case 0x21: aluResult = valRs! + valRt!; break; case 0x22: case 0x23: aluResult = valRs! - valRt!; break; case 0x24: aluResult = valRs! & valRt!; break; case 0x25: aluResult = valRs! | valRt!; break; case 0x26: aluResult = valRs! ^ valRt!; break; case 0x27: aluResult = ~(valRs! | valRt!); break; case 0x2A: aluResult = valRs! < valRt! ? 1 : 0; break; case 0x2B: aluResult = (valRs! >>> 0) < (valRt! >>> 0) ? 1 : 0; break; case 0x00: aluResult = valRt! << imm!; break; case 0x02: aluResult = valRt! >>> imm!; break; case 0x03: aluResult = valRt! >> imm!; break; case 0x08: actualTargetPC = valRs!; break; } }
                else if (regUsage.type === "I") { if (regUsage.isLoad || regUsage.isStore) { aluResult = valRs! + imm!; } else if (regUsage.isConditionalBranch) { if (regUsage.opcode === 0x04 && valRs === valRt) branchTakenActual = true; if (regUsage.opcode === 0x05 && valRs !== valRt) branchTakenActual = true; actualTargetPC = branchTakenActual ? regUsage.branchTargetAddress : pc + 4; } else { finalWriteReg = `$${regMap[regUsage.rt.toString()]}`; switch (regUsage.opcode) { case 0x08: case 0x09: aluResult = valRs! + imm!; break; case 0x0C: aluResult = valRs! & imm!; break; case 0x0D: aluResult = valRs! | imm!; break; case 0x0E: aluResult = valRs! ^ imm!; break; case 0x0A: aluResult = valRs! < imm! ? 1 : 0; break; case 0x0B: aluResult = (valRs! >>> 0) < (imm! >>> 0) ? 1 : 0; break; case 0x0F: aluResult = imm! << 16; break; } } }
                else if (regUsage.type === "J") { actualTargetPC = regUsage.jumpTargetAddress!; if (regUsage.opcode === 0x03) { finalWriteReg = "$ra"; aluResult = pc + 4; } } // JAL

                // Para cargas, el registro destino se determina aquí, pero el valor viene de MEM
                if (regUsage.isLoad) finalWriteReg = `$${regMap[regUsage.rd.toString()]}`;


                // Resolución de Saltos y Misprediction
                if (regUsage.isConditionalBranch) {
                    if (predictedTaken !== branchTakenActual || (predictedTaken && predictedPC !== actualTargetPC)) {
                        mispredictJustOccurred = true;
                        pcUpdatedByJumpOrBranchInEXMEM = true;
                        state.nextPCToFetch = actualTargetPC!; // Corregir el PC para el próximo fetch
                        state.branchMispredictActiveStallCycles = 2; // Penalización
                        state.hazards[instIdx] = { type: "Control", description: `Branch I${instIdx} MISPREDICT. Pred: ${predictedTaken ? 'T' : 'NT'} (0x${predictedPC?.toString(16)}), Actual: ${branchTakenActual ? 'T' : 'NT'} (0x${actualTargetPC?.toString(16)})`, canForward: false, stallCycles: 2 };

                        // ... (actualizar predictor de máquina de estados global como antes) ...
                        if (state.branchPredictionMode === "stateMachine") { let cS = state.globalStateMachineState; if (branchTakenActual) { if (cS === "SN") cS = "WN"; else if (cS === "WN") cS = "WT"; else if (cS === "WT") cS = "ST"; } else { if (cS === "ST") cS = "WT"; else if (cS === "WT") cS = "WN"; else if (cS === "WN") cS = "SN"; } state.globalStateMachineState = cS; }

                        // FLUSH: Marcar instrucciones en IF/ID como null en `nextInstructionStages`
                        Object.keys(state.pipelineLatches).forEach(key => {
                            const flushLatchInstIdx = parseInt(key);
                            if (flushLatchInstIdx > instIdx) { // Instrucciones que entraron al pipeline después
                                const stageOfFlushedInst = state.instructionStages[flushLatchInstIdx];
                                if (stageOfFlushedInst === "IF" || stageOfFlushedInst === "ID") {
                                    nextInstructionStages[flushLatchInstIdx] = null; // Anular en el *próximo* ciclo
                                    // No limpiar pipelineLatches aquí, se hará al reconstruir newPipelineLatches
                                }
                            }
                        });
                    }
                } else if (regUsage.isJump && regUsage.funct !== 0x08 /* no jr */) { // J, JAL
                    pcUpdatedByJumpOrBranchInEXMEM = true;
                    state.nextPCToFetch = actualTargetPC!;
                    // FLUSH para J, JAL
                    Object.keys(state.pipelineLatches).forEach(key => {
                        const flushLatchInstIdx = parseInt(key);
                        if (flushLatchInstIdx > instIdx) {
                            const stageOfFlushedInst = state.instructionStages[flushLatchInstIdx];
                            if (stageOfFlushedInst === "IF" || stageOfFlushedInst === "ID") {
                                nextInstructionStages[flushLatchInstIdx] = null;
                            }
                        }
                    });
                } else if (regUsage.isJump && regUsage.funct === 0x08 /* jr */) {
                    pcUpdatedByJumpOrBranchInEXMEM = true;
                    state.nextPCToFetch = actualTargetPC!; // Target de JR (valor de $rs)
                    // FLUSH para JR
                    Object.keys(state.pipelineLatches).forEach(key => {
                        const flushLatchInstIdx = parseInt(key);
                        if (flushLatchInstIdx > instIdx) {
                            const stageOfFlushedInst = state.instructionStages[flushLatchInstIdx];
                            if (stageOfFlushedInst === "IF" || stageOfFlushedInst === "ID") {
                                nextInstructionStages[flushLatchInstIdx] = null;
                            }
                        }
                    });
                }


                newPipelineLatches[instIdx] = {
                    ...newPipelineLatches[instIdx],
                    EX_MEM: { instruction, pc, instructionIndex, regUsage, aluResult, writeReg: finalWriteReg, valRtForStore: valRt, branchTakenActual, actualTargetPC }
                };
            }
            // Si hubo un mispredict y esta es la instrucción que lo causó, no avanza este ciclo debido al stall que acaba de activar.
            // O más bien, avanza a MEM, pero el pipeline se detendrá.
            // Si el mispredict stall es >0, la lógica de stall global al inicio del ciclo se encargará.
            if (!mispredictJustOccurred || state.branchMispredictActiveStallCycles === 0) { // Solo avanzar si no acabamos de activar un stall por mispredict
                nextInstructionStages[instIdx] = "MEM";
            } else {
                // Si esta instrucción causó un mispredict, se queda en EX este ciclo (efectivamente)
                // porque el próximo ciclo será un stall. O, si el flush la afecta, se va.
                // La lógica de stall global al inicio es más limpia.
                // Aquí, simplemente la pasamos a MEM, y el stall la congelará (o a las anteriores).
                nextInstructionStages[instIdx] = "MEM";
            }
        }
    });

    // --- ETAPA INSTRUCTION DECODE (ID) ---
    activeInstructionIndices.forEach(instIdx => {
        if (state.instructionStages[instIdx] === "ID") {
            const idLatch = state.pipelineLatches[instIdx]?.IF_ID;
            if (idLatch && idLatch.instruction) {
                const { instruction: currentInstructionHex, pc: currentPC, instructionIndex } = idLatch;
                const regUsage = state.registerUsage[instructionIndex]; // Usar el índice correcto
                if (!regUsage) { /* console.error(...); */ nextInstructionStages[instIdx] = null; return; }

                // Leer operandos (rs, rt) - Considerar forwarding aquí si se implementa
                // Por ahora, lee directamente de `state.registers` (estado del ciclo anterior)
                const valRs = regUsage.rs !== undefined ? state.registers[`$${regMap[regUsage.rs.toString()]}`] : undefined;
                const valRt = regUsage.rt !== undefined ? state.registers[`$${regMap[regUsage.rt.toString()]}`] : undefined;
                let imm: number | undefined;
                // ... (cálculo de imm como antes) ...
                if (regUsage.type === "I") { const bin = hexToBinary(currentInstructionHex.replace(/^0x/i, '')); imm = parseInt(bin.substring(16, 32), 2); if (![0x0c, 0x0d, 0x0e, 0x0f].includes(regUsage.opcode)) { if (imm & 0x8000) imm |= 0xFFFF0000; } }
                else if (regUsage.type === "R" && (regUsage.funct === 0x00 || regUsage.funct === 0x02 || regUsage.funct === 0x03)) { const bin = hexToBinary(currentInstructionHex.replace(/^0x/i, '')); imm = parseInt(bin.substring(21, 26), 2); }


                let predictedPCForNextFetch = currentPC + 4; // PC para fetch si no hay salto (dirección de byte)
                let branchPredictedTaken = false;

                if (regUsage.isConditionalBranch) {
                    // ... (lógica de predicción como antes, actualizando branchPredictedTaken y predictedPCForNextFetch) ...
                    switch (state.branchPredictionMode) { case "static": branchPredictedTaken = state.staticBranchPrediction === "taken"; break; case "stateMachine": branchPredictedTaken = state.globalStateMachineState === "WT" || state.globalStateMachineState === "ST"; break; default: branchPredictedTaken = false; break; }
                    if (branchPredictedTaken) predictedPCForNextFetch = regUsage.branchTargetAddress!;
                } else if (regUsage.isJump && regUsage.jumpTargetAddress !== undefined && regUsage.funct !== 0x08 /* no jr */) {
                    predictedPCForNextFetch = regUsage.jumpTargetAddress; // Jumps incondicionales (no JR) cambian el fetch PC en ID
                    branchPredictedTaken = true; // Considerar como "tomado" para el fetch
                }
                // Para JR, el target se resuelve en EX. Aquí no se puede predecir fácilmente sin BTB. Se asume PC+4 para el fetch.

                // Solo actualizar `state.nextPCToFetch` si no hubo un cambio de PC en EX/MEM este ciclo
                // Y si no estamos actualmente en un ciclo de stall por mispredict (donde el PC ya está corregido)
                if (!pcUpdatedByJumpOrBranchInEXMEM && state.branchMispredictActiveStallCycles === 0) {
                    state.nextPCToFetch = predictedPCForNextFetch;
                }

                newPipelineLatches[instIdx] = {
                    ...newPipelineLatches[instIdx],
                    ID_EX: { instruction: currentInstructionHex, pc: currentPC, instructionIndex, regUsage, valRs, valRt, imm, predictedPC: predictedPCForNextFetch, predictedTaken: branchPredictedTaken }
                };

                // Comprobar si esta instrucción causa un DATA stall
                if (state.stalls[instIdx] > 0 && state.currentDataStallCycles === 0 && state.branchMispredictActiveStallCycles === 0) {
                    state.currentDataStallCycles = state.stalls[instIdx];
                    // Si se activa un data stall, el fetch PC no debería haber avanzado especulativamente por un branch
                    if (branchPredictedTaken) state.nextPCToFetch = currentPC + 4; // Revertir si el data stall congela antes del branch fetch
                }
            }
            // Avanzar a EX si no hay un mispredict que nos haya flusheado o un data stall que nos congele
            if (!mispredictJustOccurred || state.branchMispredictActiveStallCycles === 0) { // TODO: Revisar condición de flush
                const wasFlushed = nextInstructionStages[instIdx] === null; // Si EX la flusheó
                if (!wasFlushed) nextInstructionStages[instIdx] = "EX";
            } else {
                nextInstructionStages[instIdx] = null; // Flusheada
            }
        }
    });

    // --- ETAPA INSTRUCTION FETCH (IF) ---
    // Solo buscar si no estamos en un ciclo de stall (datos o mispredict)
    // Y si no hubo un mispredict en este mismo ciclo (que ya corrigió el PC de fetch)
    if (state.currentDataStallCycles === 0 && state.branchMispredictActiveStallCycles === 0 && !mispredictJustOccurred) {
        const pcToFetchThisCycle = state.nextPCToFetch;
        const instructionIndexToFetch = getInstructionIndexFromPC(pcToFetchThisCycle, INSTRUCTION_START_ADDRESS);

        if (instructionIndexToFetch < state.instructions.length && instructionIndexToFetch >= 0) {
            // Solo fetchear si no está ya en el pipeline o siendo procesada en una etapa posterior este ciclo
            const alreadyInPipelineOrProcessed = Object.keys(nextInstructionStages)
                .map(Number)
                .includes(instructionIndexToFetch);

            if (!alreadyInPipelineOrProcessed || nextInstructionStages[instructionIndexToFetch] === null /* si fue flusheada */) {
                const instructionHex = state.instructions[instructionIndexToFetch];
                if (!state.registerUsage[instructionIndexToFetch]) { // Parsear si es la primera vez
                    state.registerUsage[instructionIndexToFetch] = parseInstruction(instructionHex, pcToFetchThisCycle, instructionIndexToFetch);
                }

                newPipelineLatches[instructionIndexToFetch] = {
                    ...(newPipelineLatches[instructionIndexToFetch] || {}),
                    IF_ID: { instruction: instructionHex, pc: pcToFetchThisCycle, instructionIndex: instructionIndexToFetch }
                };
                nextInstructionStages[instructionIndexToFetch] = "IF";
                state.lastFetchedPC = pcToFetchThisCycle;

                // El PC para el *siguiente* fetch será pcToFetchThisCycle + 4, a menos que ID lo cambie
                if (!pcUpdatedByJumpOrBranchInEXMEM) { // No sobrescribir si EX/MEM ya tomaron un salto
                    state.nextPCToFetch = pcToFetchThisCycle + 4;
                }
            }
        }
    }
    // El PC del estado refleja la dirección de la instrucción que está (o estaría) en IF, o el target de un salto.
    state.PC = state.nextPCToFetch;


    // Actualizar `instructionStages` y `pipelineLatches` para el próximo ciclo
    state.instructionStages = nextInstructionStages;
    state.pipelineLatches = newPipelineLatches;

    // Comprobar si ha terminado
    let activeInstructionsCount = 0;
    Object.values(state.instructionStages).forEach(stage => { if (stage !== null) activeInstructionsCount++; });

    const noMoreInstructionsToFetch = state.nextPCToFetch >= (INSTRUCTION_START_ADDRESS + state.instructions.length * 4);

    if (activeInstructionsCount === 0 && noMoreInstructionsToFetch) {
        state.isFinished = true;
        state.isRunning = false;
    }

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