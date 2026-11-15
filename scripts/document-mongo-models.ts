// Offline catalogue generation: imports schemas, never a connection or application config.
import { readFile, writeFile } from "node:fs/promises";
import { mongoSchemas } from "../models/mongo/index.js";
const prisma = await readFile(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const models = [...prisma.matchAll(/model (\w+)\s*\{([\s\S]*?)\n\}/g)];
const scalar =
  /^(\w+)\s+(String|Int|Float|Boolean|DateTime|Decimal|Role|OrderStatus|PaymentStatus|PackageSize)(\?)?(?=\s|$)(.*)$/;
const lines: string[] = [];
for (const [, name, body] of models) {
  const schema = mongoSchemas[name as keyof typeof mongoSchemas];
  if (!schema) throw new Error(`Missing MongoDB schema: ${name}`);
  lines.push(
    `### ${name}`,
    "",
    `Collection: \`${schema.options.collection}\`.`,
    "",
    "| PostgreSQL field | MongoDB field | Storage mapping | Nullable | Source default | Model reference |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const raw of body.split(/\r?\n/)) {
    const field = scalar.exec(raw.trim());
    if (!field) continue;
    const [, source, type, nullable, rest] = field;
    const target = source === "id" ? "_id" : source;
    const path = schema.paths[target];
    if (!path) throw new Error(`Unmapped field: ${name}.${source}`);
    const dbType = /@db\.(\w+)(?:\(([^)]+)\))?/.exec(rest);
    const sql = dbType
      ? `${dbType[1]}${dbType[2] ? `(${dbType[2]})` : ""}`
      : ((
          {
            String: "TEXT",
            Int: "INTEGER",
            Float: "DOUBLE PRECISION",
            Boolean: "BOOLEAN",
          } as Record<string, string>
        )[type] ?? type);
    let fallback =
      /@default\(([^)]+)\)/.exec(rest)?.[1] ?? (nullable ? "null" : "none");
    if (fallback === "uuid(" || fallback === "now(") fallback += ")";
    if (/@updatedAt/.test(rest)) fallback = "Prisma-managed updatedAt";
    lines.push(
      `| \`${source}\` | \`${target}\` | ${sql} → ${path.instance} | ${nullable ? "yes" : "no"} | \`${fallback}\` | ${path.options.ref ? `\`${String(path.options.ref)}\`` : "—"} |`,
    );
  }
  lines.push(
    "",
    "Declared indexes (in addition to MongoDB `_id` uniqueness):",
    "",
  );
  if (!schema.indexes().length) lines.push("None.");
  for (const [keys, options] of schema.indexes())
    lines.push(
      `- \`${JSON.stringify(keys)}\`${options.unique ? " — unique" : ""}${options.partialFilterExpression ? `; filter \`${JSON.stringify(options.partialFilterExpression)}\`` : ""}.`,
    );
  lines.push("");
}
const url = new URL("../docs/MONGODB_MODELS.md", import.meta.url);
const guide = await readFile(url, "utf8");
const marker =
  /<!-- BEGIN MODEL CATALOGUE -->[\s\S]*?<!-- END MODEL CATALOGUE -->/;
if (!marker.test(guide)) throw new Error("Model catalogue markers missing");
await writeFile(
  url,
  guide.replace(
    marker,
    `<!-- BEGIN MODEL CATALOGUE -->\n\n${lines.join("\n")}\n<!-- END MODEL CATALOGUE -->`,
  ),
);
console.log(
  `Documented ${models.length} models without connecting to a database.`,
);
