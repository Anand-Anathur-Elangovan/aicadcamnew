"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/types";
import { CitationCard } from "./CitationCard";
import { Bot, Loader2, User } from "lucide-react";
import { dedupeCitations } from "@/lib/chat/evidence";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  /** What the assistant is doing while it has not started writing yet. */
  status?: string;
}

export function MessageBubble({ message, isStreaming, status }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const waiting = !isUser && Boolean(isStreaming) && message.content.length === 0;
  // Older saved answers may list the same page twice, so show each source once.
  const sources = dedupeCitations(message.citations ?? []);

  return (
    <div className={cn("flex gap-3 group", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-white",
          isUser ? "bg-blue-600" : "bg-gray-700"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div className={cn("flex-1 space-y-3 max-w-3xl", isUser && "flex flex-col items-end")}>
        {/* Message bubble */}
        <div
          className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "bg-blue-600 text-white"
              : "bg-white border border-gray-200 text-gray-900"
          )}
        >
          {waiting && (
            <div className="flex items-center gap-2 text-sm text-gray-500" role="status" aria-live="polite" data-testid="chat-loader">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <span>{status || "Thinking"}</span>
              <span className="flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" />
              </span>
            </div>
          )}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-");
                return isBlock ? (
                  <pre className="mt-2 rounded-lg bg-gray-900 p-3 overflow-x-auto text-xs">
                    <code className="text-green-300">{children}</code>
                  </pre>
                ) : (
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-sm font-mono text-gray-800">{children}</code>
                );
              },
              table: ({ children }) => (
                <div className="overflow-x-auto mt-2 mb-2">
                  <table className="min-w-full text-sm border-collapse border border-gray-300 rounded-lg">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-gray-300 bg-gray-100 px-3 py-2 text-left font-semibold text-gray-800">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-gray-300 px-3 py-2 text-gray-700">{children}</td>
              ),
              ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 my-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 my-2">{children}</ol>,
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
            }}
          >
            {message.content}
          </ReactMarkdown>

          {/* Streaming cursor */}
          {isStreaming && !waiting && (
            <span className="inline-block h-4 w-0.5 bg-current animate-pulse ml-0.5 align-middle" />
          )}
        </div>

        {/* Citations Panel */}
        {!isUser && sources.length > 0 && !isStreaming && (
          <div className="space-y-2 w-full">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Sources ({sources.length})
            </p>
            <div className="space-y-2">
              {sources.map((citation) => (
                <CitationCard key={`${citation.documentId}:${citation.pageNumber ?? 0}`} citation={citation} />
              ))}
            </div>
          </div>
        )}

        {/* Timestamp */}
        <p className="text-xs text-gray-400 px-1">
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}
