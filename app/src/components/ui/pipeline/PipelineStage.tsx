'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { HazardInfo, ForwardingInfo, RegisterName } from './PipelineDisplay';
import { AlertTriangle, Zap, Code2, Cpu, MemoryStick, CheckSquare } from 'lucide-react';

interface PipelineStageProps {
  stageName: RegisterName;
  instruction: string;
  fullInstruction: string;
  isActive: boolean;
  instructionIndex?: number | null;
  hazard?: HazardInfo;
  forwardings?: ForwardingInfo[];
  stallCount?: number;
}

const registerDetails: Record<RegisterName, { name: string }> = {
  'IF/ID': { name: 'Instruction Fetch / Decode' },
  'ID/EX': { name: 'Instruction Decode / Execute' },
  'EX/MEM': { name: 'Execute / Memory Access' },
  'MEM/WB': { name: 'Memory Access / Write Back' },
};

// Icon per register (right-hand stage of the register)
const registerIcon: Record<RegisterName, React.ComponentType<{ className?: string }>> = {
  'IF/ID': Code2,        // ID
  'ID/EX': Cpu,          // EX
  'EX/MEM': MemoryStick, // MEM
  'MEM/WB': CheckSquare, // WB
};

const fmtHex = (v: string) => {
  const raw = v.startsWith('0x') ? v.slice(2) : v;
  if (raw.toLowerCase() === '00000000') return 'nop';
  return '0x' + raw.toLowerCase();
};

const Chip = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${className}`}>
    {children}
  </span>
);

export function PipelineStage({
  stageName,
  instruction,
  fullInstruction,
  isActive,
  instructionIndex,
  hazard,
  forwardings = [],
  stallCount = 0,
}: PipelineStageProps) {
  const Icon = registerIcon[stageName];
  const shortText = instruction && instruction !== '---' ? fmtHex(instruction) : '---';
  const longText = fullInstruction && fullInstruction !== 'empty' ? fmtHex(fullInstruction) : 'empty';
  const tag = instructionIndex != null ? `[${instructionIndex}] ` : '';

  // Show rules bound to the *stage* of the instruction
  const showStall = stageName === 'ID/EX' && stallCount > 0;         // stalls are inserted in ID
  const showForward = stageName === 'EX/MEM' && forwardings.length > 0; // forwarding happens in EX
  const showHazard = stageName === 'ID/EX' && (hazard?.type ?? 'NONE') !== 'NONE';

  const hazardType = showHazard ? (hazard?.type ?? 'NONE') : 'NONE';

  // Card color priority: stall > forward > RAW > WAW > active > normal
  const cardTone =
    showStall
      ? 'bg-red-50 border-red-300'
      : showForward
      ? 'bg-green-50 border-green-300'
      : hazardType === 'RAW'
      ? 'bg-rose-50 border-rose-300'
      : hazardType === 'WAW'
      ? 'bg-amber-50 border-amber-300'
      : isActive
      ? 'border-accent shadow-lg shadow-accent/20'
      : 'border-border';

  const titleTone =
    showStall
      ? 'text-red-700'
      : showForward
      ? 'text-green-700'
      : hazardType === 'RAW'
      ? 'text-rose-700'
      : hazardType === 'WAW'
      ? 'text-amber-700'
      : isActive
      ? 'text-accent'
      : 'text-muted-foreground';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card
            className={[
              'text-center w-full h-full',
              // Very subtle color/opacity/shadow transitions
              'transition-[background-color,border-color,box-shadow,transform,opacity] duration-400',
              (isActive || showStall || showForward || showHazard) ? 'opacity-100' : 'opacity-70',
              cardTone,
            ].join(' ')}
          >
            <CardHeader className="p-2 md:p-3">
              <div className="flex items-center justify-center gap-2">
                <Icon className="w-4 h-4 opacity-70 transition-opacity duration-300" />
                <CardTitle
                  className={[
                    'text-sm md:text-base font-bold',
                    'transition-colors duration-300',
                    titleTone,
                  ].join(' ')}
                >
                  {stageName}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-2 md:p-4 pt-0">
              <p
                className={[
                  'font-mono text-xs md:text-sm truncate bg-muted/50 rounded-md p-2 h-9 flex items-center justify-center',
                  'transition-[background-color,color,opacity] duration-300',
                  (isActive || showStall || showForward || showHazard) ? 'opacity-100' : 'opacity-85',
                ].join(' ')}
              >
                {shortText === '---' ? '---' : `${tag}${shortText}`}
              </p>

              <div className="mt-2 h-5 flex items-center justify-center gap-1">
                {/* RAW slot */}
                {showHazard && hazardType === 'RAW' ? (
                  <Chip className="bg-rose-100 text-rose-700 border-rose-200 transition-opacity duration-300 opacity-100">
                    <AlertTriangle className="w-3 h-3" /> RAW
                  </Chip>
                ) : showHazard && hazardType === 'WAW' ? (
                  <Chip className="bg-amber-100 text-amber-700 border-amber-200 transition-opacity duration-300 opacity-100">
                    <AlertTriangle className="w-3 h-3" /> WAW
                  </Chip>
                ) : (
                  <span className="h-5 px-2 rounded-full border border-transparent opacity-0 transition-opacity duration-300" />
                )}

                {/* STALL slot */}
                {showStall ? (
                  <Chip className="bg-red-100 text-red-700 border-red-200 transition-opacity duration-300 opacity-100">
                    <AlertTriangle className="w-3 h-3" /> stall ×{stallCount}
                  </Chip>
                ) : (
                  <span className="h-5 px-2 rounded-full border border-transparent opacity-0 transition-opacity duration-300" />
                )}

                {/* FORWARD slot */}
                {showForward ? (
                  <Chip className="bg-green-100 text-green-700 border-green-200 transition-opacity duration-300 opacity-100">
                    <Zap className="w-3 h-3" /> fwd
                  </Chip>
                ) : (
                  <span className="h-5 px-2 rounded-full border border-transparent opacity-0 transition-opacity duration-300" />
                )}
              </div>
            </CardContent>
          </Card>
        </TooltipTrigger>

        <TooltipContent className="max-w-sm">
          <p className="font-semibold">{registerDetails[stageName].name} Register</p>
          <p className="font-mono text-sm mb-2">{longText === 'empty' ? 'empty' : `${tag}${longText}`}</p>

          {showHazard && hazard && (
            <div className="text-xs">
              <p className="font-semibold mb-1">Hazard</p>
              <p className="mb-1">{hazard.description}</p>
              {hazard.stallCycles > 0 && <p>Stalls required: {hazard.stallCycles}</p>}
              <p>Can forward: {hazard.canForward ? 'Yes' : 'No'}</p>
            </div>
          )}

          {showForward && forwardings.length > 0 && (
            <div className="text-xs mt-2">
              <p className="font-semibold mb-1">Forwarding Paths</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {forwardings.map((f, i) => (
                  <li key={i}>
                    from [{f.from}] {f.fromStage} → to [{f.to}] {f.toStage} ({f.register})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
