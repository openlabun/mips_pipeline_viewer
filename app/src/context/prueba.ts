// Definición de los posibles estados de una etapa del pipeline
type PipelineStage = "IF" | "ID" | "EX" | "MEM" | "WB" | "STALL" | "";
interface InstructionMeta {
    type: "R" | "I" | "J";
    raw: string;
    opcode: string;
    name: string;
    readsFrom: string[];
    writesTo?: string;
    rs?: string;
    rt?: string;
    rd?: string;
}
function hexToBinary(hex: string): string {
    return parseInt(hex, 16).toString(2).padStart(32, '0');
}
function analyzeInstruction(hex: string): InstructionMeta {
    const binary = hexToBinary(hex);
    const opcode = binary.slice(0, 6);

    const opcodeMap = {
        "001000": "addi",
        "001001": "addiu",
        "001100": "andi",
        "000100": "beq",
        "000101": "bne",
        "000010": "j",
        "000011": "jal",
        "100100": "lbu",
        "100101": "lhu",
        "110000": "ll",
        "001111": "lui",
        "100011": "lw",
        "001101": "ori",
        "001010": "slti",
        "001011": "sltiu",
        "101000": "sb",
        "111000": "sc",
        "101001": "sh",
        "101011": "sw",
        "000000": "R"
    };

    const funcMap = {
        "100000": "add",
        "100001": "addu",
        "100100": "and",
        "001000": "jr",
        "100111": "nor",
        "100101": "or",
        "101010": "slt",
        "101011": "sltu",
        "000000": "sll",
        "000010": "srl",
        "100010": "sub",
        "100011": "subu"
    };

    const regMap = {
        "00000": "zero", "00001": "at", "00010": "v0", "00011": "v1",
        "00100": "a0", "00101": "a1", "00110": "a2", "00111": "a3",
        "01000": "t0", "01001": "t1", "01010": "t2", "01011": "t3",
        "01100": "t4", "01101": "t5", "01110": "t6", "01111": "t7",
        "10000": "s0", "10001": "s1", "10010": "s2", "10011": "s3",
        "10100": "s4", "10101": "s5", "10110": "s6", "10111": "s7",
        "11000": "t8", "11001": "t9", "11010": "k0", "11011": "k1",
        "11100": "gp", "11101": "sp", "11110": "fp", "11111": "ra"
    };

    const meta: InstructionMeta = {
        type: "I",
        raw: hex,
        opcode,
        name: "",
        readsFrom: [],
    };

    const name = opcodeMap[opcode as keyof typeof opcodeMap] || "unknown";
    meta.name = name;

    if (opcode === "000000") {
        // R-type
        meta.type = "R";
        const rsBin = binary.slice(6, 11);
        const rtBin = binary.slice(11, 16);
        const rdBin = binary.slice(16, 21);
        const shamt = binary.slice(21, 26);
        const func = binary.slice(26, 32);
        const funcName = funcMap[func as keyof typeof funcMap] || "unknown";
        meta.name = funcName;

        const rs = regMap[rsBin as keyof typeof regMap];
        const rt = regMap[rtBin as keyof typeof regMap];
        const rd = regMap[rdBin as keyof typeof regMap];

        meta.rs = rs;
        meta.rt = rt;
        meta.rd = rd;

        if (funcName === "sll" || funcName === "srl") {
            meta.readsFrom = [rt];
        } else if (funcName === "jr") {
            meta.readsFrom = [rs];
        } else {
            meta.readsFrom = [rs, rt];
        }

        if (funcName !== "jr") {
            meta.writesTo = rd;
        }
    } else if (["lw", "lbu", "lhu", "ll"].includes(name)) {
        const rs = regMap[binary.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rs = rs;
        meta.rt = rt;
        meta.readsFrom = [rs];
        meta.writesTo = rt;
    } else if (["sw", "sb", "sh", "sc"].includes(name)) {
        const rs = regMap[binary.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rs = rs;
        meta.rt = rt;
        meta.readsFrom = [rs, rt];
    } else if (["beq", "bne"].includes(name)) {
        const rs = regMap[binary.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rs = rs;
        meta.rt = rt;
        meta.readsFrom = [rs, rt];
    } else if (["addi", "addiu", "andi", "ori", "slti", "sltiu"].includes(name)) {
        const rs = regMap[binary.slice(6, 11) as keyof typeof regMap];
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rs = rs;
        meta.rt = rt;
        meta.readsFrom = [rs];
        meta.writesTo = rt;
    } else if (name === "lui") {
        const rt = regMap[binary.slice(11, 16) as keyof typeof regMap];
        meta.rt = rt;
        meta.readsFrom = [];
        meta.writesTo = rt;
    }

    return meta;
}
function printPipelineTable(matrix: PipelineStage[][]) {
    // Encabezado con números de ciclo
    const header = ["  ",...matrix[0].map((_, i) => i.toString())];
    console.log(header.join("\t"));

    // Filas con instrucciones
    matrix.forEach((row, i) => {
        const rowStr = [`I${i+1}`, ...row.map(stage => stage || "-")].join("\t");
        console.log(rowStr);
    });
}

// Función que simula el pipeline con manejo de stalls (paradas)
function simulatePipelineWithStall(hexInstructions: string[]): PipelineStage[][] {
    const limit: number = 15;
    const STAGES: PipelineStage[] = ["IF", "ID", "EX", "MEM", "WB"];
    const n = hexInstructions.length;
    let mats: PipelineStage[][] = [];
    for (let i = 0; i < n; i++) {
        mats.push([]);
    }
    let currentState: {[key: string]: string} = {"IF": "", "ID":"", "EX":"", "MEM":"", "WB":""} ;
    const analyzed = hexInstructions.map(analyzeInstruction);

    //console.log(analyzed)
    let cycle: number = 0;
    let inst: number = 0;
    while (true){
        let isStall: boolean = false
        // Se verifica si va haber Stall en el siguiente estado
        if (currentState["ID"] !== "" && currentState["EX"] !== "" ){
            let ID: string[] = analyzed[Number(currentState["ID"])]["readsFrom"];
            let EX: string | undefined = analyzed[Number(currentState["EX"])].writesTo;
            if (typeof EX === "string" && ID.includes(EX)){
                isStall = true;
            }
        }
        if (currentState["ID"] !== "" && currentState["MEM"] !== "" ){
            let ID: string[] = analyzed[Number(currentState["ID"])]["readsFrom"];
            let MEM: string | undefined = analyzed[Number(currentState["MEM"])].writesTo;
            if (typeof MEM === "string" && ID.includes(MEM)){
                isStall = true;
            }
        }
        // Si no hay Stall todas las fases cambian de estado
        if(!isStall){
            for (let i = STAGES.length-1; i >= 0; i--) {
                if (i == 0) {
                    if (inst < n ){
                        currentState[STAGES[i]] = String(inst);
                        inst++
                    }else{
                        currentState[STAGES[i]] = "";
                    }
                    
                }else{
                    currentState[STAGES[i]] = currentState[STAGES[i-1]]
                }
            }
            for (let i = 0; i < mats.length; i++){
                let agg = ""
                for (const llave in currentState){
                    if (currentState[llave] !== "" && Number(currentState[llave]) === i) {
                        agg = llave;
                    }
                }
                mats[i].push(agg as PipelineStage)
            }
        }else{ // Si hay Stall solo se deja que avance EX Y MEM
            for (let i = STAGES.length-1; i >= 1; i--) {
                if (i == 2) {
                    currentState[STAGES[i]] = "";
                }
                if(i>2){
                    currentState[STAGES[i]] = currentState[STAGES[i-1]]
                }
            }
            for (let i = 0; i < mats.length; i++){
                let agg = ""
                for (const llave in currentState){
                    if (currentState[llave] !== "" && Number(currentState[llave]) === i){
                        if (llave == "IF" || llave == "ID") {
                            agg = "STALL";
                        }else{
                            agg = llave;
                        }
                    }
                }
                mats[i].push(agg as PipelineStage)
            }
        }
        console.log(currentState, inst-1, isStall,cycle)
        if (Number(currentState["WB"]) === n-1){
            break
        }
        cycle++;
    }
    return mats;
}

function main (){
    const inst: string[]  = ["20080005","20090003","01095020","01485822","8D6C0000"];
    const pipeline = simulatePipelineWithStall(inst);
    //console.log(pipeline)
    printPipelineTable(pipeline);
}
main()