export interface Project {
  id: number;
  original_image_url: string;
  mask_url: string | null;
  created_at: string;
}

export interface PaintColor {
  id: number;
  name: string;
  hex_code: string;
  brand: string;
  finish: string | null;
  /** The manufacturer's reference, e.g. "NF-R06" — what you quote at the counter. */
  code: string | null;
}

export interface Render {
  id: number;
  project_id: number;
  paint_color_top_id: number;
  paint_color_bottom_id: number | null;
  split_position: number | null;
  result_image_url: string | null;
  status: string;
  created_at: string;
}

export interface MaskPoint {
  x: number;
  y: number;
}

export type MaskMode = "auto" | "flood";

export interface MaskResult {
  mask_url: string;
  preview_url: string;
  coverage: number;
}
