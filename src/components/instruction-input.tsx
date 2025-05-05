// src/components/instruction-input.tsx
"use client";

import type * as React from 'react';
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/; // Basic check for 8 hex characters

export function InstructionInput({ onInstructionsSubmit, onReset, isRunning }: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    const lines = inputText.trim().split('\n');
    const instructions = lines
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (instructions.length === 0) {
      setError('Please enter at least one MIPS instruction in hexadecimal format.');
      return;
    }

    const invalidInstructions = instructions.filter(inst => !HEX_REGEX.test(inst));
    if (invalidInstructions.length > 0) {
      setError(`Invalid instruction format found: ${invalidInstructions.join(', ')}. Each instruction must be 8 hexadecimal characters.`);
      return;
    }

    onInstructionsSubmit(instructions);
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
            placeholder="e.g., 0x00a63820..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono"
            disabled={isRunning}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-between">
          <Button onClick={handleSubmit} disabled={isRunning}>
            Start Simulation
          </Button>
          <Button variant="outline" onClick={onReset} disabled={!isRunning}>
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
