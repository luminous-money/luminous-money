/** Whether this is the installed app, which has no address bar or browser menu (so no find, and
 * no way to copy the page's address); on the dev server too, to try what's offered only there. */
export const installedApp = () =>
  import.meta.env.DEV ||
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;
