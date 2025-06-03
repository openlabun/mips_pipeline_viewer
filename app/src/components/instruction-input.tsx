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
} from '@/context/SimulationContext';
import {
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  Zap,
  StopCircle,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

let simState_isForwardingLogicActive: boolean = false;
let simState_previousForwardingValues: number[] = [];
let simState_forwardingPositions: number[] = [];
let simState_isLoadWordHazardPresent: boolean = false;
let simState_loadWordHazardVector: boolean[] = [];
let simState_wasPreviousLoadWordHazard: boolean = false;
let simState_previousStallValues: number[] = [];
let simState_previousStallValuesSecondary: number[] = [];
let simState_isStalledInIFStage: boolean[] = [];
let simState_stallCounter: number;
let simState_hasEnteredIDStage: boolean = false;

let branch_activeOffsetCounter: number = 0;
let branch_previousDecisionToTake: boolean = false;

export let saltables: boolean[] = [];
export let haybranch: string[];
export let setomabranch: boolean = false;
export let cambioboton: boolean;
export let labelsigno: boolean = false;
export let saltobranch: number = 0;

const mipsRegisters: Record<string, number> = {
  $zero: 0,
  $t0: 0, $t1: 0, $t2: 0, $t3: 0, $t4: 0, $t5: 0, $t6: 0, $t7: 0, $t8: 0, $9: 0,
  $s0: 0, $s1: 0, $s2: 0, $s3: 0, $s4: 0, $s5: 0, $s6: 0, $s7: 0,
  $10: 0, $11: 0, $12: 0, $13: 0, $14: 0, $15: 0, $16: 0, $17: 0, $18: 0, $19: 0,
};

const mipsMemory: Record<number, number> = {};

const HEXADECIMAL_INSTRUCTION_FORMAT_REGEX = /^[0-9a-fA-F]{8}$/;

function decodeHexToMipsAssembly(hexInstruction: string): string {
  const binaryInstruction = parseInt(hexInstruction, 16).toString(2).padStart(32, '0');
  const opcode = binaryInstruction.slice(0, 6);
  const rs = parseInt(binaryInstruction.slice(6, 11), 2);
  const rt = parseInt(binaryInstruction.slice(11, 16), 2);
  const rd = parseInt(binaryInstruction.slice(16, 21), 2);
  const shamt = parseInt(binaryInstruction.slice(21, 26), 2);
  const funct = binaryInstruction.slice(26, 32);
  const immediate = parseInt(binaryInstruction.slice(16, 32), 2);
  const signedImmediate = (immediate & 0x8000) ? immediate - 0x10000 : immediate;
  const jumpAddress = parseInt(binaryInstruction.slice(6), 2);

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
    case '001000': return `addi $${rt}, $${rs}, ${signedImmediate}`;
    case '001001': return `addiu $${rt}, $${rs}, ${signedImmediate}`;
    case '001100': return `andi $${rt}, $${rs}, ${immediate & 0xFFFF}`;
    case '001101': return `ori $${rt}, $${rs}, ${immediate & 0xFFFF}`;
    case '001010': return `slti $${rt}, $${rs}, ${signedImmediate}`;
    case '001011': return `sltiu $${rt}, $${rs}, ${signedImmediate}`;
    case '100011': return `lw $${rt}, ${signedImmediate}($${rs})`;
    case '101011': return `sw $${rt}, ${signedImmediate}($${rs})`;
    case '100000': return `lb $${rt}, ${signedImmediate}($${rs})`;
    case '101000': return `sb $${rt}, ${signedImmediate}($${rs})`;
    case '000100': return `beq $${rs}, $${rt}, ${signedImmediate}`;
    case '000101': return `bne $${rs}, $${rt}, ${signedImmediate}`;
    case '000010': return `j ${jumpAddress}`;
    case '000011': return `jal ${jumpAddress}`;
    default: return `unknown opcode: ${opcode}`;
  }
}

