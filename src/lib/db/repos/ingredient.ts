import { type Ingredient, IngredientAnySchema } from '@/lib/brewing/types/ingredient'
import { type BrewDB, db } from '@/lib/db/schema'

type Kind = Ingredient['kind']

export function makeIngredientRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<Ingredient | null> {
      const row = await database.ingredients.get(id)
      return row ? (IngredientAnySchema.parse(row) as Ingredient) : null
    },
    async list(): Promise<Ingredient[]> {
      const rows = await database.ingredients.orderBy('name').toArray()
      return rows.map((r) => IngredientAnySchema.parse(r) as Ingredient)
    },
    async listByKind(kind: Kind): Promise<Ingredient[]> {
      const rows = await database.ingredients.where('kind').equals(kind).sortBy('name')
      return rows.map((r) => IngredientAnySchema.parse(r) as Ingredient)
    },
    async search(kind: Kind, prefix: string): Promise<Ingredient[]> {
      const lower = prefix.toLowerCase()
      const rows = await database.ingredients
        .where('kind')
        .equals(kind)
        .filter((i) => i.name.toLowerCase().startsWith(lower))
        .toArray()
      return rows.map((r) => IngredientAnySchema.parse(r) as Ingredient)
    },
    async save(i: Ingredient): Promise<Ingredient> {
      const validated = IngredientAnySchema.parse(i) as Ingredient
      await database.ingredients.put(validated)
      return validated
    },
    async delete(id: string): Promise<void> {
      await database.ingredients.delete(id)
    },
  }
}

export const ingredientRepo = makeIngredientRepo(db)
