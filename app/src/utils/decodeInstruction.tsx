export type instructionFormat = 'R' | 'I' | 'J';

// Define the shape of the instruction
export interface decodedInstruction {
  format: instructionFormat;
  opcode: number;
  rs?: number; // Source register (optional for J-type)
  rt?: number; // Target register (optional for R-type)
  rd?: number; // Destination register (optional for R-type)
  shamt?: number; // Shift amount (optional for R-type)
  funct?: number; // Function code (optional for R-type)
  immediate?: number; // Immediate value (optional for I-type)
  address?: number; // Address (optional for J-type)
  raw: string; // Original instruction string
}


export function decodeHexInstruction(hex: string): decodedInstruction {

  const binary = parseInt(hex, 16).toString(2).padStart(32, '0');
  const opcode = parseInt(binary.slice(0, 6));

  const decoded: decodedInstruction = {
    format: 'R', // Default to R-type adjust later
    opcode,
    raw: hex,
  };

  if(opcode === 0) { // R-type
    decoded.rs = parseInt(binary.slice(6, 11), 2);
    decoded.rt = parseInt(binary.slice(11, 16), 2);
    decoded.rd = parseInt(binary.slice(16, 21), 2);
    decoded.shamt = parseInt(binary.slice(21, 26), 2);
    decoded.funct = parseInt(binary.slice(26, 32), 2);
    decoded.format = 'R';
  } else if(opcode === 2 || opcode === 3) { // J-type
    decoded.format = 'J';
    decoded.address = parseInt(binary.slice(6, 32), 2);
   
  }else { // I-type
    decoded.format = 'I';
    decoded.rs = parseInt(binary.slice(6, 11), 2);
    decoded.rt = parseInt(binary.slice(11, 16), 2);
    decoded.immediate = parseInt(binary.slice(16, 32), 2);
    
  }
  return decoded;
}