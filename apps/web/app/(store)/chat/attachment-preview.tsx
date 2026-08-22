"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { AttachmentObjectUrl } from "./attachment-object-url";
import {
  activeVideoRegistry,
  attachmentFetchScheduler,
  attachmentImageCache,
  imagePreviewLoadingMode,
  type ActiveVideoClaim,
  type ImageCacheLease,
  type ScheduledFetch,
} from "./attachment-media-pool";
import {
  accessFor,
  downloadChatAttachmentBlob,
  isPreviewableVideo,
  type ChatAttachment,
  type ChatThread,
} from "./chat-state";
import styles from "./attachment-preview.module.css";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type PreviewState =
  | { status: "error" }
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string };

const PREVIEW_ROOT_MARGIN = "480px 0px";

function attachmentSize(byteSize: number): string {
  if (byteSize >= 1024 * 1024) {
    const megabytes = byteSize / 1024 / 1024;
    return `${megabytes >= 10 ? Math.ceil(megabytes) : megabytes.toFixed(1).replace(".0", "")} МБ`;
  }
  return `${Math.max(1, Math.ceil(byteSize / 1024))} КБ`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

/**
 * Inline attachment preview shared by `/chat` and the widget. Images enter a
 * global three-request queue only when they approach the scroll viewport and
 * reuse a bounded eight-entry/40 MiB LRU. Videos never fetch on mount: a full
 * video response starts only after the customer presses the load button, and
 * opening another video revokes the previous video blob globally.
 */
export function ChatAttachmentMedia({
  attachment,
  onDownload,
  thread,
  viewerKind,
}: {
  attachment: ChatAttachment;
  onDownload: () => void;
  thread: ChatThread;
  viewerKind: "customer" | "guest";
}) {
  const video = isPreviewableVideo(attachment);
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [manualImageLoad, setManualImageLoad] = useState(false);
  const tileRef = useRef<HTMLDivElement>(null);
  const attachmentRef = useRef(attachment);
  const threadRef = useRef(thread);
  const videoObjectUrlRef = useRef<AttachmentObjectUrl | null>(null);
  const videoClaimRef = useRef<ActiveVideoClaim | null>(null);
  const imageLeaseRef = useRef<ImageCacheLease | null>(null);
  const imageFetchRef = useRef<ScheduledFetch<Blob> | null>(null);
  const mountedRef = useRef(false);
  const nearViewportRef = useRef(false);
  const stateRef = useRef<PreviewState>({ status: "idle" });
  const thumbRef = useRef<HTMLButtonElement>(null);
  if (videoObjectUrlRef.current === null) videoObjectUrlRef.current = new AttachmentObjectUrl();

  useEffect(() => {
    attachmentRef.current = attachment;
    threadRef.current = thread;
  }, [attachment, thread]);

  const updateState = useCallback((next: PreviewState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  const releaseImage = useCallback((resetState = true) => {
    imageFetchRef.current?.cancel();
    imageFetchRef.current = null;
    imageLeaseRef.current?.release();
    imageLeaseRef.current = null;
    if (resetState && stateRef.current.status !== "idle") updateState({ status: "idle" });
  }, [updateState]);

  const releaseVideo = useCallback((resetState = true) => {
    videoClaimRef.current?.release();
    videoClaimRef.current = null;
    videoObjectUrlRef.current?.revoke();
    if (resetState && stateRef.current.status !== "idle") updateState({ status: "idle" });
  }, [updateState]);

  const loadImage = useCallback((manual = false) => {
    if (video || (!nearViewportRef.current && !manual)
      || stateRef.current.status === "loading"
      || stateRef.current.status === "ready") return;
    if (manual) nearViewportRef.current = true;
    const currentAttachment = attachmentRef.current;
    const currentThread = threadRef.current;
    const cached = attachmentImageCache.acquire(currentAttachment.id);
    if (cached) {
      imageLeaseRef.current = cached;
      updateState({ status: "ready", url: cached.url });
      return;
    }
    const access = accessFor({ kind: viewerKind }, currentThread);
    if (!access) {
      updateState({ status: "error" });
      return;
    }
    updateState({ status: "loading" });
    const scheduled = attachmentFetchScheduler.schedule((signal) => (
      downloadChatAttachmentBlob(currentAttachment, currentThread, access, signal)
    ));
    imageFetchRef.current = scheduled;
    void scheduled.promise
      .then((blob) => {
        if (!mountedRef.current || !nearViewportRef.current) return;
        const lease = attachmentImageCache.insertAndAcquire(currentAttachment.id, blob);
        imageLeaseRef.current = lease;
        updateState({ status: "ready", url: lease.url });
      })
      .catch((error: unknown) => {
        if (mountedRef.current && nearViewportRef.current && !isAbortError(error)) {
          updateState({ status: "error" });
        }
      })
      .finally(() => {
        if (imageFetchRef.current === scheduled) imageFetchRef.current = null;
      });
  }, [updateState, video, viewerKind]);

  const loadVideo = useCallback(() => {
    if (!video || stateRef.current.status === "loading" || stateRef.current.status === "ready") return;
    const currentAttachment = attachmentRef.current;
    const currentThread = threadRef.current;
    const access = accessFor({ kind: viewerKind }, currentThread);
    if (!access) {
      updateState({ status: "error" });
      return;
    }
    updateState({ status: "loading" });
    const claim: ActiveVideoClaim = activeVideoRegistry.claim(() => {
      videoObjectUrlRef.current?.revoke();
      if (videoClaimRef.current === claim) videoClaimRef.current = null;
      if (mountedRef.current) updateState({ status: "idle" });
    });
    videoClaimRef.current = claim;
    void downloadChatAttachmentBlob(currentAttachment, currentThread, access, claim.signal)
      .then((blob) => {
        if (!mountedRef.current || !claim.isCurrent()) return;
        const url = videoObjectUrlRef.current!.issue(currentAttachment.id, blob);
        updateState({ status: "ready", url });
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || isAbortError(error)) return;
        claim.release();
        if (videoClaimRef.current === claim) videoClaimRef.current = null;
        updateState({ status: "error" });
      });
  }, [updateState, video, viewerKind]);

  useEffect(() => {
    mountedRef.current = true;
    const node = tileRef.current;
    const handleVisibility = (visible: boolean) => {
      nearViewportRef.current = visible;
      if (visible) {
        if (!video) loadImage();
      } else if (video) {
        releaseVideo();
      } else {
        releaseImage();
      }
    };
    if (!node || imagePreviewLoadingMode(typeof IntersectionObserver !== "undefined") === "manual") {
      // Legacy/embedded browsers without IntersectionObserver must opt in per
      // image. Falling back to eager loading would recreate the original GET
      // storm for a long history.
      nearViewportRef.current = false;
      setManualImageLoad(!video);
      return () => {
        mountedRef.current = false;
        releaseImage(false);
        releaseVideo(false);
      };
    }
    setManualImageLoad(false);
    const scrollRoot = node.closest<HTMLElement>("[role='log']");
    const observer = new IntersectionObserver(
      ([entry]) => handleVisibility(Boolean(entry?.isIntersecting)),
      { root: scrollRoot, rootMargin: PREVIEW_ROOT_MARGIN },
    );
    observer.observe(node);
    return () => {
      mountedRef.current = false;
      observer.disconnect();
      releaseImage(false);
      releaseVideo(false);
    };
  }, [attachment.id, loadImage, releaseImage, releaseVideo, video]);

  const retry = useCallback(() => {
    updateState({ status: "idle" });
    if (video) loadVideo();
    else loadImage(manualImageLoad);
  }, [loadImage, loadVideo, manualImageLoad, updateState, video]);
  const handleImageDecodeError = useCallback(() => {
    imageLeaseRef.current?.release();
    imageLeaseRef.current = null;
    attachmentImageCache.discard(attachment.id);
    updateState({ status: "error" });
  }, [attachment.id, updateState]);
  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    thumbRef.current?.focus();
  }, []);

  return (
    <div className={styles.tile} ref={tileRef}>
      {state.status === "idle" && video ? (
        <button
          className={styles.videoLoadButton}
          onClick={loadVideo}
          type="button"
        >
          <strong>Загрузить видео</strong>
          <span>{attachmentSize(attachment.byteSize)}. Данные не загружаются без нажатия.</span>
        </button>
      ) : state.status === "idle" && manualImageLoad ? (
        <button className={styles.videoLoadButton} onClick={() => loadImage(true)} type="button">
          <strong>Загрузить изображение</strong>
          <span>{attachmentSize(attachment.byteSize)}. Автоматическая загрузка недоступна в этом браузере.</span>
        </button>
      ) : state.status === "idle" ? (
        <div aria-label={`Изображение «${attachment.originalName}» ожидает появления на экране`} className={styles.thumbIdle} role="img">
          Изображение появится при прокрутке
        </div>
      ) : state.status === "loading" ? (
        <div className={styles.thumbLoading} role="status">
          <span aria-hidden="true" className={styles.spinner} />
          <span>Загружаем {video ? "видео" : "изображение"}…</span>
        </div>
      ) : state.status === "error" ? (
        <div className={styles.thumbError} role="alert">
          <span>Не удалось загрузить {video ? "видео" : "изображение"}</span>
          <button onClick={retry} type="button">Повторить</button>
        </div>
      ) : video ? (
        <video
          aria-label={`Видео «${attachment.originalName}»`}
          className={styles.thumbVideo}
          controls
          onError={() => {
            releaseVideo(false);
            updateState({ status: "error" });
          }}
          playsInline
          preload="metadata"
          src={state.url}
        />
      ) : (
        <button
          aria-label={`Открыть изображение «${attachment.originalName}» на весь экран`}
          className={styles.thumbButton}
          onClick={() => setLightboxOpen(true)}
          ref={thumbRef}
          type="button"
        >
          {/* Decorative: the button above already carries the accessible name. */}
          <img
            alt=""
            className={styles.thumbImage}
            onError={handleImageDecodeError}
            src={state.url}
          />
        </button>
      )}
      <div className={styles.tileMeta}>
        <span className={styles.tileName}>{attachment.originalName}</span>
        <button className={styles.downloadLink} onClick={onDownload} type="button">
          Скачать ({attachmentSize(attachment.byteSize)})
        </button>
      </div>
      {!video && lightboxOpen && state.status === "ready" ? (
        <ChatAttachmentLightbox
          imageUrl={state.url}
          name={attachment.originalName}
          onClose={closeLightbox}
          onDownload={onDownload}
        />
      ) : null}
    </div>
  );
}

