import { useState, useEffect } from "react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useSimulationActions, useSimulationState } from "@/context/SimulationContext"
import { Play, Pause, RotateCcw } from "lucide-react"

// Regex para 8 caracteres hexadecimales
const HEX_REGEX = /^[0-9a-fA-F]{8}$/

// Tipos para las props
interface InstructionInputProps {
  onInstructionsSubmit: (instructions: string[], isForwarding: boolean) => void
  onReset: () => void
  isRunning: boolean
}

export function InstructionInput({
  onInstructionsSubmit,
  onReset,
  isRunning,
}: InstructionInputProps) {
  const [inputText, setInputText] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [isForwarding, setIsForwarding] = useState<boolean>(false)

  const { pauseSimulation, resumeSimulation } = useSimulationActions()
  const { currentCycle, isFinished, instructions } = useSimulationState()

  useEffect(() => {
    if (instructions.length === 0) {
      setInputText("")
      setError(null)
    }
  }, [instructions])

  const hasStarted = currentCycle > 0
  const canPauseResume = hasStarted && !isFinished
  const disableInputAndStart = hasStarted && !isFinished

  const handleSubmit = () => {
    setError(null)
    const lines = inputText.trim().split("\n")
    const currentInstructions = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (currentInstructions.length === 0) {
      setError("Please enter at least one MIPS instruction in hexadecimal format.")
      return
    }

    const invalidInstructions = currentInstructions.filter(
      (inst) => !HEX_REGEX.test(inst)
    )
    if (invalidInstructions.length > 0) {
      setError(
        `Invalid instruction format found: ${invalidInstructions.join(
          ", "
        )}. Each instruction must be 8 hexadecimal characters.`
      )
      return
    }

    onInstructionsSubmit(currentInstructions, isForwarding) // ← Pasa el valor aquí
  }

  const handlePauseResume = () => {
    isRunning ? pauseSimulation() : resumeSimulation()
  }

  const toggleForwarding = () => {
    setIsForwarding((prev) => !prev)
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>MIPS Instructions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid w-full gap-1.5">
          <Label htmlFor="instructions">Enter Hex Instructions (one per line)</Label>
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
        <div className="flex justify-between items-center gap-2">
          {/* Botón FW */}
          <Button
            onClick={toggleForwarding}
            disabled={hasStarted && !isFinished}
            className={
              isForwarding
                ? "bg-yellow-400 hover:bg-yellow-300 text-black"
                : "bg-gray-600 hover:bg-gray-500 text-white"
            }
            size="sm"
          >
            FW
          </Button>

          {/* Start Button */}
          <Button onClick={handleSubmit} disabled={disableInputAndStart} className="flex-1">
            {isFinished ? "Restart Simulation" : hasStarted ? "Running..." : "Start Simulation"}
          </Button>

          {/* Play/Pause Button */}
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

          {/* Reset Button */}
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
  )
}
