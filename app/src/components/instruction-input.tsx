"use client";

import type * as React from "react";
import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { BranchConfigurationPanel } from "@/components/ui/branchButtons";

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
} from "@/context/SimulationContext";
import {
  Play,
  Pause,
  RotateCcw,
  AlertTriangle,
  Zap,
  StopCircle,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[]) => void;
  onReset: () => void;
  isRunning: boolean;
}

const HEX_REGEX = /^[0-9a-fA-F]{8}$/;
//const { predictionMode } = useSimulationState();

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
    setPredictionMode,
    setStateMachineConfig,
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
    predictionMode,
  } = useSimulationState();

  useEffect(() => {
    if (instructions.length === 0) {
      setError(null);
    }
  }, [instructions]);

  const hasStarted = currentCycle > 0;
  const canPauseResume = hasStarted && !isFinished;
  const disableInputAndStart = hasStarted && !isFinished;

  const hazardCount = Object.values(hazards).filter(
    (h) => h.type !== "NONE"
  ).length;
  const stallCount = Object.values(stalls).reduce((sum, s) => sum + s, 0);
  const forwardingCount = Object.values(forwardings).filter(
    (f) => f.length > 0
  ).length;

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

  const handleForwardingChange = (checked: boolean) => {
    setForwardingEnabled(checked);
    if (hasStarted && isFinished) {
      setTimeout(() => {
        onReset();
        setTimeout(() => {
          const currentInstructions = inputText
            .trim()
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

          if (currentInstructions.length > 0) {
            onInstructionsSubmit(currentInstructions);
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
          const currentInstructions = inputText
            .trim()
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

          if (currentInstructions.length > 0) {
            onInstructionsSubmit(currentInstructions);
          }
        }, 50);
      }, 50);
    }
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
            placeholder="e.g., 00a63820..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="font-mono"
            disabled={disableInputAndStart}
            aria-label="MIPS Hex Instructions Input"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* Pipeline configuration switches */}
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-medium">Pipeline Configuration</h4>

          <div className="flex items-center space-x-2">
            <Switch
              id="stalls-mode"
              checked={stallsEnabled}
              onCheckedChange={handleStallsChange}
              disabled={disableInputAndStart}
            />
            <Label htmlFor="stalls-mode" className="text-sm">
              Enable Hazard Detection & Stalls
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="forwarding-mode"
              checked={forwardingEnabled && stallsEnabled}
              onCheckedChange={handleForwardingChange}
              disabled={disableInputAndStart || !stallsEnabled}
            />
            <Label
              htmlFor="forwarding-mode"
              className={`text-sm ${
                !stallsEnabled ? "text-muted-foreground" : ""
              }`}
            >
              Enable Data Forwarding
            </Label>
          </div>

          {/* Reusable branch configuration panel */}
          <BranchConfigurationPanel disabled={hasStarted && !isFinished} />

          {!stallsEnabled && (
            <p className="text-xs text-muted-foreground">
              When hazard detection is disabled, all instructions execute in
              ideal 5-stage pipeline without stalls or forwarding.
            </p>
          )}
        </div>

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
                )}
                <div className="flex items-center text-sm">
                  <Zap className="w-4 h-4 mr-2 text-green-500" />
                  <span>
                    {forwardingEnabled
                      ? "Data forwarding enabled"
                      : "Data forwarding disabled"}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center text-sm">
                <Zap className="w-4 h-4 mr-2 text-green-500" />
                <span>No hazards detected - clean pipeline execution</span>
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

          {canPauseResume && (
            <Button
              variant="outline"
              onClick={handlePauseResume}
              size="icon"
              aria-label={isRunning ? "Pause Simulation" : "Resume Simulation"}
            >
              {isRunning ? <Pause /> : <Play />}
            </Button>
          )}

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
