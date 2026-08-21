import type {
  RuntimeConfig,
  ScreenshotAnnotation,
  SubmitResult,
  WidgetState,
  WidgetPick,
} from './types'
import { getWidgetStyles } from './ui/styles'
import { TriggerButton } from './ui/trigger'
import { BAR_IN_RECORDING_NOTICE, FeedbackPanel, type PanelFormData } from './ui/panel'
import {
  MicLevelMeter,
  isGetUserMediaSupported,
  micNotice,
  requestMicStream,
} from './capture/mic'
import { AnnotationCanvas } from './ui/annotation'
import { ElementPicker, type DragRect, type Point } from './capture/pick-mode'
import { buildPick, buildMultiPick, buildAreaPick } from './capture/pick-builder'
import { MultiSelection } from './capture/multi-select'
import { collectAreaCandidates, findMarqueeElements, resolveMarquee } from './capture/area-select'
import { PageFreezer } from './capture/freeze'
import { captureSelectedText, clearSelection } from './capture/text-selection'
import {
  frameFromStream,
  isUserCancel,
  requestTabStream,
  type CaptureSurface,
} from './capture/tab-capture'
import { isGetDisplayMediaSupported } from './capture/display-media'
import {
  createVideoRecorder,
  requestRecordingStream,
  stopTracks,
  type VideoRecorder,
  type VideoRecording,
} from './capture/video'
import { webmDurationPostProcess } from './capture/webm-duration'
import { PickPopup, type PickPopupResult } from './ui/pick-popup'
import { PickMarkers, type Marker } from './ui/pick-markers'
import { PickOutlines } from './ui/pick-outlines'
import { PickStatus } from './ui/pick-status'
import { Marquee } from './ui/marquee'
import { RecordingBar } from './ui/recording-bar'

export interface PulseCore {
  submitFeedback(data: {
    title: string
    description?: string
    type: 'bug' | 'feedback' | 'idea'
    email: string
    name?: string
    screenshot?: Blob | null
    video?: { blob: Blob; mimeType: string } | null
    picks?: WidgetPick[]
    screenshotAnnotations?: ScreenshotAnnotation[]
    captureSurface?: CaptureSurface
    onUploadProgress?: (sent: number, total: number) => void
  }): Promise<SubmitResult>
  captureScreenshot(): Promise<Blob | null>
  setWidgetHost(host: HTMLElement): void
  getRuntimeConfig(): RuntimeConfig
  getUser(): { email?: string; name?: string }
}

export class Widget {
  private host!: HTMLElement
  private shadow!: ShadowRoot
  private styleEl!: HTMLStyleElement
  private trigger!: TriggerButton
  private panel!: FeedbackPanel
  private annotation: AnnotationCanvas | null = null
  private picker: ElementPicker | null = null
  private popup: PickPopup | null = null
  private markers: PickMarkers | null = null
  private outlines: PickOutlines | null = null
  private status: PickStatus | null = null
  private marquee: Marquee | null = null
  /** Candidate elements snapshotted once per drag; the page cannot change mid-marquee. */
  private dragCandidates: Element[] = []
  private picks: WidgetPick[] = []
  private markersById = new Map<string, Marker>()
  private pendingPick: { pick: WidgetPick; marker: Marker } | null = null
  private editingPickId: string | null = null
  private multi = new MultiSelection()
  private freezer = new PageFreezer()
  private lastModifierPoint: Point | null = null
  private state: WidgetState = 'closed'
  private currentScreenshot: Blob | null = null
  /** Bitmap as captured, so re-annotating never stacks rects onto a flattened export. */
  private originalScreenshot: Blob | null = null
  private annotations: ScreenshotAnnotation[] = []
  private captureSurface: CaptureSurface | undefined
  private recorder: VideoRecorder | null = null
  private recording: VideoRecording | null = null
  private recordingBar: RecordingBar | null = null
  /** Voice-over opt-in (PULSE-400). False means no getUserMedia call is reachable. */
  private voiceOver = false
  /** Live only for the duration of a recording; muting never stops it. */
  private micTrack: MediaStreamTrack | null = null
  private levelMeter: MicLevelMeter | null = null
  private user: { email?: string; name?: string }
  private themeQuery: MediaQueryList | null = null
  private themeHandler: ((e: MediaQueryListEvent) => void) | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(
    private pulse: PulseCore,
    private config: RuntimeConfig
  ) {
    this.user = { ...config.user }
  }

