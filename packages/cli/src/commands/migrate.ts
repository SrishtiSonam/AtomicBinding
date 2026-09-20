// `imprint migrate` — dry run first, then apply inside a transaction.
//
// Every migrated document gets a version row, so the whole run is revertible one
// document at a time. That is the difference between a migration and a data loss event.

import { openSqliteStore } from "@imprint/store";
import { extractRefs, routeFor, validateDocument } from "@imprint/schema";
import { migrationsFor, MIGRATIONS } from "../../../../migrations/index";
import { registry } from "~/schema";
import { amber, bold, dim, green, heading, red, rule } from "../format";

export async function migrate(argv: string[]): Promise<number> {
  const apply = argv.includes("--apply");
  const only = argv.find((arg) => !arg.startsWith("--"));
  const store = openSqliteStore(process.env.IMPRINT_SQLITE_PATH ?? "./data/imprint.db");

  heading(apply ? "Migrate - APPLYING" : "Migrate - dry run (nothing is written)");
  rule();

  if (MIGRATIONS.length === 0) {
    console.log(dim("  no migrations are defined"));
    store.close();
    return 0;
  }

  let touched = 0;

  for (const def of Object.values(registry.documents)) {
    if (def.source !== "cms") continue;
    if (only && def.name !== only) continue;

    const rows = store.all("draft", def.name);
    const affected = rows.filter((row) => migrationsFor(def.name, row.schemaVer).length > 0);
    if (affected.length === 0) continue;

    const chain = migrationsFor(def.name, affected[0]!.schemaVer);
    const target = chain[chain.length - 1]!.to;

    console.log(`\n  ${bold(def.name)}  ${affected.length} document(s)  -> v${target}`);
    for (const step of chain) console.log(dim(`    ${step.describe()}`));

    // The sample diff: what one document looks like before and after.
    const sample = affected[0]!;
    const after = chain.reduce<Record<string, unknown>>((data, step) => step.up(data), { ...sample.data });
    console.log(dim(`\n    sample ${sample.id.slice(0, 8)}`));
    console.log(dim(`      before  ${JSON.stringify(sample.data).slice(0, 120)}`));
    console.log(dim(`      after   ${JSON.stringify(after).slice(0, 120)}`));

    const stillInvalid = validateDocument(def, after, registry);
    if (!stillInvalid.ok) {
      console.log(red(`    the migrated sample STILL fails the schema:`));
      for (const violation of stillInvalid.violations) {
        console.log(red(`      ${violation.path || "(document)"}: ${violation.message}`));
      }
      console.log(amber("    refusing to apply - fix the migration first"));
      continue;
    }

    if (apply) {
      const changes = store.rewrite(
        def.name,
        (data) => chain.reduce<Record<string, unknown>>((current, step) => step.up(current), data),
        target,
        "migration",
        {
          computeRefs: (data) => extractRefs(def.fields, data, registry),
          computeRoute: (data) => (def.route ? routeFor(def, data) : null),
        }
      );
      console.log(green(`    applied to ${changes.length} document(s), each with a revertible version row`));
      touched += changes.length;
    } else {
      touched += affected.length;
    }
  }

  console.log();
  if (touched === 0) {
    console.log(green("  Nothing to migrate."));
  } else if (apply) {
    console.log(green(bold(`  Migrated ${touched} document(s).`)));
  } else {
    console.log(amber(bold(`  ${touched} document(s) would change. Re-run with --apply.`)));
  }
  console.log();

  store.close();
  return 0;
}
