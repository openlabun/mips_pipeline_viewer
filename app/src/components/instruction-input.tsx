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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  GitBranch,
  Target,
  X,
  Settings,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
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
    setBranchPredictionEnabled,
    setBranchPredictionType,
    setDynamicPredictorInitial,
    setDynamicPredictorThreshold,
  } = useSimulationActions();
  const {
    currentCycle,
    isFinished,
    instructions,
    hazards,
    stalls,
    forwardingEnabled,
    stallsEnabled,
    branchPredictionEnabled,
    branchPredictionType,
    dynamicPredictorInitial,
    dynamicPredictorThreshold,
    forwardings,
    branches,
    registerUsage,
    totalBranches,
    totalMisses,
  } = useSimulationState();

  useEffect(() => {
    if (instructions.length === 0) {
      setError(null);
    }
  }, [instructions]);

  const hasStarted = currentCycle > 0;
  const canPauseResume = hasStarted && !isFinished;
  const disableInputAndStart = hasStarted && !isFinished;

  // Count hazards, stalls, and branches
  const hazardCount = Object.values(hazards).filter(
    (h) => h.type !== 'NONE'
  ).length;
  const stallCount = Object.values(stalls).reduce((sum, s) => sum + s, 0);
  const forwardingCount = Object.values(forwardings).filter(
    (f) => f.length > 0
  ).length;

  // Branch statistics
  const branchCount = Object.values(registerUsage).filter(
    (r) => r.isBranch
  ).length;
  const mispredictedBranches = Object.values(branches).filter(
    (b) => b.isMispredicted
  ).length;
  const correctPredictions = branchCount - mispredictedBranches;
  const controlHazards = Object.values(hazards).filter(
    (h) => h.type === 'CONTROL'
  ).length;

  // Branch prediction accuracy
  const branchAccuracy =
    branchCount > 0 ? ((correctPredictions / branchCount) * 100).toFixed(1) : 0;

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

    onInstructionsSubmit(currentInstructions);
  };

  const handlePauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };

  const restartSimulationIfFinished = () => {
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

  const handleForwardingChange = (checked: boolean) => {
    setForwardingEnabled(checked);
    restartSimulationIfFinished();
  };

  const handleStallsChange = (checked: boolean) => {
    setStallsEnabled(checked);

    if (!checked) {
      setForwardingEnabled(false);
      setBranchPredictionEnabled(false);
    }

    restartSimulationIfFinished();
  };

  const handleBranchPredictionChange = (checked: boolean) => {
    setBranchPredictionEnabled(checked);
    restartSimulationIfFinished();
  };

  const handleBranchPredictionTypeChange = (type: string) => {
    setBranchPredictionType(type as any);
    restartSimulationIfFinished();
  };

  const handleDynamicInitialChange = (checked: boolean) => {
    setDynamicPredictorInitial(checked);
    restartSimulationIfFinished();
  };

  const handleDynamicThresholdChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value) && value > 0) {
      setDynamicPredictorThreshold(value);
      restartSimulationIfFinished();
    }
  };

  return (
    <Card className='w-full max-w-md'>
      <CardHeader>
        <CardTitle>MIPS Instructions</CardTitle>
        <CardDescription>
          Enter instructions in hex format (8 characters) to visualize pipeline
          with comprehensive hazard detection and branch prediction
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid w-full gap-1.5'>
          <Label htmlFor='instructions'>
            Enter Hex Instructions (one per line)
          </Label>
          <Textarea
            id='instructions'
            placeholder='e.g., 1000ffff (beq $0, $0, -1)
10210004 (beq $1, $1, 4)
00a63820 (add $7, $5, $6)
8c820000 (lw $2, 0($4))
20420001 (addi $2, $2, 1)'
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={6}
            className='font-mono'
            disabled={disableInputAndStart}
            aria-label='MIPS Hex Instructions Input'
          />
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>

        {/* Pipeline configuration switches */}
        <div className='space-y-4 p-3 bg-muted/50 rounded-lg'>
          <h4 className='text-sm font-medium flex items-center gap-2'>
            <Settings className='w-4 h-4' />
            Pipeline Configuration
          </h4>

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

          {/* Forwarding configuration switch */}
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

          {/* Branch prediction switch */}
          <div className='flex items-center space-x-2'>
            <Switch
              id='branch-prediction-mode'
              checked={branchPredictionEnabled && stallsEnabled}
              onCheckedChange={handleBranchPredictionChange}
              disabled={disableInputAndStart || !stallsEnabled}
            />
            <Label
              htmlFor='branch-prediction-mode'
              className={`text-sm ${
                !stallsEnabled ? 'text-muted-foreground' : ''
              }`}
            >
              Enable Branch Prediction
            </Label>
          </div>

          {/* Branch prediction type selector */}
          {stallsEnabled && branchPredictionEnabled && (
            <div className='space-y-3 pl-6 border-l-2 border-blue-200'>
              <div className='space-y-2'>
                <Label
                  htmlFor='prediction-type'
                  className='text-sm font-medium'
                >
                  Prediction Strategy
                </Label>
                <Select
                  value={branchPredictionType}
                  onValueChange={handleBranchPredictionTypeChange}
                  disabled={disableInputAndStart}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select prediction type' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='ALWAYS_TAKEN'>Always Taken</SelectItem>
                    <SelectItem value='ALWAYS_NOT_TAKEN'>
                      Always Not Taken
                    </SelectItem>
                    <SelectItem value='DYNAMIC'>Dynamic Predictor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Dynamic predictor configuration */}
              {branchPredictionType === 'DYNAMIC' && (
                <div className='space-y-3 p-3 bg-blue-50 rounded-lg border border-blue-200'>
                  <h5 className='text-sm font-medium text-blue-800'>
                    Dynamic Predictor Settings
                  </h5>

                  <div className='flex items-center space-x-2'>
                    <Switch
                      id='dynamic-initial'
                      checked={dynamicPredictorInitial}
                      onCheckedChange={handleDynamicInitialChange}
                      disabled={disableInputAndStart}
                    />
                    <Label
                      htmlFor='dynamic-initial'
                      className='text-sm text-blue-700'
                    >
                      Initial Prediction:{' '}
                      {dynamicPredictorInitial ? 'Taken' : 'Not Taken'}
                    </Label>
                  </div>

                  <div className='space-y-2'>
                    <Label
                      htmlFor='dynamic-threshold'
                      className='text-sm text-blue-700'
                    >
                      Misses before changing prediction
                    </Label>
                    <Input
                      id='dynamic-threshold'
                      type='number'
                      min='1'
                      max='10'
                      value={dynamicPredictorThreshold}
                      onChange={handleDynamicThresholdChange}
                      disabled={disableInputAndStart}
                      className='w-20'
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {!stallsEnabled && (
            <p className='text-xs text-muted-foreground'>
              When hazard detection is disabled, all instructions execute in
              ideal 5-stage pipeline without stalls, forwarding, or branch
              prediction.
            </p>
          )}
        </div>

        {/* Show comprehensive statistics if simulation has started */}
        {hasStarted && stallsEnabled && (
          <div className='flex flex-col gap-3 p-3 bg-muted rounded-lg'>
            <h4 className='text-sm font-medium'>Pipeline Statistics</h4>

            {/* Data hazards */}
            {hazardCount > 0 ? (
              <div className='space-y-1'>
                <div className='flex items-center text-sm'>
                  <AlertTriangle className='w-4 h-4 mr-2 text-yellow-500' />
                  <span>{hazardCount} data hazards detected</span>
                </div>
                {forwardingEnabled && forwardingCount > 0 && (
                  <div className='flex items-center text-sm pl-6'>
                    <Zap className='w-4 h-4 mr-2 text-green-500' />
                    <span>{forwardingCount} forwarding paths active</span>
                  </div>
                )}
                {stallCount > 0 && (
                  <div className='flex items-center text-sm pl-6'>
                    <AlertTriangle className='w-4 h-4 mr-2 text-red-500' />
                    <span>{stallCount} stall cycles added</span>
                  </div>
                )}
              </div>
            ) : (
              <div className='flex items-center text-sm'>
                <Zap className='w-4 h-4 mr-2 text-green-500' />
                <span>No data hazards detected</span>
              </div>
            )}

            {/* Branch statistics */}
            {branchPredictionEnabled && totalBranches > 0 && (
              <div className='space-y-2 border-t pt-3'>
                <div className='flex items-center text-sm font-medium'>
                  <GitBranch className='w-4 h-4 mr-2 text-blue-500' />
                  <span>Branch Prediction Results</span>
                </div>
                <div className='pl-6 space-y-1'>
                  <div className='flex items-center text-sm'>
                    <GitBranch className='w-3 h-3 mr-2 text-blue-400' />
                    <span className='text-muted-foreground'>
                      Total branches:
                    </span>
                    <span className='ml-2 font-mono'>{totalBranches}</span>
                  </div>
                  <div className='flex items-center text-sm'>
                    <Target className='w-3 h-3 mr-2 text-green-500' />
                    <span className='text-muted-foreground'>
                      Correct predictions:
                    </span>
                    <span className='ml-2 font-mono'>{correctPredictions}</span>
                  </div>
                  <div className='flex items-center text-sm'>
                    <X className='w-3 h-3 mr-2 text-red-500' />
                    <span className='text-muted-foreground'>
                      Mispredictions (misses):
                    </span>
                    <span className='ml-2 font-mono font-semibold text-red-600'>
                      {totalMisses}
                    </span>
                  </div>
                  <div className='flex items-center text-sm'>
                    <Zap className='w-3 h-3 mr-2 text-blue-500' />
                    <span className='text-muted-foreground'>Accuracy:</span>
                    <span className='ml-2 font-mono font-semibold text-blue-600'>
                      {branchAccuracy}%
                    </span>
                  </div>
                  {controlHazards > 0 && (
                    <div className='flex items-center text-sm'>
                      <AlertTriangle className='w-3 h-3 mr-2 text-orange-500' />
                      <span className='text-muted-foreground'>
                        Control hazards:
                      </span>
                      <span className='ml-2 font-mono'>{controlHazards}</span>
                    </div>
                  )}
                  <div className='flex items-center text-xs text-blue-600 font-medium mt-2'>
                    <Settings className='w-3 h-3 mr-2' />
                    <span>
                      Strategy:{' '}
                      {branchPredictionType.replace('_', ' ').toLowerCase()}
                      {branchPredictionType === 'DYNAMIC' &&
                        ` (initial: ${
                          dynamicPredictorInitial ? 'taken' : 'not taken'
                        }, threshold: ${dynamicPredictorThreshold})`}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Overall performance summary */}
            {branchCount === 0 && hazardCount === 0 && (
              <div className='flex items-center text-sm'>
                <Zap className='w-4 h-4 mr-2 text-green-500' />
                <span>Clean pipeline execution - no hazards detected</span>
              </div>
            )}
          </div>
        )}

        {hasStarted && !stallsEnabled && (
          <div className='flex items-center gap-1 p-3 bg-muted rounded-lg text-sm'>
            <StopCircle className='w-4 h-4 text-blue-500' />
            <span>
              Ideal pipeline - no hazard detection or branch prediction active
            </span>
          </div>
        )}

        <div className='flex justify-between items-center gap-2'>
          {/* Start Button */}
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

          {/* Play/Pause Button */}
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

          {/* Reset Button */}
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
