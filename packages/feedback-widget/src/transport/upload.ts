import { tusUpload } from './tus'

// Direct browser -> Supabase Storage uploads (PULSE-323). The Pulse API only
// mints a signed ticket; bytes never pass through it.

export type UploadKind = 'screenshot' | 'video' | 'replay'

export interface UploadTicket {
  uploadUrl: string
  token: string
  storagePath: string
  expiresAt: string
  resumableEndpoint: string
  bucket: string
  maxBytes: number
}

export interface UploadOptions {
  /** Called with bytes sent so far and the total. */
  onProgress?: (sent: number, total: number) => void
  /** Overrides blob.type when the blob has none. */
  contentType?: string
}

// Supabase resumable uploads require exactly 6 MB chunks; anything at or
// below one chunk goes as a single signed PUT instead.
const CHUNK_BYTES = 6 * 1024 * 1024

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly step: 'ticket' | 'put' | 'resumable',
    public readonly status?: number
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

export async function uploadBlob(
  apiUrl: string,
  widgetKey: string,
  kind: UploadKind,
  blob: Blob,
  options: UploadOptions = {}
): Promise<string> {
  const contentType = options.contentType ?? blob.type
  if (!contentType) {
    throw new UploadError(`Cannot upload ${kind}: blob has no content type`, 'ticket')
  }

  const ticket = await requestTicket(apiUrl, widgetKey, {
    kind,
    contentType,
    sizeBytes: blob.size,
  })

  if (blob.size > CHUNK_BYTES) {
    await uploadResumable(ticket, blob, contentType, options.onProgress)
  } else {
    await uploadSigned(ticket.uploadUrl, blob, contentType, options.onProgress)
  }

  return ticket.storagePath
}

async function requestTicket(
  apiUrl: string,
  widgetKey: string,
  body: { kind: UploadKind; contentType: string; sizeBytes: number }
): Promise<UploadTicket> {
  let response: Response
  try {
    response = await fetch(`${apiUrl}/api/widget/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Widget-Key': widgetKey,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new UploadError('Could not reach the upload service', 'ticket')
  }

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new UploadError(
      error.error ?? `Upload request failed (HTTP ${response.status})`,
      'ticket',
      response.status
    )
  }

  return response.json() as Promise<UploadTicket>
}

// Mirrors supabase-js uploadToSignedUrl: PUT the raw body to the signed URL
// (which already carries ?token=). XHR rather than fetch for upload progress.
function uploadSigned(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  onProgress?: UploadOptions['onProgress']
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(blob.size, blob.size)
        resolve()
      } else {
        reject(new UploadError(`Upload failed (HTTP ${xhr.status})`, 'put', xhr.status))
      }
    }
    xhr.onerror = () => reject(new UploadError('Upload failed (network error)', 'put'))
    xhr.onabort = () => reject(new UploadError('Upload aborted', 'put'))
    xhr.send(blob)
  })
}

// Supabase TUS endpoint with the signed upload token in x-signature.
async function uploadResumable(
  ticket: UploadTicket,
  blob: Blob,
  contentType: string,
  onProgress?: UploadOptions['onProgress']
): Promise<void> {
  try {
    await tusUpload(blob, {
      endpoint: ticket.resumableEndpoint,
      headers: { 'x-signature': ticket.token },
      chunkSize: CHUNK_BYTES,
      metadata: {
        bucketName: ticket.bucket,
        objectName: ticket.storagePath,
        contentType,
        cacheControl: '3600',
      },
      onProgress,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new UploadError(`Resumable upload failed: ${message}`, 'resumable')
  }
}
