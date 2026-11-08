/**
 * Hand-off to MechSimulator's CNC G-code tool (https://mechsimulator.com/tools/cnc-gcode/).
 * That site sends X-Frame-Options: SAMEORIGIN, so it cannot be shown inside an iframe here.
 * Its own "Copy share link" feature opens a program from the URL hash, and this builds the same link.
 */
export const MECHSIM_PAGE = "https://mechsimulator.com/tools/cnc-gcode/";
export const MECHSIM_SCHEMA = "mechsim.cnc-gcode.v1";
/** The tool refuses longer links, so a longer program is copied or imported as a file instead. */
export const MECHSIM_LINK_LIMIT = 1800;

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Returns the share link for a program, or null when it is too long for a link. */
export async function mechsimShareUrl(gcode: string, toolDiameter = 0): Promise<string | null> {
  const record = JSON.stringify({ schema: MECHSIM_SCHEMA, gcode, toolDiam: toolDiameter, units: "mm" });
  const packed = await deflateRaw(new TextEncoder().encode(record));
  const out = new Uint8Array(packed.length + 1);
  out[0] = 1;
  out.set(packed, 1);
  const encoded = base64Url(out);
  return encoded.length > MECHSIM_LINK_LIMIT ? null : `${MECHSIM_PAGE}#c=${encoded}`;
}

/** Optional address of an embeddable build of the tool, if one is ever provided. */
export function externalEmbedUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_EXTERNAL_SIM_EMBED_URL?.trim();
  return value && /^https:\/\//i.test(value) ? value : null;
}
