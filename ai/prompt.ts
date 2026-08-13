import { Category, Field, Project } from "@/prisma/client"

// Per-field prompt text is user-controlled. Cap each value so a single
// misconfigured (or malicious) Field/Project/Category can't inject a huge
// block of text into the prompt (cost abuse / prompt injection surface).
const MAX_FIELD_PROMPT_CHARS = 2000
const MAX_PROMPT_CHARS = 200_000

function trim(value: string | null | undefined): string {
  if (!value) return ""
  if (value.length <= MAX_FIELD_PROMPT_CHARS) return value
  return value.slice(0, MAX_FIELD_PROMPT_CHARS) + "…"
}

export function buildLLMPrompt(
  promptTemplate: string,
  fields: Field[],
  categories: Category[] = [],
  projects: Project[] = []
) {
  let prompt = promptTemplate

  prompt = prompt.replace(
    "{fields}",
    fields
      .filter((field) => field.llm_prompt)
      .map((field) => `- ${field.code}: ${trim(field.llm_prompt)}`)
      .join("\n")
  )

  prompt = prompt.replace(
    "{categories}",
    categories
      .filter((category) => category.llm_prompt)
      .map((category) => `- ${category.code}: for ${trim(category.llm_prompt)}`)
      .join("\n")
  )

  prompt = prompt.replace(
    "{projects}",
    projects
      .filter((project) => project.llm_prompt)
      .map((project) => `- ${project.code}: for ${trim(project.llm_prompt)}`)
      .join("\n")
  )

  prompt = prompt.replace("{categories.code}", categories.map((category) => `${category.code}`).join(", "))
  prompt = prompt.replace("{projects.code}", projects.map((project) => `${project.code}`).join(", "))

  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS)
  }
  return prompt
}
