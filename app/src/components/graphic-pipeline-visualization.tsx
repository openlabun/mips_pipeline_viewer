'use client';
import React from 'react';
import { useSimulationState } from '@/context/SimulationContext';
import Image from 'next/image';
import datapath from '@/../public/datapath.jpg';

type AreaComponent = { x: number; y: number; w: number; h: number; label: string };

const IF_COMPONENTS: AreaComponent[] = [
    // MUX
    { x: 6.2, y: 39, w: 2.3, h: 13, label: 'MUX' },

    // PC
    { x: 10, y: 40, w: 2.3, h: 12, label: 'PC' },

    // Adder
    { x: 19.5, y: 15, w: 4.55, h: 15, label: 'Add' },

    // Instruction Memory 
    { x: 15.2, y: 44, w: 11.4, h: 25.5, label: 'IM' },

    // IF/ID pipeline 
    { x: 30.8, y: 11.3, w: 2.6, h: 83, label: 'IF/ID' },
    ];


const ID_COMPONENTS: AreaComponent[] = [
    // Registers
    { x: 37.5, y: 44,  w: 11.5,  h: 25, label: 'Registers' },

    // Imm Gen (Bit extender)
    { x: 44.5, y: 74,  w: 4, h: 14.3, label: 'IG' },

    // ID/EX pipeline 
    { x: 52.5, y: 11.3,  w: 2.6, h: 83, label: 'ID/EX' },
];

const EX_COMPONENTS: AreaComponent[] = [
    // MUX
    { x: 58.8, y: 56,  w: 2.3, h: 14, label: 'MUX' },

    // ALU 
    { x: 63.5, y: 46,  w: 6, h: 18, label: 'ALU' },

    // EX/MEM  pipeline
    { x: 72.3, y: 11.3,  w: 2.6, h: 83, label: 'EX/MEM' },

    // Store Bus (for store instructions)
    { x: 56, y: 73.4,  w: 16,  h: 0.5,  label: 'Store Bus' },
    { x: 55.8, y: 59,  w: 0.3,  h: 14.7,  label: 'Store Bus Head' },
];

const MEM_COMPONENTS: AreaComponent[] = [
  // Data memory
  { x: 77.8, y: 51.2,  w: 11.2, h: 25.5, label: 'Memory' },

  // MEM/WB  pipeline
  { x: 90.7, y: 11.3,  w: 2.6,  h: 83,   label: 'MEM/WB' },
];

const WB_COMPONENTS: AreaComponent[] = [
    // MUX 
    { x: 96, y: 55,  w: 2.5, h: 14, label: 'MUX' },
];


const ALL_COMPONENTS: AreaComponent[] = [
    ...IF_COMPONENTS,
    ...ID_COMPONENTS,
    ...EX_COMPONENTS,
    ...MEM_COMPONENTS,
    ...WB_COMPONENTS,
];

const GUIDE_COMPONENTS: AreaComponent[] =
  ALL_COMPONENTS.filter(c => c.label !== 'Store Bus' && c.label !== 'Store Bus Head');

type Half = 'left' | 'right' | 'both';

const letterForIndex = (i: number) => String.fromCharCode('A'.charCodeAt(0) + i);

// Distinct color per instruction index
const colorForIndex = (i: number) => {
  const hue = (i * 137.508) % 360; 
  return `hsl(${hue}deg 70% 50% / 0.55)`; 
};

const getAreaByLabel = (label: string, all: AreaComponent[]) =>
  all.find((a) => a.label === label);

type Props = {
    imageSrc?: string;
    showGuides?: boolean;
    maxWidthPx?: number;
};


const isStore = (opcode: number) => opcode >= 40 && opcode <= 43;



// Overlay functions for coloring, only UI 

