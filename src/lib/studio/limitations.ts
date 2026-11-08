/** Plain-language limits shown behind the information icons, so the text lives in one place. */

export const SIMULATOR_LIMITS = [
  "Ordinary 3-axis milling uses a height map, which shows material taken off from the top down. A program that tilts the tool (A, B, C words) or uses a T-slot or dovetail cutter switches to a solid model automatically.",
  "Cutting forces, tool wear and chatter are not modelled. A clean run means no collision, not a proven cycle time or finish.",
  "A thread is shown as a groove cut to the root diameter, not as a helical form.",
  "A boring head is drawn as a plain cylinder at its diameter. It must run in a hole that is already drilled.",
];

export const VOXEL_NOTE =
  "This program needs the solid model, because it tilts the tool or cuts an undercut. The solid is a grid of small boxes, about 1 percent of the part size, so thin walls and small details are drawn roughly. The tool tilts about its tip, as with tool-centre-point control, and A tilts about X, B about Y and C turns the tilt about Z. Your machine may use other signs or a table that tilts, so match the post to it. Tilted work planes (G68.2), rotary table compensation and the machine body are not modelled.";

export const VMC_BORING_NOTE =
  "On the VMC the bore is opened by a drill and then a boring head. The simulator treats the head as a plain cylinder and only lets it enlarge a drilled hole by 3 mm per side. The pilot drill goes a little past the bore depth so its point stays clear. If the shop has no boring head, a reamer or an end mill can open a bore under about 20 mm, and the lathe is the shorter process for a round part.";

export const READING_NOTE =
  "The checks catch sizes that are missing or cannot fit. They cannot tell that a value that looks plausible was read wrongly from the drawing, so compare the numbers here with the sheet before you trust the programs.";

const RULES: [RegExp, string][] = [
  [/\bG4[12]\b/, "Cutter compensation (G41/G42) is not applied. The tool follows the programmed path, not the offset path."],
  [/\bM98\b|\bG65\b|#\d+/, "Subprograms (M98) and macro variables are not expanded, so those moves are not shown."],
  [/\bG5[5-9]\b|\bG10\b/, "Work offsets other than G54 are not applied. X and Y are shown as programmed."],
  [/\bG(?:68|51)\b/, "Rotation and scaling (G68, G51) are not applied."],
  [/\bG3[23]\b/, "Single-pass threading (G32/G33) is not shown. Use G76 or G92 to see a thread."],
];

/** Parts of a program the simulator skips, so the viewer can say so only when it matters. */
export function unsupportedFeatures(program: string): string[] {
  const text = program.replace(/\([^)]*\)/g, " ").replace(/;.*$/gm, "").toUpperCase();
  return RULES.filter(([pattern]) => pattern.test(text)).map(([, note]) => note);
}
