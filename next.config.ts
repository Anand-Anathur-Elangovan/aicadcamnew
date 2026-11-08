import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the native canvas binding and PDF.js out of the server bundle so
  // DOMMatrix is available while reading drawings.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "@langchain/langgraph", "@langchain/core"],
  // Vercel only ships traced files. PDF.js loads its worker by path at run time,
  // so tracing cannot see it; list it here or reading a PDF fails in production.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/pdf-parse/dist/**/*",
      "./node_modules/pdfjs-dist/build/**/*",
    ],
  },
};

export default nextConfig;
