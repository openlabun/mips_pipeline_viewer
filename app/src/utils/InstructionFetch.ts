type Instruction={
    instruction: string;
};

type RtypeInstruction= Instruction & {
    rs: string;
    rt: string;
    rd: string;
    RegWrite: boolean;
};

type AddiInstruction = Instruction & {
    rs: string;
    rd: string;
    RegWrite: boolean;
};

type LoadInstruction = Instruction & {
    rs: string;
    rd: string;
    RegWrite: boolean;
};

type StoreInstruction = Instruction & {
    rs: string;
    rt: string;
    RegWrite: boolean;
};

type BranchInstruction = Instruction & {
    RegWrite: boolean;
};

type JumpInstruction = Instruction & {
    RegWrite: boolean;
}

type StallInstruction = Instruction & {
    RegWrite: boolean;
};

function hexToBinary(hex:string): string {
    let binary = '';
    for (let i = 0; i < hex.length; i++) {
        let bin = parseInt(hex[i], 16).toString(2);
        binary += bin.padStart(4, '0');
    }
    return binary;
}

function BinaryToInstruction(binary: string): Instruction | null {
    const opcode = binary.slice(0, 6);
    switch(opcode){
        case '000000': //add
            return {
                instruction: 'R-type',
                rs: binary.slice(6, 11),
                rt: binary.slice(11, 16),
                rd: binary.slice(16, 21),
                RegWrite: true
            } as RtypeInstruction;
        case '001000': //addi
            return {
                instruction: 'Addi',
                rs: binary.slice(6, 11),
                rd: binary.slice(11, 16),
                RegWrite: true
            } as AddiInstruction;

        case '100011': //lw
            return {
                instruction: 'Load',
                rs: binary.slice(6, 11),
                rd: binary.slice(11, 16),
                RegWrite: true
            } as LoadInstruction;

        case '101011': //sw
            return {
                instruction: 'Store',
                rs: binary.slice(6, 11),
                rt: binary.slice(11, 16),
                RegWrite: false
            } as StoreInstruction;
        
        case '000100': //beq
            return {
                instruction: 'Branch',
                RegWrite: false
            } as BranchInstruction;

        case '000010': //j
            return {
                instruction: 'Jump',
                RegWrite: false
            } as JumpInstruction;
            
        default:
            return null;
    }
}

export {hexToBinary, BinaryToInstruction}
export type FetchInstruction = Instruction | RtypeInstruction | AddiInstruction | LoadInstruction | StoreInstruction | BranchInstruction | JumpInstruction | StallInstruction;  