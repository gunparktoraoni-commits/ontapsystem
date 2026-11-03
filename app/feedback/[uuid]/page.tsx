"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Package, Sparkles, Star } from "lucide-react";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { FullPageLoader } from "@/app/components/Loader";

const API_BASE_URL = getFrontendApiBaseUrl();

type FeedbackPreview = {
  uuid: string;
  status: string;
  can_submit: boolean;
  expires_at: string;
  submitted_at: string | null;
  ratings: {
    overall_rating: number | null;
    product_rating: number | null;
    delivery_rating: number | null;
    recommend: boolean | null;
    message: string | null;
  } | null;
  order: {
    order_number: string;
    status: string;
    currency: string;
    items: Array<{ name: string; quantity: number }>;
  };
  user: { first_name: string | null };
};

const RATING_LABELS = ["", "Needs work", "Okay", "Good", "Great", "Excellent"];

function StarRow({
  value,
  onChange,
  label,
  required,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const display = hover || value;

  return (
    <div className="feedback-star-row">
      <div className="feedback-star-row__label">
        <span>{label}</span>
        {required ? <em>Required</em> : <em>Optional</em>}
      </div>
      <div
        className="feedback-star-row__stars"
        role="radiogroup"
        aria-label={label}
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n <= display;
          return (
            <motion.button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              disabled={disabled}
              className={`feedback-star ${active ? "is-active" : ""}`}
              onMouseEnter={() => !disabled && setHover(n)}
              onFocus={() => !disabled && setHover(n)}
              onBlur={() => setHover(0)}
              onClick={() => onChange(n)}
              whileTap={disabled ? undefined : { scale: 0.88 }}
              whileHover={disabled ? undefined : { y: -2 }}
            >
              <Star
                size={28}
                strokeWidth={1.6}
                fill={active ? "currentColor" : "transparent"}
              />
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        {display > 0 ? (
          <motion.p
            key={display}
            className="feedback-star-row__hint"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            {RATING_LABELS[display]}
          </motion.p>
        ) : (
          <p className="feedback-star-row__hint is-muted">Tap a star to rate</p>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function OrderFeedbackPage() {
  const params = useParams();
  const uuid = typeof params?.uuid === "string" ? params.uuid : "";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FeedbackPreview | null>(null);
  const [done, setDone] = useState(false);

  const [overall, setOverall] = useState(0);
  const [product, setProduct] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");

  const firstName = useMemo(() => {
    const name = preview?.user.first_name?.trim();
    return name || "friend";
  }, [preview]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uuid) {
        setError("This feedback link is missing or incomplete.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/feedback/${encodeURIComponent(uuid)}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = await response.json().catch(() => null);
        if (cancelled) return;

        if (!response.ok || !payload?.success || !payload?.data) {
          setError(
            payload?.error ??
              "This feedback link is invalid or no longer available.",
          );
          setPreview(null);
          return;
        }

        const data = payload.data as FeedbackPreview;
        setPreview(data);
        if (data.status === "submitted" || data.ratings) {
          setDone(true);
          setOverall(data.ratings?.overall_rating ?? 0);
          setProduct(data.ratings?.product_rating ?? 0);
          setDelivery(data.ratings?.delivery_rating ?? 0);
          setRecommend(data.ratings?.recommend ?? null);
          setMessage(data.ratings?.message ?? "");
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load this feedback form. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!uuid || submitting) return;

      if (overall < 1) {
        setError("Please choose an overall rating before submitting.");
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/feedback/${encodeURIComponent(uuid)}`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              overall_rating: overall,
              product_rating: product > 0 ? product : null,
              delivery_rating: delivery > 0 ? delivery : null,
              recommend,
              message: message.trim() || null,
            }),
          },
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.success) {
          setError(
            payload?.error ??
              "We couldn't save your feedback. Please try again.",
          );
          return;
        }

        setDone(true);
      } catch {
        setError("Network error while sending feedback. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [uuid, submitting, overall, product, delivery, recommend, message],
  );

  if (loading) {
    return <FullPageLoader />;
  }

  return (
    <div className="feedback-page">
      <div className="feedback-shell">
        <motion.div
          className="feedback-brand"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="feedback-brand__mark" aria-hidden>
            <Sparkles size={18} />
          </div>
          <div className="feedback-brand__name">OnTap</div>
        </motion.div>

        <motion.section
          className="feedback-panel"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          {!preview ? (
            <>
              <p className="feedback-kicker">Feedback</p>
              <h1 className="feedback-title">Link unavailable</h1>
              <p className="feedback-lede">
                {error ??
                  "We couldn't find an order feedback invitation for this link."}
              </p>
            </>
          ) : done || !preview.can_submit ? (
            <div className="feedback-success">
              <motion.div
                className="feedback-success__icon"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
              >
                <CheckCircle2 size={30} />
              </motion.div>
              <h1 className="feedback-title">
                {preview.status === "expired"
                  ? "This link has expired"
                  : "Thank you!"}
              </h1>
              <p className="feedback-lede">
                {preview.status === "expired"
                  ? "Feedback links stay open for 30 days after we invite you. We still appreciate your business."
                  : `Thanks${firstName !== "friend" ? `, ${firstName}` : ""} — your notes help us keep OnTap sharp for every customer.`}
              </p>
              {preview.order?.order_number ? (
                <div className="feedback-order" style={{ textAlign: "left" }}>
                  <div className="feedback-order__meta">
                    <Package size={18} />
                    Order {preview.order.order_number}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <p className="feedback-kicker">
                <Sparkles size={14} /> How did we do?
              </p>
              <h1 className="feedback-title">
                Thanks for choosing OnTap, {firstName}.
              </h1>
              <p className="feedback-lede">
                We appreciate your trust. Tell us what worked — and what we can
                improve — for order{" "}
                <strong>{preview.order.order_number}</strong>.
              </p>

              <div className="feedback-order">
                <div className="feedback-order__meta">
                  <Package size={18} />
                  Your purchase
                </div>
                <ul className="feedback-order__items">
                  {preview.order.items.length ? (
                    preview.order.items.map((item) => (
                      <li key={`${item.name}-${item.quantity}`}>
                        {item.name} × {item.quantity}
                      </li>
                    ))
                  ) : (
                    <li>Recent OnTap order</li>
                  )}
                </ul>
              </div>

              <form className="feedback-form" onSubmit={handleSubmit}>
                <StarRow
                  label="Overall experience"
                  value={overall}
                  onChange={setOverall}
                  required
                />
                <StarRow
                  label="Product quality"
                  value={product}
                  onChange={setProduct}
                />
                <StarRow
                  label="Delivery & fulfillment"
                  value={delivery}
                  onChange={setDelivery}
                />

                <div className="feedback-recommend">
                  <div className="feedback-recommend__label">
                    Would you recommend OnTap?
                  </div>
                  <div className="feedback-recommend__btns">
                    <button
                      type="button"
                      className={`feedback-choice ${recommend === true ? "is-selected" : ""}`}
                      onClick={() => setRecommend(true)}
                    >
                      Yes, happily
                    </button>
                    <button
                      type="button"
                      className={`feedback-choice ${recommend === false ? "is-selected" : ""}`}
                      onClick={() => setRecommend(false)}
                    >
                      Not yet
                    </button>
                  </div>
                </div>

                <div className="feedback-message">
                  <label htmlFor="feedback-message">Anything else to share?</label>
                  <textarea
                    id="feedback-message"
                    value={message}
                    maxLength={2000}
                    placeholder="What stood out? What should we fix next?"
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <div className="feedback-message__count">
                    {message.length}/2000
                  </div>
                </div>

                {error ? <p className="feedback-error">{error}</p> : null}

                <motion.button
                  type="submit"
                  className="feedback-submit"
                  disabled={submitting || overall < 1}
                  whileTap={submitting ? undefined : { scale: 0.98 }}
                >
                  {submitting ? "Sending…" : "Submit feedback"}
                </motion.button>
              </form>
            </>
          )}
        </motion.section>

        <p className="feedback-footer">
          OnTap · portal.ontap.ph · Your voice shapes what we build next
        </p>
      </div>
    </div>
  );
}
