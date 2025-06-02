// mipsExecutor.ts
// Esta función ejecuta instrucciones MIPS en hexadecimal y genera snapshots del estado de los registros
type RegisterState = Record<string, number>;

const initialRegisters: RegisterState = {
  $zero: 0,
  $at: 0,
  $v0: 0, $v1: 0,
  $a0: 0, $a1: 0, $a2: 0, $a3: 0,
  $t0: 0, $t1: 0, $t2: 0, $t3: 0, $t4: 0, $t5: 0, $t6: 0, $t7: 0,
  $s0: 0, $s1: 0, $s2: 0, $s3: 0, $s4: 0, $s5: 0, $s6: 0, $s7: 0,
  $t8: 0, $t9: 0,
  $k0: 0, $k1: 0,
  $gp: 0,
  $sp: 0,
  $fp: 0,
  $ra: 0
};

const regNumberToName: Record<number, string> = {
  0: '$zero', 1: '$at', 2: '$v0', 3: '$v1', 4: '$a0', 5: '$a1', 6: '$a2', 7: '$a3',
  8: '$t0', 9: '$t1', 10: '$t2', 11: '$t3', 12: '$t4', 13: '$t5', 14: '$t6', 15: '$t7',
  16: '$s0', 17: '$s1', 18: '$s2', 19: '$s3', 20: '$s4', 21: '$s5', 22: '$s6', 23: '$s7',
  24: '$t8', 25: '$t9', 26: '$k0', 27: '$k1', 28: '$gp', 29: '$sp', 30: '$fp', 31: '$ra'
};

export function executeMipsHexInstructions(hexInstructions: string[]): RegisterState[] {
  let snapshots: RegisterState[] = [];
  let registers: RegisterState = { ...initialRegisters };

  for (let i = 0; i < hexInstructions.length; i++) {
    const hex = hexInstructions[i];
    const bin = parseInt(hex, 16).toString(2).padStart(32, '0');
    const opcode = parseInt(bin.substring(0, 6), 2);

    if (opcode === 0) {
      // Tipo R
      const rs = parseInt(bin.substring(6, 11), 2);
      const rt = parseInt(bin.substring(11, 16), 2);
      const rd = parseInt(bin.substring(16, 21), 2);
      const funct = parseInt(bin.substring(26, 32), 2);

      if (funct === 32) {
        // add
        registers[regNumberToName[rd]] = registers[regNumberToName[rs]] + registers[regNumberToName[rt]];
      } else if (funct === 34) {
        // sub
        registers[regNumberToName[rd]] = registers[regNumberToName[rs]] - registers[regNumberToName[rt]];
      }
    } else {
      // Tipo I
      const rs = parseInt(bin.substring(6, 11), 2);
      const rt = parseInt(bin.substring(11, 16), 2);
      const imm = parseInt(bin.substring(16, 32), 2);

      if (opcode === 8) {
        // addi
        registers[regNumberToName[rt]] = registers[regNumberToName[rs]] + imm;
      } else if (opcode === 4 || opcode === 5) {
        // beq or bne - no modifican registros
        // no hacemos nada en el compilador, solo simulan salto
      }
    }

    // Guardar snapshot profundo
    snapshots.push({ ...registers });
  }

  return snapshots;
}

