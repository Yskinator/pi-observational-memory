import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULTS, loadConfig } from "../src/config.js";

/** getAgentDir() honors this env var, so tests can point it at a temp dir. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** Empty env so PI_OM_PASSIVE from the test environment can never leak in. */
const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe("config", () => {
	let agentDir: string;
	let cwd: string;
	const savedAgentDir = process.env[AGENT_DIR_ENV];

	function writeGlobalSettings(obj: Record<string, unknown>): void {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify(obj));
	}

	function writeProjectSettings(obj: Record<string, unknown>): void {
		const dir = join(cwd, ".pi");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "settings.json"), JSON.stringify(obj));
	}

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "om-agent-"));
		cwd = mkdtempSync(join(tmpdir(), "om-cwd-"));
		process.env[AGENT_DIR_ENV] = agentDir;
	});

	afterEach(() => {
		if (savedAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
		else process.env[AGENT_DIR_ENV] = savedAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	});

	it("defaults to disabled-by-default with the bundled model defaults", () => {
		const config = loadConfig(cwd, EMPTY_ENV);
		expect(config.enabledByDefault).toBe(false);
		expect(DEFAULTS.enabledByDefault).toBe(false);
		expect(config.observerConcurrency).toBe(DEFAULTS.observerConcurrency);
		expect(config.models.observer).toEqual({ provider: "vllm", id: "qwen3.8-27b", thinking: "low" });
		expect(config.models.consolidator).toEqual({ provider: "vllm", id: "qwen3.8-27b", thinking: "medium" });
	});

	it("accepts enabledByDefault from global settings", () => {
		writeGlobalSettings({ "observational-memory": { enabledByDefault: true } });
		expect(loadConfig(cwd, EMPTY_ENV).enabledByDefault).toBe(true);
	});

	it("lets project settings override global (both directions)", () => {
		writeGlobalSettings({ "observational-memory": { enabledByDefault: true } });
		writeProjectSettings({ "observational-memory": { enabledByDefault: false } });
		expect(loadConfig(cwd, EMPTY_ENV).enabledByDefault).toBe(false);

		writeGlobalSettings({ "observational-memory": { enabledByDefault: false } });
		writeProjectSettings({ "observational-memory": { enabledByDefault: true } });
		expect(loadConfig(cwd, EMPTY_ENV).enabledByDefault).toBe(true);
	});

	it("ignores non-boolean enabledByDefault values", () => {
		writeGlobalSettings({ "observational-memory": { enabledByDefault: "true" } });
		expect(loadConfig(cwd, EMPTY_ENV).enabledByDefault).toBe(false);

		writeGlobalSettings({ "observational-memory": { enabledByDefault: 1 } });
		expect(loadConfig(cwd, EMPTY_ENV).enabledByDefault).toBe(false);
	});

	it("merges other keys and model fields independently of enabledByDefault", () => {
		writeGlobalSettings({
			"observational-memory": {
				enabledByDefault: true,
				observerConcurrency: 3,
				models: { observer: { thinking: "high" } },
			},
		});
		const config = loadConfig(cwd, EMPTY_ENV);
		expect(config.enabledByDefault).toBe(true);
		expect(config.observerConcurrency).toBe(3);
		// Partial model object: field-by-field fallback to DEFAULTS.
		expect(config.models.observer).toEqual({ provider: "vllm", id: "qwen3.8-27b", thinking: "high" });
		expect(config.models.consolidator).toEqual({ provider: "vllm", id: "qwen3.8-27b", thinking: "medium" });
		// Untouched numeric key keeps its default.
		expect(config.chunkTokens).toBe(DEFAULTS.chunkTokens);
	});

	it("ignores malformed settings files", () => {
		writeFileSync(join(agentDir, "settings.json"), "{ not json");
		writeProjectSettings({ "observational-memory": { enabledByDefault: true } });
		expect(loadConfig(cwd, EMPTY_ENV).enabledByDefault).toBe(true);

		writeProjectSettings({ "observational-memory": { enabledByDefault: "broken" } });
		writeFileSync(join(cwd, ".pi/settings.json"), "{ not json");
		expect(loadConfig(cwd, EMPTY_ENV).enabledByDefault).toBe(false);
	});
});