/**
 * Full-image dialog. Mirrors the focus-trap/Escape/scroll-lock pattern
 * already established by `_components/mobile-drawer.tsx`: Escape closes,
 * Tab is trapped inside the panel, `document.documentElement` gets
 * `overflow: hidden` while open, and the close button is focused on open
 * so focus never lands outside the dialog. Renders the same object URL the
 * thumbnail already fetched — no second network request.
 */
function ChatAttachmentLightbox({
  imageUrl,
  name,
  onClose,
  onDownload,
}: {
  imageUrl: string;
  name: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      root.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className={styles.lightboxLayer}>
      <button aria-hidden="true" className={styles.lightboxBackdrop} onClick={onClose} tabIndex={-1} type="button" />
      <div aria-labelledby={titleId} aria-modal="true" className={styles.lightboxPanel} ref={panelRef} role="dialog">
        <span className={styles.visuallyHidden} id={titleId}>{name}</span>
        <div className={styles.lightboxHead}>
          <button className={styles.lightboxAction} onClick={onDownload} type="button">Скачать</button>
          <button aria-label="Закрыть просмотр изображения" className={styles.lightboxClose} onClick={onClose} ref={closeRef} type="button">
            <CloseIcon />
          </button>
        </div>
        <div className={styles.lightboxBody}>
          <img alt="" className={styles.lightboxImage} src={imageUrl} />
        </div>
      </div>
    </div>
  );
}
