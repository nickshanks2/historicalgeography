// How each feature type looks and is named in the UI. Presentation only:
// what exists in which year comes from the datasets, never from here.

export const LAND_COVER_TYPES = [
  "grassland",
  "open_field",
  "chaparral",
  "coastal_sage_scrub",
  "oak_woodland",
  "dune",
  "beach",
  "wetland",
  "salt_marsh",
  "riparian",
  "water",
] as const;
export type LandCoverType = (typeof LAND_COVER_TYPES)[number];

/** Painted-style colours: wash (base) and ink (texture marks). */
export const PAINTED: Record<LandCoverType | "ocean", { base: string; ink: string }> = {
  grassland: { base: "#e6dba6", ink: "#b09f58" },
  open_field: { base: "#e8dcbc", ink: "#b5a07a" },
  chaparral: { base: "#a3b088", ink: "#56663f" },
  coastal_sage_scrub: { base: "#c6cbaa", ink: "#788561" },
  oak_woodland: { base: "#adc08e", ink: "#55703f" },
  dune: { base: "#ecdcb4", ink: "#b39660" },
  beach: { base: "#f2e5c4", ink: "#c3a46c" },
  wetland: { base: "#b7cba3", ink: "#56784f" },
  salt_marsh: { base: "#cdcba3", ink: "#7d7a50" },
  riparian: { base: "#93b88d", ink: "#3f6b47" },
  water: { base: "#a9c9c9", ink: "#6b9ba1" },
  ocean: { base: "#abc8cc", ink: "#86adb3" },
};

/** Built-style flat colours for whatever land cover remains. */
export const BUILT_LAND: Record<LandCoverType | "ocean", string> = {
  grassland: "#ebe6cb",
  open_field: "#ede5d0",
  chaparral: "#d3dbc3",
  coastal_sage_scrub: "#dce0cc",
  oak_woodland: "#c9d9b6",
  dune: "#f0e7cf",
  beach: "#f2ead3",
  wetland: "#c9dcc2",
  salt_marsh: "#d5dcc2",
  riparian: "#c2d7b8",
  water: "#bcd5dd",
  ocean: "#bcd5dd",
};

export const BUILT = {
  background: "#f4f0e8",
  park: "#d0e3bb",
  building: "#d3c5b3",
  buildingLine: "#a7978a",
  pier: "#c2ac8f",
  street: "#ffffff",
  streetCasing: "#bdb3a6",
  rail: "#5a524a",
  streetcar: "#9b4a37",
  label: "#4a4239",
};

export const PAINTED_INK = {
  paper: "#f1e8d4",
  water: "#4f8597",
  coast: "#6f8f94",
  trail: "#8a5a3c",
  rancho: "#8c3b2f",
  village: "#6b3f26",
  label: "#4b3b2c",
  landmark: "#6e665c",
};

export const TYPE_LABELS: Record<string, string> = {
  grassland: "Grassland",
  open_field: "Open fields",
  chaparral: "Chaparral",
  coastal_sage_scrub: "Coastal sage scrub",
  oak_woodland: "Oak woodland",
  dune: "Dunes",
  beach: "Beach",
  wetland: "Wetland",
  salt_marsh: "Salt marsh",
  riparian: "Willow / riparian",
  water: "Open water",
  ocean: "Ocean",
  coastline: "Coastline",
  river: "River",
  creek: "Creek",
  village: "Tongva village",
  trail: "Trail",
  rancho: "Rancho boundary",
  adobe: "Adobe",
  street: "Street",
  building: "Building",
  pier: "Pier",
  rail: "Railroad",
  streetcar: "Streetcar line",
  park: "Park",
  landmark: "Today's landmark",
};
