'use client';

import type * as React from 'react';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  useSimulationActions,
  useSimulationState,
} from '@/context/SimulationContext'; // Import context hooks
import {
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  Zap,
  StopCircle,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

let fwd = false;
let fwdprev: number[] = [];  // Ahora TypeScript sabe que el array contendrá números
let fwdpos: number[] = [];
let haylw: boolean = false;
let haylwvec: boolean[] = []
let haylwprev: boolean = false;
let stallprev: number[] = []
let stallprev2: number[] = []
let stallif: boolean[] = []
let cuantosstall: number;
let haybranch: string[];
let setomabranch: boolean;
let setomabranchprev: boolean;
let saltobranch: number;
let saltables: boolean[] = []
let entroID: boolean = false;
let cambioboton: boolean=true;



const registers: Record<string, number> = {
  $zero: 0,
  $t0: 0, $t1: 0, $t2: 0, $t3: 0, $t4: 0, $t5: 0, $t6: 0, $t7: 0, $t8: 0, $9: 0,
  $s0: 0, $s1: 0, $s2: 0, $s3: 0, $s4: 0, $s5: 0, $s6: 0, $s7: 0,
  $10: 0, $11: 0, $12: 0, $13: 0, $14: 0, $15: 0, $16: 0, $17: 0, $18: 0, $19: 0
  // Agrega más si necesitas
};

const memory: Record<number, number> = {};




interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean; // Keep isRunning prop for button state logic
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/; // Basic check for 8 hex characters


function decodeMIPSInstruction(hex: string): string {
  const binary = parseInt(hex, 16).toString(2).padStart(32, '0');
  const opcode = binary.slice(0, 6);
  const rs = parseInt(binary.slice(6, 11), 2);
  const rt = parseInt(binary.slice(11, 16), 2);
  const rd = parseInt(binary.slice(16, 21), 2);
  const shamt = parseInt(binary.slice(21, 26), 2);
  const funct = binary.slice(26, 32);
  const immediate = parseInt(binary.slice(16, 32), 2);
  const signedImmediate = (immediate & 0x8000) ? immediate - 0x10000 : immediate;
  const address = parseInt(binary.slice(6), 2);

  if (opcode === '000000') {
    switch (funct) {
      case '100000': return `add $${rd}, $${rs}, $${rt}`;
      case '100001': return `addu $${rd}, $${rs}, $${rt}`;
      case '100010': return `sub $${rd}, $${rs}, $${rt}`;
      case '100011': return `subu $${rd}, $${rs}, $${rt}`;
      case '100100': return `and $${rd}, $${rs}, $${rt}`;
      case '100101': return `or $${rd}, $${rs}, $${rt}`;
      case '101010': return `slt $${rd}, $${rs}, $${rt}`;
      case '101011': return `sltu $${rd}, $${rs}, $${rt}`;
      case '000000': return `sll $${rd}, $${rt}, ${shamt}`;
      case '000010': return `srl $${rd}, $${rt}, ${shamt}`;
      case '001000': return `jr $${rs}`;
      default: return `unknown R-type funct: ${funct}`;
    }
  }

  switch (opcode) {
    // Tipo I
    case '001000': return `addi $${rt}, $${rs}, ${signedImmediate}`;
    case '001001': return `addiu $${rt}, $${rs}, ${signedImmediate}`;
    case '001100': return `andi $${rt}, $${rs}, ${immediate}`;
    case '001101': return `ori $${rt}, $${rs}, ${immediate}`;
    case '001010': return `slti $${rt}, $${rs}, ${signedImmediate}`;
    case '001011': return `sltiu $${rt}, $${rs}, ${signedImmediate}`;
    case '100011': return `lw $${rt}, ${signedImmediate}($${rs})`;
    case '101011': return `sw $${rt}, ${signedImmediate}($${rs})`;
    case '100000': return `lb $${rt}, ${signedImmediate}($${rs})`;
    case '101000': return `sb $${rt}, ${signedImmediate}($${rs})`;
    case '000100': return `beq $${rs}, $${rt}, ${signedImmediate}`;
    case '000101': return `bne $${rs}, $${rt}, ${signedImmediate}`;

    // Tipo J
    case '000010': return `j ${address}`;
    case '000011': return `jal ${address}`;

    default: return `unknown opcode: ${opcode}`;
  }
}




export function InstructionInput({
  onInstructionsSubmit,
  onReset,
  isRunning,
}: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const {
    pauseSimulation,
    resumeSimulation,
    setForwardingEnabled,
    setStallsEnabled,
    setBranchEnabled,
  } = useSimulationActions();
  const {
    currentCycle,
    isFinished,
    instructions,
    hazards,
    stalls,
    forwardingEnabled,
    stallsEnabled,
    forwardings,
  } = useSimulationState();

  useEffect(() => {
    if (instructions.length === 0) {
      setError(null);
    }
  }, [instructions]);

    useEffect(() => {
  if (isFinished) {
    fwd = false;
    fwdprev = [];
    fwdpos = [];
    haylw = false;
    stallprev = [];
    stallprev2 = [];
    haylwvec = [];
    saltables = [];
    registers["$t0"] = 0;
    registers["$t1"] = 0;
    registers["$t2"] = 0;
    registers["$t3"] = 0;
    registers["$t4"] = 0;
    registers["$t5"] = 0;
    registers["$t6"] = 0;
    registers["$t7"] = 0;
    registers["$t8"] = 0;
    registers["$9"] = 0; 
    registers["$10"] = 0;
    registers["$11"] = 0;
    registers["$12"] = 0;
    registers["$13"] = 0;
    registers["$14"] = 0;
    registers["$15"] = 0;
    registers["$16"] = 0;
    registers["$17"] = 0;
    registers["$18"] = 0;
    registers["$19"] = 0;
    entroID = false;

    
    
    
  }
}, [isFinished]);




  const hasStarted = currentCycle > 0;
  // Can only pause/resume if started and not finished
  const canPauseResume = hasStarted && !isFinished;
  // Input/Start button should be disabled if simulation has started and isn't finished
  const disableInputAndStart = hasStarted && !isFinished;

  // Count hazards and stalls
  const hazardCount = Object.values(hazards).filter(
    (h) => h.type !== 'NONE'
  ).length;
  const stallCount = Object.values(stalls).reduce((sum, s) => sum + s, 0);
  const forwardingCount = Object.values(forwardings).filter(
    (f) => f.length > 0
  ).length;

  const handleSubmit = () => {
    setError(null);
    const lines = inputText.trim().split('\n');
    const currentInstructions = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (currentInstructions.length === 0) {
      setError(
        'Please enter at least one MIPS instruction in hexadecimal format.'
      );
      return;
    }

    const invalidInstructions = currentInstructions.filter(
      (inst) => !HEX_REGEX.test(inst)
    );
    if (invalidInstructions.length > 0) {
      setError(
        `Invalid instruction format found: ${invalidInstructions.join(
          ', '
        )}. Each instruction must be 8 hexadecimal characters.`
      );
      return;
    }

      console.log(currentInstructions)


    onInstructionsSubmit(currentInstructions);
    const decoded = currentInstructions.map(decodeMIPSInstruction);
    console.log('Decoded MIPS Instructions:', decoded);






const opcodes = decoded.map(instruction => {
  // Dividimos la instrucción por espacios y tomamos la primera palabra
  return instruction.trim().split(/\s+/)[0];
});

  let y: number;
setomabranchprev = false
setomabranch = false

haybranch = opcodes



function executeInstruction(instruction: string) {
  const parts = instruction.trim().split(/\s+/);
  console.log(instruction)
  const op = parts[0];

  if (y>0 && setomabranch == true){
    y--;
    saltables.push(true)
  }else{

    saltables.push(false)


  }
  

  if (op === "lw") {
    const dest = parts[1].replace(",", "");
    const offsetAndBase = parts[2];
    const match = offsetAndBase.match(/(-?\d+)\((\$[a-z0-9]+)\)/i);
    if (!match) throw new Error("Formato lw inválido");

    const offset = parseInt(match[1], 10);
    const base = match[2];
    const address = (registers[base] || 0) + offset;
    registers[dest] = memory[address] || 0;

  } else if (op === "sw") {
    const src = parts[1].replace(",", "");
    const offsetAndBase = parts[2];
    const match = offsetAndBase.match(/(-?\d+)\((\$[a-z0-9]+)\)/i);
    if (!match) throw new Error("Formato sw inválido");

    const offset = parseInt(match[1], 10);
    const base = match[2];
    const address = (registers[base] || 0) + offset;
    memory[address] = registers[src] || 0;

  } else if (["add", "sub", "and", "or", "slt"].includes(op)) {
    const rd = parts[1].replace(",", "").trim();
    const rs = parts[2].replace(",", "").trim();
    const rt = parts[3].replace(",", "").trim();

    const a = registers[rs] || 0;
    const b = registers[rt] || 0;

    switch (op) {
      case "add": registers[rd] = a + b; break;
      case "sub": registers[rd] = a - b; break;
      case "and": registers[rd] = a & b; break;
      case "or":  registers[rd] = a | b; break;
      case "slt": registers[rd] = a < b ? 1 : 0; break;
    }

  } else if (["addi", "andi", "ori", "slti"].includes(op)) {
    const rt = parts[1].replace(",", "").trim();
    const rs = parts[2].replace(",", "").trim();
    const imm = parseInt(parts[3]);

    const val = registers[rs] || 0;

    switch (op) {
      case "addi": registers[rt] = val + imm; break;
      case "andi": registers[rt] = val & imm; break;
      case "ori":  registers[rt] = val | imm; break;
      case "slti": registers[rt] = val < imm ? 1 : 0; break;
    }

    }else if (["beq", "bne"].includes(op)) {
      console.log("entro a branch")
    const rs = parts[1].replace(",", "").trim();
    const rt = parts[2].replace(",", "").trim();
    const label = parts[3].trim();

    const valRs = registers[rs] || 0;
    const valRt = registers[rt] || 0;

    console.log(valRs)
    console.log(valRt)

    let branchTaken = false;
    switch (op) {
      case "beq":
        

        if (valRs === valRt){
          branchTaken = true
        }
        break;
      case "bne":
        if (valRs !== valRt){
          branchTaken = true
        }
        break;
    }  
    setomabranchprev = setomabranch
    setomabranch = branchTaken

    console.log(setomabranch)
    

    saltobranch = Number(label)
    y = saltobranch;



  

  } else {
    throw new Error(`Instrucción no soportada: ${op}`);
  }
}

console.log(saltables)

  decoded.forEach(instr => {
    try {

      executeInstruction(instr);
    } catch (error) {
      console.error(error);
    }
  });

  console.log("Registros:", registers);
  console.log("Memoria:", memory);




  };


  







  const handlePauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };

  // Function to handle the change of forwarding
  const handleForwardingChange = (checked: boolean) => {
    setForwardingEnabled(checked);

    
    

    // If the simulation has finished, restart it with the new configuration
    if (hasStarted && isFinished) {
      setTimeout(() => {
        onReset();
        setTimeout(() => {
          const currentInstructions = inputText
            .trim()
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

          if (currentInstructions.length > 0) {
            onInstructionsSubmit(currentInstructions);
          }
        }, 50);
      }, 50);
    }
  };




  const [cambiobotonenpip, setCambiobotonenpip] = useState(false);
  // Function to handle the change of stalls
  const handleStallsChange = (checked: boolean) => {
    setStallsEnabled(checked);
    if (checked == true){
      cambioboton = true;
    }else{
      cambioboton = false;
    }
    

    // If stalls are disabled, also disable forwarding since it doesn't make sense
    if (!checked) {
      setForwardingEnabled(false);
    }

    // If the simulation has finished, restart it with the new configuration
    if (hasStarted && isFinished) {
      setTimeout(() => {
        onReset();
        setTimeout(() => {
          const currentInstructions = inputText
            .trim()
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

          if (currentInstructions.length > 0) {
            onInstructionsSubmit(currentInstructions);
          }
        }, 50);
      }, 50);
    }
  };

  return (
    <Card className='w-full max-w-md'>
      <CardHeader>
        <CardTitle>MIPS Instructions</CardTitle>
        <CardDescription>
          Enter instructions in hex format (8 characters) to visualize pipeline
          with hazard detection
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid w-full gap-1.5'>
          <Label htmlFor='instructions'>
            Enter Hex Instructions (one per line)
          </Label>
          <Textarea
            id='instructions'
            placeholder='e.g., 00a63820...' // Removed 0x prefix for consistency with regex
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className='font-mono'
            // Disable input field if simulation has started and not yet finished
            disabled={disableInputAndStart}
            aria-label='MIPS Hex Instructions Input'
          />
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>

        {/* Pipeline configuration switches */}
        <div className='space-y-3 p-3 bg-muted/50 rounded-lg'>
          <h4 className='text-sm font-medium'>Pipeline Configuration</h4>

          {/* Stalls and hazard detection switch */}
          <div className='flex items-center space-x-2'>
            <Switch
              id='stalls-mode'
              checked={stallsEnabled}
              onCheckedChange={handleStallsChange}
              disabled={disableInputAndStart}
            />
            <Label htmlFor='stalls-mode' className='text-sm'>
              Enable Hazard Detection & Stalls
            </Label>
          </div>

          {/* Forwarding configuration switch - only available if stalls are enabled */}
          <div className='flex items-center space-x-2'>
            <Switch
              id='forwarding-mode'
              checked={forwardingEnabled && stallsEnabled}
              onCheckedChange={handleForwardingChange}
              disabled={disableInputAndStart || !stallsEnabled}
            />
            <Label
              htmlFor='forwarding-mode'
              className={`text-sm ${
                !stallsEnabled ? 'text-muted-foreground' : ''
              }`}
            >
              Enable Data Forwarding
            </Label>
          </div>

          {!stallsEnabled && (
            <p className='text-xs text-muted-foreground'>
              When hazard detection is disabled, all instructions execute in
              ideal 5-stage pipeline without stalls or forwarding.
            </p>
          )}
        </div>

        {/* Show hazard statistics if simulation has started */}
        {hasStarted && stallsEnabled && (
          <div className='flex flex-col gap-1 p-2 bg-muted rounded'>
            {hazardCount > 0 ? (
              <>
                <div className='flex items-center text-sm'>
                  <AlertTriangle className='w-4 h-4 mr-2 text-yellow-500' />
                  <span>{hazardCount} hazards detected</span>
                </div>
                {forwardingEnabled && forwardingCount > 0 && (
                  <div className='flex items-center text-sm'>
                    <Zap className='w-4 h-4 mr-2 text-green-500' />
                    <span>{forwardingCount} forwarding paths active</span>
                  </div>
                )}
                {stallCount > 0 && (
                  <div className='flex items-center text-sm'>
                    <AlertTriangle className='w-4 h-4 mr-2 text-red-500' />
                    <span>{stallCount} stall cycles added</span>
                  </div>
                )}
                <div className='flex items-center text-sm'>
                  <Zap className='w-4 h-4 mr-2 text-green-500' />
                  <span>
                    {forwardingEnabled
                      ? 'Data forwarding enabled'
                      : 'Data forwarding disabled'}
                  </span>
                </div>
              </>
            ) : (
              <div className='flex items-center text-sm'>
                <Zap className='w-4 h-4 mr-2 text-green-500' />
                <span>No hazards detected - clean pipeline execution</span>
              </div>
            )}
          </div>
        )}

        {hasStarted && !stallsEnabled && (
          <div className='flex items-center gap-1 p-2 bg-muted rounded text-sm'>
            <StopCircle className='w-4 h-4 text-blue-500' />
            <span>Ideal pipeline - no hazard detection active</span>
          </div>
        )}

        <div className='flex justify-between items-center gap-2'>
          {/* Start Button: Disabled if started and not finished */}
          <Button
            onClick={handleSubmit}
            disabled={disableInputAndStart}
            className='flex-1'
          >
            {isFinished
              ? 'Finished'
              : hasStarted
              ? 'Running...'
              : 'Start Simulation'}
          </Button>

          {/* Conditional Play/Pause Button: Show only when pause/resume is possible */}
          {canPauseResume && (
            <Button
              variant='outline'
              onClick={handlePauseResume}
              size='icon'
              aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}
            >
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

          {/* Reset Button: Show only if the simulation has started */}
          {hasStarted && (
            <Button
              variant='destructive'
              onClick={onReset}
              size='icon'
              aria-label='Reset Simulation'
            >
              <RotateCcw />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


export {saltables };
export {haybranch };
export {setomabranch};
export {cambioboton };
