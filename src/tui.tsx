/**
 * kubectl context indicator for the OpenCode TUI.
 *
 * Shows the active context and its default namespace in the footer, and
 * follows the kubeconfig so `kubectl config use-context` (or `kubectx`) shows
 * up without a restart. Read-only: it never writes to your kubeconfig.
 */
import { Show, createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { RGBA } from "@opentui/core"
import {
  clean,
  display,
  displayNamespace,
  kubeconfigFiles,
  readContext,
  watchFiles,
  type Snapshot,
} from "./kube"
import { resolveColor } from "./colors"

const GLYPH = "\u2388"

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

    const hue = (name: string): RGBA => {
      const scale = (context.theme.hue as unknown as Record<string, Record<number, RGBA>>)[name]
      return scale?.[context.themeMode === "dark" ? 300 : 700] ?? context.theme.text.muted
    }

    const painted = (color: string): string | RGBA => {
      switch (color) {
        case "red":
          return context.theme.text.feedback.error.base
        case "yellow":
          return context.theme.text.feedback.warning.base
        case "green":
          return context.theme.text.feedback.success.base
        case "blue":
          return context.theme.text.feedback.info.base
        case "muted":
          return context.theme.text.muted
        case "orange":
        case "purple":
        case "cyan":
        case "gray":
          return hue(color)
        default:
          return color
      }
    }

    const color = () => {
      const snapshot = current()
      if (!snapshot) return context.theme.text.muted
      return painted(resolveColor(snapshot.context, context.options).color)
    }

    function Badge() {
      return (
        <Show when={current()}>
          {(snapshot) => (
            <text fg={color()}>
              {`${GLYPH} ${display(snapshot().context)}:${displayNamespace(snapshot().namespace)}`}
            </text>
          )}
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
            if (!snapshot) {
              await context.ui.dialog.alert({
                title: "kubectl context",
                message: `No current context set.\n\nChecked: ${kubeconfigFiles().map(clean).join(", ")}`,
              })
              return
            }

            const match = resolveColor(snapshot.context, context.options)
            const origin = match.rule ? `rule: ${clean(match.rule)}` : match.color === "muted" ? "default" : "built-in"
            const ignored =
              match.ignored.length > 0 ? ["", `ignored: ${match.ignored.map(clean).join(", ")}`] : []

            await context.ui.dialog.alert({
              title: "kubectl context",
              message: [
                `context: ${clean(snapshot.context)}`,
                `namespace: ${clean(snapshot.namespace)}`,
                `colour: ${clean(match.color)} (${origin})`,
                "",
                `kubeconfig: ${clean(snapshot.source)}`,
                ...ignored,
              ].join("\n"),
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
