import { getCurrentUser } from "@/lib/auth"
import { fileExists, getStaticDirectory, safePathJoin } from "@/lib/files"
import fs from "fs/promises"
import lookup from "mime-types"
import { NextResponse } from "next/server"

// Never render the static file as something the browser can execute as code.
const UNSAFE_STATIC_MIMETYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
])

export async function GET(request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params
  const user = await getCurrentUser()

  if (!filename) {
    return new NextResponse("No filename provided", { status: 400 })
  }

  const staticFilesDirectory = getStaticDirectory(user)

  try {
    const fullFilePath = safePathJoin(staticFilesDirectory, filename)
    const isFileExists = await fileExists(fullFilePath)
    if (!isFileExists) {
      return new NextResponse("File not found", { status: 404 })
    }

    const fileBuffer = await fs.readFile(fullFilePath)

    const resolved = lookup.lookup(filename) || "application/octet-stream"
    const safeMime = UNSAFE_STATIC_MIMETYPES.has(resolved) ? "application/octet-stream" : resolved

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": safeMime,
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Error serving static file", error instanceof Error ? error.message : "unknown")
    return new NextResponse("Internal Server Error", { status: 500 })
  }
}