  mount(): void {
    this.host = document.createElement('div')
    this.host.id = 'pulse-widget'
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: 'closed' })

    const resolvedTheme = this.resolveTheme()
    this.styleEl = document.createElement('style')
    this.styleEl.textContent = getWidgetStyles(resolvedTheme)
    this.shadow.appendChild(this.styleEl)

    this.trigger = new TriggerButton(this.shadow, {
      text: this.config.ui.triggerText,
      position: this.config.ui.position,
      onClick: () => this.open(),
    })

    this.panel = new FeedbackPanel(this.shadow, {
      position: this.config.ui.position,
      user: this.user,
      allowScreenshot: this.config.capture.screenshot,
      allowElementPick: this.config.capture.elementPick,
      // One helper for both: the two getDisplayMedia features can never
      // disagree about what the browser supports (PULSE-339).
      allowCaptureTab: this.config.capture.captureTab && isGetDisplayMediaSupported(),
      allowVideo: this.config.capture.video && isGetDisplayMediaSupported(),
      // A microphone is a higher consent bar than a screenshot: the site has
      // to allow it AND the browser has to be able to do it (PULSE-400).
      allowVoiceOver:
        this.config.capture.video &&
        this.config.capture.voiceOver &&
        isGetDisplayMediaSupported() &&
        isGetUserMediaSupported(),
      onSubmit: (data) => this.handleSubmit(data),
      onClose: () => this.close(),
      onAnnotate: () => this.startAnnotation(),
      onRetakeScreenshot: () => this.retakeScreenshot(),
      onCaptureScreenshot: () => this.captureFullScreen(),
      onCaptureTab: () => this.captureTab(),
      onRecordVideo: () => this.startRecording(),
      onRemoveVideo: () => this.setRecording(null),
      onToggleVoiceOver: () => this.toggleVoiceOver(),
      onPickElement: () => this.startPick(),
      onEditPick: (id) => this.startEditPick(id),
      onDeletePick: (id) => this.deletePick(id),
      onTogglePause: () => this.togglePause(),
    })

    if (this.config.capture.elementPick) {
      this.markers = new PickMarkers(this.shadow)
      this.outlines = new PickOutlines(this.shadow)
      this.status = new PickStatus(this.shadow)
      this.marquee = new Marquee(this.shadow)
      this.popup = new PickPopup(this.shadow, {
        onSave: (result) => this.handlePopupSave(result),
        onCancel: () => this.handlePopupCancel(),
      })
      this.picker = new ElementPicker(this.shadow, this.host, {
        onPick: (target, point) => this.handlePick(target, point),
        onDragStart: () => this.handleDragStart(),
        onDragMove: (rect) => this.handleDragMove(rect),
        onDragEnd: (rect) => this.handleDragEnd(rect),
        onModifierEnter: () => this.handleModifierEnter(),
        onModifierClick: (target, point) => this.handleModifierClick(target, point),
        onModifierRelease: () => this.handleModifierRelease(),
      })
    }

    if (this.config.ui.theme === 'auto') {
      this.watchTheme()
    }

    // Esc is the only global shortcut the widget owns: it backs out one mode at a time.
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.handleEscape(e)
    }
    document.addEventListener('keydown', this.keyHandler, true)

    this.pulse.setWidgetHost(this.host)
  }

  open(): void {
    if (this.state !== 'closed') return
    this.state = 'open'
    this.trigger.hide()
    this.setScreenshot(null)
    this.setRecording(null)
    this.picks = []
    this.markersById.clear()
    this.markers?.clear()
    this.markers?.show()
    this.panel.setPicks(this.picks)
    this.panel.setState('open')
    this.config.onOpen?.()
  }

  /** Motion freeze is a debugging aid, never a state the host page is left in. */
  private togglePause(): void {
    this.panel.setPaused(this.freezer.toggle())
  }

  private resumePage(): void {
    if (!this.freezer.isFrozen) return
    this.freezer.unfreeze()
    this.panel.setPaused(false)
  }

  close(): void {
    if (this.state === 'closed') return
    this.resumePage()
    this.teardownPickMode()
    this.state = 'closed'
    this.panel.setState('closed')
    this.markers?.hide()
    this.trigger.show()
    this.annotation?.hide()
    this.annotation = null
    this.config.onClose?.()
  }

  destroy(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler, true)
    }
    if (this.themeQuery && this.themeHandler) {
      this.themeQuery.removeEventListener('change', this.themeHandler)
    }
    this.recorder?.cancel()
    this.recorder = null
    this.releaseVoiceOver()
    this.recordingBar?.destroy()
    this.recordingBar = null
    this.freezer.destroy()
    this.teardownPickMode()
    this.picker = null
    this.popup?.destroy()
    this.markers?.destroy()
    this.outlines?.destroy()
    this.status?.destroy()
    this.marquee?.destroy()
    this.trigger.destroy()
    this.panel.destroy()
    this.annotation?.destroy()
    this.host.remove()
  }

  setUser(user: { email?: string; name?: string }): void {
    this.user = { ...this.user, ...user }
    this.panel.setUser(this.user)
  }

  // -- element pick ----------------------------------------------------------

  private startPick(): void {
    if (!this.picker || this.state !== 'open') return
    this.state = 'picking'
    this.panel.hide()
    this.picker.start()
  }

  /** Back to the open panel, keeping committed picks. */
  private exitPickMode(): void {
    this.teardownPickMode()
    this.state = 'open'
    this.panel.setPicks(this.picks)
    this.panel.setState('open')
  }

  private teardownPickMode(): void {
    this.popup?.close()
    this.pendingPick = null
    this.editingPickId = null
    this.markers?.setPending(null)
    this.clearMultiSelect()
    this.cancelDrag()
    this.picker?.stop()
  }

  private handlePick(target: Element, point: Point): void {
    if (!this.picker || !this.popup || !this.markers) return
    // Read the selection before pausing the picker: pausing touches the page.
    const selectedText = captureSelectedText()
    this.picker.pause()
    this.openPickPopup(buildPick(target, { selectedText }), point)
  }

  /** Stage a fresh pick: pending marker at `point`, comment popup anchored on it. */
  private openPickPopup(pick: WidgetPick, point: Point): void {
    const marker: Marker = {
      id: pick.id,
      xPercent: (point.x / window.innerWidth) * 100,
      y: pick.isFixed ? point.y : point.y + window.scrollY,
      isFixed: pick.isFixed,
    }
    this.pendingPick = { pick, marker }
    this.markers?.setPending(marker)
    this.popup?.open({ xPercent: marker.xPercent, y: point.y }, { title: pick.name })
  }

  // -- multi-select (Cmd/Ctrl+Shift+click) -------------------------------------

  private handleModifierEnter(): void {
    if (this.state !== 'picking') return
    this.status?.show('Multi-select — click elements, release to comment')
  }

  /** Returns true when the click was consumed as a multi-select toggle. */
  private handleModifierClick(target: Element, point: Point): boolean {
    if (this.state !== 'picking') return false
    this.multi.toggle(target)
    this.lastModifierPoint = point
    this.outlines?.set(this.multi.items)
    this.status?.show(
      this.multi.size === 0
        ? 'Multi-select — click elements, release to comment'
        : `${this.multi.size} selected — release to comment`
    )
    return true
  }

  /**
   * Either modifier released: commit the pending set as one annotation. A single
   * element is a normal pick (no multi wrapper); an empty set is a no-op that
   * leaves the user in pick mode.
   */
  private handleModifierRelease(): void {
    const elements = this.multi.items
    const point = this.lastModifierPoint
    this.clearMultiSelect()
    if (elements.length === 0 || !point) return
    if (!this.picker || !this.popup || !this.markers) return
    this.picker.pause()
    this.openPickPopup(buildMultiPick(elements), point)
  }

  private clearMultiSelect(): void {
    this.multi.clear()
    this.lastModifierPoint = null
    this.outlines?.clear()
    this.status?.hide()
  }

  // -- drag area-select (marquee) ----------------------------------------------

  private handleDragStart(): void {
    if (this.state !== 'picking') return
    this.dragCandidates = collectAreaCandidates(this.host)
    this.status?.show('Release to comment on this area')
  }

  /** Live preview: outline whatever the marquee would currently commit. */
  private handleDragMove(rect: DragRect): void {
    if (this.state !== 'picking') return
    this.marquee?.set(rect)
    this.outlines?.set(findMarqueeElements(this.dragCandidates, rect))
  }

  /**
   * Elements inside the marquee win; an empty box big enough to be deliberate
   * becomes an area annotation; anything smaller was a stray click.
   */
  private handleDragEnd(rect: DragRect): void {
    const outcome = resolveMarquee(this.dragCandidates, rect)
    this.dragCandidates = []
    this.marquee?.hide()
    this.outlines?.clear()
    this.status?.hide()
    if (this.state !== 'picking' || outcome.kind === 'none') return
    if (!this.picker || !this.popup || !this.markers) return

    this.picker.pause()
    // Popup anchors at the centre-bottom of the marquee.
    const anchor: Point = { x: rect.x + rect.width / 2, y: rect.y + rect.height }
    this.openPickPopup(
      outcome.kind === 'area' ? buildAreaPick(rect) : buildMultiPick(outcome.elements),
      anchor
    )
  }

  private cancelDrag(): void {
    this.dragCandidates = []
    this.marquee?.hide()
    this.outlines?.clear()
    this.status?.hide()
  }

  // -- popup save/cancel -------------------------------------------------------

  private handlePopupSave(result: PickPopupResult): void {
    if (this.editingPickId) {
      const pick = this.picks.find((p) => p.id === this.editingPickId)
      this.editingPickId = null
      if (pick) {
        pick.comment = result.comment
        pick.intent = result.intent
      }
      this.panel.setPicks(this.picks)
      return
    }
    this.commitPendingPick(result)
  }

  private handlePopupCancel(): void {
    if (this.editingPickId) {
      this.editingPickId = null
      this.popup?.close()
      return
    }
    this.cancelPendingPick()
  }

  private commitPendingPick(result: PickPopupResult): void {
    const pending = this.pendingPick
    this.pendingPick = null
    if (pending) {
      pending.pick.comment = result.comment
      pending.pick.intent = result.intent
      this.picks.push(pending.pick)
      this.markersById.set(pending.pick.id, pending.marker)
      this.markers?.add(pending.marker)
      clearSelection()
    }
    this.exitPickMode()
  }

  /** Popup cancelled: drop the pending pick and return to pick mode. */
  private cancelPendingPick(): void {
    this.pendingPick = null
    this.markers?.setPending(null)
    this.popup?.close()
    this.picker?.resume()
  }

  // -- picks list (panel) ------------------------------------------------------

  /** Reopen the comment popup for an existing pick, anchored on its marker. */
  private startEditPick(id: string): void {
    const pick = this.picks.find((p) => p.id === id)
    if (!pick || !this.popup) return
    this.editingPickId = id
    const marker = this.markersById.get(id)
    const rawY = marker ? (marker.isFixed ? marker.y : marker.y - window.scrollY) : window.innerHeight / 2
    // A marker scrolled out of view would put the popup off-screen; centre instead.
    const y = rawY < 0 || rawY > window.innerHeight ? window.innerHeight / 2 : rawY
    this.popup.open(
      { xPercent: marker?.xPercent ?? 50, y },
      { title: pick.name, comment: pick.comment, intent: pick.intent }
    )
  }

  private deletePick(id: string): void {
    this.picks = this.picks.filter((p) => p.id !== id)
    this.markersById.delete(id)
    this.markers?.remove(id)
    if (this.editingPickId === id) {
      this.editingPickId = null
      this.popup?.close()
    }
    this.panel.setPicks(this.picks)
  }

  private handleEscape(e: KeyboardEvent): void {
    if (this.state === 'closed') return
    e.stopPropagation()
    // Esc STOPS AND KEEPS (PULSE-399). It used to discard, which meant the
    // reflex keystroke destroyed up to two minutes of capture with no undo.
    // Dropping a recording is now a deliberate click on Discard in the bar.
    if (this.state === 'recording') {
      void this.collectRecording()
      // An attach-row popover is the innermost thing open, so Escape backs out
      // of the options and stops there — it must never close the panel too.
    } else if (this.panel.closePopovers(true)) {
      return
    } else if (this.popup?.isOpen) {
      this.handlePopupCancel()
    } else if (this.state === 'picking' && this.multi.size > 0) {
      this.clearMultiSelect()
    } else if (this.state === 'picking') {
      this.exitPickMode()
    } else {
      this.close()
    }
  }

  // -- video recording (PULSE-338) ---------------------------------------------

  /**
   * getDisplayMedia is called with the user activation from this click still
   * live — nothing may be awaited before it, or the browser silently refuses to
   * prompt. Hiding the panel and trigger is synchronous, so it is safe to do
   * first. The host itself now stays visible: it carries the recording bar,
   * which is the only stop control the widget owns (PULSE-399).
   */
  private startRecording(): void {
    if (this.state !== 'open') return
    this.panel.setVideoError(null)
    this.panel.setVideoNotice(null)
    this.panel.setVoiceOverNote(null)
    this.hideForRecording()

    let stream: Promise<MediaStream>
    try {
      stream = requestRecordingStream()
    } catch (e) {
      this.restoreAfterRecording()
      this.panel.setVideoError(e instanceof Error ? e.message : 'Recording failed')
      return
    }

    const withVoiceOver = this.voiceOver
    this.state = 'recording'
    this.recordingBar = new RecordingBar(this.shadow, {
      onStop: () => void this.collectRecording(),
      onDiscard: () => this.cancelRecording(),
      // Only wired when the reporter opted in: no opt-in, no mic control and
      // no level meter in the bar at all.
      onToggleMic: withVoiceOver ? () => this.toggleMute() : undefined,
    })
    this.recordingBar.focusStop()
    this.recorder = createVideoRecorder({
      // Fetched only once a WebM recording finishes; see capture/webm-duration.
      postProcess: webmDurationPostProcess(this.config.apiUrl),
      onProgress: (progress) => this.recordingBar?.update(progress),
      onEnd: () => this.collectRecording(),
    })
    void this.beginRecording(withVoiceOver ? this.composeWithVoiceOver(stream) : stream)
  }

  // -- voice-over (PULSE-400) ---------------------------------------------------

  /**
   * The opt-in click, and the only place a microphone prompt can originate.
   * `getUserMedia` runs synchronously off this activation; the stream it
   * returns is released immediately, because its job was to settle the
   * permission, not to hold a live microphone open while the reporter fills in
   * a form. Record re-opens it, silently, against the granted permission.
   *
   * A refusal is never an error — the reporter simply records without a
   * voice-over — so both outcomes land in the same place.
   */
  private toggleVoiceOver(): void {
    this.panel.setVoiceOverNote(null)
    if (this.voiceOver) return this.setVoiceOver(false)
    try {
      void requestMicStream().then(
        (stream) => {
          stopTracks(stream)
          this.setVoiceOver(true)
        },
        (e: unknown) => this.setVoiceOver(false, e)
      )
    } catch (e) {
      this.setVoiceOver(false, e)
    }
  }

  private setVoiceOver(on: boolean, failure?: unknown): void {
    this.voiceOver = on
    this.panel.setVoiceOver(on)
    if (failure !== undefined) this.panel.setVoiceOverNote(micNotice(failure))
  }

  /**
   * Video track + microphone track in one `MediaStream`, the only shape
   * `MediaRecorder` accepts. A microphone that will not open degrades to silent
   * video — the display stream is returned untouched and the recording runs —
   * because losing a two-minute repro over a missing mic is a far worse outcome
   * than losing the narration.
   */
  private async composeWithVoiceOver(display: Promise<MediaStream>): Promise<MediaStream> {
    let mic: MediaStream | null = null
    try {
      mic = await requestMicStream()
    } catch (e) {
      this.panel.setVoiceOverNote(micNotice(e))
    }

    let stream: MediaStream
    try {
      stream = await display
    } catch (e) {
      // Share prompt declined after the mic opened: release it, or the browser
      // shows a microphone indicator for a recording that never started.
      stopTracks(mic)
      throw e
    }

    // `state !== 'recording'` means Discard landed while the prompts were still
    // resolving: hand back the stream the recorder will release, but never
    // adopt the track — a meter outliving its recording is a leaked context.
    const track = this.state === 'recording' ? (mic?.getAudioTracks()[0] ?? null) : null
    if (!track) {
      stopTracks(mic)
      if (this.state === 'recording') this.recordingBar?.setMicState('unavailable')
      return stream
    }

    this.micTrack = track
    this.recordingBar?.setMicState('live')
    this.levelMeter = new MicLevelMeter({
      onLevel: (level) => this.recordingBar?.setLevel(level),
    })
    // Observational only; a meter that cannot start costs the recording nothing.
    this.levelMeter.start(mic!)
    return new MediaStream([...stream.getVideoTracks(), track])
  }

  /**
   * Mute is `enabled = false`, NEVER `stop()`. A stopped track cannot be
   * revived, ends the audio for the rest of the recording and can desync what
   * is already written; a disabled one records silence and flips back
   * instantly. The track itself is the state — there is no second flag to
   * fall out of step with it.
   */
  private toggleMute(): void {
    const track = this.micTrack
    if (!track) return
    const muting = track.enabled
    track.enabled = !muting
    this.levelMeter?.setMuted(muting)
    this.recordingBar?.setMicState(muting ? 'muted' : 'live')
  }

  /**
   * The recorder stops every track on the composed stream, the microphone
   * included, so this only drops our references and tears down the analyser.
   * Stopping here as well would be a no-op — and would put a `stop()` call on
   * the mic track in a code path that must never have one.
   */
  private releaseVoiceOver(): void {
    this.levelMeter?.stop()
    this.levelMeter = null
    this.micTrack = null
  }

  private async beginRecording(stream: Promise<MediaStream>): Promise<void> {
    try {
      await this.recorder?.start(stream)
      // Already resolved by the line above; the recorder keeps the stream, so
      // this is the only place the surface can be read.
      this.applyDisplaySurface(await stream)
    } catch (e) {
      const recorder = this.recorder
      this.recorder = null
      this.restoreAfterRecording()
      // Declining the share prompt is a normal outcome, not an error to report.
      if (!isUserCancel(e) && recorder) {
        this.panel.setVideoError(e instanceof Error ? e.message : 'Recording failed')
      }
    }
  }

  /** Runs on the user's Stop sharing, the 2-minute cap, or a dead source. */
  private async collectRecording(): Promise<void> {
    const recorder = this.recorder
    if (!recorder) return
    this.recorder = null
    try {
      this.setRecording(await recorder.stop())
    } catch (e) {
      this.panel.setVideoError(e instanceof Error ? e.message : 'Recording failed')
    } finally {
      this.restoreAfterRecording()
    }
  }

  /** Only ever reached by a deliberate click on Discard in the bar. */
  private cancelRecording(): void {
    this.recorder?.cancel()
    this.recorder = null
    this.restoreAfterRecording()
  }

  /**
   * Sharing *this tab* means the bar is composited into the video — nothing in
   * the page can opt out of its own capture. Shrink it, and say so afterwards.
   * `displaySurface` is Chromium-only; where it is missing we do not know, and
   * we do not claim to. Never allowed to fail a live recording.
   */
  private applyDisplaySurface(stream: MediaStream): void {
    let surface: string | undefined
    try {
      surface = stream.getVideoTracks?.()[0]?.getSettings?.().displaySurface
    } catch {
      return
    }
    if (surface !== 'browser') return
    this.recordingBar?.setSlim(true)
    this.panel.setVideoNotice(BAR_IN_RECORDING_NOTICE)
  }

  /** The host stays visible: it carries the recording bar. */
  private hideForRecording(): void {
    this.panel.hide()
    this.trigger.hide()
  }

  private restoreAfterRecording(): void {
    this.releaseVoiceOver()
    this.recordingBar?.destroy()
    this.recordingBar = null
    this.host.style.display = ''
    this.state = 'open'
    this.panel.setState('open')
  }

  private setRecording(recording: VideoRecording | null): void {
    this.recording = recording
    this.panel.setVideo(recording?.blob ?? null, recording?.durationMs ?? 0)
  }

  // -- screenshot --------------------------------------------------------------

  private resolveTheme(): 'light' | 'dark' {
    if (this.config.ui.theme === 'dark') return 'dark'
    if (this.config.ui.theme === 'light') return 'light'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  private watchTheme(): void {
    this.themeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    this.themeHandler = () => {
      const theme = this.resolveTheme()
      this.styleEl.textContent = getWidgetStyles(theme)
    }
    this.themeQuery.addEventListener('change', this.themeHandler)
  }

  /** Captured bitmap + its annotations move together; null clears both. */
  private setScreenshot(blob: Blob | null, surface?: CaptureSurface): void {
    this.originalScreenshot = blob
    this.currentScreenshot = blob
    this.annotations = []
    this.captureSurface = blob ? surface : undefined
    this.panel.setScreenshot(blob)
  }

  /**
   * Native tab capture. getDisplayMedia is called with the user activation from
   * this click still live — nothing may be awaited before it, or the browser
   * silently refuses to prompt. Hiding the host is synchronous, so it is safe
   * to do first.
   */
  private captureTab(): void {
    this.host.style.display = 'none'
    let stream: Promise<MediaStream>
    try {
      stream = requestTabStream()
    } catch (e) {
      this.host.style.display = ''
      this.panel.setCaptureError(e instanceof Error ? e.message : 'Tab capture failed')
      return
    }
    void this.finishTabCapture(stream)
  }

  private async finishTabCapture(pending: Promise<MediaStream>): Promise<void> {
    try {
      const { blob, surface } = await frameFromStream(await pending)
      this.setScreenshot(blob, surface)
      this.panel.setCaptureError(null)
    } catch (e) {
      // Declining the picker is a normal outcome, not an error to report.
      if (!isUserCancel(e)) {
        this.panel.setCaptureError(e instanceof Error ? e.message : 'Tab capture failed')
      }
    } finally {
      this.host.style.display = ''
      this.state = 'open'
      this.panel.setState('open')
    }
  }

  /**
   * The capture engine excludes #pulse-widget itself, so the widget no longer
   * has to hide (and flash) to stay out of the shot.
   */
  private async captureFullScreen(): Promise<void> {
    let blob: Blob | null = null
    let error: string | null = null
    try {
      blob = await this.pulse.captureScreenshot()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Screenshot capture failed'
    }
    this.setScreenshot(blob)
    this.panel.setCaptureError(error)
    this.state = 'open'
    this.panel.setState('open')
  }

  private startAnnotation(): void {
    // Always annotate the ORIGINAL capture: rects are re-applied from scratch,
    // so re-opening the editor never bakes the previous pass into the bitmap.
    const source = this.originalScreenshot
    if (!source) return
    this.state = 'annotating'

    this.host.classList.add('pulse-annotating')

    this.annotation = new AnnotationCanvas(this.shadow, {
      onSave: (blob, annotations) => {
        this.host.classList.remove('pulse-annotating')
        this.currentScreenshot = blob
        this.annotations = annotations
        this.panel.setScreenshot(blob)
        this.state = 'open'
        this.annotation = null
      },
      onCancel: () => {
        this.host.classList.remove('pulse-annotating')
        this.state = 'open'
        this.annotation = null
      },
    })

    void this.annotation.show(source, this.annotations)
  }

  private async retakeScreenshot(): Promise<void> {
    await this.captureFullScreen()
  }

  private async handleSubmit(formData: PanelFormData): Promise<SubmitResult> {
    // Never leave the host page frozen behind a submitted report.
    this.resumePage()
    this.state = 'submitting'

    const result = await this.pulse.submitFeedback({
      title: formData.title,
      description: formData.description,
      type: formData.type,
      email: formData.email,
      name: formData.name,
      screenshot: this.currentScreenshot,
      video: this.recording
        ? { blob: this.recording.blob, mimeType: this.recording.mimeType }
        : null,
      picks: this.picks,
      screenshotAnnotations: this.annotations,
      captureSurface: this.captureSurface,
      onUploadProgress: (sent, total) => this.panel.setUploadProgress(sent, total),
    })

    if (result.status === 'created') {
      this.state = 'success'
      this.originalScreenshot = null
      this.currentScreenshot = null
      this.annotations = []
      this.captureSurface = undefined
      // The panel clears its own opt-in on a submitted report; keep the two in
      // step, so the next reporter has to choose the microphone again.
      this.voiceOver = false
      this.setRecording(null)
      this.picks = []
      this.markersById.clear()
      this.markers?.clear()
      this.panel.setPicks(this.picks)
    } else {
      this.state = 'error'
    }

    return result
  }
}
