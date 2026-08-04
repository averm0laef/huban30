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
  accessFor,
  downloadChatAttachmentBlob,
  type ChatAttachment,
  type ChatThread,
} from "./chat-state";
import styles from "./attachment-preview.module.css";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type PreviewState =
  | { status: "error" }
  | { status: "loading" }
  | { status: "ready"; url: string };

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

/**
 * Inline thumbnail + lightbox for one image chat attachment. Shared by the
 * full `/chat` page and the floating widget so the fetch/object-URL/focus
 * logic only exists once.
 *
 * The blob is fetched through the same authenticated helper the click-to-
 * download button already used (`downloadChatAttachmentBlob` — thread
 * ownership check, `nosniff`/`no-store`/`attachment` headers all still
 * apply server-side, untouched), then rendered from a local object URL —
 * never `<img src>` pointed straight at the endpoint. The object URL is
 * owned by one `AttachmentObjectUrl` per mounted attachment (one fetch,
 * shared by both the thumbnail and its lightbox) and is revoked on
 * unmount by `AttachmentObjectUrl` itself (see attachment-object-url.ts).
 */
export function ChatAttachmentImage({
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
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const objectUrlRef = useRef<AttachmentObjectUrl | null>(null);
  const thumbRef = useRef<HTMLButtonElement>(null);
  // Lazy init written the way react-hooks/refs expects, so the holder is
  // created exactly once per mount without allocating on every render.
  if (objectUrlRef.current === null) objectUrlRef.current = new AttachmentObjectUrl();

  useEffect(() => {
    const access = accessFor({ kind: viewerKind }, thread);
    if (!access) {
      setState({ status: "error" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    downloadChatAttachmentBlob(attachment, thread, access)
      .then((blob) => {
        if (cancelled) return;
        const url = objectUrlRef.current!.issue(attachment.id, blob);
        setState({ status: "ready", url });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => { cancelled = true; };
    // Re-fetch only on a genuine identity change (a different attachment or
    // an explicit retry) — not on every re-render of `thread`/`viewerKind`
    // object references, which the parent message list can recreate often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, thread.id, viewerKind, attempt]);

  // One object URL per mounted attachment, released the moment this
  // component goes away (thread switch, chat closed) — never left dangling.
  useEffect(() => () => objectUrlRef.current?.revoke(), []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    thumbRef.current?.focus();
  }, []);

  return (
    <div className={styles.tile}>
      {state.status === "loading" ? (
        <div className={styles.thumbLoading} role="status">
          <span aria-hidden="true" className={styles.spinner} />
          <span>Загружаем изображение…</span>
        </div>
      ) : state.status === "error" ? (
        <div className={styles.thumbError} role="alert">
          <span>Не удалось загрузить изображение</span>
          <button onClick={retry} type="button">Повторить</button>
        </div>
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
            onError={() => setState({ status: "error" })}
            src={state.url}
          />
        </button>
      )}
      <div className={styles.tileMeta}>
        <span className={styles.tileName}>{attachment.originalName}</span>
        <button className={styles.downloadLink} onClick={onDownload} type="button">
          Скачать ({Math.max(1, Math.ceil(attachment.byteSize / 1024))} КБ)
        </button>
      </div>
      {lightboxOpen && state.status === "ready" ? (
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
