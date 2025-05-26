import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Detects data hazards and inserts NOPs (00000000) to resolve them.
 * Supports RAW (Read After Write) hazards.
 */
export function insertStallsForDataHazards(instructions: string[]): string[] {
  type DecodedInstruction = {
    raw: string;
    src: string[];   // registros que se leen
    dest: string | null; // registro que se escribe
  };

  const hexToBin = (hex: string): string => {
    return parseInt(hex, 16).toString(2).padStart(32, '0');
  };

  const binToReg = (bin: string): string => {
    return parseInt(bin, 2).toString(); // puede ser string o number
  };

  const decodeInstruction = (hex: string): DecodedInstruction => {
    const bin = hexToBin(hex);
    const opcode = bin.substring(0, 6);

    if (opcode === "000000") {
      // R-type: funct = bits 26-31
      const rs = binToReg(bin.substring(6, 11));
      const rt = binToReg(bin.substring(11, 16));
      const rd = binToReg(bin.substring(16, 21));
      return { raw: hex, src: [rs, rt], dest: rd };
    } else {
      // I-type: opcode ≠ 000000
      const rs = binToReg(bin.substring(6, 11));
      const rt = binToReg(bin.substring(11, 16));
      const isStore = opcode === "101011"; 
      return {
        raw: hex,
        src: isStore ? [rs, rt] : [rs],
        dest: isStore ? null : rt, 
      };
    }
  };

  const decoded: DecodedInstruction[] = instructions.map(decodeInstruction);
  const output: string[] = [];

  for (let i = 0; i < decoded.length; i++) {
    const curr = decoded[i];
    let stallsNeeded = 0;

    for (let j = i - 1; j >= 0 && j >= i - 2; j--) {
      const prev = decoded[j];
      if (prev.dest && curr.src.includes(prev.dest)) {
        const delay = 3 - (i - j - 1); // espacio necesario entre instr.
        stallsNeeded = Math.max(stallsNeeded, delay);
      }
    }

    for (let s = 0; s < stallsNeeded; s++) {
      output.push("00000000"); // NOP
    }

    output.push(curr.raw);
  }

  return output;
}

export type ForwardInfo = {
  fromInst: number;
  fromStage: number;
  toInst: number;
  toStage: number;
  reg: string;
};

export type ForwardingResult = {
  map(arg0: (instr: any) => string): unknown;
  forwards: ForwardInfo[];
  instructions: string[]; // Instrucciones con stalls insertados si es necesario
};

export function insertStallsForForwarding(instructions: string[]): ForwardingResult {
  type DecodedInstruction = {
    raw: string;
    src: string[];
    dest: string | null;
    opcode: string;
  };

  const hexToBin = (hex: string): string => {
    return parseInt(hex, 16).toString(2).padStart(32, '0');
  };

  const binToReg = (bin: string): string => {
    return String(parseInt(bin, 2));
  };

  const decodeInstruction = (hex: string): DecodedInstruction => {
    const bin = hexToBin(hex);
    const opcode = bin.substring(0, 6);

    if (opcode === "000000") {
      // R-type
      const rs = binToReg(bin.substring(6, 11));
      const rt = binToReg(bin.substring(11, 16));
      const rd = binToReg(bin.substring(16, 21));
      return { raw: hex, src: [rs, rt], dest: rd, opcode };
    } else {
      // I-type
      const rs = binToReg(bin.substring(6, 11));
      const rt = binToReg(bin.substring(11, 16));
      return {
        raw: hex,
        src: opcode === "101011" ? [rs, rt] : [rs],
        dest: opcode === "101011" ? null : rt,
        opcode
      };
    }
  };

  const decoded: DecodedInstruction[] = instructions.map(decodeInstruction);
  const forwards: ForwardInfo[] = [];
  const output: string[] = [];

  let i = 0;
  while (i < decoded.length) {
    const curr = decoded[i];
    let stallInserted = false;

    // Check for load-use hazard with previous instruction
    if (
      i > 0 &&
      decoded[i - 1].opcode === "100011" &&
      decoded[i - 1].dest !== null &&
      curr.src.includes(decoded[i - 1].dest as string)
    ) {
      // Insert stall(s) using your stall function for just these two
      const stalled = insertStallsForDataHazards([decoded[i - 1].raw, curr.raw]);
      // Remove the last instruction already added (the previous one), to avoid duplication
      output.pop();
      // Add the stalled instructions (with NOPs)
      output.push(...stalled);
      stallInserted = true;
      i++; // Skip to next instruction
      continue;
    }

    // Check for possible forwards (from MEM or WB)
    for (let j = i - 1; j >= 0 && j >= i - 2; j--) {
      const prev = decoded[j];
      if (prev.dest !== null && curr.src.includes(prev.dest as string)) {
        // Only add forward if not a load-use hazard
        if (!(prev.opcode === "100011" && j === i - 1)) {
          const fromStage = (j === i - 1) ? 3 : 4; // 3: MEM, 4: WB
          forwards.push({
            fromInst: j,
            fromStage: fromStage,
            toInst: i,
            toStage: 2, // EX
            reg: prev.dest
          });
        }
      }
    }

    output.push(curr.raw);
    i++;
  }
  console.log("Forwards detected:", forwards);
  return {
    forwards,
    instructions: output,
    map: (fn: (instr: any) => string) => output.map(fn)
  };
}

const instructions = [
  "00221820", // ADD R3, R1, R2
  "00632022", // SUB R4, R3, R3
  "00842820"  // ADD R5, R4, R4
];

console.log("forwards", insertStallsForForwarding(instructions).forwards);
