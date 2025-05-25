// app/src/components/options-controls.tsx
"use client";

import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSimulationActions, useSimulationState } from '@/context/SimulationContext';

export function OptionsControls() {
  const { forwardingEnabled, stallEnabled } = useSimulationState();
  const { setForwarding, setStall } = useSimulationActions();

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Simulation Options</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="forwarding-switch">Forwarding</Label>
          <Switch
            id="forwarding-switch"
            checked={forwardingEnabled}
            onCheckedChange={setForwarding}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="stall-switch">Stall</Label>
          <Switch
            id="stall-switch"
            checked={stallEnabled}
            onCheckedChange={setStall}
          />
        </div>
      </CardContent>
    </Card>
  );
}