import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  useSimulationState,
  useSimulationActions,
} from "@/context/SimulationContext";

export function BranchConfigurationPanel({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const { predictionMode, stateMachineConfig } = useSimulationState();
  const { setPredictionMode, setStateMachineConfig } = useSimulationActions();

  const isStateMachine = predictionMode === "STATE_MACHINE";
  const isNotTaken = predictionMode === "NOT_TAKEN";

  const handleToggleTaken = (checked: boolean) => {
    if (!isStateMachine) {
      setPredictionMode(checked ? "NOT_TAKEN" : "TAKEN");
    }
  };

  const handleStateMachineToggle = (checked: boolean) => {
    setPredictionMode(
      checked ? "STATE_MACHINE" : isNotTaken ? "NOT_TAKEN" : "TAKEN"
    );
  };

  const handleInitialPredictionChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const initial = e.target.value as "TAKEN" | "NOT_TAKEN";
    setStateMachineConfig({
      ...stateMachineConfig,
      initialPrediction: initial,
    });
  };

  const handleErrorThresholdChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const threshold = parseInt(e.target.value);
    setStateMachineConfig({
      ...stateMachineConfig,
      missThreshold: isNaN(threshold) ? 2 : threshold,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center space-x-2">
        <Switch
          id="branch-taken-toggle"
          checked={isNotTaken}
          onCheckedChange={handleToggleTaken}
          disabled={isStateMachine || disabled}
        />
        <Label htmlFor="branch-taken-toggle" className="text-sm">
          {isStateMachine
            ? "Prediction mode disabled"
            : isNotTaken
            ? "Always Not Taken"
            : "Always Taken"}
        </Label>
      </div>
      <div className="flex items-center space-x-2">
        <Switch
          id="state-machine-toggle"
          checked={isStateMachine}
          onCheckedChange={handleStateMachineToggle}
          disabled={disabled}
        />
        <Label htmlFor="state-machine-toggle" className="text-sm">
          Enable 2-bit State Machine
        </Label>
      </div>
      {isStateMachine && (
        <div className="space-y-2 pl-4">
          <div className="flex items-center space-x-2">
            <Label htmlFor="initial-prediction" className="text-sm">
              Initial Prediction:
            </Label>
            <select
              id="initial-prediction"
              value={stateMachineConfig.initialPrediction}
              onChange={handleInitialPredictionChange}
              className="border rounded px-2 py-1 text-sm"
              disabled={disabled}
            >
              <option value="TAKEN">Taken</option>
              <option value="NOT_TAKEN">Not Taken</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <Label htmlFor="error-threshold" className="text-sm">
              Misses before changing:
            </Label>
            <Input
              id="error-threshold"
              type="number"
              min={1}
              value={stateMachineConfig.missThreshold}
              onChange={handleErrorThresholdChange}
              className="w-16 text-sm"
              disabled={disabled}
            />
          </div>
        </div>
      )}
      {isStateMachine && (
        <p className="text-xs text-muted-foreground">
          State machine prediction is enabled. You can configure the initial
          prediction and number of misses required to change it.
        </p>
      )}
    </div>
  );
}
