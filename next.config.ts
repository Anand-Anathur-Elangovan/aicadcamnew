import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the native canvas binding and PDF.js out of the server bundle so
  // DOMMatrix is available while reading drawings.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "@langchain/langgraph", "@langchain/core"],
};

export default nextConfig;
