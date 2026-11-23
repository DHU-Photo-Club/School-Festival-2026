export function scatterPosition(index: number) {
	// Restore the original golden-angle spiral, with density falling toward the outside.
	// Keep one orb at the previous lower-left pair's midpoint, and move the other
	// into the vacant outer position so the data remains available when panning.
	if (index === 7) return { x: -105, y: 250 };
	const positionIndex = index === 4 ? 7 : index;
	const angle = -Math.PI / 2 + positionIndex * Math.PI * (3 - Math.sqrt(5));
	const radius = Math.sqrt(220 ** 2 + 6400 * positionIndex ** 1.5);
	return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}
