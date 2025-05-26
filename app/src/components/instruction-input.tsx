"use client";

import React, { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';
import { Play, Pause, RotateCcw } from 'lucide-react';

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;



function insertNopsForHazards(instructions: string[]): string[] {
  const newInstructions: string[] = [];
  const regWriteHistory: Record<number, number> = {}; // regNum -> lineIndex

  const decodeInstruction = (hex: string) => {
    const bin = parseInt(hex, 16).toString(2).padStart(32, '0');
    const opcode = bin.slice(0, 6);
    if (opcode === '000000') {
      // Tipo R
      const rs = parseInt(bin.slice(6, 11), 2);
      const rt = parseInt(bin.slice(11, 16), 2);
      const rd = parseInt(bin.slice(16, 21), 2);
      return { type: 'R', rs, rt, rd };
    } else {
      // Tipo I
      const rs = parseInt(bin.slice(6, 11), 2);
      const rt = parseInt(bin.slice(11, 16), 2);
      return { type: 'I', rs, rt };
    }
  };

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];
    const decoded = decodeInstruction(inst);
    const dependsOn: number[] = [];

    if (!decoded) {
      newInstructions.push(inst);
      continue;
    }

    if (decoded.type === 'R') {
      dependsOn.push(decoded.rs, decoded.rt);
    } else if (decoded.type === 'I') {
      dependsOn.push(decoded.rs);
    }

    const hazard = dependsOn.some(reg => regWriteHistory[reg] !== undefined);

    if (hazard) {
      newInstructions.push(...Array(3).fill('00000000')); // Insert 3 NOPs
    }

    newInstructions.push(inst);

    if (decoded.type === 'R') {
      if (typeof decoded.rd === 'number') {
        regWriteHistory[decoded.rd] = i;
      }
    } else if (decoded.type === 'I') {
      regWriteHistory[decoded.rt] = i;
    }
  }

  return newInstructions;
}

function insertNopsForLoadHazards(instructions: string[]): string[] {
  const newInstructions: string[] = [];

  const decodeInstruction = (hex: string) => {
    const bin = parseInt(hex, 16).toString(2).padStart(32, '0');
    const opcode = bin.slice(0, 6);
    if (opcode === '000000') {
      // Tipo R
      const rs = parseInt(bin.slice(6, 11), 2);
      const rt = parseInt(bin.slice(11, 16), 2);
      const rd = parseInt(bin.slice(16, 21), 2);
      return { type: 'R', opcode, rs, rt, rd };
    } else {
      // Tipo I
      const rs = parseInt(bin.slice(6, 11), 2);
      const rt = parseInt(bin.slice(11, 16), 2);
      return { type: 'I', opcode, rs, rt };
    }
  };

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];
    const decoded = decodeInstruction(inst);
    newInstructions.push(inst);

    if (!decoded) continue;

    // Detectar si esta instrucción es LOAD (lw)
    // lw opcode = 100011
    const isLoad = decoded.type === 'I' && decoded.opcode === '100011';

    if (isLoad && i + 1 < instructions.length) {
      newInstructions.push(...Array(3).fill('00000000')); // Insert 3 NOPs
    }
  }

  return newInstructions;
}


export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [insertNops, setInsertNops] = useState<boolean>(false);

  const { pauseSimulation, resumeSimulation, setActivateFW } = useSimulationActions();
  const { currentCycle, isFinished, instructions, activateFW } = useSimulationState();

  // Estado local para el checkbox de forwarding, sincronizado con contexto
  const [activateForwarding, setActivateForwarding] = useState<boolean>(activateFW);

  useEffect(() => {
    if (instructions.length === 0) {
      setInputText('');
      setError(null);
    }
  }, [instructions]);

  useEffect(() => {
    // Sincronizar estado local con el estado del contexto (por si cambia desde otro lado)
    setActivateForwarding(activateFW);
  }, [activateFW]);

  const hasStarted = currentCycle > 0;
  const canPauseResume = hasStarted && !isFinished;
  const disableInputAndStart = hasStarted && !isFinished;

  const handleSubmit = () => {
    setError(null);
    const lines = inputText.trim().split('\n');
    const currentInstructions = lines.map(line => line.trim()).filter(line => line.length > 0);

    if (currentInstructions.length === 0) {
      setError('Please enter at least one MIPS instruction in hexadecimal format.');
      return;
    }

    const invalidInstructions = currentInstructions.filter(inst => !HEX_REGEX.test(inst));
    if (invalidInstructions.length > 0) {
      setError(`Invalid instruction format found: ${invalidInstructions.join(', ')}. Each instruction must be 8 hexadecimal characters.`);
      return;
    }

    const finalInstructions = insertNops && activateForwarding !==insertNops
      ? insertNopsForHazards(currentInstructions)
      : activateFW && activateForwarding !==insertNops
      ? insertNopsForLoadHazards(currentInstructions): currentInstructions;

    onInstructionsSubmit(finalInstructions);
  };

  const handlePauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };

// Manejador para checkbox "insertNops"
const handleInsertNopsChange = (checked: boolean | 'indeterminate') => {
  const enabled = Boolean(checked);
  setInsertNops(enabled);
  if (enabled) {
    // Si activamos insertNops, desactivamos forwarding
    setActivateForwarding(false);
    setActivateFW(false);
  }
};

// Manejador para checkbox "activateForwarding"
const handleForwardingChange = (checked: boolean | 'indeterminate') => {
  const enabled = Boolean(checked);
  setActivateForwarding(enabled);
  setActivateFW(enabled);
  if (enabled) {
    // Si activamos forwarding, desactivamos insertNops
    setInsertNops(false);
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

        <div className="flex items-center space-x-2">
          <Checkbox
            id="insert-nops"
            checked={insertNops}
            onCheckedChange={handleInsertNopsChange}
            disabled={disableInputAndStart}
          />
          <Label htmlFor="insert-nops">Activate Stalling for Data Hazards</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="activate-forwarding"
            checked={activateForwarding}
            onCheckedChange={handleForwardingChange}
            disabled={disableInputAndStart}
          />
          <Label htmlFor="activate-forwarding">Activate forwarding</Label>
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
