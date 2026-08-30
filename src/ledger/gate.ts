import { OM_ENABLED, type Entry } from "./types.js";

/** Latest explicit `/om on|off` gate in the branch, or undefined when none has been written. */
export function readGateFromLedger(branch: Entry[]): boolean | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "custom" && entry.customType === OM_ENABLED) {
			return (entry.data as { enabled?: boolean } | undefined)?.enabled ?? false;
		}
	}
	return undefined;
}

/** Effective enabled state: an explicit gate entry wins, otherwise the config default. */
export function resolveEnabledGate(branch: Entry[], defaultEnabled: boolean): boolean {
	return readGateFromLedger(branch) ?? defaultEnabled;
}
