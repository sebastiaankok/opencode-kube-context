# opencode-kube-context

Know which Kubernetes cluster your agent is pointed at. A `⎈` badge for the active
kubectl context, in the OpenCode TUI footer, updated the moment you switch.

```
⎈ prod-eu-west-1
```

- **Footer badge** in the session prompt footer and on the home screen.
- **Colour-coded**: red for `prod` / `production` / `prd`, yellow for `stg` / `stage` /
  `staging` / `preprod` / `uat`, muted otherwise.
- **Live**: follows your kubeconfig, so `kubectl config use-context …` (or `kubectx`) shows
  up without restarting OpenCode.
- **`/kube`**: a palette and slash command that shows the full context and which
  kubeconfig file it came from.
- **Read-only**: it never writes to your kubeconfig, and it does not need `kubectl` on
  `PATH`. It parses the same files kubectl does: `$KUBECONFIG` (in order) or
  `~/.kube/config`, first non-empty `current-context` wins.

## Install

Requires OpenCode v2 (2.2 or newer).

```sh
opencode plugin add opencode-kube-context
```

The package has only a TUI part, so `plugin add` records it in
`~/.config/opencode/cli.json` rather than `opencode.json(c)`. Restart the TUI afterwards.

Or add it by hand:

```jsonc title="~/.config/opencode/cli.json"
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-kube-context"]
}
```

Because it is a CLI-side plugin, it also works when the TUI talks to a remote OpenCode
server.

## Usage

The badge appears on its own when a context is set. With no `current-context` in your
kubeconfig, it stays hidden.

| Command | What it does |
| --- | --- |
| `/kube` | Shows the current context and the kubeconfig file it was read from |
| `Kubernetes: kubectl context` | Same command, in the command palette |

Long names are shortened for the footer: EKS ARNs (`arn:aws:eks:…:cluster/name`) show the
cluster name, and names longer than 36 characters are middle-truncated.

## Limitations

- It reads the kubeconfig, so it cannot see a `--context` flag passed to a single `kubectl`
  call, or credentials resolved by an auth plugin.
- Context switching is left to `kubectl` on purpose: the plugin only observes.

## Development

The TUI part is shipped as TypeScript (`src/tui.tsx`) and compiled by OpenCode's plugin
loader, so there is no build step.

```sh
npm install
npm run typecheck
npm run pack:dry
```

To try a checkout locally, point OpenCode at it instead of installing:

```sh
ln -s "$PWD" ~/.config/opencode/plugins/kube-context
```

Plugins under `~/.config/opencode/plugins/` load automatically, and edits reload in every
running TUI window. Remove that directory before installing the npm package, or the same
footer badge shows up twice.

## License

Apache-2.0
