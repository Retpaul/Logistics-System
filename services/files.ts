import { Id } from "../contracts/index.js";
import { forbidden, notFound, AppError } from "../lib/errors.js";
import type { AuthContext } from "../lib/tokens.js";
import { prisma } from "../startup/db.js";
import { uploadBlob, deleteBlob, getDownloadUrl } from "./storage.js";
import { riderFor } from "./dispatch.js";

export async function saveRiderFile(
  auth: AuthContext,
  file: Express.Multer.File | undefined,
  purpose: unknown,
) {
  if (!file || !["LICENSE", "INSURANCE", "PROOF"].includes(String(purpose)))
    throw new AppError(
      400,
      "VALIDATION_FAILED",
      "Choose a file and valid purpose",
    );
  const rider = await riderFor(auth);
  if (rider.onboardingStatus === "INVITED") throw forbidden();
  const b = file.buffer;
  const type =
    b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
      ? "image/jpeg"
      : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : b.subarray(0, 5).toString() === "%PDF-"
          ? "application/pdf"
          : null;
  if (!type || (purpose === "PROOF" && type === "application/pdf"))
    throw new AppError(
      400,
      "VALIDATION_FAILED",
      "Use a JPEG/PNG photo, or PDF for documents",
    );
  const stored = await uploadBlob({
    tenantId: auth.tenantId,
    body: b,
    filename: file.originalname,
    contentType: type,
  });
  try {
    const saved = await prisma.storedFile.create({
      data: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        ...stored,
        purpose: String(purpose),
      },
    });
    return { id: saved.id, filename: saved.filename };
  } catch (e) {
    try {
      await deleteBlob({ tenantId: auth.tenantId, key: stored.key });
    } catch {
      console.warn("File metadata save failed; orphan cleanup required");
    }
    throw e;
  }
}
export async function fileDownload(auth: AuthContext, id: string) {
  const file = await prisma.storedFile.findFirst({
    where: {
      id: Id.parse(id),
      tenantId: auth.tenantId,
      ...(auth.role === "RIDER" ? { userId: auth.userId } : {}),
    },
  });
  if (!file) throw notFound("File");
  return getDownloadUrl({
    tenantId: auth.tenantId,
    key: file.key,
    filename: file.filename,
  });
}
