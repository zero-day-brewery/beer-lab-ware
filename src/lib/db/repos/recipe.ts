import { type Recipe, RecipeSchema } from '@/lib/brewing/types/recipe'
import { type BrewDB, db } from '@/lib/db/schema'

export function makeRecipeRepo(database: BrewDB) {
  return {
    async get(id: string): Promise<Recipe | null> {
      const row = await database.recipes.get(id)
      return row ? RecipeSchema.parse(row) : null
    },
    async list(): Promise<Recipe[]> {
      const rows = await database.recipes.orderBy('updatedAt').reverse().toArray()
      return rows.map((r) => RecipeSchema.parse(r))
    },
    async save(r: Recipe): Promise<Recipe> {
      const stamped = { ...r, updatedAt: new Date().toISOString() }
      const validated = RecipeSchema.parse(stamped)
      await database.recipes.put(validated)
      return validated
    },
    async delete(id: string): Promise<void> {
      const deletedAt = new Date().toISOString()
      await database.transaction('rw', database.recipes, database.rowTombstones, async () => {
        await database.recipes.delete(id)
        await database.rowTombstones.put({ id, table: 'recipes', deletedAt })
      })
    },
    liveList: () => database.recipes.orderBy('updatedAt').reverse().toArray(),
  }
}

export const recipeRepo = makeRecipeRepo(db)
