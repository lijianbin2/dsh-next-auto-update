/**
 * Host half of the Auto update bundle.
 *
 * Every update action needs either the browser's `pluginManager` Remote or the
 * desktop window's own updater, so the browser module (`./client`) owns the
 * whole feature. This entry exists so the profile records the bundle and its
 * patch row; it registers nothing and holds no state.
 */
export function apply() {}
