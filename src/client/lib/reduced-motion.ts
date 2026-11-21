/** `prefers-reduced-motion: reduce` を監視する。 */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
	const query = matchMedia("(prefers-reduced-motion: reduce)");
	onChange(query.matches);
	const listener = (event: MediaQueryListEvent) => onChange(event.matches);
	query.addEventListener("change", listener);
	return () => query.removeEventListener("change", listener);
}
