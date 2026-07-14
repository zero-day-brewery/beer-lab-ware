const L_PER_GAL = 3.785411784

export const galToL = (gal: number): number => gal * L_PER_GAL
export const lToGal = (l: number): number => l / L_PER_GAL
export const lToMl = (l: number): number => l * 1000
export const mlToL = (ml: number): number => ml / 1000
