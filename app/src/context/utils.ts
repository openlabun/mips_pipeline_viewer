import { list } from "postcss";

export function binaryToHex(binaryString: string): string {
    // Pad the binary string with leading zeros to ensure it's a multiple of 4
    while (binaryString.length % 4 !== 0) {
        binaryString = '0' + binaryString;
    }

    // Initialize an empty string to store the hexadecimal representation
    let hexString = '';

    // Convert each group of 4 bits to its hexadecimal equivalent
    for (let i = 0; i < binaryString.length; i += 4) {
        const binaryChunk = binaryString.substr(i, 4); // Get a chunk of 4 bits
        const hexDigit = parseInt(binaryChunk, 2).toString(16); // Convert the chunk to hexadecimal
        hexString += hexDigit; // Append the hexadecimal digit to the result
    }

    // Return the hexadecimal representation
    return "0x" + hexString.toUpperCase(); // Convert to uppercase for consistency
}

export function hexToBinary(hex: string): string {
    let binary = '';
    for (let i = 0; i < hex.length; i++) {
        let bin = parseInt(hex[i], 16).toString(2);
        binary += bin.padStart(4, '0');
    }
    return binary;
}

export function translateInstructionToMIPS(hexInstruction: string): string {
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
        "00000": "zero",
        "00001": "at",
        "00010": "v0",
        "00011": "v1",
        "00100": "a0",
        "00101": "a1",
        "00110": "a2",
        "00111": "a3",
        "01000": "t0",
        "01001": "t1",
        "01010": "t2",
        "01011": "t3",
        "01100": "t4",
        "01101": "t5",
        "01110": "t6",
        "01111": "t7",
        "10000": "s0",
        "10001": "s1",
        "10010": "s2",
        "10011": "s3",
        "10100": "s4",
        "10101": "s5",
        "10110": "s6",
        "10111": "s7",
        "11000": "t8",
        "11001": "t9",
        "11010": "k0",
        "11011": "k1",
        "11100": "gp",
        "11101": "sp",
        "11110": "fp",
        "11111": "ra"
    };

    const binaryInstruction = hexToBinary(hexInstruction);
    const opcode = binaryInstruction.slice(0, 6);
    const opcodeMIPS = opcodeMap[opcode as keyof typeof opcodeMap];
    if (!opcodeMIPS) return "Unknown Instruction (invalid opcode)";

    let mipsInstruction = "";
    if (opcodeMIPS === "R") {
        const func = binaryInstruction.slice(26, 32);
        const funcMIPS = funcMap[func as keyof typeof funcMap];
        if (!funcMIPS) return "Unknown Instruction (function)";
        const rs = regMap[binaryInstruction.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binaryInstruction.slice(11, 16) as keyof typeof regMap];
        const rd = regMap[binaryInstruction.slice(16, 21) as keyof typeof regMap];
        const shamt = parseInt(binaryInstruction.slice(21, 26), 2);

        if (["sll", "srl"].includes(funcMIPS)) {
            mipsInstruction = `${funcMIPS} ${rd} ${rt} ${shamt}`;
        } else if (funcMIPS === "jr") {
            mipsInstruction = `${funcMIPS} ${rs}`;
        } else {
            mipsInstruction = `${funcMIPS} ${rd} ${rs} ${rt}`;
        }
    } else if (["lw", "sw", "lbu", "lhu", "ll", "sb", "sh", "sc"].includes(opcodeMIPS)) {
        const base = regMap[binaryInstruction.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binaryInstruction.slice(11, 16) as keyof typeof regMap];
        const offset = parseInt(binaryInstruction.slice(16, 32), 2);
        mipsInstruction = `${opcodeMIPS} ${rt} ${offset}(${base})`;
    } else if (["addi", "addiu", "lui", "andi", "ori", "slti", "sltiu"].includes(opcodeMIPS)) {
        const rs = regMap[binaryInstruction.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binaryInstruction.slice(11, 16) as keyof typeof regMap];
        const immediate = parseInt(binaryInstruction.slice(16, 32), 2);
        mipsInstruction = `${opcodeMIPS} ${rt} ${rs} ${immediate}`;
    } else if (["beq", "bne"].includes(opcodeMIPS)) {
        const rs = regMap[binaryInstruction.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binaryInstruction.slice(11, 16) as keyof typeof regMap];
        const offset = parseInt(binaryInstruction.slice(16, 32), 2);
        mipsInstruction = `${opcodeMIPS} ${rs} ${rt} ${offset}`;
    } else if (["j", "jal"].includes(opcodeMIPS)) {
        const address = parseInt(binaryInstruction.slice(6, 32), 2);
        mipsInstruction = `${opcodeMIPS} ${address}`;
    } else {
        return "Unsupported instruction type";
    }

return mipsInstruction;
}

export function translateInstructionToMIPSList(hexInstructions: string[]): string[] {
    return hexInstructions.map(translateInstructionToMIPS);
}

// Define the InstructionMeta interface
interface InstructionMeta {
    type: "R" | "I" | "J";
    raw: string;
    opcode: string;
    name: string;
    rs?: string;
    rt?: string;
    rd?: string;
    readsFrom: string[];
    writesTo?: string;
}

export function analyzeInstruction(hex: string): InstructionMeta {
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

// Example hex input as string literals (remove or comment out if not needed)
type PipelineStage = "IF" | "ID" | "EX" | "MEM" | "WB" | "STALL" | "";

export function simulatePipelineWithStall(hexInstructions: string[]): PipelineStage[][] {
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
                    const writeStage = prev.name === "lw" ? 3 : 4; // MEM o WB
                    const availableCycle = prevStart + writeStage;
                    const neededCycle = currentCycle + 1; // La instrucción lo necesita en ID
                    if (neededCycle < availableCycle) {
                        stall = Math.max(stall, availableCycle - neededCycle);
                    }
                }
            }
        }
        currentCycle += stall;
        startCycles.push(currentCycle);

        // Rellena la matriz con las etapas y los stalls
        let stageIdx = 0;
        let cycle = currentCycle;
        while (stageIdx < STAGES.length) {
            pipeline[i][cycle] = STAGES[stageIdx];
            stageIdx++;
            cycle++;
        }
        // Marca los stalls (si hubo)
        for (let s = 0; s < stall; s++) {
            pipeline[i][currentCycle - stall + s] = "STALL";
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

// Ejemplo de uso:
const hex_input = [
    "21080001",
    "21290002",
    "214A0003",
    "216B0004",
    "218C0005",
    "01084020",
    "01084820",
    "01295020",
    "014A5820",
    "016B6020"
];

const pipelineMatrix = simulatePipelineWithStall(hex_input);
console.table(pipelineMatrix);


