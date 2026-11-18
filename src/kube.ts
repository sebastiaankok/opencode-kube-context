/**
 * Kubeconfig reading for the TUI badge.
 *
 * Reads the files kubectl does (KUBECONFIG in order, else ~/.kube/config),
 * follows the first-non-empty-wins rule for `current-context`, and looks up
 * that context's namespace. Read-only: it never writes to the kubeconfig.
 */
import { watch, type FSWatcher } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path"

export interface Snapshot {
  readonly context: string
  readonly namespace: string
  readonly source: string
}

export interface ConfigFile {
  readonly path: string
  readonly text: string
}

export function expandPath(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return join(homedir(), value.slice(2))
  return isAbsolute(value) ? value : resolve(value)
}

export function kubeconfigFiles(): string[] {
  const raw = process.env.KUBECONFIG?.trim()
  const files = raw
    ? raw
        .split(delimiter)
        .map((part) => part.trim())
        .filter(Boolean)
        .map(expandPath)
    : []
  return files.length > 0 ? files : [join(homedir(), ".kube", "config")]
}

export function scalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0]!
    const end = trimmed.indexOf(quote, 1)
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end)
  }
  const comment = trimmed.indexOf(" #")
  return (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim()
}

/** Strip terminal control characters and collapse whitespace for display. */
export function clean(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** kubectl merges KUBECONFIG files in order and the first non-empty value wins. */
export function currentContext(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("current-context:")) continue
    const value = clean(scalar(line.slice("current-context:".length)))
    return value.length > 0 ? value : undefined
  }
  return undefined
}

function namespaceValue(value: string): string | undefined {
  const parsed = clean(scalar(value))
  if (parsed.length === 0 || parsed === "~" || parsed.toLowerCase() === "null") return undefined
  return parsed
}

const KEY_VALUE = /^(\s*)([A-Za-z0-9_.-]+):(?:\s+(.*))?$/
const LIST_ITEM = /^(\s*)-(?:\s+(.*))?$/
const TOP_LEVEL_KEY = /^[^\s#-][^:]*:/

/**
 * Map context name to its namespace for one kubeconfig file.
 *
 * This is a deliberately small reader for the `contexts:` list, not a general
 * YAML parser. kubectl, the cloud CLIs and `kubectl config set-context` all
 * write the block layout it expects. Anything it does not understand falls
 * back to the default namespace.
 */
export function contextNamespaces(text: string): Map<string, string | undefined> {
  const contexts = new Map<string, string | undefined>()
  let inContexts = false
  let item: { name?: string; namespace?: string } | undefined
  let keyIndent = 0
  let contextIndent: number | undefined

  const flush = () => {
    if (item?.name) {
      if (!contexts.has(item.name)) {
        contexts.set(item.name, item.namespace)
      } else if (contexts.get(item.name) === undefined && item.namespace !== undefined) {
        contexts.set(item.name, item.namespace)
      }
    }
    item = undefined
    contextIndent = undefined
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "")
    if (!inContexts) {
      if (/^contexts:\s*(?:#.*)?$/.test(line)) inContexts = true
      continue
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue
    if (line === "---" || line === "...") {
      flush()
      break
    }
    if (TOP_LEVEL_KEY.test(line)) {
      flush()
      break
    }

    const list = LIST_ITEM.exec(line)
    if (list) {
      flush()
      item = {}
      const dash = line.indexOf("-")
      const after = line.slice(dash + 1)
      keyIndent = dash + 1 + (after.length - after.trimStart().length)
      const tail = after.trim()
      if (tail.startsWith("context:")) {
        contextIndent = keyIndent
        const inline = tail.slice("context:".length).trim()
        const match = /^\{.*\bnamespace:\s*(.+?)(?:,|})/.exec(inline)
        if (match) item.namespace = namespaceValue(match[1]!)
      } else {
        const kv = KEY_VALUE.exec(tail)
        if (kv?.[2] === "name") item.name = clean(scalar(kv[3] ?? ""))
      }
      continue
    }

    const kv = KEY_VALUE.exec(line)
    if (!kv || !item) continue
    const indent = kv[1]!.length
    const key = kv[2]!
    const value = kv[3] ?? ""
    if (key === "name" && indent === keyIndent) {
      item.name = clean(scalar(value))
    } else if (key === "context" && indent === keyIndent) {
      contextIndent = indent
    } else if (key === "namespace" && contextIndent !== undefined && indent > contextIndent) {
      item.namespace = namespaceValue(value)
    }
  }
  flush()
  return contexts
}

export function snapshotFrom(files: readonly ConfigFile[]): Snapshot | undefined {
  let context: string | undefined
  let source: string | undefined
  for (const file of files) {
    const value = currentContext(file.text)
    if (value) {
      context = value
      source = file.path
      break
    }
  }
  if (!context || !source) return undefined

  let namespace: string | undefined
  for (const file of files) {
    const contexts = contextNamespaces(file.text)
    if (!contexts.has(context)) continue
    namespace = contexts.get(context)
    break
  }
  return { context, namespace: namespace ?? "default", source }
}

export async function readContext(): Promise<Snapshot | undefined> {
  const files: ConfigFile[] = []
  for (const file of kubeconfigFiles()) {
    try {
      files.push({ path: file, text: await readFile(file, "utf8") })
    } catch {
      continue
    }
  }
  return snapshotFrom(files)
}

/** EKS contexts are full ARNs; only the cluster name is worth showing. */
export function display(context: string): string {
  const name = clean(context).replace(/^arn:aws[^:]*:eks:[^:]*:\d+:cluster\//, "")
  if (name.length <= 36) return name
  return `${name.slice(0, 20)}…${name.slice(-15)}`
}

export function displayNamespace(namespace: string): string {
  const name = clean(namespace)
  if (name.length <= 24) return name
  return `${name.slice(0, 12)}…${name.slice(-11)}`
}

export function tone(context: string): "danger" | "warning" | undefined {
  const name = context.toLowerCase()
  if (/(^|[^a-z])(prod|production|prd)([^a-z]|$)/.test(name)) return "danger"
  if (/(^|[^a-z])(stg|stage|staging|preprod|uat)([^a-z]|$)/.test(name)) return "warning"
  return undefined
}

/** Watch the kubeconfig directories, so a context change is picked up at once. */
export function watchFiles(onChange: () => void): () => void {
  const watchers: FSWatcher[] = []
  const watched = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const notify = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 100)
  }

  for (const file of kubeconfigFiles()) {
    const directory = dirname(file)
    const name = basename(file)
    if (watched.has(directory)) continue
    watched.add(directory)
    try {
      watchers.push(
        watch(directory, { persistent: false }, (_event, changed) => {
          if (!changed || changed.toString() === name) notify()
        }),
      )
    } catch {
      // No such directory: there is nothing to watch until it exists.
    }
  }

  return () => {
    if (timer) clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}
