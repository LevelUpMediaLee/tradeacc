const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_REQUESTS = 8;
const BRAND_LOGO_URL = "https://crs-roofing.ta-partner.co.uk/assets/crs-logo.png";
const HIGHLEVEL_API_URL = "https://services.leadconnectorhq.com";
const HIGHLEVEL_API_VERSION = "2021-07-28";
const HIGHLEVEL_CONTACT_TAG = "CRS Roofing Calculator";
const HIGHLEVEL_SOURCE = "CRS Roofing Website Calculator";
const HIGHLEVEL_PIPELINE_NAME = "Sales";
const HIGHLEVEL_STAGE_NAME = "NEW LEAD";
const rateBuckets = new Map();
let highLevelPipelineTargetPromise = null;

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

async function highLevelRequest(path, options = {}) {
  const response = await fetch(HIGHLEVEL_API_URL + path, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Authorization": "Bearer " + process.env.GHL_PRIVATE_INTEGRATION_TOKEN,
      "Content-Type": "application/json",
      "Version": HIGHLEVEL_API_VERSION,
      ...options.headers
    },
    signal: AbortSignal.timeout(5_000)
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error("HighLevel request failed with status " + response.status + ".");
    error.status = response.status;
    error.details = data?.message || data?.error || null;
    throw error;
  }

  return data;
}

function normaliseHighLevelName(value) {
  return String(value || "").trim().toLowerCase();
}

async function findHighLevelPipelineTarget() {
  if (process.env.GHL_PIPELINE_ID && process.env.GHL_PIPELINE_STAGE_ID) {
    return {
      pipelineId: process.env.GHL_PIPELINE_ID,
      pipelineStageId: process.env.GHL_PIPELINE_STAGE_ID
    };
  }

  const locationId = process.env.GHL_LOCATION_ID;
  const data = await highLevelRequest(
    "/opportunities/pipelines?locationId=" + encodeURIComponent(locationId)
  );
  const pipelineName = process.env.GHL_PIPELINE_NAME || HIGHLEVEL_PIPELINE_NAME;
  const stageName = process.env.GHL_PIPELINE_STAGE_NAME || HIGHLEVEL_STAGE_NAME;
  const pipeline = data?.pipelines?.find((item) => (
    normaliseHighLevelName(item?.name) === normaliseHighLevelName(pipelineName)
  ));

  if (!pipeline) {
    throw new Error("HighLevel pipeline '" + pipelineName + "' was not found.");
  }

  const stage = pipeline.stages?.find((item) => (
    normaliseHighLevelName(item?.name) === normaliseHighLevelName(stageName)
  ));

  if (!stage) {
    throw new Error(
      "HighLevel stage '" + stageName + "' was not found in pipeline '" + pipelineName + "'."
    );
  }

  return { pipelineId: pipeline.id, pipelineStageId: stage.id };
}

async function getHighLevelPipelineTarget() {
  if (!highLevelPipelineTargetPromise) {
    highLevelPipelineTargetPromise = findHighLevelPipelineTarget().catch((error) => {
      highLevelPipelineTargetPromise = null;
      throw error;
    });
  }

  return highLevelPipelineTargetPromise;
}

async function syncHighLevelLead(submission, calculation) {
  if (!process.env.GHL_PRIVATE_INTEGRATION_TOKEN || !process.env.GHL_LOCATION_ID) {
    throw new Error("HighLevel is missing its token or location ID.");
  }

  const locationId = process.env.GHL_LOCATION_ID;
  const contactPayload = {
    locationId,
    name: submission.name,
    phone: submission.phone,
    postalCode: submission.postcode,
    country: "GB",
    source: HIGHLEVEL_SOURCE,
    createNewIfDuplicateAllowed: false
  };

  if (submission.email) {
    contactPayload.email = submission.email;
  }

  const [contactResult, pipelineTarget] = await Promise.all([
    highLevelRequest("/contacts/upsert", {
      method: "POST",
      body: JSON.stringify(contactPayload)
    }),
    getHighLevelPipelineTarget()
  ]);
  const contactId = contactResult?.contact?.id;

  if (!contactId) {
    throw new Error("HighLevel did not return a contact ID.");
  }

  const contactTag = process.env.GHL_CONTACT_TAG || HIGHLEVEL_CONTACT_TAG;
  const [, opportunityResult] = await Promise.all([
    highLevelRequest("/contacts/" + encodeURIComponent(contactId) + "/tags", {
      method: "POST",
      body: JSON.stringify({ tags: [contactTag] })
    }),
    highLevelRequest("/opportunities/upsert", {
      method: "POST",
      body: JSON.stringify({
        pipelineId: pipelineTarget.pipelineId,
        pipelineStageId: pipelineTarget.pipelineStageId,
        locationId,
        contactId,
        name: submission.name + " - CRS Roofing website enquiry",
        status: "open",
        source: HIGHLEVEL_SOURCE,
        monetaryValue: calculation.estimate
      })
    })
  ]);

  return {
    contactId,
    opportunityId: opportunityResult?.opportunity?.id || null,
    contactCreated: contactResult?.new === true
  };
}

