import { describe, expect, it } from "vitest";

import { readGateFromLedger, resolveEnabledGate, type Entry } from "../src/ledger/index.js";

function gateEntry(id: string, enabled: boolean): Entry {
	return { type: "custom", id, customType: "om.enabled", data: { enabled } };
}

function costEntry(id: string): Entry {
	return { type: "custom", id, customType: "om.cost", data: { costUsd: 0.1 } };
}

describe("readGateFromLedger", () => {
	it("returns undefined when the branch has no gate entry", () => {
		expect(readGateFromLedger([])).toBeUndefined();
		expect(readGateFromLedger([costEntry("c1"), costEntry("c2")])).toBeUndefined();
	});

	it("returns the state of the most recent gate entry", () => {
		expect(readGateFromLedger([gateEntry("g1", true)])).toBe(true);
		expect(readGateFromLedger([gateEntry("g1", false)])).toBe(false);
		expect(readGateFromLedger([gateEntry("g1", true), costEntry("c2"), gateEntry("g2", false)])).toBe(false);
		expect(readGateFromLedger([gateEntry("g1", false), gateEntry("g2", true)])).toBe(true);
	});

	it("treats a gate entry without data as disabled", () => {
		const noData: Entry = { type: "custom", id: "g1", customType: "om.enabled" };
		expect(readGateFromLedger([noData])).toBe(false);
	});
});

describe("resolveEnabledGate", () => {
	it("falls back to the config default when no gate entry exists", () => {
		expect(resolveEnabledGate([], true)).toBe(true);
		expect(resolveEnabledGate([], false)).toBe(false);
		expect(resolveEnabledGate([costEntry("c1")], true)).toBe(true);
	});

	it("lets an explicit gate entry win over the default in both directions", () => {
		expect(resolveEnabledGate([gateEntry("g1", false)], true)).toBe(false);
		expect(resolveEnabledGate([gateEntry("g1", true)], false)).toBe(true);
		expect(resolveEnabledGate([gateEntry("g1", true), gateEntry("g2", false)], true)).toBe(false);
	});
});
