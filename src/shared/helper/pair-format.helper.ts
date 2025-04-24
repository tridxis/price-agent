
export class PairFormatHelper {
    static formatPair(pair: string): Promise<string> {
        const upperPair = pair.toUpperCase();
        const pairSpecial = {
            'KBONK': 'kBONK',
            'KPEPE': 'kPEPE',
            'KSHIB': 'kSHIB',
            'KNEIRO': 'kNEIRO',
            'KFLOKI': 'kFLOKI',
            'KLUNC': 'kLUNC',
            'KDOGS': 'kDOGS',
        };
    
        return pairSpecial[upperPair] || upperPair;
    }
}
