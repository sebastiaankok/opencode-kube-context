import { display, tone } from "./kube"

export interface ColorMatch {
  readonly color: string
  readonly rule?: string
  readonly ignored: readonly string[]
}

function parseRules(options: unknown): { rules: Array<[string, string]>; ignored: string[] } {
  if (!options || typeof options !== "object") return { rules: [], ignored: [] }
  const colors = (options as { colors?: unknown }).colors
  if (colors === undefined) return { rules: [], ignored: [] }
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) {
    return { rules: [], ignored: ["colors"] }
  }

  const rules: Array<[string, string]> = []
  const ignored: string[] = []
  for (const [pattern, value] of Object.entries(colors)) {
    const color = normalize(value)
    if (color) rules.push([pattern, color])
    else ignored.push(pattern)
  }
  return { rules, ignored }
}

const NAMED = new Set(["red", "orange", "yellow", "green", "cyan", "blue", "purple", "gray", "muted"])
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function normalize(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const color = value.trim().toLowerCase()
  if (NAMED.has(color) || HEX.test(color)) return color
  return undefined
}

function isExact(pattern: string, context: string): boolean {
  const wanted = pattern.toLowerCase()
  const shown = display(context)
  return wanted === context.toLowerCase() || wanted === shown.toLowerCase()
}

function isWildcardMatch(pattern: string, context: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  const regex = new RegExp(`^${source}$`, "i")
  return regex.test(context) || regex.test(display(context))
}

/**
 * Pick the badge colour for a context.
 *
 * Without configuration, the existing prod/staging detection applies. User
 * rules layer on top of it: exact names win over the built-in tones, and
 * wildcard rules only cover contexts the built-ins do not classify.
 */
export function resolveColor(context: string, options: unknown): ColorMatch {
  const parsed = parseRules(options)

  for (const [pattern, color] of parsed.rules) {
    if (pattern.includes("*")) continue
    if (isExact(pattern, context)) return { color, rule: pattern, ignored: parsed.ignored }
  }

  switch (tone(context)) {
    case "danger":
      return { color: "red", ignored: parsed.ignored }
    case "warning":
      return { color: "yellow", ignored: parsed.ignored }
  }

  for (const [pattern, color] of parsed.rules) {
    if (!pattern.includes("*")) continue
    if (isWildcardMatch(pattern, context)) return { color, rule: pattern, ignored: parsed.ignored }
  }

  return { color: "muted", ignored: parsed.ignored }
}
