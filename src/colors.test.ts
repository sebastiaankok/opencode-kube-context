import { describe, expect, test } from "bun:test"
import { resolveColor } from "./colors"

describe("resolveColor", () => {
  test("keeps the built-in prod and staging colours without configuration", () => {
    expect(resolveColor("prod-eu", undefined)).toEqual({ color: "red", rule: undefined, ignored: [] })
    expect(resolveColor("staging-eu", undefined)).toEqual({ color: "yellow", rule: undefined, ignored: [] })
    expect(resolveColor("dev-eu", undefined)).toEqual({ color: "muted", rule: undefined, ignored: [] })
  })

  test("an exact name overrides the built-in colour", () => {
    const options = { colors: { "prod-eu": "blue", "dev-eu": "green" } }
    expect(resolveColor("prod-eu", options)).toEqual({ color: "blue", rule: "prod-eu", ignored: [] })
    expect(resolveColor("dev-eu", options)).toEqual({ color: "green", rule: "dev-eu", ignored: [] })
  })

  test("wildcard rules match in written order", () => {
    const options = { colors: { "dev*": "blue", "*": "muted" } }
    expect(resolveColor("dev-eu", options)).toEqual({ color: "blue", rule: "dev*", ignored: [] })
    expect(resolveColor("other", options)).toEqual({ color: "muted", rule: "*", ignored: [] })
  })

  test("a wildcard cannot hide a built-in prod or staging colour", () => {
    expect(resolveColor("prod-eu", { colors: { "*prod*": "blue" } })).toEqual({
      color: "red",
      rule: undefined,
      ignored: [],
    })
    expect(resolveColor("staging-eu", { colors: { "*": "green", "*staging*": "blue" } })).toEqual({
      color: "yellow",
      rule: undefined,
      ignored: [],
    })
    expect(resolveColor("prod-eu", { colors: { "prod-eu": "blue", "*prod*": "green" } })).toEqual({
      color: "blue",
      rule: "prod-eu",
      ignored: [],
    })
  })

  test("names and patterns are case-insensitive", () => {
    expect(resolveColor("DEV-EU", { colors: { "dev-eu": "green" } })).toEqual({
      color: "green",
      rule: "dev-eu",
      ignored: [],
    })
    expect(resolveColor("dev-eu", { colors: { "*DEV*": "GREEN" } })).toEqual({
      color: "green",
      rule: "*DEV*",
      ignored: [],
    })
  })

  test("rules also match the name shown in the badge", () => {
    const prod = "arn:aws:eks:eu-west-1:123456789012:cluster/prod-eu"
    expect(resolveColor(prod, { colors: { "prod-eu": "green" } })).toEqual({
      color: "green",
      rule: "prod-eu",
      ignored: [],
    })

    const dev = "arn:aws:eks:eu-west-1:123456789012:cluster/dev-eu"
    expect(resolveColor(dev, { colors: { "dev-*": "green" } })).toEqual({
      color: "green",
      rule: "dev-*",
      ignored: [],
    })
  })

  test("skips invalid colours and reports the rules it ignored", () => {
    const options = { colors: { "dev-eu": "rad", "dev*": "green", "*": "also-bad" } }
    expect(resolveColor("dev-eu", options)).toEqual({
      color: "green",
      rule: "dev*",
      ignored: ["dev-eu", "*"],
    })
  })

  test("accepts short and long hex colours", () => {
    expect(resolveColor("dev-eu", { colors: { "dev-eu": "#ABC" } })).toEqual({
      color: "#abc",
      rule: "dev-eu",
      ignored: [],
    })
    expect(resolveColor("dev-eu", { colors: { "dev-eu": "#12Ab34" } })).toEqual({
      color: "#12ab34",
      rule: "dev-eu",
      ignored: [],
    })
  })

  test("ignores malformed options and values", () => {
    expect(resolveColor("prod-eu", { colors: ["red"] })).toEqual({
      color: "red",
      rule: undefined,
      ignored: ["colors"],
    })
    expect(resolveColor("dev-eu", { colors: { "dev-eu": 42 } })).toEqual({
      color: "muted",
      rule: undefined,
      ignored: ["dev-eu"],
    })
  })

  test("a catch-all written first wins over later wildcards", () => {
    expect(resolveColor("dev-eu", { colors: { "*": "muted", "dev*": "blue" } })).toEqual({
      color: "muted",
      rule: "*",
      ignored: [],
    })
  })
})
