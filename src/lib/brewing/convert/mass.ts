const KG_PER_LB = 0.45359237
const G_PER_OZ = 28.349523125

export const lbToKg = (lb: number): number => lb * KG_PER_LB
export const kgToLb = (kg: number): number => kg / KG_PER_LB
export const ozToG = (oz: number): number => oz * G_PER_OZ
export const gToOz = (g: number): number => g / G_PER_OZ
