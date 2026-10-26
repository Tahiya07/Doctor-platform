import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useConfirm } from "../../context/ConfirmContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { useResource } from "../../hooks/useResource.js";
import { reviewService } from "../../services/index.js";
import { timeAgo } from "../../utils/dates.js";
import { Button, Notice } from "../ui/index.js";
import { Stars, StarPicker } from "./StarRating.jsx";

const COMMENT_MAX = 1000;

/** Average, count and a bar per star rating. */
function Summary({ summary }) {
  const { average, count, distribution } = summary;
  return (
    <div className="review-summary">
      <div className="review-average">
        <strong>{average.toFixed(1)}</strong>
        <Stars value={average} />
        <small>
          {count} {count === 1 ? "review" : "reviews"}
        </small>
      </div>
      <ul className="review-bars" aria-label="Ratings breakdown">
        {[5, 4, 3, 2, 1].map((point) => (
          <li key={point}>
            <span>{point}</span>
            <i>
              <b style={{ width: `${count ? (distribution[point] / count) * 100 : 0}%` }} />
            </i>
            <small>{distribution[point]}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Create or edit form. `existing` is the patient's own review when editing. */
function ReviewForm({ doctorId, existing, onSaved, onCancel }) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!rating) {
      setError("Choose a rating from 1 to 5.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const input = { rating, comment: comment.trim() };
      const saved = existing
        ? await reviewService.update(existing.id, input)
        : await reviewService.create(doctorId, input);
      onSaved(saved);
    } catch (failure) {
      setError(failure.details?.comment ?? failure.details?.rating ?? failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="review-form" onSubmit={submit} noValidate>
      <h3>{existing ? "Edit your review" : "Rate your visit"}</h3>
      <StarPicker value={rating} onChange={setRating} disabled={busy} />
      <label className="field">
        Share your experience (optional)
        <textarea
          rows={3}
          maxLength={COMMENT_MAX}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="How was the consultation? Was the doctor attentive and clear?"
        />
        <small className="field-hint">
          {comment.length}/{COMMENT_MAX}
        </small>
      </label>
      <Notice error>{error}</Notice>
      <div className="form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : existing ? "Save review" : "Submit review"}
        </Button>
        {existing && (
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Patient reviews for one doctor: the rating summary, the reviews, and (for a patient who has had a
 * completed visit) the form to write or change their own review.
 * @param {{doctorId: string, onSummary?: (summary: {average: number, count: number}) => void}} props
 */
export default function ReviewsSection({ doctorId, onSummary }) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [editing, setEditing] = useState(false);
  const { data, loading, error, reload, setData } = useResource(
    () => reviewService.list(doctorId),
    [doctorId],
  );

  useEffect(() => {
    if (data) onSummary?.(data.summary);
  }, [data, onSummary]);

  const saved = (message) => (review) => {
    setEditing(false);
    notify(message);
    setData((current) => {
      if (!current || !review) return current;
      const previous = current.items.find((item) => item.mine);
      const distribution = { ...current.summary.distribution };
      if (previous) distribution[previous.rating] = Math.max(0, distribution[previous.rating] - 1);
      distribution[review.rating] = (distribution[review.rating] ?? 0) + 1;
      const count = current.summary.count + (previous ? 0 : 1);
      const ratingTotal =
        current.summary.average * current.summary.count - (previous?.rating ?? 0) + review.rating;
      return {
        ...current,
        summary: {
          ...current.summary,
          average: count ? Math.round((ratingTotal / count) * 10) / 10 : 0,
          count,
          distribution,
        },
        items: [review, ...current.items.filter((item) => item.id !== review.id && !item.mine)],
        viewer: { ...current.viewer, canReview: false, myReview: review },
      };
    });
    reload();
  };

  const remove = async () => {
    const confirmed = await confirm({
      title: "Delete your review?",
      message: "Your rating and comment will be removed from this doctor’s profile.",
      confirmLabel: "Delete review",
    });
    if (!confirmed) return;
    try {
      await reviewService.remove(data.viewer.myReview.id);
      notify("Your review was deleted.");
      reload();
    } catch (failure) {
      notify(failure.message);
    }
  };

  if (!data)
    return (
      <section className="profile-section surface" aria-busy={loading}>
        <span className="eyebrow">PATIENT REVIEWS</span>
        <h2>What patients say.</h2>
        <p className="review-empty">
          {error ? "Reviews could not be loaded right now." : "Loading reviews…"}
        </p>
      </section>
    );

  const { summary, items, viewer } = data;
  return (
    <section className="profile-section surface" id="reviews">
      <span className="eyebrow">PATIENT REVIEWS</span>
      <h2>What patients say.</h2>
      {summary.count > 0 ? (
        <Summary summary={summary} />
      ) : (
        <p className="review-empty">No reviews yet. Patients can rate a doctor after a completed visit.</p>
      )}

      {viewer.canReview && !editing && (
        <ReviewForm doctorId={doctorId} onSaved={saved("Thank you. Your review was posted.")} />
      )}
      {viewer.myReview && editing && (
        <ReviewForm
          doctorId={doctorId}
          existing={viewer.myReview}
          onSaved={saved("Your review was updated.")}
          onCancel={() => setEditing(false)}
        />
      )}

      {items.length > 0 && (
        <ul className="review-list">
          {items.map((review) => (
            <li key={review.id} className="review-item">
              <div className="review-head">
                <Stars value={review.rating} size={14} />
                <strong>{review.author}</strong>
                {review.mine && <span className="review-mine">Your review</span>}
                <time dateTime={review.createdAt}>{timeAgo(review.createdAt)}</time>
              </div>
              {review.comment && <p translate="no">{review.comment}</p>}
              {review.mine && !editing && (
                <div className="review-actions">
                  <button type="button" className="table-action" onClick={() => setEditing(true)}>
                    <Pencil size={12} /> Edit
                  </button>
                  <button type="button" className="table-action table-action-danger" onClick={remove}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