function executeSingleMipsInstruction(assemblyInstruction: string): void {
  const instructionParts = assemblyInstruction.trim().split(/\s+/);
  const operation = instructionParts[0];
  console.log(assemblyInstruction);

  if (branch_activeOffsetCounter > 0 && setomabranch === true && labelsigno === true) {
    branch_activeOffsetCounter--;
    saltables.push(true);
  } else if (branch_activeOffsetCounter < 0 && setomabranch === true && labelsigno === false) {
    branch_activeOffsetCounter++;
    saltables.push(true);
  } else {
    saltables.push(false);
  }

  if (operation === "lw") {
    const destReg = instructionParts[1].replace(",", "");
    const offsetAndBaseReg = instructionParts[2];
    const memAccessMatch = offsetAndBaseReg.match(/(-?\d+)\((\$[a-z0-9]+)\)/i);
    if (!memAccessMatch) throw new Error("Invalid lw format");

    const offset = parseInt(memAccessMatch[1], 10);
    const baseReg = memAccessMatch[2];
    const memoryAddress = (mipsRegisters[baseReg] || 0) + offset;
    mipsRegisters[destReg] = mipsMemory[memoryAddress] || 0;

  } else if (operation === "sw") {
    const srcReg = instructionParts[1].replace(",", "");
    const offsetAndBaseReg = instructionParts[2];
    const memAccessMatch = offsetAndBaseReg.match(/(-?\d+)\((\$[a-z0-9]+)\)/i);
    if (!memAccessMatch) throw new Error("Invalid sw format");

    const offset = parseInt(memAccessMatch[1], 10);
    const baseReg = memAccessMatch[2];
    const memoryAddress = (mipsRegisters[baseReg] || 0) + offset;
    mipsMemory[memoryAddress] = mipsRegisters[srcReg] || 0;

  } else if (["add", "sub", "and", "or", "slt"].includes(operation)) {
    const rdReg = instructionParts[1].replace(",", "").trim();
    const rsReg = instructionParts[2].replace(",", "").trim();
    const rtReg = instructionParts[3].replace(",", "").trim();

    const valA = mipsRegisters[rsReg] || 0;
    const valB = mipsRegisters[rtReg] || 0;

    switch (operation) {
      case "add": mipsRegisters[rdReg] = valA + valB; break;
      case "sub": mipsRegisters[rdReg] = valA - valB; break;
      case "and": mipsRegisters[rdReg] = valA & valB; break;
      case "or":  mipsRegisters[rdReg] = valA | valB; break;
      case "slt": mipsRegisters[rdReg] = valA < valB ? 1 : 0; break;
    }

  } else if (["addi", "andi", "ori", "slti"].includes(operation)) {
    const rtReg = instructionParts[1].replace(",", "").trim();
    const rsReg = instructionParts[2].replace(",", "").trim();
    const immediateVal = parseInt(instructionParts[3]);

    const regVal = mipsRegisters[rsReg] || 0;

    switch (operation) {
      case "addi": mipsRegisters[rtReg] = regVal + immediateVal; break;
      case "andi": mipsRegisters[rtReg] = regVal & immediateVal; break;
      case "ori":  mipsRegisters[rtReg] = regVal | immediateVal; break;
      case "slti": mipsRegisters[rtReg] = regVal < immediateVal ? 1 : 0; break;
    }

  } else if (["beq", "bne"].includes(operation)) {
    console.log("entro a branch");
    const rsReg = instructionParts[1].replace(",", "").trim();
    const rtReg = instructionParts[2].replace(",", "").trim();
    const labelOffsetStr = instructionParts[3].trim();

    const valRs = mipsRegisters[rsReg] || 0;
    const valRt = mipsRegisters[rtReg] || 0;

    console.log(valRs);
    console.log(valRt);

    const labelNumericValue = Number(labelOffsetStr);
    labelsigno = labelNumericValue > 0;

    console.log("van dos y se cae la");

    let branchIsActuallyTaken = false;
    switch (operation) {
      case "beq":
        if (valRs === valRt) {
          branchIsActuallyTaken = true;
        }
        break;
      case "bne":
        if (valRs !== valRt) {
          branchIsActuallyTaken = true;
        }
        break;
    }
    branch_previousDecisionToTake = setomabranch;
    setomabranch = branchIsActuallyTaken;
    console.log(setomabranch);
    
    saltobranch = labelNumericValue;
    branch_activeOffsetCounter = saltobranch;

  } else if (operation === "j" || operation === "jal" || operation === "jr") {
  } else {
    if (!assemblyInstruction.startsWith("unknown")) {
        throw new Error(`Unsupported instruction for execution: ${operation}`);
    } else {
        console.warn(`Skipping execution of unknown/undecoded instruction: ${assemblyInstruction}`);
    }
  }
}


interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

export function InstructionInput({
  onInstructionsSubmit,
  onReset,
  isRunning,
}: InstructionInputProps) {
  const [instructionInputText, setInstructionInputText] = useState<string>('');
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const {
    pauseSimulation,
    resumeSimulation,
    setForwardingEnabled,
    setStallsEnabled,
  } = useSimulationActions();

  const {
    currentCycle,
    isFinished,
    instructions: contextInstructions,
    hazards,
    stalls,
    forwardingEnabled,
    stallsEnabled,
    forwardings,
  } = useSimulationState();

  useEffect(() => {
    if (contextInstructions.length === 0) {
      setSubmissionError(null);
    }
  }, [contextInstructions]);

  useEffect(() => {
    if (isFinished) {
      simState_isForwardingLogicActive = false;
      simState_previousForwardingValues = [];
      simState_forwardingPositions = [];
      simState_isLoadWordHazardPresent = false;
      simState_previousStallValues = [];
      simState_previousStallValuesSecondary = [];
      simState_isStalledInIFStage = [];
  
      simState_hasEnteredIDStage = false;
      
      const registersToReset = [
        "$t0", "$t1", "$t2", "$t3", "$t4", "$t5", "$t6", "$t7", "$t8", "$9",
        "$10", "$11", "$12", "$13", "$14", "$15", "$16", "$17", "$18", "$19"
      ];
      registersToReset.forEach(reg => mipsRegisters[reg] = 0);

      saltables = [];
    }
  }, [isFinished]);

  const simulationHasStarted = currentCycle > 0;
  const canControlPauseResume = simulationHasStarted && !isFinished;
  const disableInputsAndStartButton = simulationHasStarted && !isFinished;

  const detectedHazardCount = Object.values(hazards).filter(
    (h) => h.type !== 'NONE'
  ).length;
  const totalStallCount = Object.values(stalls).reduce((sum, s) => sum + s, 0);
  const activeForwardingPathCount = Object.values(forwardings).filter(
    (f) => f.length > 0
  ).length;

  const handleInstructionSubmission = () => {
    setSubmissionError(null);
    const instructionLines = instructionInputText.trim().split('\n');
    const processedHexInstructions = instructionLines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (processedHexInstructions.length === 0) {
      setSubmissionError(
        'Please enter at least one MIPS instruction in hexadecimal format.'
      );
      return;
    }

    const invalidFormatInstructions = processedHexInstructions.filter(
      (inst) => !HEXADECIMAL_INSTRUCTION_FORMAT_REGEX.test(inst)
    );
    if (invalidFormatInstructions.length > 0) {
      setSubmissionError(
        `Invalid instruction format found: ${invalidFormatInstructions.join(
          ', '
        )}. Each instruction must be 8 hexadecimal characters.`
      );
      return;
    }
    
    console.log(processedHexInstructions);
    onInstructionsSubmit(processedHexInstructions);

    const decodedAssemblyInstructions = processedHexInstructions.map(decodeHexToMipsAssembly);
    console.log('Decoded MIPS Instructions:', decodedAssemblyInstructions);

    haybranch = decodedAssemblyInstructions.map(instruction => {
      return instruction.trim().split(/\s+/)[0];
    });
    
    setomabranch = false;
    branch_previousDecisionToTake = false; 

    decodedAssemblyInstructions.forEach(instr => {
      try {
        executeSingleMipsInstruction(instr);
      } catch (e: any) {
        console.error(e.message || 'Error executing instruction.');
      }
    });

    console.log("Registros:", mipsRegisters);
    console.log("Memoria:", mipsMemory);
    console.log(saltables);
  };

  const toggleSimulationPauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };

  const handlePipelineForwardingToggle = (isChecked: boolean) => {
    setForwardingEnabled(isChecked);
    restartSimulationIfFinished();
  };

  const handlePipelineStallsToggle = (isChecked: boolean) => {
    setStallsEnabled(isChecked);
    if (!isChecked) {
      setForwardingEnabled(false);
    }
    restartSimulationIfFinished();
  };
  
  const restartSimulationIfFinished = () => {
      if (simulationHasStarted && isFinished) {
      setTimeout(() => {
        onReset();
        setTimeout(() => {
          const currentHexInstructionsInTextArea = instructionInputText
            .trim()
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

          if (currentHexInstructionsInTextArea.length > 0) {
              onInstructionsSubmit(currentHexInstructionsInTextArea);
          }
        }, 50);
      }, 50);
    }
  }

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
          <Label htmlFor='instructions-input-area'>
            Enter Hex Instructions (one per line)
          </Label>
          <Textarea
            id='instructions-input-area'
            placeholder='e.g., 00a63820...'
            value={instructionInputText}
            onChange={(e) => setInstructionInputText(e.target.value)}
            rows={5}
            className='font-mono'
            disabled={disableInputsAndStartButton}
            aria-label='MIPS Hex Instructions Input'
          />
          {submissionError && <p className='text-sm text-destructive'>{submissionError}</p>}
        </div>

        <div className='space-y-3 p-3 bg-muted/50 rounded-lg'>
          <h4 className='text-sm font-medium'>Pipeline Configuration</h4>
          <div className='flex items-center space-x-2'>
            <Switch
              id='stalls-hazard-mode'
              checked={stallsEnabled}
              onCheckedChange={handlePipelineStallsToggle}
              disabled={disableInputsAndStartButton}
            />
            <Label htmlFor='stalls-hazard-mode' className='text-sm'>
              Enable: Hazard detection, stalls and branch
            </Label>
          </div>
          <div className='flex items-center space-x-2'>
            <Switch
              id='forwarding-config-mode'
              checked={forwardingEnabled && stallsEnabled}
              onCheckedChange={handlePipelineForwardingToggle}
              disabled={disableInputsAndStartButton || !stallsEnabled}
            />
            <Label
              htmlFor='forwarding-config-mode'
              className={`text-sm ${
                !stallsEnabled ? 'text-muted-foreground' : ''
              }`}
            >
              Enable: Data forwarding
            </Label>
          </div>
          {!stallsEnabled && (
            <p className='text-xs text-muted-foreground'>
              When hazard detection is disabled, all instructions execute in
              ideal 5-stage pipeline without stalls or forwarding.
            </p>
          )}
        </div>

        {simulationHasStarted && stallsEnabled && (
          <div className='flex flex-col gap-1 p-2 bg-muted rounded'>
            {detectedHazardCount > 0 ? (
              <>
                <div className='flex items-center text-sm'>
                  <AlertTriangle className='w-4 h-4 mr-2 text-yellow-500' />
                  <span>{detectedHazardCount} hazards detected</span>
                </div>
                {forwardingEnabled && activeForwardingPathCount > 0 && (
                  <div className='flex items-center text-sm'>
                    <Zap className='w-4 h-4 mr-2 text-green-500' />
                    <span>{activeForwardingPathCount} forwarding paths active</span>
                  </div>
                )}
                {totalStallCount > 0 && (
                  <div className='flex items-center text-sm'>
                    <AlertTriangle className='w-4 h-4 mr-2 text-red-500' />
                    <span>{totalStallCount} stall cycles added</span>
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

        {simulationHasStarted && !stallsEnabled && (
          <div className='flex items-center gap-1 p-2 bg-muted rounded text-sm'>
            <StopCircle className='w-4 h-4 text-blue-500' />
            <span>Ideal pipeline - no hazard detection active</span>
          </div>
        )}

        <div className='flex justify-between items-center gap-2'>
          <Button
            onClick={handleInstructionSubmission}
            disabled={disableInputsAndStartButton}
            className='flex-1'
          >
            {isFinished
              ? 'Finished'
              : simulationHasStarted
              ? 'Running...'
              : 'Start Simulation'}
          </Button>

          {canControlPauseResume && (
            <Button
              variant='outline'
              onClick={toggleSimulationPauseResume}
              size='icon'
              aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}
            >
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

          {simulationHasStarted && (
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