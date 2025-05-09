"use client";
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';

export let forwardingDetected = false;

// ✅ Tipo de forwarding (puede ir en otro archivo si lo necesitas global)
export type ForwardingInfo = {
  fromIndex: number;
  toIndex: number;
  register: string;
};

let fwd = false;
let fwdprev: number[] = [];  // Ahora TypeScript sabe que el array contendrá números
let fwdpos: number[] = [];







const HEX_REGEX = /^[0-9a-fA-F]{8}$/;

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { pauseSimulation, resumeSimulation } = useSimulationActions();
  const { currentCycle, isFinished, instructions } = useSimulationState();

  useEffect(() => {
    if (instructions.length === 0) {
      setInputText('');
      setError(null);
    }
  }, [instructions]);

  const hasStarted = currentCycle > 0;
  const canPauseResume = hasStarted && !isFinished;
  const disableInputAndStart = hasStarted && !isFinished;

  // ✅ Función para decodificar hexadecimal a MIPS
  function decodeMIPSInstruction(hex: string): string {
    const binary = parseInt(hex, 16).toString(2).padStart(32, '0');
    const opcode = binary.slice(0, 6);
    const rs = parseInt(binary.slice(6, 11), 2);
    const rt = parseInt(binary.slice(11, 16), 2);
    const rd = parseInt(binary.slice(16, 21), 2);
    const shamt = parseInt(binary.slice(21, 26), 2);
    const funct = binary.slice(26, 32);
    const immediate = parseInt(binary.slice(16, 32), 2);
    const address = parseInt(binary.slice(6), 2);

    if (opcode === '000000') {
      switch (funct) {
        case '100000': return `add $${rd}, $${rs}, $${rt}`;
        case '100010': return `sub $${rd}, $${rs}, $${rt}`;
        case '100100': return `and $${rd}, $${rs}, $${rt}`;
        case '100101': return `or $${rd}, $${rs}, $${rt}`;
        case '101010': return `slt $${rd}, $${rs}, $${rt}`;
        case '000000': return `sll $${rd}, $${rt}, ${shamt}`;
        case '000010': return `srl $${rd}, $${rt}, ${shamt}`;
        default: return `unknown R-type funct: ${funct}`;
      }
    }

    switch (opcode) {
      case '001000': return `addi $${rt}, $${rs}, ${immediate}`;
      case '001100': return `andi $${rt}, $${rs}, ${immediate}`;
      case '001101': return `ori $${rt}, $${rs}, ${immediate}`;
      case '100011': return `lw $${rt}, ${immediate}($${rs})`;
      case '101011': return `sw $${rt}, ${immediate}($${rs})`;
      case '000100': return `beq $${rs}, $${rt}, ${immediate}`;
      case '000101': return `bne $${rs}, $${rt}, ${immediate}`;
      case '000010': return `j ${address}`;
      case '000011': return `jal ${address}`;
      default: return `unknown opcode: ${opcode}`;
    }
  }

  const handleSubmit = () => {
    setError(null);
    const lines = inputText.trim().split('\n');
    const currentInstructions = lines
      .map(line => line.trim())
      .filter(line => line.length > 0);
  
    if (currentInstructions.length === 0) {
      setError('Please enter at least one MIPS instruction in hexadecimal format.');
      return;
    }
  
    const invalidInstructions = currentInstructions.filter(inst => !HEX_REGEX.test(inst));
    if (invalidInstructions.length > 0) {
      setError(`Invalid instruction format found: ${invalidInstructions.join(', ')}. Each instruction must be 8 hexadecimal characters.`);
      return;
    }
  
    // 🔄 Traducción de instrucciones y log
// 🔄 Traducción de instrucciones y log
const decoded = currentInstructions.map(decodeMIPSInstruction);
console.log('Decoded MIPS Instructions:', decoded);

// ✅ Verificación de forwarding (dependencias RAW)
// ✅ Verificación de forwarding (dependencias RAW)
const extractRdRsRt = (instr: string) => {
  const match = instr.match(/\$(\d+),\s*\$(\d+),\s*\$(\d+)/);
  if (match) {
    const [, rd, rs, rt] = match.map(Number);
    return { rd, rs, rt };
  }
  return null;
};

const forwardingList: ForwardingInfo[] = [];

for (let i = 1; i < decoded.length; i++) {
  const prev = extractRdRsRt(decoded[i - 1]);
  const curr = extractRdRsRt(decoded[i]);

  if (prev && curr) {
    if (prev.rd && (prev.rd === curr.rs || prev.rd === curr.rt)) {
      const register = `$${prev.rd}`;
      forwardingList.push({
        fromIndex: i - 1,
        toIndex: i,
        register,
      });

      console.log(`⚠️ Forwarding needed between instruction ${i - 1} and ${i}: ${register}`);
      console.log(forwardingList);
      fwd = true;
      fwdprev.push(i - 1); // Ahora agregamos los índices a los arrays
      fwdpos.push(i);
      console.log(fwdprev,fwdpos)
      
    }
  }
}


  
    onInstructionsSubmit(currentInstructions);
  };
  

  const handlePauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>MIPS Instructions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid w-full gap-1.5">
          <Label htmlFor="instructions">Enter Hex Instructions (one per line)</Label>
          <Textarea
            id="instructions"
            placeholder="e.g., 00a63820"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono"
            disabled={disableInputAndStart}
            aria-label="MIPS Hex Instructions Input"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-between items-center gap-2">
          <Button onClick={handleSubmit} disabled={disableInputAndStart} className="flex-1">
            {isFinished ? 'Finished' : hasStarted ? 'Running...' : 'Start Simulation'}
          </Button>
          {canPauseResume && (
            <Button variant="outline" onClick={handlePauseResume} size="icon" aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}>
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}
          {hasStarted && (
            <Button variant="destructive" onClick={onReset} size="icon" aria-label="Reset Simulation">
              <RotateCcw />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}





//################################################################################



import type * as React from 'react';

import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableCaption,
} from '@/components/ui/table';

