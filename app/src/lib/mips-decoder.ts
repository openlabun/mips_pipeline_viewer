export interface DecodedInstructionInfo {
  hex: string;
  opcode: number | null;
  rs: number | null; 
  rt: number | null; 
  rd: number | null; 
  isLoadWord: boolean;
  writesToRegister: boolean; 
  destinationRegister: number | null; 
  sourceRegisters: number[]; 
}

export function decodeInstruction(hexInstruction: string): DecodedInstructionInfo {
  if (hexInstruction.length !== 8 || !/^[0-9a-fA-F]+$/.test(hexInstruction)) {
    console.warn(`Invalid hex instruction format: ${hexInstruction}`);
    return {
      hex: hexInstruction,
      opcode: null, rs: null, rt: null, rd: null,
      isLoadWord: false, writesToRegister: false,
      destinationRegister: null, sourceRegisters: [],
    };
  }

  const instructionInt = parseInt(hexInstruction, 16);

  const opcode = (instructionInt >>> 26) & 0x3F;
  const rs = (instructionInt >>> 21) & 0x1F;
  const rt = (instructionInt >>> 16) & 0x1F;
  const rd = (instructionInt >>> 11) & 0x1F;

  let isLoadWord = false;
  let writesToRegister = false;
  let destinationRegister: number | null = null;
  const sourceRegisters: number[] = [];

  if (opcode === 0x00) {
    if (rd !== 0) {
      writesToRegister = true;
      destinationRegister = rd;
    }
    if (rs !== 0) sourceRegisters.push(rs);
    if (rt !== 0) sourceRegisters.push(rt);
  }
  else {
    if (opcode === 0x23) {
      isLoadWord = true;
      if (rt !== 0) {
        writesToRegister = true;
        destinationRegister = rt;
      }
      if (rs !== 0) sourceRegisters.push(rs);
    }
    else if (opcode === 0x2B) {
      writesToRegister = false;
      destinationRegister = null;
      if (rs !== 0) sourceRegisters.push(rs);
      if (rt !== 0) sourceRegisters.push(rt);
    }
    else if (opcode === 0x08) {
      if (rt !== 0) {
        writesToRegister = true;
        destinationRegister = rt;
      }
      if (rs !== 0) sourceRegisters.push(rs);
    }
    else if ([0x0C, 0x0D, 0x0E, 0x0A].includes(opcode)) {
        if (rt !== 0) {
            writesToRegister = true;
            destinationRegister = rt;
        }
        if (rs !== 0) sourceRegisters.push(rs);
    }
    else if (opcode === 0x0F) {
        if (rt !== 0) {
            writesToRegister = true;
            destinationRegister = rt;
        }
    }
  }

  return {
    hex: hexInstruction,
    opcode,
    rs: opcode === 0x00 || [0x23, 0x2B, 0x08, 0x0C, 0x0D, 0x0E, 0x0A].includes(opcode) ? rs : null,
    rt: opcode === 0x00 || [0x23, 0x2B, 0x08, 0x0C, 0x0D, 0x0E, 0x0A, 0x0F].includes(opcode) ? rt : null,
    rd: opcode === 0x00 ? rd : null,
    isLoadWord,
    writesToRegister,
    destinationRegister,
    sourceRegisters: [...new Set(sourceRegisters)],
  };
}

export function getDecodedInstructionText(info: DecodedInstructionInfo): string {
  if (info.opcode === null) return `${info.hex} (Error decoding)`;
  let text = `${info.hex} -> Op:0x${info.opcode.toString(16).padStart(2,'0')}`;
  if (info.rs !== null) text += `, rs:$${info.rs}`;
  if (info.rt !== null) text += `, rt:$${info.rt}`;
  if (info.rd !== null && info.opcode === 0) text += `, rd:$${info.rd}`;
  if (info.isLoadWord) text += ` (LW)`;
  if (info.writesToRegister && info.destinationRegister !== null) {
    text += ` -> writes to $${info.destinationRegister}`;
  } else if (info.writesToRegister && info.destinationRegister === null) {
    text += ` -> attempts to write to $0`;
  }
  if (info.sourceRegisters.length > 0) {
    text += `, reads from ${info.sourceRegisters.map(r => `$${r}`).join(', ')}`;
  }
  return text;
}