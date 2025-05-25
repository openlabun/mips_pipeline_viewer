export type OpType = 'R_FORMAT' | 'I_FORMAT' | 'J_FORMAT';

export interface InstructionDescriptor {
  sourceReg1: number;
  sourceReg2: number;
  targetReg: number;
  operation: number;
  funcCode: number;
  format: OpType;
  isLoadWord: boolean;
}

export function decodeHexInstruction(hexCode: string): InstructionDescriptor {
  const binaryString = parseInt(hexCode, 16).toString(2).padStart(32, '0');

  const operation = parseInt(binaryString.substring(0, 6), 2);
  const sourceReg1 = parseInt(binaryString.substring(6, 11), 2);
  const sourceReg2 = parseInt(binaryString.substring(11, 16), 2);

  let format: OpType = 'R_FORMAT';
  let targetReg = 0;
  let funcCode = 0;

  const isLoadWord = operation === 35;

  if (operation === 0) {
    format = 'R_FORMAT';
    targetReg = parseInt(binaryString.substring(16, 21), 2);
    funcCode = parseInt(binaryString.substring(26, 32), 2);
  } else if (operation === 2 || operation === 3) {
    format = 'J_FORMAT';
    targetReg = operation === 3 ? 31 : 0;
    funcCode = 0;
  } else {
    format = 'I_FORMAT';
    if (operation >= 32 && operation <= 37) {
      targetReg = sourceReg2;
    } else if (operation >= 8 && operation <= 15) {
      targetReg = sourceReg2;
    } else {
      targetReg = 0;
    }
  }

  return {
    sourceReg1,
    sourceReg2,
    targetReg,
    operation,
    funcCode,
    format,
    isLoadWord,
  };
}

export function decodeInstructions(
  instructions: string[]
): Record<number, InstructionDescriptor> {
  const instructionFormats: Record<number, InstructionDescriptor> = {};

  instructions.forEach((inst, idx) => {
    instructionFormats[idx] = decodeHexInstruction(inst);
  });

  return instructionFormats;
}
