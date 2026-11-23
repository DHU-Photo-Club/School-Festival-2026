export interface ArchivePhoto {
	id: string;
	src?: string;
	fullSrc?: string;
	alt: string;
}

export interface ArchiveDetailData {
	colorName: string;
	description: string;
	photos: ArchivePhoto[];
}

/** Replace this fixture provider with the archive data source when it is available. */
export function previewDetail(id: string): ArchiveDetailData {
	return {
		colorName: "カラーネーム",
		description: "色の説明が入ります。".repeat(12),
		photos: Array.from({ length: 18 }, (_, index) => ({ id: `${id}-photo-${index + 1}`, alt: `写真 ${index + 1}` })),
	};
}
