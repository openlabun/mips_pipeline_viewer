'use client';

import type * as React from 'react';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';
import { Play, Pause, RotateCcw, AlertTriangle, Zap, StopCircle } from 'lucide-react';
import { IconPlayerPlayFilled, IconLoader, IconPercentage100 } from '@tabler/icons-react';

interface InstructionInputProps {
  onInstructionsSubmit: (
    instructions: string[],
    branchConfig: {
      mode: 'always' | 'machine';
      initialPrediction: boolean;
      missThreshold: number;
    }
  ) => void;
  onReset: () => void;
  isRunning: boolean;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;

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

  const [branchPredictionEnabled, setBranchPredictionEnabled] =
    useState<boolean>(false);
  const [branchMode, setBranchMode] = useState<'always' | 'machine'>('always');
  const [initialPrediction, setInitialPrediction] = useState<
    'taken' | 'not-taken'
  >('not-taken');
  const [missThreshold, setMissThreshold] = useState<number>(1);

  const hasStarted = currentCycle > 0;
  const canPauseResume = hasStarted && !isFinished;
  const disableInputAndStart = hasStarted && !isFinished;

  useEffect(() => {
    if (instructions.length === 0) {
      setError(null);
    }
  }, [instructions]);

  const handleSubmit = () => {
    setError(null);
    const lines = inputText.trim().split('\n');
    const currentInstructions = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (currentInstructions.length === 0) {
      setError(
        'Por favor ingresa al menos una instrucción MIPS en formato hexadecimal.'
      );
      return;
    }

    const invalidInstructions = currentInstructions.filter(
      (inst) => !HEX_REGEX.test(inst)
    );
    if (invalidInstructions.length > 0) {
      setError(
        `Invalid Format: Every instruction must have 8 hex characters.`
      );
      return;
    }

    const branchConfig = {
      mode: branchMode,
      initialPrediction: initialPrediction === 'taken',
      missThreshold: branchMode === 'machine' ? missThreshold : 0,
    };

    console.log('>>> handleSubmit: branchConfig =', branchConfig);

    onInstructionsSubmit(currentInstructions, branchConfig);
  };

