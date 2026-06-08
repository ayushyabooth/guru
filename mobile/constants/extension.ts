/**
 * Chrome extension distribution config (GUR-227).
 *
 * The extension delivers the on-page Guru experience (FAB, highlights, peek
 * cards) on publisher articles. Until it's published to the Chrome Web Store we
 * ship an unpacked "beta" build; flip `EXTENSION_WEBSTORE_URL` once it's live
 * and the onboarding swaps from "Load unpacked" steps to a 1-click "Add to
 * Chrome" button automatically.
 */

export const EXTENSION_NAME = 'Guru Reader';

/** Chrome Web Store listing URL. Empty until published → onboarding shows the
 *  unpacked-install path. Set this after publishing to enable "Add to Chrome". */
export const EXTENSION_WEBSTORE_URL = '';

/** Downloadable zip of the unpacked build (host in the web app's /public, or a
 *  GitHub release). Used by the beta "Load unpacked" flow. */
export const EXTENSION_DOWNLOAD_URL = '/guru-extension.zip';

/** Marker the extension writes to <html data-guru-extension="<version>"> on load. */
export const EXTENSION_PRESENCE_ATTR = 'guruExtension'; // dataset key (data-guru-extension)

/** Event the extension dispatches on window when it injects. */
export const EXTENSION_READY_EVENT = 'guru:extension-ready';

/** True once the extension is on the Web Store (controls the CTA wording/target). */
export const isExtensionPublished = () => !!EXTENSION_WEBSTORE_URL;
