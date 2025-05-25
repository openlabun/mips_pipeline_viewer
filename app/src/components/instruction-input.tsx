// src/components/instruction-input.tsx
'use client';

import type * as React from 'react';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useSimulationActions,
  useSimulationState,
} from '@/context/SimulationContext';
import { Play, Pause, RotateCcw } from 'lucide-react';

interface InstructionInputProps {
  onInstructionsSubmit: (
    instructions: string[],
    enableForwarding: boolean,
    enableStalls: boolean
  ) => void;
  onReset: () => void;
  isRunning: boolean;
}

const INSTRUCTION_PATTERN = /^[0-9a-fA-F]{8}$/;

export function InstructionInput({
  onInstructionsSubmit,
  onReset,
  isRunning,
}: InstructionInputProps) {
  const [programText, setProgramText] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [enableForwarding, setEnableForwarding] = useState<boolean>(true);
  const [enableStalls, setEnableStalls] = useState<boolean>(true);

  const { haltExecution, resumeExecution } = useSimulationActions();
  const { clockCycle, executionComplete, programInstructions } =
    useSimulationState();

  // Clear validation errors when instructions reset
  useEffect(() => {
    if (programInstructions.length === 0) {
      setValidationError(null);
    }
  }, [programInstructions]);

  const hasBegunExecution = clockCycle > 0;
  const canToggleExecution = hasBegunExecution && !executionComplete;
  const inputsDisabled = hasBegunExecution && !executionComplete;

  const validateAndSubmit = () => {
    setValidationError(null);
    const lines = programText.trim().split('\n');
    const validInstructions = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (validInstructions.length === 0) {
      setValidationError('At least one valid MIPS instruction is required.');
      return;
    }

    const invalidFormats = validInstructions.filter(
      (inst) => !INSTRUCTION_PATTERN.test(inst)
    );
    if (invalidFormats.length > 0) {
      setValidationError(
        `Invalid format detected: ${invalidFormats.join(
          ', '
        )}. Instructions must be exactly 8 hexadecimal characters.`
      );
      return;
    }

    onInstructionsSubmit(validInstructions, enableForwarding, enableStalls);
  };

  const handleExecutionToggle = () => {
    if (isRunning) {
      haltExecution();
    } else {
      resumeExecution();
    }
  };

  return (
    <div className='space-y-4'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>MIPS Instructions</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid w-full gap-1.5'>
            <Label htmlFor='program-input'>
              Enter Hex Instructions (one per line)
            </Label>
            <Textarea
              id='program-input'
              placeholder='e.g., 00a63820...'
              value={programText}
              onChange={(e) => setProgramText(e.target.value)}
              rows={5}
              className='font-mono'
              disabled={inputsDisabled}
              aria-label='MIPS Hex Instructions Input'
            />
            {validationError && (
              <p className='text-sm text-destructive'>{validationError}</p>
            )}
          </div>

          <div className='flex justify-between items-center gap-2'>
            <Button
              onClick={validateAndSubmit}
              disabled={inputsDisabled}
              className='flex-1'
            >
              {executionComplete
                ? 'Completed'
                : hasBegunExecution
                ? 'Executing...'
                : 'Begin Execution'}
            </Button>

            {canToggleExecution && (
              <Button
                variant='outline'
                onClick={handleExecutionToggle}
                size='icon'
                aria-label={isRunning ? 'Halt Execution' : 'Resume Execution'}
              >
                {isRunning ? <Pause /> : <Play />}
              </Button>
            )}

            {hasBegunExecution && (
              <Button
                variant='destructive'
                onClick={onReset}
                size='icon'
                aria-label='Reset Processor'
              >
                <RotateCcw />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Hazard Configuration - Outside the card */}
      <div className='w-full max-w-md space-y-3'>
        <Label className='text-sm font-medium'>Hazard Configuration</Label>

        <div className='flex gap-6'>
          <div className='flex items-center space-x-2'>
            <input
              type='radio'
              id='no-hazard-handling'
              name='pipeline-config'
              checked={!enableForwarding && !enableStalls}
              onChange={() => {
                setEnableForwarding(false);
                setEnableStalls(false);
              }}
              disabled={inputsDisabled}
              className='h-4 w-4'
            />
            <Label htmlFor='no-hazard-handling' className='text-sm'>
              No Hazards
            </Label>
          </div>

          <div className='flex items-center space-x-2'>
            <input
              type='radio'
              id='stalls-only'
              name='pipeline-config'
              checked={!enableForwarding && enableStalls}
              onChange={() => {
                setEnableForwarding(false);
                setEnableStalls(true);
              }}
              disabled={inputsDisabled}
              className='h-4 w-4'
            />
            <Label htmlFor='stalls-only' className='text-sm'>
              Stalls
            </Label>
          </div>

          <div className='flex items-center space-x-2'>
            <input
              type='radio'
              id='forwarding-stalls'
              name='pipeline-config'
              checked={enableForwarding && enableStalls}
              onChange={() => {
                setEnableForwarding(true);
                setEnableStalls(true);
              }}
              disabled={inputsDisabled}
              className='h-4 w-4'
            />
            <Label htmlFor='forwarding-stalls' className='text-sm'>
              Forwarding
            </Label>
          </div>
        </div>

        <div className='text-xs text-muted-foreground'>
          {!enableForwarding && !enableStalls && (
            <span>Raw pipeline execution - hazards ignored</span>
          )}
          {!enableForwarding && enableStalls && (
            <span>Pipeline stalls on all RAW dependencies</span>
          )}
          {enableForwarding && enableStalls && (
            <span>Data forwarding with stalls for load-use hazards</span>
          )}
        </div>
      </div>
    </div>
  );
}
