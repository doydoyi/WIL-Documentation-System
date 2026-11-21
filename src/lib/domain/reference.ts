/** Document fields an Administrator can mark as required per category. */
export const REQUIRED_FIELD_OPTIONS = ["title", "description", "document_date"] as const;
export type RequiredFieldName = (typeof REQUIRED_FIELD_OPTIONS)[number];

export const REQUIRED_FIELD_LABELS: Record<RequiredFieldName, string> = {
  title: "Title",
  description: "Description",
  document_date: "Document date",
};

export const MATCH_TARGET_LABELS = {
  file_name: "File name",
  folder_path: "Folder path",
  extracted_text: "Extracted text (OCR)",
} as const;
