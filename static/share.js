/* "Share this view" — copy the current URL to the clipboard.
 *
 * The URL is the view. A selected structure on a TCR page (?structure=), a selected
 * residue on a structure page (?residue=), the Explore viewer's state — all of it is
 * in the query string, and all of it is written with replaceState as you go. So the
 * URL as it stands *is* what the reader is looking at, and copying it shares that,
 * not merely the page it happens to be on.
 *
 * The button ships hidden and is revealed here, so a browser that cannot copy never
 * shows a control that does nothing.
 */
(function () {

  const button = document.querySelector('.share-view');
  if (!button) return;

  const label = button.querySelector('.share-view-label');
  const icon = button.querySelector('i');

  /* navigator.clipboard needs a secure context (https, or localhost in development)
   * AND permission — it REJECTS rather than returning false when the write is denied,
   * so it has to be caught, not just feature-detected. Falling through to the old
   * selection trick then covers both: plain http, and a denied permission. It is
   * deprecated, but the alternative is a button that does nothing. */
  async function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* denied — fall through */ }
    }

    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (e) {
      copied = false;
    }
    document.body.removeChild(field);
    return copied;
  }

  let resetting = null;

  function say(message, iconClass) {
    label.textContent = message;
    if (icon) icon.className = iconClass;

    clearTimeout(resetting);
    resetting = setTimeout(() => {
      label.textContent = 'Share this view';
      if (icon) icon.className = 'fa-regular fa-paste';
    }, 2000);
  }

  button.addEventListener('click', async () => {
    const copied = await copy(window.location.href);
    // Say what happened. A button that silently does nothing on failure is worse
    // than one that admits it — the reader would paste the wrong thing.
    if (copied) say('Link copied', 'fa-solid fa-check');
    else say('Press Ctrl+C', 'fa-regular fa-paste');
  });

  button.hidden = false;
})();
