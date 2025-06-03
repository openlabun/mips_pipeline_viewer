'use client';

import * as React from 'react';

interface RegisterUsage {
  rs: number;
  rt: number;
  rd: number;
  opcode: number;
  funct: number;
  type: 'R' | 'I' | 'J' | 'OTHER';
  isLoad: boolean;
  isBranch: boolean;
  branchType?: 'BEQ' | 'BNE';
  immediate?: number;
}

const simulateRegisterFiles = (
  submittedInstructions: string[],
  registerUsage: Record<number, RegisterUsage>
): Record<number, number>[] => {
  const states: Record<number, number>[] = [];
  const regFile: Record<number, number> = {};
  for (let r = 0; r < 32; r++) regFile[r] = 0;

  submittedInstructions.forEach((_, idx) => {
    const usage = registerUsage[idx];
    states.push({ ...regFile });

    if (usage.type === "R") {
      const funct = usage.funct;
      const rsVal = regFile[usage.rs];
      const rtVal = regFile[usage.rt];
      let result = 0;

      switch (funct) {
        case 32:
          result = rsVal + rtVal;
          break;
        case 34:
          result = rsVal - rtVal;
          break;
        case 36:
          result = rsVal & rtVal;
          break;
        case 37:
          result = rsVal | rtVal;
          break;
        case 42:
          result = rsVal < rtVal ? 1 : 0;
          break;
        default:
          result = 0;
      }
      if (usage.rd !== 0) {
        regFile[usage.rd] = result;
      }
    } else if (usage.type === "I" && usage.isBranch) {
      // nothing happens
    } else if (usage.type === "I" && usage.isLoad) {
      regFile[usage.rd] = 0;
    } else if (usage.type === "I" && !usage.isBranch) {
      const opc = usage.opcode;
      const rsVal = regFile[usage.rs];
      const imm = usage.immediate ?? 0;
      let result = 0;
      switch (opc) {
        case 8:
          result = rsVal + imm;
          break;
        case 12:
          result = rsVal & imm;
          break;
        case 13:
          result = rsVal | imm;
          break;
        case 14:
          result = rsVal ^ imm;
          break;
        case 10:
          result = rsVal < imm ? 1 : 0;
          break;
        default:
          result = 0;
      }
      if (usage.rd !== 0) {
        regFile[usage.rd] = result;
      }
    }
  });

  return states;
};

export default function Compilator({
  instructions,
  registerUsage,
}: {
  instructions: string[];
  registerUsage: Record<number, RegisterUsage>;
}) {
  const [registerFileStates, setRegisterFileStates] = React.useState<
    Record<number, number>[]
  >([]);

  React.useEffect(() => {
    const states = simulateRegisterFiles(instructions, registerUsage);
    setRegisterFileStates(states);
  }, [instructions, registerUsage]);

  return (
    <div className='w-full'>
      <h2 className='text-lg font-semibold mb-2'>Compilator MIPS (Secuencial)</h2>
      <div className='overflow-x-auto'>
        <table className='min-w-full table-auto border'>
          <thead>
            <tr>
              <th className='border px-2 py-1'>Instr #</th>
              <th className='border px-2 py-1'>Reg</th>
              <th className='border px-2 py-1'>Valor</th>
            </tr>
          </thead>
          <tbody>
            {registerFileStates.map((rf, idx) =>
              Object.keys(rf).map((r) => (
                <tr key={`state-${idx}-r${r}`}>
                  <td className='border px-2 py-1 text-center'>{idx}</td>
                  <td className='border px-2 py-1 text-center'>{r}</td>
                  <td className='border px-2 py-1 text-center'>{rf[parseInt(r)]}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
