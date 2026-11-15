(() => {
  if (window.parent === window) return;
  const permitted = JSON.parse(document.currentScript.dataset.parentOrigins);
  function capture(event) {
    const claim = event.data?.session_claim;
    if (event.source !== window.parent || !permitted.includes(event.origin)
        || event.data?.type !== "litellm-auth" || typeof claim !== "string" || claim.length > 8194) return;
    window.imageStudioPendingClaim = { claim, origin: event.origin };
  }
  window.addEventListener("message", capture);
  window.imageStudioStopClaimBuffer = () => window.removeEventListener("message", capture);
})();
