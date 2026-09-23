/**
 * Deterministic render of the unconsolidated-observation tier to
 * `.memory/<sessionId>/observations.md` (durability for the buffer tier).
 *
 * The file is machine-managed: the orchestrator atomically re-renders the WHOLE file
 * (never edited incrementally) after every observation commit, after every
 * consolidation, and on session start. It self-heals to exactly the folded
 * `activeObservations` set on the next observation commit, consolidation, `/om on`, or
 * session start, so a stale copy (e.g. after a mid-session /tree rollback) is only
 * transient — the ledger and the injected compaction block stay exact. It is a special
 * file, not a topic: excluded from `listTopics`/INDEX.md and invisible to the
 * consolidator's scoped tools.
 */
import { foldLedger, observationToLine, sortObservations, type Entry, type Observation } from "../ledger/index.js";
import { atomicWrite, observationsPath } from "./paths.js";

const OBSERVATIONS_FILE_HEADER =
	"# Unconsolidated Observations\n" +
	"\n" +
	"<!-- Machine-managed: re-rendered on every observation, consolidation, and session start. Do not edit by hand. -->\n";

/**
 * Render the full `observations.md` content: a fixed header plus one line per
 * unconsolidated observation, chronological and in the exact `observationToLine`
 * format. Empty list => header only, no lines.
 */
export function renderObservationsFile(observations: Observation[]): string {
	const lines = sortObservations(observations).map(observationToLine);
	if (lines.length === 0) return OBSERVATIONS_FILE_HEADER;
	return `${OBSERVATIONS_FILE_HEADER}\n${lines.join("\n")}\n`;
}

/**
 * Re-fold the branch and atomically rewrite `observations.md` so the on-disk file holds
 * exactly the active (unconsolidated) observations. Pass the CURRENT branch
 * (`ctx.sessionManager.getBranch()`), the same source of truth the triggers fold.
 */
export function refreshObservationsFile(memoryRoot: string, branch: Entry[]): void {
	const active = foldLedger(branch).activeObservations;
	atomicWrite(observationsPath(memoryRoot), renderObservationsFile(active));
}
