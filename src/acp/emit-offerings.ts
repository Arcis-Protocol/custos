// Emit offering.json for every catalog entry → src/acp/serve/<id>/offering.json
// Run: npm run acp:offerings
import * as fs from "fs";
import * as path from "path";
import { OFFERINGS, toOfferingJson } from "./offerings.js";

for (const o of OFFERINGS) {
  const dir = path.join("src/acp/serve", o.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "offering.json");
  fs.writeFileSync(file, JSON.stringify(toOfferingJson(o), null, 2) + "\n");
  console.log("wrote", file);
}
