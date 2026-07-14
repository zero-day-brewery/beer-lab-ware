// Nominal (branded) types — prevent unit mixups at compile time.
// At runtime, all values are just numbers.

declare const __brand: unique symbol

type Brand<T, B> = T & { readonly [__brand]: B }

export type Liters = Brand<number, 'Liters'>
export type Milliliters = Brand<number, 'Milliliters'>
export type Kilograms = Brand<number, 'Kilograms'>
export type Grams = Brand<number, 'Grams'>
export type Celsius = Brand<number, 'Celsius'>
export type Minutes = Brand<number, 'Minutes'>
export type Percentage = Brand<number, 'Percentage'> // 0-100, not 0-1
export type SG = Brand<number, 'SG'> // specific gravity, e.g. 1.052
export type Plato = Brand<number, 'Plato'>
export type IBU = Brand<number, 'IBU'>
export type SRM = Brand<number, 'SRM'>

export const liters = (n: number): Liters => n as Liters
export const milliliters = (n: number): Milliliters => n as Milliliters
export const kilograms = (n: number): Kilograms => n as Kilograms
export const grams = (n: number): Grams => n as Grams
export const celsius = (n: number): Celsius => n as Celsius
export const minutes = (n: number): Minutes => n as Minutes
export const percentage = (n: number): Percentage => n as Percentage
export const sg = (n: number): SG => n as SG
export const plato = (n: number): Plato => n as Plato
export const ibu = (n: number): IBU => n as IBU
export const srm = (n: number): SRM => n as SRM
