"use client";

import type * as React from "react";
import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  useSimulationActions,
  useSimulationState,
} from "@/context/SimulationContext"; // Import context hooks
import {
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  Zap,
  StopCircle,
  Target,
  Cloud,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean; // Keep isRunning prop for button state logic
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/; // Basic check for 8 hex characters

export function InstructionInput({
  onInstructionsSubmit,
  onReset,
  isRunning,
}: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const {
    pauseSimulation,
    resumeSimulation,
    setForwardingEnabled,
    setStallsEnabled,
    setFlushEnabled,
    setBranchPredictionEnabled,
    setBranchMode,
    setStateMachineConfig,
  } = useSimulationActions();
  const {
    currentCycle,
    isFinished,
    instructions,
    hazards,
    stalls,
    flushes,
    forwardingEnabled,
    stallsEnabled,
    flushEnabled,
    branchPredictionEnabled,
    forwardings,
    branchMode,
    initialPrediction,
    failThreshold,
    branchOutcome,
    branchMissCount,
  } = useSimulationState();

  useEffect(() => {
    if (instructions.length === 0) {
      setError(null);
    }
  }, [instructions]);

  const hasStarted = currentCycle > 0;
  const disableInputAndStart = hasStarted && !isFinished;
  // Block configuration changes if the simulation is finished
  const configDisabled = isFinished;
  // Count hazards and stalls
  const hazardCount = Object.values(hazards).filter(
    (h) => h.type !== "NONE"
  ).length;
  const stallCount = Object.values(stalls).reduce((sum, s) => sum + s, 0);
  const flushCount = Object.values(flushes).filter(Boolean).length;
  const forwardingCount = Object.values(forwardings).filter(
    (f) => f.length > 0
  ).length;

  // Count branch instructions and prediction statistics
  const branchInstructions = Object.values(branchOutcome).length;
  const correctPredictions =
    Object.values(branchOutcome).filter(Boolean).length;
  const predictionAccuracy =
    branchInstructions > 0
      ? ((correctPredictions / branchInstructions) * 100).toFixed(1)
      : "N/A";

  const handleSubmit = () => {
    setError(null);
    const lines = inputText.trim().split("\n");
    const currentInstructions = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (currentInstructions.length === 0) {
      setError(
        "Please enter at least one MIPS instruction in hexadecimal format."
      );
      return;
    }

    const invalidInstructions = currentInstructions.filter(
      (inst) => !HEX_REGEX.test(inst)
    );
    if (invalidInstructions.length > 0) {
      setError(
        `Invalid instruction format found: ${invalidInstructions.join(
          ", "
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

  // Function to handle the change of forwarding
  const handleForwardingChange = (checked: boolean) => {
    if (isFinished) return;
    setForwardingEnabled(checked);
  };

  // Function to handle the change of stalls
  const handleStallsChange = (checked: boolean) => {
    if (isFinished) return;
    setStallsEnabled(checked); // Disable forwarding if stalls are disabled
    if (!checked) {
      setForwardingEnabled(false);
    }
  };
  // Function to handle the change of flush
  const handleFlushChange = (checked: boolean) => {
    if (isFinished) return;
    // Only allow enabling flush if branch prediction is enabled
    if (checked && !branchPredictionEnabled) return;
    setFlushEnabled(checked);
  };
  // Function to handle the change of branch prediction
  const handleBranchPredictionChange = (checked: boolean) => {
    if (isFinished) return;
    setBranchPredictionEnabled(checked);

    // Disable flush if branch prediction is disabled
    if (!checked) {
      setFlushEnabled(false);
    }
  };

  const handleBranchModeChange = (
    mode: "ALWAYS_TAKEN" | "ALWAYS_NOT_TAKEN" | "STATE_MACHINE"
  ) => {
    if (isFinished) return;
    setBranchMode(mode);

    if (mode !== "STATE_MACHINE") {
      // Clear state machine config if switching away
      setStateMachineConfig(false, 1);
    }
  };

  const handleInitialPredictionChange = (taken: boolean) => {
    if (isFinished) return;
    setStateMachineConfig(taken, failThreshold);
  };

  const handleFailThresholdChange = (value: number) => {
    if (isFinished) return;
    const threshold = Math.max(1, value);
    setStateMachineConfig(initialPrediction, threshold);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>MIPS Instructions</CardTitle>
        <CardDescription>
          Enter instructions in hex format (8 characters) to visualize pipeline
          with hazard detection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid w-full gap-1.5">
          <Label htmlFor="instructions">
            Enter Hex Instructions (one per line)
          </Label>
          <Textarea
            id="instructions"
            placeholder="e.g., 00a63820..." // Removed 0x prefix for consistency with regex
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono"
            // Disable input field if simulation has started and not yet finished
            disabled={disableInputAndStart}
            aria-label="MIPS Hex Instructions Input"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* Pipeline configuration switches */}
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-medium">Pipeline Configuration</h4>
          {/* Stalls and hazard detection switch */}
          <div className="flex items-center space-x-2">
            <Switch
              id="stalls-mode"
              checked={stallsEnabled}
              onCheckedChange={handleStallsChange}
              disabled={disableInputAndStart || configDisabled} // actualizado
            />
            <Label htmlFor="stalls-mode" className="text-sm">
              Enable Hazard Detection & Stalls
            </Label>
          </div>{" "}
          {/* Forwarding configuration switch - only available if stalls are enabled */}
          <div className="flex items-center space-x-2">
            <Switch
              id="forwarding-mode"
              checked={forwardingEnabled && stallsEnabled}
              onCheckedChange={handleForwardingChange}
              disabled={
                disableInputAndStart || configDisabled || !stallsEnabled
              }
            />
            <Label
              htmlFor="forwarding-mode"
              className={`text-sm ${
                !stallsEnabled ? "text-muted-foreground" : ""
              }`}
            >
              Enable Data Forwarding{" "}
            </Label>
          </div>
          {/* Flush configuration switch - only available if branch prediction is enabled */}
          <div className="flex items-center space-x-2">
            <Switch
              id="flush-mode"
              checked={flushEnabled && branchPredictionEnabled}
              onCheckedChange={handleFlushChange}
              disabled={
                disableInputAndStart ||
                configDisabled ||
                !branchPredictionEnabled
              }
            />
            <Label
              htmlFor="flush-mode"
              className={`text-sm ${
                !branchPredictionEnabled ? "text-muted-foreground" : ""
              }`}
            >
              Enable Pipeline Flush
            </Label>
          </div>
          {!branchPredictionEnabled && (
            <p className="text-xs text-muted-foreground">
              Pipeline flush requires branch prediction to be enabled, as
              flushes occur during branch mispredictions.
            </p>
          )}
          {!stallsEnabled && (
            <p className="text-xs text-muted-foreground">
              When hazard detection is disabled, all instructions execute in
              ideal 5-stage pipeline without stalls or forwarding.
            </p>
          )}
          {/* Branch prediction enable/disable switch */}
          <div className="pt-2 border-t border-muted">
            <div className="flex items-center space-x-2">
              <Switch
                id="branch-prediction-mode"
                checked={branchPredictionEnabled}
                onCheckedChange={handleBranchPredictionChange}
                disabled={disableInputAndStart || configDisabled}
              />
              <Label htmlFor="branch-prediction-mode" className="text-sm">
                Enable Branch Prediction
              </Label>
            </div>
          </div>
          {/* Branch prediction mode selection - only available if branch prediction is enabled */}
          {branchPredictionEnabled && (
            <div className="border-t border-muted pt-2">
              <h4 className="text-sm font-medium">Branch Prediction Mode</h4>{" "}
              <div className="mt-2 grid gap-2">
                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={branchMode}
                  onChange={(e) =>
                    handleBranchModeChange(e.target.value as any)
                  }
                  disabled={disableInputAndStart || configDisabled}
                >
                  <option value="ALWAYS_TAKEN">Always Taken</option>
                  <option value="ALWAYS_NOT_TAKEN">Always Not Taken</option>
                  <option value="STATE_MACHINE">State Machine</option>
                </select>
                {branchMode === "STATE_MACHINE" && (
                  <div className="space-y-2">
                    {/* Predicción inicial (radio buttons) */}
                    <div className="flex items-center space-x-4">
                      <Label className="text-sm">Initial Prediction:</Label>
                      <label className="flex items-center space-x-1 text-sm">
                        <input
                          type="radio"
                          name="initialPred"
                          className="w-4 h-4"
                          checked={initialPrediction === true}
                          onChange={() => handleInitialPredictionChange(true)}
                          disabled={disableInputAndStart || configDisabled}
                        />
                        <span>Taken</span>
                      </label>
                      <label className="flex items-center space-x-1 text-sm">
                        <input
                          type="radio"
                          name="initialPred"
                          className="w-4 h-4"
                          checked={initialPrediction === false}
                          onChange={() => handleInitialPredictionChange(false)}
                          disabled={disableInputAndStart || configDisabled}
                        />
                        <span>Not Taken</span>
                      </label>
                    </div>

                    {/* Fail threshold */}
                    <div className="flex items-center space-x-2">
                      <Label htmlFor="failThreshold" className="text-sm">
                        Fail Threshold:
                      </Label>
                      <input
                        id="failThreshold"
                        type="number"
                        min={1}
                        className="border rounded w-16 px-2 py-1 text-sm"
                        value={failThreshold}
                        onChange={(e) =>
                          handleFailThresholdChange(Number(e.target.value))
                        }
                        disabled={disableInputAndStart || configDisabled}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {!branchPredictionEnabled && (
            <p className="text-xs text-muted-foreground">
              When branch prediction is disabled, branch instructions execute
              without prediction logic.
            </p>
          )}
        </div>

        {/* Show hazard statistics if simulation has started */}
        {hasStarted && stallsEnabled && (
          <div className="flex flex-col gap-1 p-2 bg-muted rounded">
            {hazardCount > 0 ? (
              <>
                <div className="flex items-center text-sm">
                  <AlertTriangle className="w-4 h-4 mr-2 text-yellow-500" />
                  <span>{hazardCount} hazards detected</span>
                </div>
                {forwardingEnabled && forwardingCount > 0 && (
                  <div className="flex items-center text-sm">
                    <Zap className="w-4 h-4 mr-2 text-green-500" />
                    <span>{forwardingCount} forwarding paths active</span>
                  </div>
                )}
                {stallCount > 0 && (
                  <div className="flex items-center text-sm">
                    <AlertTriangle className="w-4 h-4 mr-2 text-red-500" />
                    <span>{stallCount} stall cycles added</span>
                  </div>
                )}{" "}
                {flushEnabled && flushCount > 0 && (
                  <div className="flex items-center text-sm">
                    <Cloud className="w-4 h-4 mr-2 text-orange-500" />
                    <span>
                      {flushCount} instruction{flushCount > 1 ? "s" : ""}{" "}
                      flushed
                    </span>
                  </div>
                )}
                <div className="flex items-center text-sm">
                  <Zap className="w-4 h-4 mr-2 text-green-500" />
                  <span>
                    {forwardingEnabled
                      ? "Data forwarding enabled"
                      : "Data forwarding disabled"}
                  </span>
                </div>
                {branchPredictionEnabled && branchInstructions > 0 && (
                  <div className="flex items-center text-sm">
                    <Target className="w-4 h-4 mr-2 text-blue-500" />
                    <span>
                      Branch prediction: {correctPredictions}/
                      {branchInstructions} correct ({predictionAccuracy}%)
                    </span>
                  </div>
                )}
                {branchPredictionEnabled && branchMissCount > 0 && (
                  <div className="flex items-center text-sm">
                    <AlertTriangle className="w-4 h-4 mr-2 text-orange-500" />
                    <span>{branchMissCount} branch mispredictions</span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center text-sm">
                <Zap className="w-4 h-4 mr-2 text-green-500" />
                <span>No hazards detected - clean pipeline execution</span>
              </div>
            )}
            {branchPredictionEnabled && (
              <div className="flex items-center text-sm">
                <Target className="w-4 h-4 mr-2 text-blue-500" />
                <span>
                  Branch prediction:{" "}
                  {branchPredictionEnabled
                    ? `${branchMode.toLowerCase().replace("_", " ")}`
                    : "disabled"}
                </span>
              </div>
            )}
          </div>
        )}

        {hasStarted && !stallsEnabled && (
          <div className="flex items-center gap-1 p-2 bg-muted rounded text-sm">
            <StopCircle className="w-4 h-4 text-blue-500" />
            <span>Ideal pipeline - no hazard detection active</span>
          </div>
        )}

        <div className="flex justify-between items-center gap-2">
          {/* Start Button: Disabled if started and not finished */}
          <Button
            onClick={handleSubmit}
            disabled={disableInputAndStart}
            className="flex-1"
          >
            {isFinished
              ? "Finished"
              : hasStarted
              ? "Running..."
              : "Start Simulation"}
          </Button>

          {/* Conditional Play/Pause Button: Show only when pause/resume is possible */}
          {hasStarted && !isFinished && (
            <Button
              variant="outline"
              onClick={handlePauseResume}
              size="icon"
              aria-label={isRunning ? "Pause Simulation" : "Resume Simulation"}
            >
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

          {/* Reset Button: Show only if the simulation has started */}
          {hasStarted && (
            <Button
              variant="destructive"
              onClick={onReset}
              size="icon"
              aria-label="Reset Simulation"
            >
              <RotateCcw />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
