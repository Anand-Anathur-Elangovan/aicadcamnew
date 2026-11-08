import { describe, expect, it } from "vitest";
import { MECHSIM_PAGE, MECHSIM_SCHEMA, mechsimShareUrl } from "@/lib/gcode/mechsim";

async function open(url: string) {
  const encoded = url.split("#c=")[1];
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  expect(bytes[0]).toBe(1);
  const stream = new Blob([bytes.subarray(1) as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(await new Response(stream).arrayBuffer()));
}

describe("MechSimulator share link", () => {
  it("packs the program the way the tool's own Copy share link does", async () => {
    const program = "G21 G18\nG00 X42 Z2\nG01 X16 F0.25\nG01 Z-34 F0.2\nM30";
    const url = await mechsimShareUrl(program, 6);
    expect(url?.startsWith(`${MECHSIM_PAGE}#c=`)).toBe(true);
    expect(await open(url as string)).toEqual({ schema: MECHSIM_SCHEMA, gcode: program, toolDiam: 6, units: "mm" });
  });

  it("returns null for a program too long to fit in a link", async () => {
    const long = Array.from({ length: 400 }, (_, index) => `G01 X${index * 1.37} Y${index * 2.11} Z-${index * 0.31} F${100 + index}`).join("\n");
    expect(await mechsimShareUrl(long)).toBeNull();
  });
});
