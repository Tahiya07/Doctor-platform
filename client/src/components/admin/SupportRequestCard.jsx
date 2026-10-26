import { Mail } from "lucide-react";
import { useState } from "react";
import { Button, Field, Pill } from "../ui/index.js";

const STATUS_LABEL = { received: "New", in_progress: "In progress", resolved: "Resolved" };

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SupportRequestCard({ request, onStatusChange, onReply }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await onStatusChange(request, status);
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (event) => {
    event.preventDefault();
    const message = String(new FormData(event.currentTarget).get("message") ?? "").trim();
    if (message.length < 2 || busy) return;
    setBusy(true);
    try {
      if (await onReply(request, message)) setReplyOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="verification-card surface support-request-card">
      <div className="support-request-main">
        <div className="support-request-heading">
          <span className="eyebrow">RECEIVED {formatDate(request.createdAt)}</span>
          <Pill tone={request.status === "resolved" ? "verified" : "pending"}>
            {STATUS_LABEL[request.status] ?? request.status}
          </Pill>
        </div>
        <p className="support-request-message" translate="no">
          {request.message}
        </p>
        <div className="support-request-contact">
          {request.userName && <strong>{request.userName}</strong>}
          {request.email ? (
            <a href={`mailto:${request.email}`}>
              <Mail size={14} /> {request.email}
            </a>
          ) : (
            <span>No reply email provided</span>
          )}
        </div>
      </div>
      <div className="support-request-actions">
        {request.status !== "in_progress" && request.status !== "resolved" && (
          <Button variant="outline" disabled={busy} onClick={() => changeStatus("in_progress")}>
            {busy ? "Updating…" : "Start review"}
          </Button>
        )}
        {request.status !== "resolved" && request.email && (
          <Button disabled={busy} onClick={() => setReplyOpen((open) => !open)}>
            <Mail size={15} /> {replyOpen ? "Close reply" : "Reply"}
          </Button>
        )}
        {request.status !== "resolved" && !request.email && (
          <Button variant="outline" disabled={busy} onClick={() => changeStatus("resolved")}>
            {busy ? "Updating…" : "Mark resolved"}
          </Button>
        )}
        {request.status === "resolved" && (
          <Button variant="outline" disabled={busy} onClick={() => changeStatus("received")}>
            {busy ? "Updating…" : "Reopen"}
          </Button>
        )}
        {replyOpen && request.email && (
          <form className="support-reply-form" onSubmit={submitReply}>
            <Field label="Email reply">
              <textarea name="message" required minLength={2} maxLength={4000} rows={4} disabled={busy} />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reply"}
            </Button>
          </form>
        )}
      </div>
    </article>
  );
}
