"use client";

// Monaco editor for one G-code program.
// Typing stays in the editor. Save commits it, Play runs that saved path, Export downloads the .nc file.

import { useRef, useEffect, useCallback, useState } from "react";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { registerGCodeLanguage, GCODE_LANGUAGE_ID, GCODE_THEME_ID } from "@/lib/gcode/syntax";

interface Props {
  value: string;
  programLabel?: string;
  moves?: number;
  playing?: boolean;
  onSave?: (value: string) => void;
  onPlay?: () => void;
  onExport?: (value: string) => void;
  onLineClick?: (lineIndex: number) => void;
  highlightLine?: number;
  readOnly?: boolean;
  className?: string;
}

export default function GCodeMonacoEditor({
  value,
  programLabel,
  moves = 0,
  playing = false,
  onSave,
  onPlay,
  onExport,
  onLineClick,
  highlightLine,
  readOnly = false,
  className = "",
}: Props) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const valueRef = useRef(value);
  const applyingRef = useRef(false);
  const onLineClickRef = useRef(onLineClick);
  valueRef.current = value;
  onLineClickRef.current = onLineClick;
  const [dirty, setDirty] = useState(false);
  const hasProgram = value.trim().length > 0 || dirty;

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerGCodeLanguage(monaco);
  }, []);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationsRef.current = editor.createDecorationsCollection([]);
    const loaded = valueRef.current.replace(/\r\n/g, "\n");
    if (editor.getValue().replace(/\r\n/g, "\n") !== loaded) {
      applyingRef.current = true;
      editor.setValue(loaded);
      applyingRef.current = false;
    }

    editor.onDidChangeCursorPosition((event) => {
      if (event.source !== "mouse" && event.source !== "keyboard") return;
      onLineClickRef.current?.(event.position.lineNumber - 1);
    });

    editor.onDidChangeModelContent(() => {
      if (applyingRef.current) return;
      const next = editor.getValue().replace(/\r\n/g, "\n");
      setDirty(next !== valueRef.current.replace(/\r\n/g, "\n"));
    });
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = value.replace(/\r\n/g, "\n");
    if (editor.getValue().replace(/\r\n/g, "\n") === next) {
      setDirty(false);
      return;
    }
    applyingRef.current = true;
    editor.setValue(next);
    applyingRef.current = false;
    setDirty(false);
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const decorations = decorationsRef.current;
    if (!editor || !monaco || !decorations || highlightLine === undefined) return;

    const lineNum = highlightLine + 1;
    decorations.set([
      {
        range: new monaco.Range(lineNum, 1, lineNum, 1),
        options: {
          isWholeLine: true,
          className: "gcode-highlight-line",
          glyphMarginClassName: "gcode-highlight-glyph",
        },
      },
    ]);
    editor.revealLineInCenterIfOutsideViewport(lineNum);
  }, [highlightLine]);

  const currentText = () => editorRef.current?.getValue().replace(/\r\n/g, "\n") ?? value;

  return (
    <div className={`relative w-full h-full flex flex-col ${className}`}>
      <div className="flex flex-col gap-1.5 px-3 py-2 bg-slate-800 border-b border-slate-700 text-xs shrink-0">
        <div className="flex items-center gap-2 text-slate-400">
          <span className="text-slate-200 font-medium">G-Code Editor</span>
          {programLabel && <span className="text-slate-500">{programLabel}</span>}
          {readOnly && <span className="text-yellow-400 animate-pulse">Generating…</span>}
          {dirty && <span className="text-amber-300">Unsaved</span>}
          <span className="ml-auto text-slate-500">{moves > 0 ? `${moves} moves` : "No moves yet"}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSave?.(currentText())}
            disabled={readOnly || !dirty}
            className="px-2.5 py-1 rounded bg-slate-100 text-slate-900 font-semibold disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => onPlay?.()}
            disabled={readOnly || dirty || moves === 0}
            className="px-2.5 py-1 rounded bg-cyan-600 text-white font-semibold disabled:opacity-40"
          >
            {playing ? "Stop" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => onExport?.(currentText())}
            disabled={readOnly || !hasProgram}
            className="px-2.5 py-1 rounded border border-slate-500 text-slate-100 font-semibold disabled:opacity-40"
          >
            Export .nc
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          {dirty
            ? "Save stores this edit. Play then follows the saved program in the 3D view."
            : "Play follows the saved program. Export downloads it for the machine."}
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={GCODE_LANGUAGE_ID}
          theme={GCODE_THEME_ID}
          defaultValue={value}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={{
            readOnly,
            fontSize: 14,
            lineHeight: 22,
            fontFamily: "'Cascadia Code', Consolas, monospace",
            fontLigatures: false,
            lineNumbers: "on",
            glyphMargin: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "off",
            wrappingIndent: "none",
            renderWhitespace: "none",
            folding: false,
            automaticLayout: true,
            tabSize: 2,
            detectIndentation: false,
            padding: { top: 8, bottom: 8 },
            cursorSmoothCaretAnimation: "on",
            smoothScrolling: true,
            overviewRulerBorder: false,
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          }}
        />
      </div>

      <style>{`
        .gcode-highlight-line {
          background: rgba(251, 191, 36, 0.12) !important;
          border-left: 2px solid #fbbf24 !important;
        }
        .gcode-highlight-glyph {
          background: #fbbf24;
          border-radius: 50%;
          width: 6px !important;
          height: 6px !important;
          margin-top: 8px;
          margin-left: 4px;
        }
      `}</style>
    </div>
  );
}
