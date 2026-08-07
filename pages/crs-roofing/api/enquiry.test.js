import assert from "node:assert/strict";
import test from "node:test";

import handler from "./enquiry.js";

test("sends a calculator contact and new lead opportunity to HighLevel", async () => {
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_FROM_EMAIL = "CRS Roofing <quotes@example.com>";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "ghl-test-token";
  process.env.GHL_LOCATION_ID = "location-123";

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url) === "https://api.resend.com/emails") {
      return Response.json({ id: "email-123" });
    }

    if (String(url).includes("/opportunities/pipelines?")) {
      return Response.json({
        pipelines: [{
          id: "pipeline-sales",
          name: "Sales",
          stages: [{ id: "stage-new-lead", name: "NEW LEAD" }]
        }]
      });
    }

    if (String(url).endsWith("/contacts/upsert")) {
      return Response.json({
        new: true,
        contact: { id: "contact-123" }
      });
    }

    if (String(url).endsWith("/contacts/contact-123/tags")) {
      return Response.json({ tags: ["CRS Roofing Calculator"] }, { status: 201 });
    }

    if (String(url).endsWith("/opportunities/upsert")) {
      return Response.json({ opportunity: { id: "opportunity-123" } });
    }

    throw new Error("Unexpected request: " + url);
  };

  try {
    const request = new Request("https://crs-roofing.ta-partner.co.uk/api/enquiry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://crs-roofing.ta-partner.co.uk"
      },
      body: JSON.stringify({
        submissionId: "123e4567-e89b-12d3-a456-426614174000",
        website: "",
        name: "Test Customer",
        phone: "07123 456789",
        email: "test@example.com",
        consent: true,
        postcode: "RG4 9SL",
        distance: 3,
        width: 5,
        length: 6,
        height: 3,
        profile: "pitched",
        covering: "slate"
      })
    });
    const response = await handler.fetch(request);
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.crmSynced, true);

    const contactCall = calls.find((call) => call.url.endsWith("/contacts/upsert"));
    assert.deepEqual(JSON.parse(contactCall.options.body), {
      locationId: "location-123",
      name: "Test Customer",
      phone: "07123 456789",
      postalCode: "RG4 9SL",
      country: "GB",
      source: "CRS Roofing Website Calculator",
      createNewIfDuplicateAllowed: false,
      email: "test@example.com"
    });

    const tagCall = calls.find((call) => call.url.endsWith("/contacts/contact-123/tags"));
    assert.deepEqual(JSON.parse(tagCall.options.body), {
      tags: ["CRS Roofing Calculator"]
    });

    const opportunityCall = calls.find((call) => call.url.endsWith("/opportunities/upsert"));
    assert.deepEqual(JSON.parse(opportunityCall.options.body), {
      pipelineId: "pipeline-sales",
      pipelineStageId: "stage-new-lead",
      locationId: "location-123",
      contactId: "contact-123",
      name: "Test Customer - CRS Roofing website enquiry",
      status: "open",
      source: "CRS Roofing Website Calculator"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
