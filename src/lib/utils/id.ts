import { validate as uuidValidate, v4 as uuidv4 } from 'uuid'

export const newId = (): string => uuidv4()
export const isUUID = (s: string): boolean => uuidValidate(s)
