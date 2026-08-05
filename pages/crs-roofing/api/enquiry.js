const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_REQUESTS = 8;
const rateBuckets = new Map();

const PRICING = {
  minimumArea: 10,
  minimumEstimate: 1150,
  materialsAllowance: 100,
  roofProfiles: {
    flat: { label: "Flat roof", multiplier: 1 },
    pitched: { label: "Pitched roof", multiplier: 1.25 }
  },
  coverings: {
    felt: { label: "Felt", ratePerSquareMetre: 100 },
    plain: { label: "Plain tile", ratePerSquareMetre: 200 },
    pan: { label: "Pan tile", ratePerSquareMetre: 100 },
    slate: { label: "Slate", ratePerSquareMetre: 180 }
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function getClientIp(request) {
  return (
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function checkRateLimit(request) {
  const now = Date.now();
  const key = getClientIp(request);
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    return null;
  }

  if (current.count >= RATE_LIMIT_REQUESTS) {
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  }

  current.count += 1;
  return null;
}

function cleanText(value, maximumLength) {
  return typeof value === "string"
    ? value.trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maximumLength)
    : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function validEmail(value) {
  return value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPhone(value) {
  return /^[+\d][\d\s().-]{6,39}$/.test(value);
}

function validateSubmission(body) {
  const submission = {
    submissionId: cleanText(body?.submissionId, 64),
    website: cleanText(body?.website, 200),
    name: cleanText(body?.name, 100),
    phone: cleanText(body?.phone, 40),
    email: cleanText(body?.email, 254).toLowerCase(),
    postcode: cleanText(body?.postcode, 10).toUpperCase(),
    profile: cleanText(body?.profile, 20),
    covering: cleanText(body?.covering, 20),
    width: Number(body?.width),
    length: Number(body?.length),
    height: Number(body?.height),
    distance: Number(body?.distance),
    consent: body?.consent === true
  };

  if (submission.website) {
    return { submission, spam: true };
  }

  if (!/^[0-9a-f-]{36}$/i.test(submission.submissionId)) {
    return { error: "The enquiry reference is invalid." };
  }

  if (submission.name.length < 2) {
    return { error: "Please enter your name." };
  }

  if (!validPhone(submission.phone)) {
    return { error: "Please enter a valid phone number." };
  }

  if (!validEmail(submission.email)) {
    return { error: "Please enter a valid email address." };
  }

  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(submission.postcode)) {
    return { error: "Please enter a valid UK postcode." };
  }

  if (
    !Number.isFinite(submission.width) ||
    submission.width < 2 ||
    submission.width > 40 ||
    !Number.isFinite(submission.length) ||
    submission.length < 2 ||
    submission.length > 40 ||
    !Number.isFinite(submission.height) ||
    submission.height < 2 ||
    submission.height > 15
  ) {
    return { error: "The roof measurements are invalid." };
  }

  if (!Number.isFinite(submission.distance) || submission.distance < 0 || submission.distance > 30) {
    return { error: "The property is outside the current service area." };
  }

  if (!PRICING.roofProfiles[submission.profile]) {
    return { error: "The roof profile is invalid." };
  }

  if (!PRICING.coverings[submission.covering]) {
    return { error: "The roof covering is invalid." };
  }

  if (
    (submission.profile === "flat" && submission.covering !== "felt") ||
    (submission.profile === "pitched" && submission.covering === "felt")
  ) {
    return { error: "The roof profile and covering do not match." };
  }

  if (!submission.consent) {
    return { error: "Contact consent is required." };
  }

  return { submission, spam: false };
}

function calculateEstimate(submission) {
  const area = submission.width * submission.length;
  const profile = PRICING.roofProfiles[submission.profile];
  const covering = PRICING.coverings[submission.covering];
  const calculated = area * covering.ratePerSquareMetre + PRICING.materialsAllowance;
  const estimateBase = area <= PRICING.minimumArea
    ? PRICING.minimumEstimate
    : Math.max(PRICING.minimumEstimate, calculated);
  const estimate = Math.round((estimateBase * profile.multiplier) / 50) * 50;

  return { area, profile, covering, estimate };
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0
  }).format(value);
}

function emailHtml(submission, calculation, receivedAt) {
  const rows = [
    ["Name", submission.name],
    ["Phone", submission.phone],
    ["Email", submission.email || "Not provided"],
    ["Property postcode", submission.postcode],
    ["Distance from CRS Roofing", Math.round(submission.distance) + " miles"],
    ["Roof profile", calculation.profile.label],
    ["Roof covering", calculation.covering.label],
    ["Roof width", submission.width.toFixed(1) + " m"],
    ["Roof length", submission.length.toFixed(1) + " m"],
    ["Roof footprint", calculation.area.toFixed(1) + " m²"],
    ["Roof height", submission.height.toFixed(1) + " m"],
    ["Rough estimate", "Approx. " + formatMoney(calculation.estimate)],
    ["Consent", "Confirmed"],
    ["Received", receivedAt]
  ];

  const tableRows = rows.map(([label, value]) => (
    "<tr>" +
      "<td style=\"padding:10px 12px;border-bottom:1px solid #e8e2d2;color:#6f6650;font-size:14px;vertical-align:top;\">" +
        escapeHtml(label) +
      "</td>" +
      "<td style=\"padding:10px 12px;border-bottom:1px solid #e8e2d2;color:#333333;font-size:14px;font-weight:600;vertical-align:top;\">" +
        escapeHtml(value) +
      "</td>" +
    "</tr>"
  )).join("");

  return [
    "<!doctype html><html><body style=\"margin:0;background:#f4f2ec;font-family:Arial,Helvetica,sans-serif;color:#333333;\">",
    "<div style=\"max-width:680px;margin:0 auto;padding:24px;\">",
    "<div style=\"background:#333333;padding:24px 28px;border-radius:12px 12px 0 0;\">",
    "<p style=\"margin:0;color:#c1a961;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;\">CRS Roofing</p>",
    "<h1 style=\"margin:8px 0 0;color:#ffffff;font-size:25px;line-height:1.25;\">New roof estimate enquiry</h1>",
    "</div>",
    "<div style=\"background:#ffffff;padding:24px 28px;border-radius:0 0 12px 12px;\">",
    "<p style=\"margin:0 0 20px;color:#555555;font-size:15px;line-height:1.5;\">A customer completed the CRS Roofing calculator and consented to being contacted.</p>",
    "<table role=\"presentation\" style=\"width:100%;border-collapse:collapse;border:1px solid #e8e2d2;border-radius:8px;\">",
    tableRows,
    "</table>",
    "<p style=\"margin:22px 0 0;font-size:13px;color:#777064;\">Enquiry reference: " + escapeHtml(submission.submissionId) + "</p>",
    "</div></div></body></html>"
  ].join("");
}

function emailText(submission, calculation, receivedAt) {
  return [
    "NEW CRS ROOFING ESTIMATE ENQUIRY",
    "",
    "Name: " + submission.name,
    "Phone: " + submission.phone,
    "Email: " + (submission.email || "Not provided"),
    "Property postcode: " + submission.postcode,
    "Distance from CRS Roofing: " + Math.round(submission.distance) + " miles",
    "Roof profile: " + calculation.profile.label,
    "Roof covering: " + calculation.covering.label,
    "Roof width: " + submission.width.toFixed(1) + " m",
    "Roof length: " + submission.length.toFixed(1) + " m",
    "Roof footprint: " + calculation.area.toFixed(1) + " m²",
    "Roof height: " + submission.height.toFixed(1) + " m",
    "Rough estimate: Approx. " + formatMoney(calculation.estimate),
    "Consent: Confirmed",
    "Received: " + receivedAt,
    "Enquiry reference: " + submission.submissionId
  ].join("\n");
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return json({ error: "Expected a JSON request." }, 415);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 20_000) {
      return json({ error: "The enquiry is too large." }, 413);
    }

    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      return json({ error: "Request origin is not allowed." }, 403);
    }

    const retryAfter = checkRateLimit(request);
    if (retryAfter) {
      return json(
        { error: "Too many enquiries. Please try again later." },
        429,
        { "Retry-After": String(retryAfter) }
      );
    }

    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      console.error("CRS enquiry email is missing Resend configuration.");
      return json({ error: "The enquiry service is not configured." }, 500);
    }

    try {
      const body = await request.json();
      const validation = validateSubmission(body);

      if (validation.error) {
        return json({ error: validation.error }, 400);
      }

      if (validation.spam) {
        return json({ ok: true });
      }

      const submission = validation.submission;
      const calculation = calculateEstimate(submission);
      const receivedAt = new Intl.DateTimeFormat("en-GB", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: "Europe/London"
      }).format(new Date());
      const recipient = process.env.CRS_ADMIN_EMAIL || "dan@dm-me.co.uk";
      const subject = "New CRS Roofing enquiry - " + submission.postcode + " - approx. " + formatMoney(calculation.estimate);
      const email = {
        from: process.env.RESEND_FROM_EMAIL,
        to: [recipient],
        subject,
        html: emailHtml(submission, calculation, receivedAt),
        text: emailText(submission, calculation, receivedAt)
      };

      if (submission.email) {
        email.reply_to = submission.email;
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json",
          "Idempotency-Key": "crs-enquiry-" + submission.submissionId
        },
        body: JSON.stringify(email)
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        console.error("Resend rejected the CRS enquiry email.", {
          status: response.status,
          name: data?.name
        });
        return json({ error: "We could not send your enquiry. Please try again." }, 502);
      }

      return json({
        ok: true,
        enquiryId: data?.id || null,
        estimate: calculation.estimate
      });
    } catch (error) {
      console.error("CRS enquiry function failed.", {
        name: error?.name,
        message: error?.message
      });
      return json({ error: "We could not send your enquiry. Please try again." }, 500);
    }
  }
};
