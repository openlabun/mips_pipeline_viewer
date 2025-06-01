'use client';

import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  type BranchPredictionMode, // Import types
  type StaticBranchPrediction,
  type StateMachineInitialPrediction,
} from '@/context/SimulationContext';
import {
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  Zap,
  StopCircle,
  GitBranch, // Icon for branch prediction
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  // isRunning prop can be removed if using context's isRunning
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;

export function InstructionInput({
  onInstructionsSubmit: propOnInstructionsSubmit,
  onReset: propOnReset,
}: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const {
    pauseSimulation,
    resumeSimulation,
    setForwardingEnabled,
    setStallsEnabled,
    setBranchPredictionMode,
    setStaticBranchPrediction,
    setStateMachineInitialPrediction,
    setStateMachineFailsToSwitch,
  } = useSimulationActions();

  const {
    currentCycle,
    isFinished,
    instructions, // from context, for restarting
    hazards,
    stalls,
    forwardingEnabled,
    stallsEnabled,
    forwardings,
    branchPredictionMode,
    staticBranchPrediction,
    stateMachineInitialPrediction,
    stateMachineFailsToSwitch,
    isRunning, // Use isRunning from context
  } = useSimulationState();

  useEffect(() => {
    if (instructions.length === 0) {
      setError(null);
      // Consider if inputText should also be cleared when context instructions are gone
      // setInputText('');
    }
  }, [instructions]);

  const hasStarted = currentCycle > 0 || (currentCycle === 0 && isRunning); // Consider cycle 0 as started if isRunning
  const canPauseResume = (hasStarted || isRunning) && !isFinished; // isRunning means it can be paused.
  const disableInputAndStart = (hasStarted || isRunning) && !isFinished;


  const hazardCount = Object.values(hazards).filter(
    (h) => h.type !== 'NONE'
  ).length;
  const stallCount = Object.values(stalls).reduce((sum, s) => sum + s, 0);
  const forwardingCount = Object.values(forwardings).filter(
    (f) => f.length > 0
  ).length;

  // This function is called when a config changes, to restart simulation with current instructions
  const restartSimulationWithCurrentConfig = useCallback(() => {
      // Only restart if a simulation has started or instructions are present
      if (hasStarted || instructions.length > 0 || inputText.trim().length > 0) {
        propOnReset(); // Call parent's reset, which should trigger context's reset (preserving config)
        
        setTimeout(() => {
          const currentInstructionsFromInput = inputText
            .trim()
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

          // Use instructions from input field if available, otherwise from context (e.g. after a reset)
          const instructionsToRestart = currentInstructionsFromInput.length > 0
            ? currentInstructionsFromInput
            : instructions; // 'instructions' is from context state

          if (instructionsToRestart.length > 0) {
            propOnInstructionsSubmit(instructionsToRestart); // Call parent's submit
          } else if (currentInstructionsFromInput.length === 0 && instructions.length === 0) {
            // If both are empty, effectively it's a reset to initial input state
            // propOnReset() was already called. No need to submit empty instructions.
          }
        }, 50); // Small delay for state updates to propagate
      }
  }, [hasStarted, propOnReset, propOnInstructionsSubmit, inputText, instructions]);


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
    propOnInstructionsSubmit(currentInstructions);
  };

  const handleMainReset = () => {
    propOnReset();
    setInputText(''); // Clear input text on user-triggered full reset
    setError(null);
  };

  const handlePauseResume = () => {
    if (isRunning) {
      pauseSimulation();
    } else {
      resumeSimulation();
    }
  };

  const handleConfigChangeAndRestart = (updateAction: () => void) => {
    updateAction(); // Apply the specific config change (e.g., setForwardingEnabled)
    restartSimulationWithCurrentConfig();
  };

  const handleForwardingChange = (checked: boolean) => {
    handleConfigChangeAndRestart(() => setForwardingEnabled(checked));
  };

  const handleStallsChange = (checked: boolean) => {
    handleConfigChangeAndRestart(() => {
        setStallsEnabled(checked);
        if (!checked) {
          setForwardingEnabled(false); // This updates context directly
        }
    });
  };
  
  const handleBranchPredictionModeChange = (mode: BranchPredictionMode) => {
    handleConfigChangeAndRestart(() => setBranchPredictionMode(mode));
  };

  const handleStaticPredictionChange = (value: string) => {
    handleConfigChangeAndRestart(() => setStaticBranchPrediction(value as StaticBranchPrediction));
  };

  const handleStateMachineInitialChange = (value: string) => {
    handleConfigChangeAndRestart(() => setStateMachineInitialPrediction(value as StateMachineInitialPrediction));
  };

  const handleStateMachineFailsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1) {
      handleConfigChangeAndRestart(() => setStateMachineFailsToSwitch(val));
    } else if (e.target.value === '' || (!isNaN(val) && val < 1)) {
      // If empty or invalid, revert to a sensible default (e.g., current or 1)
      // To avoid rapid restarts on partial input, only trigger restart for valid numbers
      // The context ensures fails >= 1. Here we just update if valid.
      if (!isNaN(val) && val < 1) {
         handleConfigChangeAndRestart(() => setStateMachineFailsToSwitch(1));
      }
      // If just empty, don't immediately restart, wait for a valid number.
      // Or, if you want to set it to a default immediately:
      // setStateMachineFailsToSwitch(stateMachineFailsToSwitch); // or 1
    }
  };
  
  const displayStateMachineFails = isNaN(stateMachineFailsToSwitch) || stateMachineFailsToSwitch < 1 ? 1 : stateMachineFailsToSwitch;


  const staticPredictionEnabled = branchPredictionMode === 'static';
  const stateMachinePredictionEnabled = branchPredictionMode === 'stateMachine';

  return (
    <Card className='w-full max-w-md'>
      <CardHeader>
        <CardTitle>MIPS Pipeline Simulator</CardTitle>
        <CardDescription>
          Enter instructions, configure pipeline, and visualize execution.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid w-full gap-1.5'>
          <Label htmlFor='instructions'>
            Enter Hex Instructions (one per line)
          </Label>
          <Textarea
            id='instructions'
            placeholder='e.g., 00a63820 (add $7,$5,$6)'
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className='font-mono'
            disabled={disableInputAndStart}
            aria-label='MIPS Hex Instructions Input'
          />
          {error && <p className='text-sm text-destructive'>{error}</p>}
        </div>

        {/* Pipeline configuration switches */}
        <div className='space-y-3 p-3 bg-muted/50 rounded-lg'>
          <h4 className='text-sm font-medium'>Pipeline Configuration</h4>
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
          <div className='flex items-center space-x-2'>
            <Switch
              id='forwarding-mode'
              checked={forwardingEnabled && stallsEnabled} // Visually sync with stall dependency
              onCheckedChange={handleForwardingChange}
              disabled={disableInputAndStart || !stallsEnabled}
            />
            <Label
              htmlFor='forwarding-mode'
              className={`text-sm ${!stallsEnabled ? 'text-muted-foreground' : ''}`}
            >
              Enable Data Forwarding
            </Label>
          </div>
          {!stallsEnabled && (
            <p className='text-xs text-muted-foreground'>
              Ideal pipeline: No hazard detection, stalls, or forwarding.
            </p>
          )}
        </div>

        {/* Branch Prediction Configuration */}
        <div className='space-y-3 p-3 bg-muted/50 rounded-lg'>
          <div className='flex items-center space-x-2 mb-2'>
            
            <h4 className='text-sm font-medium'>Branch Prediction</h4>
          </div>

          <div className='flex items-center space-x-2'>
            <Switch
              id='branch-static-mode'
              checked={staticPredictionEnabled}
              onCheckedChange={(checked) =>
                handleBranchPredictionModeChange(checked ? 'static' : 'none')
              }
              disabled={disableInputAndStart}
            />
            <Label htmlFor='branch-static-mode' className='text-sm'>
              Static Prediction
            </Label>
          </div>
          {staticPredictionEnabled && (
            <div className='pl-8 space-y-2 text-sm'> {/* Indent options */}
              <RadioGroup
                value={staticBranchPrediction}
                onValueChange={handleStaticPredictionChange}
                disabled={disableInputAndStart}
              >
                <div className='flex items-center space-x-2'>
                  <RadioGroupItem value='taken' id='static-taken' />
                  <Label htmlFor='static-taken'>Always Taken</Label>
                </div>
                <div className='flex items-center space-x-2'>
                  <RadioGroupItem value='notTaken' id='static-not-taken' />
                  <Label htmlFor='static-not-taken'>Always Not Taken</Label>
                </div>
              </RadioGroup>
            </div>
          )}

          <div className='flex items-center space-x-2 mt-3'>
            <Switch
              id='branch-sm-mode'
              checked={stateMachinePredictionEnabled}
              onCheckedChange={(checked) =>
                handleBranchPredictionModeChange(checked ? 'stateMachine' : 'none')
              }
              disabled={disableInputAndStart}
            />
            <Label htmlFor='branch-sm-mode' className='text-sm'>
              State Machine Prediction
            </Label>
          </div>
          {stateMachinePredictionEnabled && (
            <div className='pl-8 space-y-3 text-sm'> {/* Indent options */}
              <div>
                <Label htmlFor='sm-initial-pred' className='mb-1 block font-medium'>Initial Prediction:</Label>
                <RadioGroup
                  id='sm-initial-pred'
                  value={stateMachineInitialPrediction}
                  onValueChange={handleStateMachineInitialChange}
                  disabled={disableInputAndStart}
                >
                  <div className='flex items-center space-x-2'>
                    <RadioGroupItem value='taken' id='sm-initial-taken' />
                    <Label htmlFor='sm-initial-taken'>Initially Taken</Label>
                  </div>
                  <div className='flex items-center space-x-2'>
                    <RadioGroupItem value='notTaken' id='sm-initial-not-taken' />
                    <Label htmlFor='sm-initial-not-taken'>Initially Not Taken</Label>
                  </div>
                </RadioGroup>
              </div>
              <div>
                <Label htmlFor='sm-fails' className='mb-1 block font-medium'>Mispredictions to Switch State:</Label>
                <Input
                  type='number'
                  id='sm-fails'
                  value={displayStateMachineFails}
                  onChange={handleStateMachineFailsChange}
                  onBlur={(e) => { // Ensure a valid value on blur if input is bad
                      const val = parseInt(e.target.value, 10);
                      if (isNaN(val) || val < 1) {
                          handleConfigChangeAndRestart(() => setStateMachineFailsToSwitch(1));
                      }
                  }}
                  min={1}
                  className='w-24 h-9' // Adjusted size
                  disabled={disableInputAndStart}
                />
                 <p className='text-xs text-muted-foreground mt-1'>
                  (e.g., 1 for 1-bit, 2 for 2-bit predictor)
                </p>
              </div>
            </div>
          )}
           {branchPredictionMode === "none" && !staticPredictionEnabled && !stateMachinePredictionEnabled && (
             <p className='text-xs text-muted-foreground mt-1 pl-1'>
              No branch prediction active. Branches typically resolved in ID/EX, may cause stalls.
            </p>
           )}
        </div>

        {/* Statistics Display */}
        {(hasStarted || isFinished) && ( // Show stats if started or finished
          <div className='flex flex-col gap-1 p-3 bg-muted/40 rounded text-sm'>
            <h4 className='text-xs font-semibold uppercase text-muted-foreground mb-1'>Simulation Status</h4>
            {stallsEnabled ? (
              <>
                {hazardCount > 0 || stallCount > 0 ? (
                  <>
                    <div className='flex items-center'>
                      <AlertTriangle className='w-4 h-4 mr-1.5 text-yellow-600' />
                      <span>{hazardCount} data hazards</span>
                    </div>
                    {stallCount > 0 && (
                      <div className='flex items-center'>
                        <StopCircle className='w-4 h-4 mr-1.5 text-red-600' />
                        <span>{stallCount} stall cycles (data)</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className='flex items-center'>
                    <Zap className='w-4 h-4 mr-1.5 text-green-600' />
                    <span>No data hazards.</span>
                  </div>
                )}
                {forwardingEnabled && (
                  <div className='flex items-center'>
                    <Zap className='w-4 h-4 mr-1.5 text-blue-600' />
                    <span>
                      {forwardingCount > 0
                        ? `${forwardingCount} active forwarding paths`
                        : 'Data forwarding enabled'}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className='flex items-center'>
                <Zap className='w-4 h-4 mr-1.5 text-green-600' />
                <span>Ideal pipeline (no hazard detection).</span>
              </div>
            )}
            {branchPredictionMode !== 'none' && (
                <div className='flex items-center mt-1.5 pt-1.5 border-t border-muted'>
                    <GitBranch className='w-4 h-4 mr-1.5 text-purple-600' />
                    <span>
                        Branch: {
                            branchPredictionMode === 'static'
                                ? `Static (${staticBranchPrediction === 'taken' ? 'Always Taken' : 'Always Not Taken'})`
                                : `State Machine (Initial: ${stateMachineInitialPrediction === 'taken' ? 'Taken' : 'Not Taken'}, ${displayStateMachineFails} to flip)`
                        }
                    </span>
                </div>
            )}
          </div>
        )}

        <div className='flex justify-between items-center gap-2'>
          <Button
            onClick={handleSubmit}
            disabled={disableInputAndStart}
            className='flex-1'
            aria-live="polite"
          >
            {isFinished
              ? 'Finished - Restart?'
              : hasStarted || isRunning
                ? `Running (Cycle ${currentCycle})`
                : 'Start Simulation'}
          </Button>

          {canPauseResume && (
            <Button
              variant='outline'
              onClick={handlePauseResume}
              size='icon'
              aria-label={isRunning ? 'Pause Simulation' : 'Resume Simulation'}
            >
              {isRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
          )}

          {(hasStarted || isFinished) && ( // Show Reset if started or finished
            <Button
              variant='destructive'
              onClick={handleMainReset}
              size='icon'
              aria-label='Reset Simulation'
            >
              <RotateCcw className="w-5 h-5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}