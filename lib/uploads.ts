import { File as PrismaFile, User } from "@/prisma/client"
import { createFile } from "@/models/files"
import { randomUUID } from "crypto"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import sharp from "sharp"
import config from "./config"
import { getStaticDirectory, getUserUploadsDirectory, isEnoughStorageToUploadFile, safePathJoin, unsortedFilePath } from "./files"

// Cap individual uploads at 50 MiB regardless of `bodySizeLimit`. Even if
// the Next.js config allows 256 MiB, anything beyond a few MiB per file is
// almost certainly abusive for an invoice/transaction app.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

// Map of allowed mimetypes for unsorted ingest. Anything else is rejected
// before we write bytes to disk so we don't end up serving attacker-uploaded
// HTML/SVG/JS back to authenticated users.
const ALLOWED_INGEST_MIMETYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
])

// Restrict the extensions we'll accept to the same set so that a malicious
// filename like `evil.html` cannot be stored even if the mimetype is correct.
const ALLOWED_INGEST_EXTENSIONS = new Set<string>([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
])

function isAllowedIngest(input: { filename: string; mimetype: string }) {
  if (ALLOWED_INGEST_MIMETYPES.has(input.mimetype)) {
    const ext = path.extname(input.filename).slice(1).toLowerCase()
    if (ext && ALLOWED_INGEST_EXTENSIONS.has(ext)) return true
  }
  return false
}

export async function uploadStaticImage(
  user: User,
  file: File,
  saveFileName: string,
  maxWidth: number = config.upload.images.maxWidth,
  maxHeight: number = config.upload.images.maxHeight,
  quality: number = config.upload.images.quality
) {
  const uploadDirectory = getStaticDirectory(user)

  if (file.size > MAX_UPLOAD_BYTES) {
    throw Error("File is too large to upload")
  }
  if (!isEnoughStorageToUploadFile(user, file.size)) {
    throw Error("Not enough space to upload the file")
  }

  await mkdir(uploadDirectory, { recursive: true })

  // Get target format from saveFileName extension
  const targetFormat = path.extname(saveFileName).slice(1).toLowerCase()
  if (!targetFormat) {
    throw Error("Target filename must have an extension")
  }

  // Convert image and save to static folder
  const uploadFilePath = safePathJoin(uploadDirectory, saveFileName)
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const sharpInstance = sharp(buffer).rotate().resize(maxWidth, maxHeight, {
    fit: "inside",
    withoutEnlargement: true,
  })

  // Set output format and quality
  switch (targetFormat) {
    case "png":
      await sharpInstance.png().toFile(uploadFilePath)
      break
    case "jpg":
    case "jpeg":
      await sharpInstance.jpeg({ quality }).toFile(uploadFilePath)
      break
    case "webp":
      await sharpInstance.webp({ quality }).toFile(uploadFilePath)
      break
    case "avif":
      await sharpInstance.avif({ quality }).toFile(uploadFilePath)
      break
    default:
      throw Error(`Unsupported target format: ${targetFormat}`)
  }

  return uploadFilePath
}

export async function ingestUnsortedFile(
  user: User,
  input: { buffer: Buffer; filename: string; mimetype: string; metadata?: Record<string, unknown> }
): Promise<PrismaFile> {
  if (input.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("File is too large to upload")
  }
  if (!isAllowedIngest(input)) {
    throw new Error("Unsupported file type")
  }
  if (!isEnoughStorageToUploadFile(user, input.buffer.length)) {
    throw new Error("Not enough space to upload the file")
  }

  const fileUuid = randomUUID()
  const relativeFilePath = unsortedFilePath(fileUuid, input.filename)
  const fullFilePath = safePathJoin(getUserUploadsDirectory(user), relativeFilePath)

  await mkdir(path.dirname(fullFilePath), { recursive: true })
  await writeFile(fullFilePath, input.buffer)

  return await createFile(user.id, {
    id: fileUuid,
    filename: input.filename,
    path: relativeFilePath,
    mimetype: input.mimetype,
    metadata: { size: input.buffer.length, ...input.metadata },
  })
}
