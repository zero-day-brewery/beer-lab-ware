'use client'
import { type KeyboardEvent, useState } from 'react'
import { useController, useFormContext } from 'react-hook-form'
import type { Recipe } from '@/lib/brewing/types/recipe'

/**
 * Controlled tag editor for the recipe form. `tags` is `string[]`, so it can't
 * ride a plain `register` — it's wired through `useController` (mirrors the
 * Style/Equipment picker precedent). Enter or comma commits the draft as a
 * trimmed, de-duped, non-empty chip; each chip has a remove ✕; Backspace on an
 * empty field pops the last chip.
 */
export function RecipeTagsField() {
  const { control } = useFormContext<Recipe>()
  const { field } = useController({ control, name: 'tags' })
  const tags = field.value ?? []
  const [draft, setDraft] = useState('')

  const addTag = (raw: string) => {
    const tag = raw.trim()
    setDraft('')
    if (!tag || tags.includes(tag)) return
    field.onChange([...tags, tag])
  }

  const removeTag = (tag: string) => {
    field.onChange(tags.filter((t) => t !== tag))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(draft)
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">Tags</span>
      {tags.length > 0 && (
        <div className="chip-row">
          {tags.map((tag) => (
            <span key={tag} className="flow-chip inline-flex items-center gap-1">
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="opacity-70 transition hover:opacity-100"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          // Support paste that ends in a comma; live typing of a comma is handled
          // in onKeyDown (which preventDefaults before the char lands).
          const v = e.target.value
          if (v.endsWith(',')) addTag(v.slice(0, -1))
          else setDraft(v)
        }}
        onKeyDown={onKeyDown}
        placeholder="Add a tag and press Enter…"
        aria-label="Add a tag"
        className="rounded border border-input bg-background px-2 py-1.5 text-sm"
      />
    </label>
  )
}