function adminEmailHtml(submission, calculation, receivedAt) {
  const roofRows = [
    ["Roof profile", calculation.profile.label],
    ["Roof covering", calculation.covering.label],
    ["Roof width", submission.width.toFixed(1) + " m"],
    ["Roof length", submission.length.toFixed(1) + " m"],
    ["Roof footprint", calculation.area.toFixed(1) + " m²"],
    ["Roof height", submission.height.toFixed(1) + " m"]
  ];

  const tableRows = roofRows.map(([label, value], index) => (
    "<tr>" +
      "<td style=\"padding:11px 14px;" + (index < roofRows.length - 1 ? "border-bottom:1px solid #ebe7db;" : "") + "color:#746d5d;font-size:14px;line-height:1.4;vertical-align:top;\">" +
        escapeHtml(label) +
      "</td>" +
      "<td style=\"padding:11px 14px;" + (index < roofRows.length - 1 ? "border-bottom:1px solid #ebe7db;" : "") + "color:#333333;font-size:14px;font-weight:600;line-height:1.4;text-align:right;vertical-align:top;\">" +
        escapeHtml(value) +
      "</td>" +
    "</tr>"
  )).join("");

  const customerEmail = submission.email || "Not provided";
  const customerEmailHtml = submission.email
    ? "<a href=\"mailto:" + escapeHtml(submission.email) + "\" style=\"color:#333333;text-decoration:none;\">" + escapeHtml(submission.email) + "</a>"
    : escapeHtml(customerEmail);

  return [
    "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"light only\"><title>New CRS Roofing enquiry</title></head>",
    "<body style=\"margin:0;padding:0;background:#edece8;font-family:'Avenir Next',Avenir,'Century Gothic','Helvetica Neue',Arial,sans-serif;color:#333333;\">",
    "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;\">New CRS Roofing estimate enquiry from " + escapeHtml(submission.name) + " in " + escapeHtml(submission.postcode) + ".</div>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;background:#edece8;\"><tr><td align=\"center\" style=\"padding:32px 12px;\">",
    "<table role=\"presentation\" width=\"640\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;max-width:640px;border-collapse:separate;background:#ffffff;border-radius:14px;box-shadow:0 12px 34px rgba(51,51,51,.13);overflow:hidden;\">",
    "<tr><td style=\"height:7px;background:#c1a961;font-size:0;line-height:0;\">&nbsp;</td></tr>",
    "<tr><td align=\"center\" style=\"padding:26px 24px 22px;background:#333333;\">",
    "<img src=\"" + BRAND_LOGO_URL + "\" width=\"132\" alt=\"CRS Roofing\" style=\"display:block;width:132px;max-width:45%;height:auto;margin:0 auto;border:0;\">",
    "<p style=\"margin:18px 0 0;color:#c1a961;font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;\">Website estimate calculator</p>",
    "<h1 style=\"margin:8px 0 0;color:#ffffff;font-size:27px;font-weight:500;line-height:1.25;letter-spacing:-.02em;\">New roofing enquiry</h1>",
    "</td></tr>",
    "<tr><td style=\"padding:28px 28px 10px;background:#ffffff;\">",
    "<p style=\"margin:0;color:#777064;font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;\">Rough estimate</p>",
    "<p style=\"margin:7px 0 0;color:#333333;font-size:38px;font-weight:700;line-height:1.15;letter-spacing:-.035em;\">Approx. " + escapeHtml(formatMoney(calculation.estimate)) + "</p>",
    "<p style=\"margin:8px 0 0;color:#6d6d68;font-size:14px;line-height:1.5;\">Submitted " + escapeHtml(receivedAt) + "</p>",
    "</td></tr>",
    "<tr><td style=\"padding:18px 28px 0;background:#ffffff;\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;border-collapse:separate;background:#f3efe3;border-left:4px solid #c1a961;border-radius:10px;\"><tr><td style=\"padding:20px;\">",
    "<p style=\"margin:0 0 10px;color:#746d5d;font-size:12px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;\">Customer details</p>",
    "<p style=\"margin:0;color:#333333;font-size:22px;font-weight:600;line-height:1.3;\">" + escapeHtml(submission.name) + "</p>",
    "<p style=\"margin:12px 0 0;color:#333333;font-size:15px;line-height:1.6;\"><a href=\"tel:" + escapeHtml(submission.phone) + "\" style=\"color:#333333;font-weight:600;text-decoration:none;\">" + escapeHtml(submission.phone) + "</a><br>" + customerEmailHtml + "</p>",
    "</td></tr></table>",
    "</td></tr>",
    "<tr><td style=\"padding:24px 28px 0;background:#ffffff;\">",
    "<p style=\"margin:0 0 11px;color:#746d5d;font-size:12px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;\">Property</p>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;border-collapse:separate;background:#333333;border-radius:10px;\"><tr>",
    "<td style=\"width:50%;padding:17px 18px;border-right:1px solid #555555;vertical-align:top;\"><span style=\"display:block;color:#bdbdb7;font-size:12px;line-height:1.3;\">Postcode</span><strong style=\"display:block;margin-top:4px;color:#ffffff;font-size:17px;font-weight:600;line-height:1.3;\">" + escapeHtml(submission.postcode) + "</strong></td>",
    "<td style=\"width:50%;padding:17px 18px;vertical-align:top;\"><span style=\"display:block;color:#bdbdb7;font-size:12px;line-height:1.3;\">From CRS Roofing</span><strong style=\"display:block;margin-top:4px;color:#c1a961;font-size:17px;font-weight:600;line-height:1.3;\">" + Math.round(submission.distance) + " miles</strong></td>",
    "</tr></table>",
    "</td></tr>",
    "<tr><td style=\"padding:24px 28px 0;background:#ffffff;\">",
    "<p style=\"margin:0 0 11px;color:#746d5d;font-size:12px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;\">Roof summary</p>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;border-collapse:separate;border:1px solid #e2ddcf;border-radius:10px;\">",
    tableRows,
    "</table>",
    "</td></tr>",
    "<tr><td align=\"center\" style=\"padding:26px 28px 30px;background:#ffffff;\">",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\"><tr><td align=\"center\" bgcolor=\"#c1a961\" style=\"border-radius:8px;\"><a href=\"tel:" + escapeHtml(submission.phone) + "\" style=\"display:inline-block;padding:14px 24px;color:#292929;font-size:14px;font-weight:700;text-decoration:none;\">Call " + escapeHtml(submission.name) + " · " + escapeHtml(submission.phone) + "</a></td></tr></table>",
    "<p style=\"margin:19px 0 0;color:#88847a;font-size:11px;line-height:1.5;\">Contact consent confirmed · Reference " + escapeHtml(submission.submissionId) + "</p>",
    "</td></tr>",
    "<tr><td align=\"center\" style=\"padding:17px 24px;background:#333333;color:#bdbdb7;font-size:11px;line-height:1.5;\">CRS Roofing · 0118 230 2060 · info@crsroofing-reading.co.uk</td></tr>",
    "</table></td></tr></table></body></html>"
  ].join("");
}

