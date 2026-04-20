'use client';

import type * as React from 'react';
import { useState, useEffect, useRef } from 'react';
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
  Upload,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean; // Keep isRunning prop for button state logic
  preset?: string;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/; // Basic check for 8 hex characters

export function InstructionInput({
  onInstructionsSubmit,
  onReset,
  isRunning,
  preset,
}: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preset defualts for text area if not running
  useEffect(() => {
    if (!isRunning) {
      // only set if user hasn't typed anything
      if (!inputText.trim() && preset) setInputText(preset);
    }
  }, [preset, isRunning]);

  const {
    pauseSimulation,
    resumeSimulation,
    setForwardingEnabled,
    setStallsEnabled,
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
      .map((line) => line.replace(/^0x/i, '')) // allow optional 0x prefix
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

    onInstructionsSubmit(currentInstructions);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) return;

      // Logic to parse "v2.0 raw" or similar formats
      // Format:
      // v2.0 raw
      // 25490001 01294820 ...

      const lines = content.split('\n');
      let instructions: string[] = [];

      lines.forEach(line => {
        const trimmed = line.trim();
        // Skip header lines like "v2.0 raw"
        if (trimmed.startsWith('v2.0') || trimmed === 'raw') return;

        // Split by whitespace and collect hex instructions
        const parts = trimmed.split(/\s+/).filter(part => part.length > 0);
        instructions = [...instructions, ...parts];
      });

      if (instructions.length > 0) {
        setInputText(instructions.join('\n'));
        setError(null);
      } else {
        setError('No valid instructions found in the file.');
      }

      // Reset input value so same file can be uploaded again
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.onerror = () => {
      setError('Error reading file.');
    };
    reader.readAsText(file);
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
  };

  // Function to handle the change of stalls
  const handleStallsChange = (checked: boolean) => {
    setStallsEnabled(checked);

    // If stalls are disabled, also disable forwarding since it doesn't make sense
    if (!checked) {
      setForwardingEnabled(false);
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
          <div className='flex items-center justify-between'>
            <Label htmlFor='instructions'>
              Enter Hex Instructions (one per line)
            </Label>
            <div className='flex items-center gap-2'>
              <input
                type='file'
                ref={fileInputRef}
                className='hidden'
                accept='.txt,.raw,.hex'
                onChange={handleFileUpload}
                disabled={disableInputAndStart}
              />
              <Button
                variant='outline'
                size='sm'
                onClick={() => fileInputRef.current?.click()}
                disabled={disableInputAndStart}
                className='h-8 text-xs gap-1'
                title='Load instructions from file'
              >
                <Upload className='w-3.5 h-3.5' />
                Load File
              </Button>
            </div>
          </div>
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
              className={`text-sm ${!stallsEnabled ? 'text-muted-foreground' : ''
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
              onClick={() => {
                onReset();
                window.dispatchEvent(new CustomEvent('pipeline:reset'));
              }}
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