import { Download, Code2, Cpu, MemoryStick, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';




const STAGES = [
  { name: 'IF', icon: Download },
  { name: 'ID', icon: Code2 },
  { name: 'EX', icon: Cpu },
  { name: 'MEM', icon: MemoryStick },
  { name: 'WB', icon: CheckSquare },
] as const;





export function PipelineVisualization() {
  // Get state from context
  const {
    instructions,
    currentCycle: cycle,
    maxCycles, // Max cycles determines the number of columns
    isRunning,
    instructionStages, // Use the pre-calculated stages
    isFinished, // Use the finished flag from context
  } = useSimulationState();

  useEffect(() => {
  if (isFinished) {
    fwd = false;
    forwardingDetected = false;
    fwdprev = [];
    fwdpos = [];
  }
}, [isFinished]);



  // Use maxCycles for the number of columns if it's calculated, otherwise 0
  const totalCyclesToDisplay = maxCycles > 0 ? maxCycles : 0;
  const cycleNumbers = Array.from({ length: totalCyclesToDisplay }, (_, i) => i + 1);

  // Helper function to detect forwarding (this can be customized based on your logic)
  const detectForwarding = (instIndex: number, register: string) => {
    let detectedForwarding = false;
    
    // Itera a través de las instrucciones previas y verifica si hay un forwarding al registro requerido
    for (let i = instIndex - 1; i >= 0; i--) {
      const currentInstruction = instructions[i];
      const currentStageIndex = instructionStages[i];

      // Verifica si la instrucción previa escribe en el mismo registro
     
    }

    return detectedForwarding;
  };

 
  





  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Pipeline Progress</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableCaption>MIPS instruction pipeline visualization</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px] sticky left-0 bg-card z-10 border-r">Instruction</TableHead>
                {cycleNumbers.map((c) => (
                  <TableHead key={`cycle-${c}`} className="text-center w-16">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructions.map((inst, instIndex) => (
                <TableRow key={`inst-${instIndex}`}>
                  <TableCell className="font-mono sticky left-0 bg-card z-10 border-r">
                    {inst}
                    
                  </TableCell>
                  {cycleNumbers.map((c) => {
                    const expectedStageIndex = c - instIndex - 1;
                    const currentStageIndex = instructionStages[instIndex];
                    const isInPipelineAtThisCycle = expectedStageIndex >= 0 && expectedStageIndex < STAGES.length;
                    const currentStageData = isInPipelineAtThisCycle ? STAGES[expectedStageIndex] : null;
                    const isActualCurrentStage = currentStageIndex !== null && expectedStageIndex === currentStageIndex && c === cycle;
                    const shouldAnimate = isActualCurrentStage && isRunning && !isFinished;
                    const shouldHighlightStatically = isActualCurrentStage && !isRunning && !isFinished;
                    const isPastStage = isInPipelineAtThisCycle && c < cycle;

                    // Detect forwarding in ID and MEM stages
                    
                    const isForwardingInID = detectForwarding(instIndex, "ID");
                    const isForwardingInMEM = detectForwarding(instIndex, "MEM");
                    

                    return (
                      
                    <TableCell
                      key={`inst-${instIndex}-cycle-${c}`}
                      className={cn(
                        'text-center w-16 h-14 transition-colors duration-300',
                        isFinished
                          ? 'bg-background'
                          : (
                              ((fwdprev.includes(instIndex) && currentStageData?.name === 'MEM') ||
                              (fwdpos.includes(instIndex) && currentStageData?.name === 'ID'))
                            )
                          ? 'bg-yellow-200 text-black border border-yellow-500'
                          : (
                              ((fwdprev.includes(instIndex) || fwdpos.includes(instIndex)) && !isRunning)
                            )
                          ? 'bg-yellow-100 text-black border border-yellow-300'
                          : shouldAnimate 
                            ? 'bg-accent text-accent-foreground animate-pulse-bg' 
                            : shouldHighlightStatically 
                              ? 'bg-accent text-accent-foreground' 
                              : isPastStage 
                                ? 'bg-secondary text-secondary-foreground' 
                                : 'bg-background'
                      )}
                    >
                      {currentStageData && !isFinished && (
                        <div className="flex flex-col items-center justify-center">
                          <currentStageData.icon className="w-4 h-4 mb-1" aria-hidden="true" />
                          <span className="text-xs">{currentStageData.name}</span>
                        </div>
                      )}
                    </TableCell>

                    




                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
  
}

