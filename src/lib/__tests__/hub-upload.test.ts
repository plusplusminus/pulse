import { describe, expect, it } from "vitest";
import {
  IMAGE_MAX_SIZE,
  OTHER_MAX_SIZE,
  isHubAttachmentUrl,
  isImageMimeType,
  maxSizeForMimeType,
  publicAttachmentUrl,
  sanitizeFilename,
  validateUploadRequest,
} from "../hub-upload";

describe("hub-upload validation", () => {
  describe("validateUploadRequest", () => {
    it("accepts a valid image", () => {
      const result = validateUploadRequest({
        filename: "photo.png",
        contentType: "image/png",
        fileSize: 1024,
      });
      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.maxSize).toBe(IMAGE_MAX_SIZE);
      }
    });

    it("accepts a valid PDF", () => {
      const result = validateUploadRequest({
        filename: "spec.pdf",
        contentType: "application/pdf",
        fileSize: 2 * 1024 * 1024,
      });
      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.maxSize).toBe(OTHER_MAX_SIZE);
      }
    });

    it("rejects an unknown MIME type", () => {
      const result = validateUploadRequest({
        filename: "binary.exe",
        contentType: "application/x-msdownload",
        fileSize: 100,
      });
      expect("error" in result).toBe(true);
    });

    it("rejects an oversized image", () => {
      const result = validateUploadRequest({
        filename: "huge.png",
        contentType: "image/png",
        fileSize: IMAGE_MAX_SIZE + 1,
      });
      expect("error" in result).toBe(true);
    });

    it("rejects an oversized PDF", () => {
      const result = validateUploadRequest({
        filename: "huge.pdf",
        contentType: "application/pdf",
        fileSize: OTHER_MAX_SIZE + 1,
      });
      expect("error" in result).toBe(true);
    });

    it("rejects missing fields", () => {
      expect("error" in validateUploadRequest({})).toBe(true);
      expect(
        "error" in
          validateUploadRequest({ filename: "x.png", contentType: "image/png" })
      ).toBe(true);
      expect(
        "error" in
          validateUploadRequest({
            filename: "x.png",
            contentType: "image/png",
            fileSize: 0,
          })
      ).toBe(true);
    });
  });

  describe("isImageMimeType", () => {
    it("identifies images", () => {
      expect(isImageMimeType("image/png")).toBe(true);
      expect(isImageMimeType("image/svg+xml")).toBe(true);
    });
    it("rejects non-images", () => {
      expect(isImageMimeType("application/pdf")).toBe(false);
      expect(isImageMimeType("text/plain")).toBe(false);
    });
  });

  describe("maxSizeForMimeType", () => {
    it("returns image cap for images", () => {
      expect(maxSizeForMimeType("image/jpeg")).toBe(IMAGE_MAX_SIZE);
    });
    it("returns other cap for everything else", () => {
      expect(maxSizeForMimeType("application/pdf")).toBe(OTHER_MAX_SIZE);
    });
  });

  describe("sanitizeFilename", () => {
    it("strips path separators and exotic chars", () => {
      expect(sanitizeFilename("../etc/passwd")).toBe(".._etc_passwd");
      expect(sanitizeFilename("my report (final).pdf")).toBe(
        "my_report__final_.pdf"
      );
    });
    it("falls back to a default when input collapses to empty", () => {
      expect(sanitizeFilename("///")).toBe("___");
      expect(sanitizeFilename("")).toBe("file");
    });
  });

  describe("publicAttachmentUrl", () => {
    it("composes a Supabase public URL", () => {
      expect(
        publicAttachmentUrl(
          "https://abc.supabase.co",
          "form-attachments",
          "hub-1/abc.pdf"
        )
      ).toBe(
        "https://abc.supabase.co/storage/v1/object/public/form-attachments/hub-1/abc.pdf"
      );
    });
  });

  describe("isHubAttachmentUrl", () => {
    it("matches comment-attachments URLs", () => {
      expect(
        isHubAttachmentUrl(
          "https://x.supabase.co/storage/v1/object/public/comment-attachments/hub-1/comments/abc.pdf"
        )
      ).toBe(true);
    });
    it("matches form-attachments URLs", () => {
      expect(
        isHubAttachmentUrl(
          "https://x.supabase.co/storage/v1/object/public/form-attachments/hub-1/abc.pdf"
        )
      ).toBe(true);
    });
    it("does not match unrelated URLs", () => {
      expect(isHubAttachmentUrl("https://example.com/file.pdf")).toBe(false);
      expect(
        isHubAttachmentUrl("https://uploads.linear.app/abc/file.pdf")
      ).toBe(false);
    });
  });
});
