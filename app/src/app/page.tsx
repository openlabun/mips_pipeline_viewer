// src/app/page.tsx
"use client";

import type * as React from "react";
import { InstructionInput } from "@/components/instruction-input";
import { PipelineVisualization } from "@/components/pipeline-visualization";
import { Separator } from "@/components/ui/separator";
import {
  useSimulationState,
  useSimulationActions,
} from "@/context/SimulationContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { mode } = useSimulationState();
  const { setMode } = useSimulationActions();
  const { instructions, isRunning, currentCycle, maxCycles, isFinished } =
    useSimulationState();
  const {
    startSimulation,
    resetSimulation,
    pauseSimulation,
    resumeSimulation,
    nextCycle,
    previousCycle,
  } = useSimulationActions();

  const hasStarted = currentCycle > 0;

  // Añadir este componente para los controles de navegación por ciclos
  const CycleControls = () => {
    if (!hasStarted || instructions.length === 0) return null;

    return (
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={previousCycle}
          disabled={currentCycle <= 1 || isRunning}
          aria-label="Ciclo anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {isRunning ? (
          <Button
            variant="outline"
            size="sm"
            onClick={pauseSimulation}
            aria-label="Pausar simulación"
          >
            <Pause className="h-4 w-4 mr-1" /> Pausar
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={resumeSimulation}
            disabled={isFinished}
            aria-label="Continuar simulación"
          >
            <Play className="h-4 w-4 mr-1" /> Continuar
          </Button>
        )}

        <Button
          variant="outline"
          size="icon"
          onClick={nextCycle}
          disabled={currentCycle >= maxCycles || isRunning}
          aria-label="Siguiente ciclo"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 md:p-8 flex flex-col items-center space-y-8">
      <header className="text-center">
        <h1 className="text-4xl font-bold text-primary mb-2">
          MIPS Pipeline Viewer
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Visualiza cómo las instrucciones MIPS fluyen a través de un pipeline de 5 etapas.
          Aprende sobre riesgos de datos y técnicas para resolverlos.
        </p>
      </header>

      {/* Información explicativa */}
      <Alert className="max-w-2xl">
        <Info className="h-5 w-5" />
        <AlertTitle>¿Qué es un pipeline?</AlertTitle>
        <AlertDescription>
          Un pipeline permite ejecutar múltiples instrucciones simultáneamente, cada una en una etapa 
          diferente del procesador. Las 5 etapas son: Búsqueda (IF), Decodificación (ID), 
          Ejecución (EX), Acceso a memoria (MEM) y Escritura (WB).
        </AlertDescription>
      </Alert>

      {/* Tabs para modos de ejecución con explicaciones */}
      <Tabs 
        defaultValue="normal"
        value={mode} 
        onValueChange={(val) => setMode(val as any)}
        className="w-full max-w-2xl"
      >
        <TabsList className="grid grid-cols-3 mb-4">
          <TabsTrigger value="normal">Normal</TabsTrigger>
          <TabsTrigger value="stall">Stall</TabsTrigger>
          <TabsTrigger value="forwarding">Forwarding</TabsTrigger>
        </TabsList>
        
        <TabsContent value="normal">
          <Card>
            <CardContent className="pt-6">
              <p>Modo normal: ejecuta las instrucciones sin resolver dependencias de datos, 
              lo que provocaría errores en un procesador real.</p>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="stall">
          <Card>
            <CardContent className="pt-6">
              <p>Modo stall: detiene el pipeline cuando una instrucción necesita un valor que 
              aún no está disponible. Es más seguro pero más lento.</p>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="forwarding">
          <Card>
            <CardContent className="pt-6">
              <p>Modo forwarding: transfiere datos directamente entre etapas del pipeline sin 
              esperar a que lleguen a la etapa de escritura, mejorando el rendimiento.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Entrada de instrucciones */}
      <InstructionInput
        onInstructionsSubmit={startSimulation}
        onReset={resetSimulation}
        isRunning={isRunning}
      />

      <Separator className="my-4" />

      {/* Visualización condicionada */}
      {instructions.length > 0 ? (
        <>
          <PipelineVisualization />
          {maxCycles > 0 && (
            <div className="text-center bg-muted rounded-md p-3 w-full max-w-2xl">
              <p className="font-medium mb-2">
                Ciclo: {currentCycle} / {maxCycles}{" "}
                <span className="ml-2 px-2 py-1 rounded-full bg-accent text-accent-foreground text-sm">
                  {isFinished ? "Finalizado" : isRunning ? "Ejecutando" : "Pausado"}
                </span>
              </p>
              <CycleControls />
            </div>
          )}
        </>
      ) : (
        <div className="text-center p-8 bg-muted/30 rounded-md w-full max-w-2xl">
          <h3 className="font-semibold text-lg mb-2">
            {!hasStarted 
              ? "¡Comienza tu simulación!" 
              : "Simulación reiniciada"}
          </h3>
          <p className="text-muted-foreground">
            {!hasStarted 
              ? "Ingresa instrucciones MIPS en formato hexadecimal y presiona 'Iniciar Simulación'." 
              : "Ingresa nuevas instrucciones para iniciar otra simulación."}
          </p>
        </div>
      )}
    </div>
  );
}
