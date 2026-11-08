import { describe, expect, it } from "vitest";
import { programDownload } from "@/lib/gcode/exportProgram";

describe("program download", () => {
  it("names the file from the part and operation and keeps a trailing newline", () => {
    const file = programDownload("G21 G90\nG01 X10", "HC-100", 10);
    expect(file.name).toBe("HC-100-OP10.nc");
    expect(file.program).toBe("G21 G90\nG01 X10\n");
  });

  it("uses a plain name when the part number has spaces", () => {
    const file = programDownload("M30\n", "2-hole bracket");
    expect(file.name).toBe("2-hole-bracket.nc");
    expect(file.program).toBe("M30\n");
  });
});
