// Minimal TUS 1.0.0 client (creation + PATCH chunks + HEAD resume) for
// Supabase resumable uploads. tus-js-client costs ~17 KB gz in the widget
// bundle, which blows the PULSE-323 budget; we only need a single in-session
// upload so this ~1 KB client is enough.

export interface TusOptions {
  endpoint: string
  headers: Record<string, string>
  metadata: Record<string, string>
  chunkSize: number
  retries?: number
  retryDelayMs?: number
  onProgress?: (sent: number, total: number) => void
}

const TUS_VERSION = '1.0.0'

export class TusError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'TusError'
  }
}

interface XhrResult {
  status: number
  header(name: string): string | null
}

function request(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Blob | null,
  onProgress?: (sent: number) => void
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value)
    }
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded)
      }
    }
    xhr.onload = () =>
      resolve({ status: xhr.status, header: (name) => xhr.getResponseHeader(name) })
    xhr.onerror = () => reject(new TusError(`${method} failed (network error)`))
    xhr.onabort = () => reject(new TusError(`${method} aborted`))
    xhr.send(body)
  })
}

function encodeMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${btoa(unescape(encodeURIComponent(value)))}`)
    .join(',')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createUpload(size: number, opts: TusOptions): Promise<string> {
  const res = await request(
    'POST',
    opts.endpoint,
    {
      ...opts.headers,
      'Tus-Resumable': TUS_VERSION,
      'Upload-Length': String(size),
      'Upload-Metadata': encodeMetadata(opts.metadata),
    },
    null
  )
  if (res.status !== 201) {
    throw new TusError(`Could not create resumable upload (HTTP ${res.status})`, res.status)
  }
  const location = res.header('Location')
  if (!location) throw new TusError('Resumable upload created without a Location')
  return new URL(location, opts.endpoint).toString()
}

async function currentOffset(location: string, opts: TusOptions): Promise<number> {
  const res = await request(
    'HEAD',
    location,
    { ...opts.headers, 'Tus-Resumable': TUS_VERSION },
    null
  )
  const offset = Number(res.header('Upload-Offset'))
  if (res.status !== 200 || !Number.isFinite(offset)) {
    throw new TusError(`Could not read upload offset (HTTP ${res.status})`, res.status)
  }
  return offset
}

async function patchChunk(
  location: string,
  chunk: Blob,
  offset: number,
  opts: TusOptions,
  onProgress: (sent: number) => void
): Promise<number> {
  const res = await request(
    'PATCH',
    location,
    {
      ...opts.headers,
      'Tus-Resumable': TUS_VERSION,
      'Upload-Offset': String(offset),
      'Content-Type': 'application/offset+octet-stream',
    },
    chunk,
    onProgress
  )
  const next = Number(res.header('Upload-Offset'))
  if (res.status !== 204 || !Number.isFinite(next)) {
    throw new TusError(`Chunk upload failed (HTTP ${res.status})`, res.status)
  }
  return next
}

export async function tusUpload(blob: Blob, opts: TusOptions): Promise<void> {
  const retries = opts.retries ?? 3
  const retryDelayMs = opts.retryDelayMs ?? 1000
  const location = await createUpload(blob.size, opts)

  let offset = 0
  let failures = 0
  while (offset < blob.size) {
    const end = Math.min(offset + opts.chunkSize, blob.size)
    const base = offset
    try {
      offset = await patchChunk(location, blob.slice(offset, end), offset, opts, (sent) =>
        opts.onProgress?.(base + sent, blob.size)
      )
      failures = 0
    } catch (error) {
      if (++failures > retries) throw error
      await delay(retryDelayMs * failures)
      offset = await currentOffset(location, opts)
    }
  }
  opts.onProgress?.(blob.size, blob.size)
}
