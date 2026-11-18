/**
 * kubectl context indicator for the OpenCode TUI.
 *
 * Reads the kubeconfig files the way kubectl does (KUBECONFIG in order, else
 * ~/.kube/config), shows the current context in the footer, and follows the
 * file so `kubectl config use-context` shows up without a restart.
 * Read-only: it never writes to your kubeconfig.
 */
import { watch, type FSWatcher } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path"
import { Show, createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"

interface Snapshot {
  readonly context: string
  readonly source: string
}

const GLYPH = "\u2388"

function expandPath(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return join(homedir(), value.slice(2))
  return isAbsolute(value) ? value : resolve(value)
}

function kubeconfigFiles(): string[] {
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

function scalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed[0]!
    const end = trimmed.indexOf(quote, 1)
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end)
  }
  const comment = trimmed.indexOf(" #")
  return (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim()
}

/** kubectl merges KUBECONFIG files in order and the first non-empty value wins. */
function currentContext(text: string): string | undefined {
  for (const line of text.split("\n")) {
    if (!line.startsWith("current-context:")) continue
    const value = scalar(line.slice("current-context:".length))
    return value.length > 0 ? value : undefined
  }
  return undefined
}

async function readContext(): Promise<Snapshot | undefined> {
  for (const file of kubeconfigFiles()) {
    let text: string
    try {
      text = await readFile(file, "utf8")
    } catch {
      continue
    }
    const context = currentContext(text)
    if (context) return { context, source: file }
  }
  return undefined
}

/** EKS contexts are full ARNs; only the cluster name is worth showing. */
function display(context: string): string {
  const name = context.replace(/^arn:aws[^:]*:eks:[^:]*:\d+:cluster\//, "")
  if (name.length <= 36) return name
  return `${name.slice(0, 20)}…${name.slice(-15)}`
}

function tone(context: string): "danger" | "warning" | undefined {
  const name = context.toLowerCase()
  if (/(^|[^a-z])(prod|production|prd)([^a-z]|$)/.test(name)) return "danger"
  if (/(^|[^a-z])(stg|stage|staging|preprod|uat)([^a-z]|$)/.test(name)) return "warning"
  return undefined
}

/** Watch the kubeconfig directories, so a context change is picked up at once. */
function watchFiles(onChange: () => void): () => void {
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

export default Plugin.define({
  id: "kube-context",
  async setup(context) {
    const [current, setCurrent] = createSignal<Snapshot | undefined>(await readContext())
    let disposed = false

    const stopWatching = watchFiles(() => {
      void readContext().then((next) => {
        if (!disposed) setCurrent(next)
      })
    })

    const color = () => {
      const snapshot = current()
      if (!snapshot) return context.theme.text.muted
      switch (tone(snapshot.context)) {
        case "danger":
          return context.theme.text.feedback.error.base
        case "warning":
          return context.theme.text.feedback.warning.base
        default:
          return context.theme.text.muted
      }
    }

    function Badge() {
      return (
        <Show when={current()}>
          {(snapshot) => <text fg={color()}>{`${GLYPH} ${display(snapshot().context)}`}</text>}
        </Show>
      )
    }

    const release = [
      context.ui.slot({ append: "prompt.footer.status", render: () => <Badge /> }),
      context.ui.slot({ append: "home.footer.status", render: () => <Badge /> }),
    ]

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "kube-context.show",
          title: "Kubernetes: kubectl context",
          group: "Kubernetes",
          palette: true,
          slash: { name: "kube" },
          run: async () => {
            const snapshot = await readContext()
            await context.ui.dialog.alert({
              title: "kubectl context",
              message: snapshot
                ? `${snapshot.context}\n\nkubeconfig: ${snapshot.source}`
                : `No current context set.\n\nChecked: ${kubeconfigFiles().join(", ")}`,
            })
          },
        },
      ],
    }))

    return () => {
      disposed = true
      stopWatching()
      for (const unregister of release) unregister()
    }
  },
})
