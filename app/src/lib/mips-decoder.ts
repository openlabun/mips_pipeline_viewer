export interface DecodedInstructionInfo {
  hex: string; // La instrucción original en hexadecimal
  opcode: number | null;
  rs: number | null; // Número del registro fuente 1
  rt: number | null; // Número del registro fuente 2 o destino para lw/sw
  rd: number | null; // Número del registro destino para R-type
  isLoadWord: boolean;
  writesToRegister: boolean; // Indica si la instrucción escribe en rd o rt (para lw)
  destinationRegister: number | null; // El registro que será escrito (rd o rt para lw)
  sourceRegisters: number[]; // Array de números de registros fuente
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

  // R-type (ej: add, sub, or, slt). Opcode 0x00.
  if (opcode === 0x00) {
    // Para R-type, rd es el destino. rs y rt son fuentes.
    // shamt y funct no son necesarios para la detección de hazards de registros.
    if (rd !== 0) { // No se escribe en el registro $zero
      writesToRegister = true;
      destinationRegister = rd;
    }
    if (rs !== 0) sourceRegisters.push(rs); // $zero no es una dependencia
    if (rt !== 0) sourceRegisters.push(rt); // $zero no es una dependencia
  }
  // I-type
  else {
    // LW (opcode 0x23 o 35 decimal)
    if (opcode === 0x23) {
      isLoadWord = true;
      if (rt !== 0) { // No se escribe en $zero
        writesToRegister = true;
        destinationRegister = rt; // rt es el destino en lw
      }
      if (rs !== 0) sourceRegisters.push(rs); // rs es el registro base (fuente)
    }
    // SW (opcode 0x2B o 43 decimal)
    else if (opcode === 0x2B) {
      writesToRegister = false; // sw no escribe en el banco de registros
      destinationRegister = null;
      if (rs !== 0) sourceRegisters.push(rs); // rs es el registro base (fuente)
      if (rt !== 0) sourceRegisters.push(rt); // rt es el registro a guardar (fuente)
    }
    // ADDI (opcode 0x08 o 8 decimal)
    else if (opcode === 0x08) {
      if (rt !== 0) { // No se escribe en $zero
        writesToRegister = true;
        destinationRegister = rt; // rt es el destino
      }
      if (rs !== 0) sourceRegisters.push(rs); // rs es fuente
    }
    // Otros I-type que escriben en rt (ej. ANDI, ORI, XORI, SLTI)
    // ANDI (0x0C), ORI (0x0D), XORI (0x0E), SLTI (0x0A)
    else if ([0x0C, 0x0D, 0x0E, 0x0A].includes(opcode)) {
        if (rt !== 0) {
            writesToRegister = true;
            destinationRegister = rt;
        }
        if (rs !== 0) sourceRegisters.push(rs);
    }
    // LUI (0x0F) - rt es destino, no usa rs como fuente de datos.
    else if (opcode === 0x0F) {
        if (rt !== 0) {
            writesToRegister = true;
            destinationRegister = rt;
        }
        // No hay rs como fuente de datos para LUI en el sentido de hazard
    }
    // Para otras instrucciones I-type no listadas o J-type,
    // asumimos que no escriben o no son relevantes para hazards simples de reg-reg.
    // Esto se puede expandir si se soportan más instrucciones.
  }

  return {
    hex: hexInstruction,
    opcode,
    rs: opcode === 0x00 || [0x23, 0x2B, 0x08, 0x0C, 0x0D, 0x0E, 0x0A].includes(opcode) ? rs : null, // rs es relevante para R-type y muchos I-type
    rt: opcode === 0x00 || [0x23, 0x2B, 0x08, 0x0C, 0x0D, 0x0E, 0x0A, 0x0F].includes(opcode) ? rt : null, // rt es relevante para R-type y muchos I-type
    rd: opcode === 0x00 ? rd : null, // rd solo es relevante para R-type
    isLoadWord,
    writesToRegister,
    destinationRegister,
    sourceRegisters: [...new Set(sourceRegisters)], // Asegurar valores únicos
  };
}

/**
 * Devuelve una representación de texto de la información decodificada.
 * Útil para debugging.
 */
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
    // Esto podría pasar si rd/rt es $zero y lo marcamos como que no "escribe" funcionalmente.
    text += ` -> attempts to write to $0`;
  }
  if (info.sourceRegisters.length > 0) {
    text += `, reads from ${info.sourceRegisters.map(r => `$${r}`).join(', ')}`;
  }
  return text;
}