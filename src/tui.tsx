/**
 * kubectl context indicator for the OpenCode TUI.
 *
 * Shows the active context and its default namespace in the footer, and
 * follows the kubeconfig so `kubectl config use-context` (or `kubectx`) shows
 * up without a restart. Read-only: it never writes to your kubeconfig.
 */
import { Show, createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import {
  clean,
  display,
  displayNamespace,
  kubeconfigFiles,
  readContext,
  tone,
  watchFiles,
  type Snapshot,
} from "./kube"

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
            await context.ui.dialog.alert({
              title: "kubectl context",
              message: snapshot
                ? [
                    `context: ${clean(snapshot.context)}`,
                    `namespace: ${clean(snapshot.namespace)}`,
                    "",
                    `kubeconfig: ${clean(snapshot.source)}`,
                  ].join("\n")
                : `No current context set.\n\nChecked: ${kubeconfigFiles().map(clean).join(", ")}`,
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
