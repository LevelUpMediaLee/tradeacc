(() => {
  const form = document.querySelector(".form-card iframe");
  const formOrigin = new URL(form.dataset.src).origin;
  let submitted = false;

  window.addEventListener("message", ({ origin, source, data }) => {
    if (submitted || origin !== formOrigin || source !== form.contentWindow || !Array.isArray(data)) return;

    if (data[0] === "iframeLoaded") {
      const query = Object.fromEntries(new URLSearchParams(window.location.search));
      source.postMessage(["query-params", query, window.location.href, document.referrer, form.id], formOrigin);
      form.dataset.ready = "true";
      return;
    }

    // HighLevel sends this iframe-specific marker after it accepts a submission.
    if (data[0] !== "set-sticky-contacts" || data[1] !== `embedded_iframe_${form.id}` || data[2] !== form.id) return;

    submitted = true;
    try {
      sessionStorage.setItem("crs-roofing-inspection-submitted", "1");
    } catch {
      // The confirmation page still works when storage is disabled.
    }
    window.location.assign("/roofing/thankyou");
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted && submitted) window.location.reload();
  });

  form.src = form.dataset.src;
})();
