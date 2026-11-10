# CRS Roofing calculator

This folder is a self-contained Vercel project with a static calculator and one
server-side enquiry email function.

Vercel Root Directory: pages/crs-roofing

Required Vercel environment variables:

- RESEND_API_KEY
- RESEND_FROM_EMAIL, set to `CRS Roofing <quotes@ta-partner.co.uk>`

Optional:

- CRS_ADMIN_EMAIL, which defaults to dan@dm-me.co.uk

## Free roof inspection campaign

- `/roofing` embeds the existing HighLevel “Book Your Free Roof Inspection”
  form (`LkhGXiWJQ0qWKDIrVxwR`) and sends Meta `PageView`.
- After HighLevel confirms the embedded submission, the browser navigates to
  `/roofing/thankyou`. That page consumes a one-time session marker and sends
  Meta `Lead`. Direct visits and refreshes do not count as leads.
- The campaign uses pixel `1101695255519025`. Its form redirect is handled on
  this landing page, so the shared form can continue to show its normal
  confirmation message on other sites.
