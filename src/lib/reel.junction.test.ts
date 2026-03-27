import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "fs";
import test from "node:test";
import { buildJunctionDrawtextFilter, junctionPartToTextfileContent } from "./reel";

test("junctionPartToTextfileContent: known phrases wrap with real newlines (no stray n)", () => {
  assert.equal(
    junctionPartToTextfileContent("YOU'RE NOT SPECIAL"),
    "YOU'RE NOT\nSPECIAL",
  );
  assert.equal(
    junctionPartToTextfileContent("IF YOU DONT SPEAK"),
    "IF YOU DONT\nSPEAK",
  );
  assert.equal(
    junctionPartToTextfileContent("Hard pill to swallow"),
    "HARD PILL TO\nSWALLOW",
  );
});

test("junctionPartToTextfileContent: merged lines must not look like NOTnSPECIAL / DONTnSPEAK", () => {
  const samples = [
    "YOU'RE NOT SPECIAL",
    "IF YOU DONT SPEAK",
    "DONT SPEAK UNLESS",
  ];
  for (const s of samples) {
    const body = junctionPartToTextfileContent(s);
    const oneLine = body.split("\n").join("");
    assert.ok(
      !/NOTn|DONTn|SPEAKn/i.test(oneLine),
      `unexpected literal n glue in: ${JSON.stringify(oneLine)}`,
    );
    assert.ok(
      !body.includes("\\n"),
      "must not contain backslash+n bytes; use real newline only",
    );
  }
});

test("junctionPartToTextfileContent: newlines are single LF (0x0a), not CRLF", () => {
  const body = junctionPartToTextfileContent("Stop chasing start attracting");
  assert.ok(!body.includes("\r"), "no CR in textfile body");
  const n = [...body].filter((c) => c === "\n").length;
  assert.ok(n >= 1, "multiline sample should contain at least one LF");
});

test("buildJunctionDrawtextFilter: writes textfile bodies and uses textfile= in filter", () => {
  const junk: string[] = [];
  const prefix = `test_junction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filter = buildJunctionDrawtextFilter(
    ["YOU'RE NOT SPECIAL", "IF YOU DONT SPEAK"],
    20,
    "v1",
    prefix,
    junk,
  );

  try {
    assert.equal(junk.length, 2);
    assert.match(filter, /drawtext=textfile='/);
    assert.equal((filter.match(/textfile=/g) ?? []).length, 2, "each part uses textfile=");
    assert.equal(
      readFileSync(junk[0], "utf8"),
      "YOU'RE NOT\nSPECIAL",
    );
    assert.equal(
      readFileSync(junk[1], "utf8"),
      "IF YOU DONT\nSPEAK",
    );
  } finally {
    for (const p of junk) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
});
