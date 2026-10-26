import { ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { isDemoMode } from "../../constants.js";
import { formatDateTime } from "../../utils/dates.js";
import { Avatar } from "../ui/index.js";
import MessageComposer from "./MessageComposer.jsx";
import { ROLE_LABELS } from "./roleLabels.js";

function subtitle(conversation) {
  if (!conversation) return "";
  const who = ROLE_LABELS[conversation.participantRole] ?? "";
  return conversation.canMessage ? who : `${who} · appointment acceptance required`;
}

/**
 * Header, message list and composer for one conversation. The list stays scrolled to the newest
 * message, unless you have scrolled up to read older ones.
 * @param {{conversation?: object, messages: object[], loading: boolean, error: string,
 *   onError: (message: string) => void, onSend: (text: string) => Promise<void>,
 *   onSendAttachment: (file: File) => Promise<void>}} props
 */
export default function ChatThread({
  conversation,
  messages,
  loading,
  error,
  onError,
  onSend,
  onSendAttachment,
}) {
  const listRef = useRef(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const node = listRef.current;
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [messages.length, conversation?.id]);

  const trackScroll = (event) => {
    const node = event.currentTarget;
    stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  };

  return (
    <section className="chat-conversation">
      <header>
        {conversation && <Avatar src={conversation.participantImage} name={conversation.participantName} />}
        <span>
          <strong>{conversation?.participantName || "Choose a conversation"}</strong>
          <small>
            {subtitle(conversation)}
            {typeof conversation?.online === "boolean" && (
              <span className={`presence-status ${conversation.online ? "is-online" : "is-offline"}`}>
                <i aria-hidden="true" />
                {conversation.online ? "Online" : "Offline"}
              </span>
            )}
          </small>
        </span>
      </header>
      <div className="chat-notice">
        <ShieldCheck size={14} /> Do not use this service for urgent medical concerns.
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="message-list" aria-live="polite" ref={listRef} onScroll={trackScroll}>
        {messages.map((message) => (
          <div className={`message-bubble ${message.isMine ? "outgoing" : ""}`} key={message.id}>
            <span translate="no">{message.body}</span>
            {message.attachmentUrl && (
              <a href={message.attachmentUrl} target="_blank" rel="noreferrer">
                {message.attachmentName || "Open attachment"}
              </a>
            )}
            <small>
              {formatDateTime(message.sentAt)}
              {message.simulated ? " · simulated" : ""}
              {message.isMine && message.readAt ? " · Read" : ""}
            </small>
          </div>
        ))}
        {!messages.length && !loading && (
          <div className="table-empty">
            {conversation ? "No messages yet. Say hello!" : "Choose a conversation."}
          </div>
        )}
      </div>
      <MessageComposer
        disabled={!conversation?.canMessage}
        onSend={onSend}
        onSendAttachment={onSendAttachment}
        onError={onError}
      />
      {isDemoMode && (
        <small className="demo-caption">
          Demo messages are local simulations; no real delivery or read receipts.
        </small>
      )}
    </section>
  );
}
