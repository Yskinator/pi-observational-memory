import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { observationToLine, type Entry } from "../src/ledger/index.js";
import { renderObservationsFile, refreshObservationsFile } from "../src/memory/observations-render.js";
import { observationsPath } from "../src/memory/paths.js";
import { observation, observationsDroppedEntry, observationsRecordedEntry } from "./fixtures/session.js";

const HEADER =
	"# Unconsolidated Observations\n" +
	"\n" +
	"<!-- Machine-managed: re-rendered on every observation, consolidation, and session start. Do not edit by hand. -->\n";

describe("renderObservationsFile", () => {
	it("renders the fixed header plus one line per observation, chronologically", () => {
		const first = observation("2026-05-02T10:00:01", { content: "first event" });
		const second = observation("2026-05-02T10:05:00", { content: "second event" });
		// Input deliberately out of order — the render must sort it.
		const rendered = renderObservationsFile([second, first]);
		expect(rendered).toBe(`${HEADER}\n${observationToLine(first)}\n${observationToLine(second)}\n`);
	});

	it("uses the exact observationToLine line format", () => {
		const obs = observation("2026-05-02T10:00:01", { content: "hi" });
		expect(renderObservationsFile([obs])).toBe(`${HEADER}\n${observationToLine(obs)}\n`);
	});

	it("is header-only when empty", () => {
		expect(renderObservationsFile([])).toBe(HEADER);
	});
});

// Exercises refreshObservationsFile directly against a real tmpdir with a simulated branch.
// The real dispatch call sites (observer/consolidator triggers, session start, /om on) each
// pass the current getBranch() in a single line; a full subprocess-spawn harness is out of
// scope here.
describe("refreshObservationsFile (real fs)", () => {
	let cwd: string;
	let memoryRoot: string;
	let branch: Entry[];

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "om-obs-file-"));
		memoryRoot = join(cwd, ".memory", "sess-1");
		branch = [];
	});
	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	it("contains a just-committed observation after a simulated observation commit", () => {
		const obs = observation("2026-05-02T10:00:01", { content: "added a login page" });
		branch.push(observationsRecordedEntry("e1", { observations: [obs], coversUpToId: "m1" }));
		refreshObservationsFile(memoryRoot, branch);
		expect(readFileSync(observationsPath(memoryRoot), "utf-8")).toContain(observationToLine(obs));
	});

	it("no longer contains an observation after a consolidation tombstone", () => {
		const dropped = observation("2026-05-02T10:00:01", { content: "old event" });
		const kept = observation("2026-05-02T10:05:00", { content: "new event" });
		branch.push(observationsRecordedEntry("e1", { observations: [dropped, kept], coversUpToId: "m1" }));
		refreshObservationsFile(memoryRoot, branch);
		expect(readFileSync(observationsPath(memoryRoot), "utf-8")).toContain(observationToLine(dropped));

		// The consolidator filed `dropped` into a topic file; the orchestrator tombstones it.
		branch.push(observationsDroppedEntry("e2", { observationTimestamps: [dropped.timestamp], coversUpToId: "m2" }));
		refreshObservationsFile(memoryRoot, branch);
		const text = readFileSync(observationsPath(memoryRoot), "utf-8");
		expect(text).not.toContain(observationToLine(dropped));
		expect(text).toContain(observationToLine(kept));
	});

	it("self-heals a stale on-disk file to the folded active set (session start)", () => {
		// A stale file from a pre-fork state claims an observation that the current
		// branch no longer has active (and has one it is missing).
		const committed = observation("2026-05-02T11:00:00", { content: "current event" });
		branch.push(observationsRecordedEntry("e1", { observations: [committed], coversUpToId: "m1" }));
		refreshObservationsFile(memoryRoot, branch);
		// Clobber the file with stale content, then re-run the session-start refresh.
		const path = observationsPath(memoryRoot);
		writeFileSync(path, "# Unconsolidated Observations\n\nSTALE-LINE\n", "utf-8");
		refreshObservationsFile(memoryRoot, branch);
		const text = readFileSync(path, "utf-8");
		expect(text).not.toContain("STALE-LINE");
		expect(text).toContain(observationToLine(committed));
	});

	it("empties the on-disk file to header-only when the active set fully drains", () => {
		const obs = observation("2026-05-02T10:00:01", { content: "only event" });
		branch.push(observationsRecordedEntry("e1", { observations: [obs], coversUpToId: "m1" }));
		refreshObservationsFile(memoryRoot, branch);
		expect(readFileSync(observationsPath(memoryRoot), "utf-8")).toContain(observationToLine(obs));

		// A consolidation files everything into topic files and tombstones the whole batch.
		branch.push(observationsDroppedEntry("e2", { observationTimestamps: [obs.timestamp], coversUpToId: "m2" }));
		refreshObservationsFile(memoryRoot, branch);
		expect(readFileSync(observationsPath(memoryRoot), "utf-8")).toBe(HEADER);
	});
});
