import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerConsolidatorTools } from "../agent/consolidator/tools.js";
import { buildWorkerEnv } from "../src/spawn/launch.js";

describe("buildWorkerEnv(consolidator)", () => {
	it("sets role, run id, and the .memory sandbox root", () => {
		const env = buildWorkerEnv("consolidator", { memoryRoot: "/proj/.memory/sess-1", runId: "c1" });
		expect(env.OM_WORKER).toBe("consolidator");
		expect(env.OM_RUN_ID).toBe("c1");
		expect(env.OM_MEMORY_DIR).toBe("/proj/.memory/sess-1");
	});
});

describe("registerConsolidatorTools (scoped to .memory/)", () => {
	let cwd: string;
	let memoryRoot: string;
	let tools: Map<string, any>;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "om-cons-tools-"));
		memoryRoot = join(cwd, ".memory");
		tools = new Map();
		const fakePi = { registerTool: (def: any) => tools.set(def.name, def) } as any;
		registerConsolidatorTools(fakePi, memoryRoot);
	});
	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	it("registers the scoped tool belt (no terminal report tool)", () => {
		expect([...tools.keys()].sort()).toEqual(["edit", "grep", "ls", "read", "write"].sort());
	});

	it("write then read a topic file", async () => {
		const res = await tools.get("write").execute("1", { path: "auth.md", content: "---\nid: auth\n---\nbody" });
		expect(res.content[0].text).toContain("Wrote auth.md");
		expect(readFileSync(join(memoryRoot, "auth.md"), "utf-8")).toContain("body");
		const read = await tools.get("read").execute("2", { path: "auth.md" });
		expect(read.content[0].text).toContain("body");
	});

	it("refuses to write or edit INDEX.md", async () => {
		const w = await tools.get("write").execute("1", { path: "INDEX.md", content: "x" });
		expect(w.content[0].text).toContain("generated automatically");
		expect(existsSync(join(memoryRoot, "INDEX.md"))).toBe(false);
	});

	it("refuses to read, write, or edit observations.md (orchestrator-managed)", async () => {
		mkdirSync(memoryRoot, { recursive: true });
		writeFileSync(join(memoryRoot, "observations.md"), "2026-05-02T10:00:01  some event");
		const r = await tools.get("read").execute("1", { path: "observations.md" });
		expect(r.content[0].text).toContain("orchestrator-managed");
		const w = await tools.get("write").execute("2", { path: "observations.md", content: "x" });
		expect(w.content[0].text).toContain("orchestrator-managed");
		expect(readFileSync(join(memoryRoot, "observations.md"), "utf-8")).toContain("some event");
		const e = await tools.get("edit").execute("3", { path: "observations.md", oldText: "event", newText: "X" });
		expect(e.content[0].text).toContain("orchestrator-managed");
	});

	it("never surfaces observations.md in ls or grep", async () => {
		mkdirSync(memoryRoot, { recursive: true });
		writeFileSync(join(memoryRoot, "observations.md"), "secret-obs-line");
		writeFileSync(join(memoryRoot, "auth.md"), "uses JWT tokens");
		const ls = await tools.get("ls").execute("1", {});
		expect(ls.content[0].text).toBe("auth.md");
		const grep = await tools.get("grep").execute("2", { pattern: "secret|obs" });
		expect(grep.content[0].text).toBe("(no matches)");
	});

	it("rejects paths that escape .memory/", async () => {
		const r = await tools.get("write").execute("1", { path: "../escape.md", content: "x" });
		expect(r.content[0].text).toContain("escapes .memory/");
		expect(existsSync(join(cwd, "escape.md"))).toBe(false);
	});

	it("edit replaces an exact unique substring and rejects ambiguous matches", async () => {
		await tools.get("write").execute("1", { path: "t.md", content: "alpha beta alpha" });
		const ambiguous = await tools.get("edit").execute("2", { path: "t.md", oldText: "alpha", newText: "X" });
		expect(ambiguous.content[0].text).toContain("ambiguous");
		const ok = await tools.get("edit").execute("3", { path: "t.md", oldText: "beta", newText: "BETA" });
		expect(ok.content[0].text).toContain("Edited");
		expect(readFileSync(join(memoryRoot, "t.md"), "utf-8")).toBe("alpha BETA alpha");
	});

	it("ls and grep operate within .memory/", async () => {
		await tools.get("write").execute("1", { path: "auth.md", content: "uses JWT tokens" });
		await tools.get("write").execute("2", { path: "deploy.md", content: "uses fly.io" });
		const ls = await tools.get("ls").execute("3", {});
		expect(ls.content[0].text.split("\n").sort()).toEqual(["auth.md", "deploy.md"]);
		const grep = await tools.get("grep").execute("4", { pattern: "JWT" });
		expect(grep.content[0].text).toContain("auth.md:1");
	});
});
