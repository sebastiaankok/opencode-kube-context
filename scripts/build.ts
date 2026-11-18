import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { runtimeModuleIdForSpecifier } from "@opentui/core/runtime-plugin"

// OpenCode loads plugins from node_modules without the host's Solid source
// transform, so JSX must be compiled here. Imports that the host already owns
// are rewritten to its runtime module ids so the plugin shares the host's
// signals and renderables instead of bundling a second copy.
const shared = new Set([
  "@opencode/plugin/tui",
  "@opentui/core",
  "@opentui/solid",
  "solid-js",
  "solid-js/store",
])

const result = await Bun.build({
  entrypoints: ["./src/tui.tsx"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  packages: "external",
  external: ["opentui:*"],
  plugins: [
    createSolidTransformPlugin({
      moduleName: runtimeModuleIdForSpecifier("@opentui/solid"),
      resolvePath(specifier) {
        if (shared.has(specifier)) return runtimeModuleIdForSpecifier(specifier)
        return null
      },
    }),
  ],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`built ${result.outputs.map((output) => output.path).join(", ")}`)
