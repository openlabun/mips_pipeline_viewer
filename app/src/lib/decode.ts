interface DecodedInst {
  reads: number[];    // registros leídos
  writes: number | null; // registro escrito
  isLoad: boolean;
}

export function decodeInstruction(hex: string): DecodedInst {
  const bin = parseInt(hex, 16).toString(2).padStart(32, '0');
  const opcode = parseInt(bin.slice(0, 6), 2);
  const rs = parseInt(bin.slice(6, 11), 2);
  const rt = parseInt(bin.slice(11, 16), 2);
  const rd = parseInt(bin.slice(16, 21), 2);
  const funct = parseInt(bin.slice(26), 2);

  if (opcode === 0) {
    // R-type
    return {
      reads: [rs, rt],
      writes: rd,
      isLoad: false
    };
  }

  // Load (opcode 35 == 0x23)
  if (opcode === 0x23) {
    return {
      reads: [rs],
      writes: rt,
      isLoad: true
    };
  }

  // Store (opcode 43 == 0x2B)
  if (opcode === 0x2B) {
    return {
      reads: [rs, rt],
      writes: null,
      isLoad: false
    };
  }

  // Addi u otras.
  return {
    reads: [rs],
    writes: rt,
    isLoad: false
  };
}

//detectar hazard
function hasHazard(prev: DecodedInst, curr: DecodedInst): boolean {
  if (prev.writes == null || prev.writes === 0) return false;
  return curr.reads.includes(prev.writes);
}
//usar para stall
export function Stall(prev: DecodedInst, curr: DecodedInst): boolean {
  return hasHazard(prev, curr);
}
//usar para FW, la segunda componente verifica si es load
export function canForward(prev: DecodedInst, curr: DecodedInst): [boolean,boolean] {
  const hazard = hasHazard(prev, curr);
  const requiereStall = hazard && prev.isLoad;
  return [hazard, requiereStall];
  
}
