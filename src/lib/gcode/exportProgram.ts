/** A machine file from the program currently in the editor. */
export function programDownload(text: string, partNumber?: string, opNumber?: number): { name: string; program: string } {
  const safe = (partNumber || "program").replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "program";
  const name = opNumber != null ? `${safe}-OP${opNumber}.nc` : `${safe}.nc`;
  const body = text.replace(/\r\n/g, "\n");
  return { name, program: body.endsWith("\n") ? body : `${body}\n` };
}

export function downloadProgram(text: string, partNumber?: string, opNumber?: number): void {
  const { name, program } = programDownload(text, partNumber, opNumber);
  const file = new Blob([program], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
