import { useCallback, useId, useMemo, useState } from "react";
import { useAppState } from "../../../app/AppState";
import type { TestNotePublishResult } from "../../../app/AppStateTypes";

const DEFAULT_NOTE_CONTENT = "hello world";

export function TestPublishNotePanel({
  signingBlocked,
}: {
  signingBlocked: boolean;
}) {
  const { publishTestNote, runtimeRelays = [] } = useAppState();
  const contentId = useId();
  const errorId = useId();
  const [content, setContent] = useState(DEFAULT_NOTE_CONTENT);
  const [touched, setTouched] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [result, setResult] = useState<TestNotePublishResult | null>(null);
  const [copied, setCopied] = useState<
    "event-id" | "nevent" | "event-json" | null
  >(null);

  const trimmed = content.trim();
  const relayUnavailable =
    runtimeRelays.length > 0 &&
    !runtimeRelays.some((relay) => relay.state === "online");
  const inlineError =
    touched && trimmed.length === 0 ? "Enter note content to publish." : null;
  const submitDisabled =
    signingBlocked || relayUnavailable || publishing || trimmed.length === 0;

  const eventJson = useMemo(
    () => (result ? JSON.stringify(result.event, null, 2) : ""),
    [result],
  );

  const copyValue = useCallback(
    async (value: string, kind: "event-id" | "nevent" | "event-json") => {
      if (!navigator.clipboard) {
        return;
      }
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        return;
      }
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1400);
    },
    [],
  );

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setTouched(true);
      if (submitDisabled) return;
      setPublishing(true);
      setPublishError(null);
      try {
        const nextResult = await publishTestNote({ content: trimmed });
        setResult(nextResult);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : "Failed to publish note";
        setPublishError(reason);
      } finally {
        setPublishing(false);
      }
    },
    [publishTestNote, submitDisabled, trimmed],
  );

  return (
    <section
      className="panel panel-pad test-publish-note-panel"
      data-testid="test-publish-note-panel"
      aria-labelledby={`${contentId}-heading`}
    >
      <div className="value" id={`${contentId}-heading`}>
        Publish Test Note
      </div>
      <p className="help">
        Signs a kind 1 Nostr note with the active group key and publishes it
        to the connected relays.
      </p>
      <form onSubmit={onSubmit} className="test-sign-form">
        <div className="field">
          <label className="label" htmlFor={contentId}>
            Note content
          </label>
          <textarea
            id={contentId}
            className={`input${inlineError ? " input-error" : ""}`}
            rows={3}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (!touched) setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            aria-invalid={inlineError != null}
            aria-describedby={inlineError ? errorId : undefined}
          />
          {inlineError ? (
            <span id={errorId} className="field-error-text" role="alert">
              {inlineError}
            </span>
          ) : null}
        </div>
        <div className="inline-actions">
          <button
            type="submit"
            className="button button-primary button-md"
            disabled={submitDisabled}
            aria-disabled={submitDisabled}
            aria-label="Publish Note"
          >
            {publishing ? "Publishing..." : "Publish Note"}
          </button>
          {signingBlocked ? (
            <span className="help" role="status">
              Signing unavailable - peers below threshold or runtime not ready.
            </span>
          ) : relayUnavailable ? (
            <span className="help" role="status">
              No online relays available.
            </span>
          ) : null}
        </div>
        {publishError ? (
          <p className="field-error-text" role="alert">
            {publishError}
          </p>
        ) : null}
        {result ? (
          <div className="test-publish-note-result" role="status">
            <p
              className="help"
              data-testid="test-publish-note-request-id"
            >
              Signed request: <code>{result.requestId}</code>
            </p>
            <p className="help" data-testid="test-publish-note-event-id">
              Event id: <code>{result.eventId}</code>
            </p>
            <p className="help" data-testid="test-publish-note-nevent">
              Nevent: <code>{result.nevent}</code>
            </p>
            <p className="help" data-testid="test-publish-note-relays">
              Published to {result.reached.length} relay
              {result.reached.length === 1 ? "" : "s"}
              {result.failed.length > 0
                ? `; ${result.failed.length} failed`
                : ""}
              .
            </p>
            <div className="inline-actions">
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={() => copyValue(result.eventId, "event-id")}
              >
                {copied === "event-id" ? "Copied" : "Copy event id"}
              </button>
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={() => copyValue(result.nevent, "nevent")}
              >
                {copied === "nevent" ? "Copied" : "Copy nevent"}
              </button>
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={() => copyValue(eventJson, "event-json")}
              >
                {copied === "event-json" ? "Copied" : "Copy event JSON"}
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}