function adminEmailText(submission, calculation, receivedAt) {
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

function customerEmailHtml(submission, calculation) {
  const summaryRows = [
    ["Property", submission.postcode],
    ["Roof type", calculation.profile.label],
    ["Roof covering", calculation.covering.label],
    ["Roof footprint", calculation.area.toFixed(1) + " m²"],
    ["Roof height", submission.height.toFixed(1) + " m"]
  ];
  const tableRows = summaryRows.map(([label, value], index) => (
    "<tr>" +
      "<td style=\"padding:12px 14px;" + (index < summaryRows.length - 1 ? "border-bottom:1px solid #ebe7db;" : "") + "color:#746d5d;font-size:14px;line-height:1.4;vertical-align:top;\">" + escapeHtml(label) + "</td>" +
      "<td style=\"padding:12px 14px;" + (index < summaryRows.length - 1 ? "border-bottom:1px solid #ebe7db;" : "") + "color:#333333;font-size:14px;font-weight:600;line-height:1.4;text-align:right;vertical-align:top;\">" + escapeHtml(value) + "</td>" +
    "</tr>"
  )).join("");

  return [
    "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"color-scheme\" content=\"light only\"><title>Your CRS Roofing rough estimate</title></head>",
    "<body style=\"margin:0;padding:0;background:#edece8;font-family:'Avenir Next',Avenir,'Century Gothic','Helvetica Neue',Arial,sans-serif;color:#333333;\">",
    "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;\">Your CRS Roofing rough estimate is approx. " + escapeHtml(formatMoney(calculation.estimate)) + ".</div>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;background:#edece8;\"><tr><td align=\"center\" style=\"padding:32px 12px;\">",
    "<table role=\"presentation\" width=\"640\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;max-width:640px;border-collapse:separate;background:#ffffff;border-radius:14px;box-shadow:0 12px 34px rgba(51,51,51,.13);overflow:hidden;\">",
    "<tr><td style=\"height:7px;background:#c1a961;font-size:0;line-height:0;\">&nbsp;</td></tr>",
    "<tr><td align=\"center\" style=\"padding:26px 24px 22px;background:#333333;\">",
    "<img src=\"" + BRAND_LOGO_URL + "\" width=\"132\" alt=\"CRS Roofing\" style=\"display:block;width:132px;max-width:45%;height:auto;margin:0 auto;border:0;\">",
    "<p style=\"margin:18px 0 0;color:#c1a961;font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;\">Estimate confirmation</p>",
    "<h1 style=\"margin:8px 0 0;color:#ffffff;font-size:27px;font-weight:500;line-height:1.25;letter-spacing:-.02em;\">Your rough estimate</h1>",
    "</td></tr>",
    "<tr><td style=\"padding:28px 28px 0;background:#ffffff;\">",
    "<p style=\"margin:0;color:#333333;font-size:18px;font-weight:600;line-height:1.5;\">Hi " + escapeHtml(submission.name) + ",</p>",
    "<p style=\"margin:10px 0 0;color:#666661;font-size:15px;line-height:1.6;\">Thanks for using the CRS Roofing roof estimate calculator. Based on the information you provided, your rough estimate is:</p>",
    "</td></tr>",
    "<tr><td style=\"padding:23px 28px 6px;background:#ffffff;\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;background:#f3efe3;border-left:4px solid #c1a961;border-radius:10px;\"><tr><td style=\"padding:22px;\">",
    "<p style=\"margin:0;color:#746d5d;font-size:12px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;\">Approximate cost</p>",
    "<p style=\"margin:7px 0 0;color:#333333;font-size:38px;font-weight:700;line-height:1.15;letter-spacing:-.035em;\">Approx. " + escapeHtml(formatMoney(calculation.estimate)) + "</p>",
    "</td></tr></table>",
    "</td></tr>",
    "<tr><td style=\"padding:24px 28px 0;background:#ffffff;\">",
    "<p style=\"margin:0 0 11px;color:#746d5d;font-size:12px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;\">Your details</p>",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;border-collapse:separate;border:1px solid #e2ddcf;border-radius:10px;\">",
    tableRows,
    "</table>",
    "</td></tr>",
    "<tr><td style=\"padding:24px 28px 0;background:#ffffff;\">",
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;background:#333333;border-radius:10px;\"><tr><td style=\"padding:22px;\">",
    "<p style=\"margin:0;color:#c1a961;font-size:12px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;\">What happens next?</p>",
    "<p style=\"margin:9px 0 0;color:#ffffff;font-size:17px;font-weight:500;line-height:1.5;\">Book a no-obligation site visit and we can inspect the roof and work everything out.</p>",
    "</td></tr></table>",
    "</td></tr>",
    "<tr><td align=\"center\" style=\"padding:26px 28px 12px;background:#ffffff;\">",
    "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\"><tr><td align=\"center\" bgcolor=\"#c1a961\" style=\"border-radius:8px;\"><a href=\"tel:+441182302060\" style=\"display:inline-block;padding:14px 24px;color:#292929;font-size:14px;font-weight:700;text-decoration:none;\">Call CRS Roofing · 0118 230 2060</a></td></tr></table>",
    "<p style=\"margin:16px 0 0;color:#666661;font-size:14px;line-height:1.5;\">Or email <a href=\"mailto:info@crsroofing-reading.co.uk\" style=\"color:#8c793d;font-weight:600;\">info@crsroofing-reading.co.uk</a></p>",
    "</td></tr>",
    "<tr><td style=\"padding:12px 28px 28px;background:#ffffff;\">",
    "<p style=\"margin:0;color:#88847a;font-size:12px;line-height:1.6;text-align:center;\">This estimate is a useful starting point. The final quotation will be confirmed following a site visit.</p>",
    "</td></tr>",
    "<tr><td align=\"center\" style=\"padding:17px 24px;background:#333333;color:#bdbdb7;font-size:11px;line-height:1.5;\">CRS Roofing · 0118 230 2060 · info@crsroofing-reading.co.uk</td></tr>",
    "</table></td></tr></table></body></html>"
  ].join("");
}

function customerEmailText(submission, calculation) {
  return [
    "YOUR CRS ROOFING ROUGH ESTIMATE",
    "",
    "Hi " + submission.name + ",",
    "",
    "Thanks for using the CRS Roofing roof estimate calculator.",
    "",
    "Your rough estimate: Approx. " + formatMoney(calculation.estimate),
    "",
    "YOUR DETAILS",
    "Property: " + submission.postcode,
    "Roof type: " + calculation.profile.label,
    "Roof covering: " + calculation.covering.label,
    "Roof footprint: " + calculation.area.toFixed(1) + " m²",
    "Roof height: " + submission.height.toFixed(1) + " m",
    "",
    "WHAT HAPPENS NEXT?",
    "Book a no-obligation site visit and we can inspect the roof and work everything out.",
    "",
    "This estimate is a useful starting point. The final quotation will be confirmed following a site visit.",
    "",
    "CRS Roofing",
    "0118 230 2060",
    "info@crsroofing-reading.co.uk"
  ].join("\n");
}

async function sendResendEmail(email, idempotencyKey) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(email)
  });
  const data = await response.json().catch(() => null);

  return { response, data };
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
        html: adminEmailHtml(submission, calculation, receivedAt),
        text: adminEmailText(submission, calculation, receivedAt)
      };

      if (submission.email) {
        email.reply_to = submission.email;
      }

      const { response, data } = await sendResendEmail(
        email,
        "crs-enquiry-" + submission.submissionId
      );

      if (!response.ok) {
        console.error("Resend rejected the CRS enquiry email.", {
          status: response.status,
          name: data?.name,
          message: data?.message
        });
        return json({ error: "We could not send your enquiry. Please try again." }, 502);
      }

      let crmSynced = false;

      try {
        await syncHighLevelLead(submission, calculation);
        crmSynced = true;
      } catch (error) {
        console.error("HighLevel rejected the CRS Roofing lead.", {
          name: error?.name,
          message: error?.message,
          status: error?.status,
          details: error?.details
        });
      }

      let confirmationSent = false;
      let confirmationId = null;

      if (submission.email) {
        const confirmationEmail = {
          from: process.env.RESEND_FROM_EMAIL,
          to: [submission.email],
          reply_to: "CRS Roofing <info@crsroofing-reading.co.uk>",
          subject: "Your CRS Roofing rough estimate - " + submission.postcode,
          html: customerEmailHtml(submission, calculation),
          text: customerEmailText(submission, calculation)
        };
        const confirmation = await sendResendEmail(
          confirmationEmail,
          "crs-confirmation-" + submission.submissionId
        );

        if (confirmation.response.ok) {
          confirmationSent = true;
          confirmationId = confirmation.data?.id || null;
        } else {
          console.error("Resend rejected the CRS customer confirmation.", {
            status: confirmation.response.status,
            name: confirmation.data?.name,
            message: confirmation.data?.message
          });
        }
      }

      return json({
        ok: true,
        enquiryId: data?.id || null,
        confirmationSent,
        confirmationId,
        crmSynced,
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