// Returns base absolute positioning style for an AreaComponent 
function baseAreaStyle(a: AreaComponent, zIndex: number): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${a.x}%`,
    top: `${a.y}%`,
    width: `${a.w}%`,
    height: `${a.h}%`,
    pointerEvents: 'none',
    zIndex,
  };
}

// Creates a left half overlay block with a given background color
function leftHalfDiv(bg: string) {
  return (
    <div
      key="left"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '50%',
        height: '100%',
        background: bg,
        border: '1px solid rgba(0,0,0,0.25)',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Creates a right half overlay block with a given background color 
function rightHalfDiv(bg: string) {
  return (
    <div
      key="right"
      style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        width: '50%',
        height: '100%',
        background: bg,
        border: '1px solid rgba(0,0,0,0.25)',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Renders one overlay with half selection and a centered label 
function renderAreaOverlay(
  area: AreaComponent,
  half: Half,
  bg: string,
  zIndex: number,
  label: string,
  key: string,
) {
  const halves =
    half === 'both' ? [leftHalfDiv(bg), rightHalfDiv(bg)]
    : half === 'left' ? [leftHalfDiv(bg)]
    : [rightHalfDiv(bg)];

  return (
    <div key={key} style={baseAreaStyle(area, zIndex)}>
      {halves}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          color: 'black',
          textShadow: '0 1px 2px rgba(255,255,255,0.7)',
          fontSize: 'clamp(10px, 1.2vw, 16px)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

// Given (label, half) render overlays in order
function buildLabeledOverlays(
  allAreas: AreaComponent[],
  targets: Array<{ label: string; half: Half }>,
  bg: string,
  zIndex: number,
  label: string,
  keyPrefix: string,
) {
  const result: React.ReactNode[] = [];
  targets.forEach((t, idx) => {
    const area = getAreaByLabel(t.label, allAreas);
    if (!area) return;
    result.push(renderAreaOverlay(area, t.half, bg, zIndex, label, `${keyPrefix}-${t.label}-${idx}`));
  });
  return result;
}

// Given direct (area, half) render overlays in order.
function buildDirectOverlays(
  targets: Array<{ area?: AreaComponent; half: Half }>,
  bg: string,
  zIndex: number,
  label: string,
  keyPrefix: string,
) {
  const result: React.ReactNode[] = [];
  targets.forEach((t, idx) => {
    if (!t.area) return;
    result.push(renderAreaOverlay(t.area, t.half, bg, zIndex, label, `${keyPrefix}-${idx}`));
  });
  return result;
}


// IF stage 
function IfOverlays({ allAreas }: { allAreas: AreaComponent[] }) {
  const { instructions, instructionStages, registerUsage } = useSimulationState();
  const overlays: React.ReactNode[] = [];

  for (let i = 0; i < instructions.length; i++) {
    const usage = registerUsage[i];
    // Only LOAD or STORE in IF
    if (!usage || !(usage.isLoad || isStore(usage.opcode))) continue;
    if (instructionStages[i] !== 0) continue; // 0 = IF

    const label = letterForIndex(i);
    const bg = colorForIndex(i);

    const targets = [
      { label: 'MUX',   half: 'both' as Half },
      { label: 'PC',    half: 'both' as Half },
      { label: 'Add',   half: 'both' as Half },
      { label: 'IM',    half: 'right' as Half }, // Instruction Memory --> right
      { label: 'IF/ID', half: 'left'  as Half }, // IF/ID --> left
    ];

    overlays.push(
      ...buildLabeledOverlays(allAreas, targets, bg, 30, label, `IF-${i}`)
    );
  }

  return <>{overlays}</>;
}

function IdOverlays({ allAreas }: { allAreas: AreaComponent[] }) {
  const { instructions, instructionStages, registerUsage } = useSimulationState();
  const overlays: React.ReactNode[] = [];

  for (let i = 0; i < instructions.length; i++) {
    const usage = registerUsage[i];
    // Only LOAD or STORE in ID
    if (!usage || !(usage.isLoad || isStore(usage.opcode))) continue;
    if (instructionStages[i] !== 1) continue; // 1 = ID

    const label = letterForIndex(i);
    const bg = colorForIndex(i);

    const targets = [
      { label: 'IF/ID',     half: 'right' as Half }, // IF/ID --> right
      { label: 'Registers', half: 'right' as Half }, // Registers --> right
      { label: 'IG',        half: 'both'  as Half }, // Imm Gen --> both
      { label: 'ID/EX',     half: 'left'  as Half }, // ID/EX --> left
    ];

    overlays.push(
      ...buildLabeledOverlays(allAreas, targets, bg, 31, label, `ID-${i}`)
    );
  }

  return <>{overlays}</>;
}

function EXLoadOverlays() {
  const { instructions, instructionStages, registerUsage } = useSimulationState();
  const overlays: React.ReactNode[] = [];

  const find = (arr: AreaComponent[], lbl: string) => arr.find(a => a.label === lbl);

  for (let i = 0; i < instructions.length; i++) {
    const usage = registerUsage[i];
    if (!usage || !(usage.isLoad || isStore(usage.opcode))) continue;
    if (instructionStages[i] !== 2) continue; // 2 = EX

    const label = letterForIndex(i);
    const bg = colorForIndex(i);

    const targets = [
      { area: find(ID_COMPONENTS, 'ID/EX'),  half: 'right' as Half }, // ID/EX --> right
      { area: find(EX_COMPONENTS, 'MUX'),    half: 'both'  as Half }, // MUX (EX) --> both
      { area: find(EX_COMPONENTS, 'ALU'),    half: 'both'  as Half }, // ALU --> both
      { area: find(EX_COMPONENTS, 'EX/MEM'), half: 'left'  as Half }, // EX/MEM --> left
    ].filter(t => t.area);

    overlays.push(...buildDirectOverlays(targets, bg, 32, label, `EX-${i}`));

    // Red bus ONLY for store
    if (isStore(usage.opcode)) {
      const busLabels = ['Store Bus', 'Store Bus Head'];
      busLabels.forEach(lbl => {
        const b = EX_COMPONENTS.find(a => a.label === lbl);
        if (!b) return;
        overlays.push(
          <div
            key={`EX-bus-${label}-${lbl}`}
            style={{
              ...baseAreaStyle(b, 43),
              background: 'hsl(0 85% 50% / 0.6)',
              boxShadow: '0 0 4px rgba(0,0,0,0.25)',
            }}
          />
        );
      });
    }
  }

  return <>{overlays}</>;
}

function MEMOverlays({ allAreas }: { allAreas: AreaComponent[] }) {
  const { instructions, instructionStages, registerUsage } = useSimulationState();
  const overlays: React.ReactNode[] = [];
  const get = (label: string) => allAreas.find(a => a.label === label);

  for (let i = 0; i < instructions.length; i++) {
    const usage = registerUsage[i];
    if (!usage || !(usage.isLoad || isStore(usage.opcode))) continue;
    if (instructionStages[i] !== 3) continue; // 3 = MEM

    const label = letterForIndex(i);
    const bg = colorForIndex(i);

    // LOAD:  EX/MEM --> right, Memory --> right, MEM/WB --> left
    // STORE: EX/MEM --> right, Memory --> left,  (no MEM/WB)
    const targets: Array<{ area?: AreaComponent; half: Half }> = [
      { area: get('EX/MEM'), half: 'right' },
      { area: get('Memory'), half: usage.isLoad ? 'right' : 'left' },
      ...(usage.isLoad ? [{ area: get('MEM/WB'), half: 'left' as Half }] : []),
    ];

    overlays.push(
      ...buildDirectOverlays(targets, bg, 33, label, `MEM-${i}`)
    );
  }

  return <>{overlays}</>;
}

function WBLoadOverlays({ allAreas }: { allAreas: AreaComponent[] }) {
  const { instructions, instructionStages, registerUsage } = useSimulationState();
  const overlays: React.ReactNode[] = [];
  const get = (label: string) => allAreas.find(a => a.label === label);
  const wbMux = WB_COMPONENTS.find(a => a.label === 'MUX');

  for (let i = 0; i < instructions.length; i++) {
    const usage = registerUsage[i];
    if (!usage || !usage.isLoad) continue;    // LOAD only in WB
    if (instructionStages[i] !== 4) continue; // 4 = WB

    const label = letterForIndex(i);
    const bg = colorForIndex(i);

    const targets: Array<{ area?: AreaComponent; half: Half }> = [
      { area: get('Registers'), half: 'left'  }, // Registers --> left
      { area: get('MEM/WB'),    half: 'right' }, // MEM/WB --> right
      { area: wbMux,            half: 'both'  }, // MUX --> full
    ];

    overlays.push(
      ...buildDirectOverlays(targets, bg, 34, label, `WB-${i}`)
    );
  }

  return <>{overlays}</>;
}

export default function GraphicPipelineVisualization({
    imageSrc = '/datapath.jpg',
    showGuides = true, 
    maxWidthPx = 1200,
    }: Props) {
    return (
        <div
        className="relative w-full mx-auto"
        style={{ maxWidth: maxWidthPx }}
        >
        <Image
          src={imageSrc || datapath}          
          alt="MIPS datapath"
          className="w-full h-auto block select-none"
          priority
          draggable={false}
          width={1200}
          height={744} 
        />
        {showGuides &&
        GUIDE_COMPONENTS.map((a, i) => (
            <div
            key={`ifc-${i}`}
            className="absolute border border-dashed border-rose-500/70 rounded-md"
            style={{
                left: `${a.x}%`,
                top: `${a.y}%`,
                width: `${a.w}%`,
                height: `${a.h}%`,
            }}
            title={a.label}
            >
            <div className="absolute -top-6 left-0 text-xs font-semibold text-rose-700 bg-rose-100/80 px-2 py-0.5 rounded">
                {a.label}
            </div>
            </div>
        ))}
        <IfOverlays allAreas={ALL_COMPONENTS} />
        <IdOverlays allAreas={ALL_COMPONENTS} />
        <EXLoadOverlays />
        <MEMOverlays allAreas={ALL_COMPONENTS} />
        <WBLoadOverlays allAreas={ALL_COMPONENTS} />
    </div>
  );
}