// JS folder for an ARBITRARY fixture file — folds {calId,log} with the ACTUAL mobile
// engine (../src/lib/engine.ts) and dumps the folded calendar JSON on stdout. Symmetric
// to fold_cpp (the C++ desktop engine), so any fixture can be checked for cross-platform
// parity AND for a specific expected outcome.
// Usage: node --experimental-strip-types --import ./register.mjs fold_ts.mjs <fixture.json>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { foldCalendar, eventFromJson } from "../src/lib/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] ? join(here, process.argv[2]) : join(here, "fixtures.json");
const fx = JSON.parse(readFileSync(path, "utf8"));
const log = fx.log.map(eventFromJson);
process.stdout.write(JSON.stringify(foldCalendar(fx.calId, log)) + "\n");