  const handlePauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };

  const handleForwardingChange = (checked: boolean) => {
    setForwardingEnabled(checked);
    if (hasStarted && isFinished) {
      setTimeout(() => {
        onReset();
        setTimeout(() => {
          const lines = inputText.trim().split('\n');
          const currentInstructions = lines
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          if (currentInstructions.length > 0) {
            const branchConfig = {
              mode: branchMode,
              initialPrediction: initialPrediction === 'taken',
              missThreshold: branchMode === 'machine' ? missThreshold : 0,
            };
            onInstructionsSubmit(currentInstructions, branchConfig);
          }
        }, 50);
      }, 50);
    }
  };

  const handleStallsChange = (checked: boolean) => {
    setStallsEnabled(checked);
    if (!checked) {
      setForwardingEnabled(false);
    }
    if (hasStarted && isFinished) {
      setTimeout(() => {
        onReset();
        setTimeout(() => {
          const lines = inputText.trim().split('\n');
          const currentInstructions = lines
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          if (currentInstructions.length > 0) {
            const branchConfig = {
              mode: branchMode,
              initialPrediction: initialPrediction === 'taken',
              missThreshold: branchMode === 'machine' ? missThreshold : 0,
            };
            onInstructionsSubmit(currentInstructions, branchConfig);
          }
        }, 50);
      }, 50);
    }
  };

  return (
    <section className='flex flex-col gap-3 p-4 border dark:border-gray-600 rounded-lg'>
      <h3 className="text-2xl font-semibold leading-none tracking-tight dark:text-gray-300">MIPS Instructions</h3>
      <div className='grid grid-cols-3 gap-5 dark:text-gray-300'>
        <div className='flex flex-col gap-2 w-full'>
          <h4 className='text-base font-semibold'>Hex Instructions</h4>
          <Textarea id='instructions' placeholder='e.g., 00a63820 (one per line)' value={inputText} onChange={(e) => setInputText(e.target.value)} rows={5} className='font-mono dark:bg-gray-700 dark:text-gray-50' disabled={disableInputAndStart} aria-label='Input MIPS Hex'/>
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>

        <div className='flex flex-col gap-2'>
          <h4 className='text-base font-semibold'>Pipeline Configuration</h4>
          <div className='flex items-center space-x-2'>
            <Switch id='stalls-mode' checked={stallsEnabled} onCheckedChange={handleStallsChange} disabled={disableInputAndStart}/>
            <Label htmlFor='stalls-mode' className='text-sm'>
              Enable Hazard Detection & Stalls
            </Label>
          </div>
          <div className='flex items-center space-x-2'>
            <Switch id='forwarding-mode' checked={forwardingEnabled && stallsEnabled} onCheckedChange={handleForwardingChange} disabled={disableInputAndStart || !stallsEnabled}/>
            <Label htmlFor='forwarding-mode' className={`text-sm ${!stallsEnabled ? 'text-muted-foreground' : ''}`}>
              Enable Data Forwarding
            </Label>
          </div>
        </div>

        <div className='flex flex-col gap-2'>
          <h4 className='text-base font-semibold'>Branch Support</h4>
          <div className='flex items-center space-x-2'>
            <Switch id='branch-mode-switch' checked={branchPredictionEnabled} onCheckedChange={(checked) => {
                setBranchPredictionEnabled(checked);
                setBranchMode(checked ? 'machine' : 'always');
                if (!checked) {
                  setInitialPrediction('not-taken');
                }
              }}
              disabled={disableInputAndStart}
            />
            <Label htmlFor='branch-mode-switch' className='text-sm'>
              Enable State Machine
            </Label>
          </div>

          {branchPredictionEnabled ? (
            <div className='flex flex-col gap-3'>
              <div className='flex items-center space-x-2'>
                <Label htmlFor='miss-thresh' className='text-xs text-gray-400'>
                  Misses until change
                </Label>
                <div className='flex items-center border rounded-full overflow-hidden w-fit'>
                  <button className='px-3 py-1 bg-gray-200 hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-400 dark:text-gray-900' disabled={missThreshold <= 1} onClick={() => setMissThreshold((prev) => Math.max(1, prev - 1))}>
                    −
                  </button>
                  <span className='px-3 py-1 bg-white text-center w-10 border-x dark:bg-gray-200 dark:text-gray-700'>
                    {missThreshold}
                  </span>
                  <button className='px-3 py-1 bg-gray-200 hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-400 dark:text-gray-900' disabled={missThreshold >= 4} onClick={() => setMissThreshold((prev) => Math.min(4, prev + 1))}>
                    +
                  </button>
                </div>
              </div>
              <div className='flex items-center gap-3'>
                <Label htmlFor='initial-pred' className='text-xs text-gray-400'>
                  Starting state
                </Label>
                <RadioGroup value={initialPrediction} onValueChange={(val) => setInitialPrediction(val as any)} className='flex items-center gap-2'>
                  <div className='flex items-center'>
                    <RadioGroupItem value='taken' id='initial-taken' className='peer hidden'/>
                    <label htmlFor='initial-taken' className='text-xs px-4 py-2 rounded-full border border-gray-300 bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-800 cursor-pointer peer-data-[state=checked]:bg-[#333333] peer-data-[state=checked]:text-white peer-data-[state=checked]:border-[#333333] dark:peer-data-[state=checked]:bg-gray-200 dark:peer-data-[state=checked]:text-gray-900 dark:peer-data-[state=checked]:border-gray-200'>
                      Taken
                    </label>
                  </div>
                  <div className='flex items-center'>
                    <RadioGroupItem value='not-taken' id='initial-not-taken' className='peer hidden'/>
                    <label htmlFor='initial-not-taken' className='text-xs px-4 py-2 rounded-full border border-gray-300 bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-800 cursor-pointer peer-data-[state=checked]:bg-[#333333] peer-data-[state=checked]:text-white peer-data-[state=checked]:border-[#333333] dark:peer-data-[state=checked]:bg-gray-200 dark:peer-data-[state=checked]:text-gray-900 dark:peer-data-[state=checked]:border-gray-200'>
                      Not Taken
                    </label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          ) : (
            <div className='flex items-center gap-3'>
              <Label htmlFor='static-pred' className='text-xs text-gray-400'>
                Always
              </Label>
              <RadioGroup className='flex items-center gap-2' value={initialPrediction} onValueChange={(val) => setInitialPrediction(val as any)}>
                <div className='flex items-center'>
                  <RadioGroupItem value='taken' id='static-taken' className='peer hidden'/>
                  <label htmlFor='static-taken' className='text-xs px-4 py-2 rounded-full border border-gray-300 bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-800 cursor-pointer peer-data-[state=checked]:bg-[#333333] peer-data-[state=checked]:text-white peer-data-[state=checked]:border-[#333333] dark:peer-data-[state=checked]:bg-gray-200 dark:peer-data-[state=checked]:text-gray-900 dark:peer-data-[state=checked]:border-gray-200'>
                    Taken
                  </label>
                </div>
                <div className='flex items-center'>
                  <RadioGroupItem value='not-taken' id='static-not-taken' className='peer hidden'/>
                  <label htmlFor='static-not-taken' className='text-xs px-4 py-2 rounded-full border border-gray-300 bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-800 cursor-pointer peer-data-[state=checked]:bg-[#333333] peer-data-[state=checked]:text-white peer-data-[state=checked]:border-[#333333] dark:peer-data-[state=checked]:bg-gray-200 dark:peer-data-[state=checked]:text-gray-900 dark:peer-data-[state=checked]:border-gray-200'>
                    Not Taken
                  </label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>

      </div>
      <div className='flex justify-between items-center gap-2'>
        <Button onClick={handleSubmit} disabled={disableInputAndStart} className='flex-1 rounded-full'>

          {isFinished
            ? <IconPercentage100 stroke={2} />
            : hasStarted
              ? <IconLoader stroke={2} />
              : <IconPlayerPlayFilled />}
          {isFinished
            ? 'Finished'
            : hasStarted
              ? 'Running...'
              : 'Start Simulation'}
        </Button>

        {canPauseResume && (
          <Button variant='outline' className='rounded-full dark:bg-gray-200 dark:text-gray-800' onClick={handlePauseResume} size='icon' aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}>
            {isRunning ? <Pause /> : <Play />}
          </Button>
        )}

        {hasStarted && (
          <Button className='rounded-full' variant='destructive' onClick={onReset} size='icon' aria-label='Reset Simulation'>
            <RotateCcw />
          </Button>
        )}
      </div>

      {hasStarted && stallsEnabled && (
        <div className='flex justify-center gap-8 mt-3'>
          {Object.values(hazards).filter((h) => h.type !== 'NONE').length >
            0 ? (
            <>
              <div className='flex items-center text-sm'>
                <AlertTriangle className='w-4 h-4 mr-1 text-yellow-500' />
                <span>
                  {
                    Object.values(hazards).filter((h) => h.type !== 'NONE')
                      .length
                  }{' '}
                  hazards detected
                </span>
              </div>

              {forwardingEnabled &&
                Object.values(forwardings).filter((f) => f.length > 0).length >
                0 && (
                  <div className='flex items-center text-sm'>
                    <Zap className='w-4 h-4 mr-1 text-green-500' />
                    <span>
                      {
                        Object.values(forwardings).filter(
                          (f) => f.length > 0
                        ).length
                      }{' '}
                      forwarding paths active
                    </span>
                  </div>
                )}

              {Object.values(stalls).some((s) => s > 0) && (
                <div className='flex items-center text-sm'>
                  <AlertTriangle className='w-4 h-4 mr-1 text-red-500' />
                  <span>
                    {Object.values(stalls).reduce((a, b) => a + b, 0)} stall
                    cycles added
                  </span>
                </div>
              )}
              <div className='flex items-center text-sm'>
                <Zap className='w-4 h-4 mr-1 text-green-500' />
                <span>
                  {forwardingEnabled ? 'Data forwarding enabled' : 'Data forwarding disabled'}
                </span>
              </div>
            </>
          ) : (
            <div className='flex items-center text-sm'>
              <Zap className='w-4 h-4 mr-1 text-green-500' />
              <span>No hazards detected</span>
            </div>
          )}
        </div>
      )}

      {hasStarted && !stallsEnabled && (
        <div className='flex items-center justify-center gap-1 text-sm'>
          <StopCircle className='w-4 h-4 text-blue-500' />
          <span>Ideal pipeline - no hazard detection</span>
        </div>
      )}
    </section>
  );
}
