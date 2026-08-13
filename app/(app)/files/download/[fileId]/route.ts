import { getCurrentUser } from "@/lib/auth"
import { fileExists, fullPathForFile } from "@/lib/files"
import { encodeFilename } from "@/lib/utils"
import { getFileById } from "@/models/files"
import fs from "fs/promises"
import { NextResponse } from "next/server"

// Browsers can execute attacker-controlled HTML/JS if we hand them back with
// a `text/html` content-type. Force `application/octet-stream` for any mimetype
// that could be rendered (HTML, XML, SVG) and require the file to be saved,
// not rendered in the browser tab.
const UNSAFE_DOWNLOAD_MIMETYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
])

export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params
  const user = await getCurrentUser()

  if (!fileId) {
    return new NextResponse("No fileId provided", { status: 400 })
  }

  try {
    // Find file in database
    const file = await getFileById(fileId, user.id)

    if (!file || file.userId !== user.id) {
      return new NextResponse("File not found or does not belong to the user", { status: 404 })
    }

    // Check if file exists
    const fullFilePath = fullPathForFile(user, file)
    const isFileExists = await fileExists(fullFilePath)
    if (!isFileExists) {
      return new NextResponse("File not found on disk", { status: 404 })
    }

    // Read file
    const fileBuffer = await fs.readFile(fullFilePath)

    const safeMime = UNSAFE_DOWNLOAD_MIMETYPES.has(file.mimetype) ? "application/octet-stream" : file.mimetype
    const dispositionType = safeMime === file.mimetype ? "inline" : "attachment"

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": safeMime,
        "Content-Disposition": `${dispositionType}; filename*=${encodeFilename(file.filename)}`,
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Error serving file", error instanceof Error ? error.message : "unknown")
    return new NextResponse("Internal Server Error", { status: 500 })
  }
}
