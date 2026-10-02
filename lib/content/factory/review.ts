export function filterReviewRows(rows: any[], filters: Record<string, string>) {
  return rows.filter(row => (!filters.reviewStatus || row.status === filters.reviewStatus)
    && (!filters.validation || (filters.validation === "flagged") === Boolean(row.validation_errors?.length || row.editorial_metadata?.warnings?.length || row.duplicate_group_id)));
}
export const reviewPage = (page: number, total: number) => Math.max(1, Math.min(page, Math.ceil(total / 25)));
export const WAVE_ONE_REVIEW_INDICATORS = [
 {subject:"Computing",code:"B10.2.4.1.1"},{subject:"Computing",code:"B10.2.4.1.3"},{subject:"Computing",code:"B10.3.3.1.2"},
 {subject:"Mathematics",code:"B10.1.3.1.1"},{subject:"Mathematics",code:"B10.1.3.1.2"},{subject:"Mathematics",code:"B10.1.3.1.3"},
 {subject:"Science",code:"B10.1.2.1.1"},{subject:"Science",code:"B10.1.2.1.2"},{subject:"Science",code:"B10.1.2.1.3"},
];
