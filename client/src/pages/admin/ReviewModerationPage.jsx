import { useState } from "react";
import { Stars } from "../../components/reviews/StarRating.jsx";
import {
  DataTable,
  ErrorState,
  PageLoader,
  SectionHeading,
  StatusPill,
  Tabs,
} from "../../components/ui/index.js";
import { useAction } from "../../hooks/useAction.js";
import { useResource } from "../../hooks/useResource.js";
import { adminService } from "../../services/index.js";
import { timeAgo } from "../../utils/dates.js";

const FILTERS = [
  { key: "", label: "All reviews" },
  { key: "visible", label: "Visible" },
  { key: "hidden", label: "Hidden" },
];

/** Patient reviews with the full author, so inappropriate ones can be hidden from doctors’ profiles. */
export default function ReviewModerationPage() {
  const run = useAction();
  const [filter, setFilter] = useState("");
  const reviews = useResource(() => adminService.listReviews(filter || undefined), [filter]);
  const rows = reviews.data ?? [];

  const change = async (review, status) => {
    const updated = await run(() => adminService.setReviewStatus(review.id, status), {
      success: status === "hidden" ? "Review hidden from the public profile." : "Review is visible again.",
    });
    if (updated)
      reviews.setData((items) =>
        filter && filter !== updated.status
          ? items.filter((item) => item.id !== updated.id)
          : items.map((item) => (item.id === updated.id ? updated : item)),
      );
  };

  const columns = [
    {
      key: "review",
      header: "REVIEW",
      render: (review) => (
        <span className="review-comment-cell">
          <Stars value={review.rating} size={13} />
          <br />
          {review.comment ? <span translate="no">{review.comment}</span> : <em>No comment</em>}
        </span>
      ),
    },
    {
      key: "doctor",
      header: "DOCTOR",
      render: (review) => review.doctorName,
    },
    {
      key: "patient",
      header: "WRITTEN BY",
      render: (review) => (
        <span className="table-person">
          <span>
            <strong>{review.patientName}</strong>
            <small>{review.patientEmail}</small>
          </span>
        </span>
      ),
    },
    { key: "when", header: "POSTED", render: (review) => timeAgo(review.createdAt) },
    { key: "status", header: "STATUS", render: (review) => <StatusPill status={review.status} /> },
    {
      key: "action",
      header: "ACTION",
      render: (review) =>
        review.status === "hidden" ? (
          <button className="table-action" type="button" onClick={() => change(review, "visible")}>
            Restore
          </button>
        ) : (
          <button
            className="table-action table-action-danger"
            type="button"
            onClick={() => change(review, "hidden")}
          >
            Hide
          </button>
        ),
    },
  ];

  return (
    <>
      <SectionHeading
        eyebrow="REVIEW MODERATION"
        title={
          <>
            Reviews, kept <em>honest.</em>
          </>
        }
        description="Hide a review that is abusive or not about the visit. Hidden reviews disappear from the doctor’s profile and stop counting towards the rating."
      />
      <Tabs tabs={FILTERS} value={filter} onChange={setFilter} label="Filter reviews" />
      {reviews.error && !reviews.data ? (
        <ErrorState error={reviews.error} onRetry={reviews.reload} />
      ) : !reviews.data ? (
        <PageLoader label="Loading reviews…" />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(review) => review.id}
          emptyMessage="No reviews in this view yet."
        />
      )}
    </>
  );
}
