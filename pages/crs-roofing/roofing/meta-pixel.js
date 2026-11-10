(() => {
  const event = document.currentScript.dataset.event;
  const pixelId = "1101695255519025";

  if (event === "Lead") {
    const key = "crs-roofing-inspection-submitted";
    try {
      if (sessionStorage.getItem(key) !== "1") return;
      sessionStorage.removeItem(key);
    } catch {
      return;
    }
  }

  if (!window.fbq) {
    const queue = function () {
      if (queue.callMethod) queue.callMethod.apply(queue, arguments);
      else queue.queue.push(arguments);
    };
    queue.push = queue;
    queue.loaded = true;
    queue.version = "2.0";
    queue.queue = [];
    window.fbq = queue;
    window._fbq = queue;

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.append(script);
  }

  window.fbq("init", pixelId);
  window.fbq("trackSingle", pixelId, event);
})();
