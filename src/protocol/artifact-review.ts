export type ReviewLine = {
  kind: 'context' | 'added' | 'removed';
  before?: number;
  after?: number;
  text: string;
};

export interface ArtifactReviewNote {
  start: number;
  end: number;
  text: string;
}

export interface ArtifactReviewDecision {
  action: 'request_changes' | 'accept';
  notes: ArtifactReviewNote[];
  status: 'accepted' | 'preparing' | 'queued' | 'completed' | 'needs_review';
  messageId?: string;
  followupJobId?: string;
  workState?: string;
}

export interface ArtifactReviewView {
  ok: true;
  name: string;
  sha256: string;
  baselineSha256?: string;
  historical: boolean;
  lines: ReviewLine[];
  decision?: ArtifactReviewDecision;
}

export const artifactLines = (text: string) => text.split(/\r\n|\r|\n/);
export const MAX_REVIEW_LINES = 1200;
export const MAX_REVIEW_BYTES = 128 * 1024;

/** Callers bound both line counts. The table stores only lengths, keeping memory below 3 MiB. */
export function compareArtifactLines(before: readonly string[] | undefined, after: readonly string[]): ReviewLine[] {
  if (!before) return after.map((text, index) => ({ kind: 'context', after: index + 1, text }));
  const width = after.length + 1;
  const lengths = new Uint16Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      const at = i * width + j;
      lengths[at] = before[i] === after[j]
        ? 1 + lengths[at + width + 1]!
        : Math.max(lengths[at + width]!, lengths[at + 1]!);
    }
  }
  const rows: ReviewLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      rows.push({ kind: 'context', before: i + 1, after: j + 1, text: after[j++]! });
      i++;
    } else if (i < before.length && (j === after.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) {
      rows.push({ kind: 'removed', before: i + 1, text: before[i++]! });
    } else {
      rows.push({ kind: 'added', after: j + 1, text: after[j++]! });
    }
  }
  return rows;
}
