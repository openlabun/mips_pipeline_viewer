// src/components/instruction-input.tsx
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
      regWriteHistory[decoded.rd] = i;
    } else if (decoded.type === 'I') {
      regWriteHistory[decoded.rt] = i;
    }
  }

  return newInstructions;
}

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [insertNops, setInsertNops] = useState<boolean>(true);
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

    const finalInstructions = insertNops
      ? insertNopsForHazards(currentInstructions)
      : currentInstructions;

    onInstructionsSubmit(finalInstructions);
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

        <div className="flex items-center space-x-2">
          <Checkbox
            id="insert-nops"
            checked={insertNops}
            onCheckedChange={(checked) => setInsertNops(Boolean(checked))}
            disabled={disableInputAndStart}
          />
          <Label htmlFor="insert-nops">Activate Stalling for Data Hazards</Label>
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
