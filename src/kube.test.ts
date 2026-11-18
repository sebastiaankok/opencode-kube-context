import { describe, expect, test } from "bun:test"
import { clean, contextNamespaces, display, displayNamespace, snapshotFrom } from "./kube"

const config = (body: string) => ({ path: "/tmp/config", text: body })

const standard = `apiVersion: v1
clusters:
- cluster:
    server: https://example
  name: eu
contexts:
- context:
    cluster: eu
    namespace: kube-system
    user: me
  name: prod-eu
current-context: prod-eu
kind: Config
`

describe("snapshotFrom", () => {
  test("reads the context and its namespace", () => {
    expect(snapshotFrom([config(standard)])).toEqual({
      context: "prod-eu",
      namespace: "kube-system",
      source: "/tmp/config",
    })
  })

  test("defaults to the default namespace when the context omits one", () => {
    const text = `contexts:
- context:
    cluster: eu
    user: me
  name: dev
current-context: dev
`
    expect(snapshotFrom([config(text)])?.namespace).toBe("default")
  })

  test("treats null and empty namespaces as the default", () => {
    const text = `contexts:
- context:
    namespace: ~
  name: dev
- context:
    namespace: ""
  name: staging
current-context: dev
`
    expect(snapshotFrom([config(text)])?.namespace).toBe("default")

    const empty = text.replace("current-context: dev", "current-context: staging")
    expect(snapshotFrom([config(empty)])?.namespace).toBe("default")
  })

  test("handles quoted names and namespaces", () => {
    const text = `contexts:
- context:
    namespace: "team-a"
  name: "arn:aws:eks:eu-west-1:123456789012:cluster/prod"
current-context: "arn:aws:eks:eu-west-1:123456789012:cluster/prod"
`
    expect(snapshotFrom([config(text)])).toEqual({
      context: "arn:aws:eks:eu-west-1:123456789012:cluster/prod",
      namespace: "team-a",
      source: "/tmp/config",
    })
  })

  test("handles name before context", () => {
    const text = `contexts:
- name: dev
  context:
    namespace: apps
current-context: dev
`
    expect(snapshotFrom([config(text)])?.namespace).toBe("apps")
  })

  test("handles indented list items", () => {
    const text = `contexts:
  - context:
      namespace: apps
    name: dev
current-context: dev
`
    expect(snapshotFrom([config(text)])?.namespace).toBe("apps")
  })

  test("handles CRLF and comments", () => {
    const text = standard.replace(/\n/g, "\r\n").replace("current-context:", "# comment\r\ncurrent-context:")
    expect(snapshotFrom([config(text)])?.namespace).toBe("kube-system")
  })

  test("reads current-context and the namespace from different files", () => {
    const first = `contexts:
- context:
    namespace: payments
  name: prod
`
    const second = `contexts:
- context:
    namespace: ignored
  name: other
current-context: prod
`
    expect(snapshotFrom([config(first), { path: "/tmp/second", text: second }])).toEqual({
      context: "prod",
      namespace: "payments",
      source: "/tmp/second",
    })
  })

  test("takes the whole context from the first file that defines it", () => {
    const first = `contexts:
- context:
    namespace: payments
  name: prod
current-context: prod
`
    const second = `contexts:
- context:
    namespace: ignored
  name: prod
`
    expect(snapshotFrom([config(first), { path: "/tmp/second", text: second }])?.namespace).toBe("payments")
  })

  test("does not fill a missing namespace from a later file", () => {
    // kubectl keeps the whole context from the first file; a later file's
    // solution for the same context name is discarded.
    const first = `contexts:
- context:
    namespace:
  name: prod
current-context: prod
`
    const second = `contexts:
- context:
    namespace: payments
  name: prod
`
    expect(snapshotFrom([config(first), { path: "/tmp/second", text: second }])?.namespace).toBe("default")
  })

  test("returns undefined without a current context", () => {
    expect(snapshotFrom([config("apiVersion: v1\n")])).toBeUndefined()
    expect(snapshotFrom([config("current-context:\n")])).toBeUndefined()
  })
})

describe("contextNamespaces", () => {
  test("stops at the next top-level key", () => {
    const text = `contexts:
- context:
    namespace: apps
  name: dev
users:
- name: dev
  user:
    token: not-a-namespace
`
    expect(contextNamespaces(text)).toEqual(new Map([["dev", "apps"]]))
  })

  test("handles a flow-style context map", () => {
    const text = `contexts:
- context: {cluster: eu, namespace: apps}
  name: dev
`
    expect(contextNamespaces(text).get("dev")).toBe("apps")
  })
})

describe("display", () => {
  test("shortens EKS ARNs to the cluster name", () => {
    expect(display("arn:aws:eks:eu-west-1:123456789012:cluster/prod-eu")).toBe("prod-eu")
  })

  test("middle-truncates long contexts", () => {
    expect(display("a".repeat(40))).toBe(`${"a".repeat(20)}…${"a".repeat(15)}`)
  })

  test("middle-truncates long namespaces", () => {
    expect(displayNamespace("n".repeat(30))).toBe(`${"n".repeat(12)}…${"n".repeat(11)}`)
  })

  test("strips terminal control characters", () => {
    expect(clean("prod\u001b]52;c;payload\u0007")).toBe("prod]52;c;payload")
  })
})
