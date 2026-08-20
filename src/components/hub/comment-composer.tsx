"use client";

import { useState, useRef, useTransition, useEffect, useCallback } from "react";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import { Send, Loader2, X, Bold, Italic, Link, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

type Comment = {
  id: string;
  linearId?: string;
  body: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string };
  isHubComment?: boolean;
  push_status?: string;
  push_error?: string;
  children?: Comment[];
};

type FileUpload = {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  publicUrl?: string;
  previewUrl?: string;
  error?: string;
};

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/plain",
];

const ACCEPT_STRING =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt";

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function CommentComposer({
  hubId,
  issueLinearId,
  replyingTo,
  onCancelReply,
  onCommentAdded,
}: {
  hubId: string;
  issueLinearId: string;
  replyingTo?: { parentId: string; authorName: string } | null;
  onCancelReply?: () => void;
  onCommentAdded: (comment: Comment) => void;
}) {
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [linkInput, setLinkInput] = useState<{
    visible: boolean;
    selectedText: string;
    selectionStart: number;
    selectionEnd: number;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const hasActiveUploads = uploads.some((u) => u.status === "uploading");

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      uploads.forEach((u) => {
        if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus textarea when reply target changes
  useEffect(() => {
    if (replyingTo) {
      textareaRef.current?.focus();
    }
  }, [replyingTo]);

  const insertTextAtCursor = useCallback(
    (text: string) => {
      const el = textareaRef.current;
      if (!el) {
        setBody((prev) => prev + text);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const current = el.value;
      const before = current.slice(0, start);
      const after = current.slice(end);
      // Add newline before if cursor isn't at start and previous char isn't newline
      const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
      const newValue = before + prefix + text + "\n" + after;
      setBody(newValue);
      requestAnimationFrame(() => {
        el.focus();
        const cursorPos = before.length + prefix.length + text.length + 1;
        el.setSelectionRange(cursorPos, cursorPos);
      });
    },
    []
  );

  const uploadFile = useCallback(
    async (file: File) => {
      const uploadId = crypto.randomUUID();
      const previewUrl = isImageFile(file)
        ? URL.createObjectURL(file)
        : undefined;

      const entry: FileUpload = {
        id: uploadId,
        file,
        status: "uploading",
        previewUrl,
      };

      setUploads((prev) => [...prev, entry]);

      try {
        // 1. Get signed URL
        const res = await fetch(`/api/hub/${hubId}/comments/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            fileSize: file.size,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error ?? `Upload failed (${res.status})`
          );
        }

        const { signedUrl, publicUrl, maxSize } = (await res.json()) as {
          signedUrl: string;
          publicUrl: string;
          maxSize: number;
        };

        // Check file size
        if (file.size > maxSize) {
          const maxMB = Math.round(maxSize / (1024 * 1024));
          throw new Error(`File too large (max ${maxMB}MB)`);
        }

        // 2. Upload to signed URL
        const putRes = await fetch(signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!putRes.ok) {
          throw new Error(`Upload failed (${putRes.status})`);
        }

        // 3. Mark done and insert markdown
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId ? { ...u, status: "done" as const, publicUrl } : u
          )
        );

        const markdown = isImageFile(file)
          ? `![${file.name}](${publicUrl})`
          : `[${file.name}](${publicUrl})`;

        insertTextAtCursor(markdown);
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Upload failed";
        setUploads((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? { ...u, status: "error" as const, error: errorMsg }
              : u
          )
        );
      }
    },
    [hubId, insertTextAtCursor]
  );

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      if (isPending) return;
      const fileArray = Array.from(files);
      for (const file of fileArray) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          setUploads((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              file,
              status: "error",
              error: `Unsupported file type: ${file.type || "unknown"}`,
            },
          ]);
          continue;
        }
        uploadFile(file);
      }
    },
    [uploadFile, isPending]
  );

  const removeUpload = useCallback((id: string) => {
    setUploads((prev) => {
      const upload = prev.find((u) => u.id === id);
      if (upload?.previewUrl) URL.revokeObjectURL(upload.previewUrl);
      // Remove the inserted markdown from the body
      if (upload?.publicUrl) {
        const imgMarkdown = `![${upload.file.name}](${upload.publicUrl})`;
        const linkMarkdown = `[${upload.file.name}](${upload.publicUrl})`;
        setBody((prevBody) => {
          let updated = prevBody.replace(imgMarkdown, "");
          updated = updated.replace(linkMarkdown, "");
          // Clean up leftover blank lines
          updated = updated.replace(/\n{3,}/g, "\n\n").trim();
          return updated;
        });
      }
      return prev.filter((u) => u.id !== id);
    });
  }, []);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  // Clipboard paste handler
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const imageFiles: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        processFiles(imageFiles);
      }
      // If no image files, let the default text paste happen
    },
    [processFiles]
  );

  function handleSubmit() {
    if (!body.trim() || isPending || hasActiveUploads) return;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/hub/${hubId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueLinearId,
            body: body.trim(),
            parentId: replyingTo?.parentId ?? undefined,
          }),
        });

        if (!res.ok) return;

        const data = (await res.json()) as Comment;
        onCommentAdded({
          id: data.id,
          body: data.body ?? body.trim(),
          parentId: replyingTo?.parentId ?? undefined,
          createdAt: data.createdAt ?? new Date().toISOString(),
          updatedAt: data.updatedAt ?? new Date().toISOString(),
          user: data.user,
          isHubComment: true,
          push_status: data.push_status,
          push_error: data.push_error,
        });
        setBody("");
        // Clear completed/errored uploads
        setUploads((prev) => {
          prev.forEach((u) => {
            if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
          });
          return [];
        });
        captureEvent(POSTHOG_EVENTS.comment_created);
        onCancelReply?.();

        // Reset textarea height
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      } catch {
        // silently fail — the comment wasn't saved
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.metaKey || e.ctrlKey) {
      if (e.key === "b") {
        e.preventDefault();
        handleBold();
        return;
      }
      if (e.key === "i") {
        e.preventDefault();
        handleItalic();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
        return;
      }
    }
    if (e.key === "Escape" && replyingTo) {
      onCancelReply?.();
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  const wrapSelection = useCallback(
    (before: string, after: string, placeholder: string) => {
      const el = textareaRef.current;
      if (!el) return;

      const current = el.value;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = current.slice(start, end);
      const text = selected || placeholder;
      const newValue =
        current.slice(0, start) + before + text + after + current.slice(end);

      setBody(newValue);

      // Restore cursor: select the inserted text (not the wrapper chars)
      requestAnimationFrame(() => {
        el.focus();
        const cursorStart = start + before.length;
        const cursorEnd = cursorStart + text.length;
        el.setSelectionRange(cursorStart, cursorEnd);
      });
    },
    []
  );

  const handleBold = useCallback(() => {
    wrapSelection("**", "**", "bold");
  }, [wrapSelection]);

  const handleItalic = useCallback(() => {
    wrapSelection("*", "*", "italic");
  }, [wrapSelection]);

  const handleLink = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.slice(start, end);

    if (selected) {
      // Has selection — show inline URL input
      setLinkInput({
        visible: true,
        selectedText: selected,
        selectionStart: start,
        selectionEnd: end,
      });
      requestAnimationFrame(() => linkInputRef.current?.focus());
    } else {
      // No selection — insert placeholder markdown
      const current = el.value;
      const placeholder = "[link text](url)";
      const newValue = current.slice(0, start) + placeholder + current.slice(end);
      setBody(newValue);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + 1, start + 10);
      });
    }
  }, []);

  const handleLinkSubmit = useCallback(
    (url: string) => {
      if (!linkInput) return;
      const el = textareaRef.current;
      const current = el?.value ?? body;
      const { selectedText, selectionStart, selectionEnd } = linkInput;
      const replacement = `[${selectedText}](${url || "url"})`;
      const newValue =
        current.slice(0, selectionStart) + replacement + current.slice(selectionEnd);
      setBody(newValue);
      setLinkInput(null);
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          const cursorPos = selectionStart + replacement.length;
          el.setSelectionRange(cursorPos, cursorPos);
        }
      });
    },
    [linkInput, body]
  );

  const handleLinkCancel = useCallback(() => {
    setLinkInput(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
      }
      // Reset so the same file can be selected again
      e.target.value = "";
    },
    [processFiles]
  );

  return (
    <div className="border-t border-border p-4 shrink-0">
      {replyingTo && (
        <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
          <span>
            Replying to{" "}
            <span className="font-medium text-foreground">
              {replyingTo.authorName}
            </span>
          </span>
          <button
            onClick={onCancelReply}
            className="ml-auto p-0.5 rounded hover:bg-muted transition-colors"
            title="Cancel reply"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <div
          className={cn(
            "flex-1 flex flex-col border rounded-md bg-background transition-colors",
            isDragOver
              ? "border-dashed border-primary/60 bg-primary/[0.03]"
              : "border-border",
            "focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent"
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {linkInput?.visible ? (
            <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
              <Link className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                ref={linkInputRef}
                type="url"
                placeholder="Paste or type URL..."
                className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/60"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleLinkSubmit(e.currentTarget.value);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    handleLinkCancel();
                  }
                }}
                onBlur={(e) => {
                  // Submit if there's a value, otherwise cancel
                  if (e.currentTarget.value.trim()) {
                    handleLinkSubmit(e.currentTarget.value);
                  } else {
                    handleLinkCancel();
                  }
                }}
              />
              <span className="text-[10px] text-muted-foreground shrink-0">
                Enter to apply · Esc to cancel
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-0.5">
              <button
                type="button"
                onClick={handleBold}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Bold (Cmd+B)"
                aria-label="Bold"
                tabIndex={-1}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleItalic}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Italic (Cmd+I)"
                aria-label="Italic"
                tabIndex={-1}
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleLink}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Link"
                aria-label="Insert link"
                tabIndex={-1}
              >
                <Link className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-3.5 bg-border mx-0.5" />
              <button
                type="button"
                onClick={handleAttachClick}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Attach file"
                aria-label="Attach file"
                tabIndex={-1}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_STRING}
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isDragOver
                ? "Drop files here..."
                : replyingTo
                  ? "Write a reply..."
                  : "Add a comment..."
            }
            rows={1}
            className={cn(
              "flex-1 resize-none px-3 py-2 text-sm bg-transparent",
              "focus:outline-none",
              "placeholder:text-muted-foreground/60"
            )}
            disabled={isPending}
          />
          {/* Upload previews */}
          {uploads.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-2">
              {uploads.map((upload) => (
                <div
                  key={upload.id}
                  className={cn(
                    "group relative flex items-center gap-1.5 rounded border px-2 py-1 text-xs",
                    upload.status === "uploading" &&
                      "border-border bg-muted/50 text-muted-foreground",
                    upload.status === "done" &&
                      "border-border bg-muted/30 text-foreground",
                    upload.status === "error" &&
                      "border-destructive/40 bg-destructive/5 text-destructive"
                  )}
                >
                  {/* Thumbnail for images */}
                  {upload.previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={upload.previewUrl}
                      alt=""
                      className="h-8 w-8 rounded object-cover shrink-0"
                    />
                  )}
                  <div className="flex flex-col min-w-0 max-w-[120px]">
                    <span className="truncate text-[11px] leading-tight">
                      {upload.file.name}
                    </span>
                    {upload.status === "uploading" && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        Uploading...
                      </span>
                    )}
                    {upload.status === "error" && (
                      <span className="text-[10px] text-destructive truncate">
                        {upload.error}
                      </span>
                    )}
                  </div>
                  {/* Remove button */}
                  {upload.status !== "uploading" && (
                    <button
                      type="button"
                      onClick={() => removeUpload(upload.id)}
                      className="ml-0.5 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={!body.trim() || isPending || hasActiveUploads}
          aria-label="Submit comment"
          className={cn(
            "px-3 py-2 rounded-md transition-colors shrink-0 self-end",
            body.trim() && !hasActiveUploads
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
          title={
            hasActiveUploads
              ? "Wait for uploads to finish"
              : "Submit (Cmd+Enter)"
          }
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        Markdown supported. Cmd+B bold, Cmd+I italic, Cmd+Enter to submit.
        Drag-and-drop or paste images.
      </p>
    </div>
  );
}
