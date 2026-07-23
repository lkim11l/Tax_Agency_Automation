import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  syntheticDocx,
  syntheticPdf,
  syntheticXlsx,
} from "../src/modules/documents/test-fixtures";

async function main() {
  const directory = path.join(process.cwd(), "tmp", "phase3-live-fixtures");
  await mkdir(directory, { recursive: true });
  const fixtures = [
    ["phase3-live.docx", syntheticDocx()],
    ["phase3-live.pdf", syntheticPdf("Phase 3 live PDF source")],
    ["phase3-live.xlsx", await syntheticXlsx()],
    [
      "phase3-live.png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZkAAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    [
      "phase3-live.rtf",
      Buffer.from("{\\rtf1\\ansi Safe unsupported Phase 3 fixture.}"),
    ],
  ] as const;

  for (const [filename, content] of fixtures) {
    await writeFile(path.join(directory, filename), content);
  }
  console.log(
    JSON.stringify({
      directory,
      files: fixtures.map(([filename]) => filename),
    }),
  );
}

void main();
