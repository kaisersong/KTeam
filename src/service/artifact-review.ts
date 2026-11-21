import {createHash} from 'node:crypto';
import {fields,KTeamError,record,text} from '../errors.js';
import {generatedFilePreview} from '../runtime/generated-files.js';
import {artifactLines,compareArtifactLines,MAX_REVIEW_BYTES,MAX_REVIEW_LINES,type ArtifactReviewDecision,type ArtifactReviewNote,type ArtifactReviewView} from '../protocol/artifact-review.js';
import type {TeamStore} from './team-store.js';
import type {ConversationService} from './conversation.js';
import type {WorkInputs} from './work-inputs.js';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

function assertReviewer(membership: Record<string,unknown>, botId:string){
  const members = Array.isArray(membership.members) ? membership.members : [];
  if ((membership.room as any)?.status!=='active' ||
      !members.some(member=>member.status==='active'&&member.subject?.kind==='user'&&member.subject.userId==='user.local') ||
      !members.some(member=>member.status==='active'&&member.subject?.kind==='agent'&&member.subject.logicalAgentId===botId)) {
    throw new KTeamError('artifact_review_unavailable',409);
  }
}

interface ReviewRecord {
  id: string;
  roomId: string;
  jobId: string;
  pathKey: string;
  sha256: string;
  content: string;
  action: ArtifactReviewDecision['action'];
  notes: ArtifactReviewNote[];
  inputId: string;
  intent: string;
}

export class ArtifactReview {
  constructor(private store: TeamStore, private conversations: ConversationService, private inputs: WorkInputs) {}

  private source(roomId: string, toolCallId: string) {
    const receipts = this.store.generatedFilesForTool(roomId,toolCallId);
    const receipt = receipts[0];
    const job = receipt && this.store.job(receipt.facts.jobId);
    const result = job?.results?.find((result:any)=>result.botId===receipt.botId && (!receipt.taskRef||result.taskRef===receipt.taskRef));
    if (receipts.length!==1 || job?.roomId!==roomId || job.state!=='delivered' ||
        job.needsReview || !result?.messageId || !this.store.binding(receipt.botId)) {
      throw new KTeamError('artifact_review_unavailable',409);
    }
    return {
      id: 'artifact-review:'+receipt.id.slice('generated-file:'.length),
      roomId, toolCallId, job, botId:receipt.botId, resultMessageId:String(result.messageId),
      name:String(receipt.facts.file.name),pathKey:digest(receipt.facts.file.path), sha256:receipt.facts.file.sha256 as string,
    };
  }

  private version(source: ReturnType<ArtifactReview['source']>) {
    const preview = generatedFilePreview(this.store,source.roomId,source.toolCallId);
    if (!['markdown','text'].includes(preview.kind) || preview.bytes>MAX_REVIEW_BYTES || preview.content.includes('\0')) {
      throw new KTeamError('artifact_review_text_unavailable',409);
    }
    const lines = artifactLines(preview.content);
    if (lines.length>MAX_REVIEW_LINES) throw new KTeamError('artifact_review_text_unavailable',409);
    return {name:preview.name,content:preview.content,lines};
  }

  private decision(row: ReviewRecord): ArtifactReviewDecision {
    if (row.action==='accept') return {action:row.action,status:'accepted',notes:row.notes};
    const receipt = this.store.operation('work-input:'+row.inputId);
    const job = receipt?.queuedJobId ? this.store.job(receipt.queuedJobId) : undefined;
    const status = job?.state==='delivered'?'completed':job&&['blocked','stopped','unknown','cancelled','noop'].includes(job.state)?'needs_review':
      ['queued','completed','needs_review'].includes(receipt?.status) ? receipt.status : 'preparing';
    return {action:row.action,status,notes:row.notes,messageId:receipt?.messageId,
      followupJobId:receipt?.queuedJobId,workState:job?.state};
  }

  async view(roomId: string, toolCallId: string, {reconcile = true} = {}): Promise<ArtifactReviewView> {
    const membership = await this.conversations.scope(roomId);
    const source = this.source(roomId,toolCallId);
    assertReviewer(membership,source.botId);
    const decided = this.store.operation(source.id) as ReviewRecord | null;
    if (reconcile && decided && this.decision(decided).status==='preparing') {
      await this.inputs.view(roomId);
      assertReviewer(await this.conversations.scope(roomId),source.botId);
    }
    let current: string[];
    let historical = false;
    try { current = this.version(source).lines; }
    catch (error) {
      if (!decided || !(error instanceof KTeamError) || error.code!=='generated_file_changed') throw error;
      current = artifactLines(decided.content);
      historical = true;
    }
    const jobIds = [source.job.id];
    let job = source.job;
    // Compare only to preserved versions of this file in the same work lineage.
    while (job.afterJobId && jobIds.length<12 && !jobIds.includes(job.afterJobId)) {
      job = this.store.job(job.afterJobId);
      if (!job || job.roomId!==roomId) break;
      jobIds.push(job.id);
    }
    const baseline = this.store.artifactReviewBaseline(roomId,source.pathKey,jobIds,source.sha256);
    const decision = decided ? this.decision(decided) : undefined;
    if (historical && decision?.status==='preparing') decision.status='needs_review';
    return {
      ok:true,name:source.name,sha256:source.sha256,baselineSha256:baseline?.sha256,historical,
      lines:compareArtifactLines(baseline ? artifactLines(baseline.content) : undefined,current),
      source:{jobId:source.job.id,messageId:source.resultMessageId},
      decision,
    };
  }

  async submit(roomId: string, value: unknown) {
    const input = record(value);
    fields(input,['toolCallId','expectedSha256','action','notes']);
    const toolCallId = text(input.toolCallId,'tool_call_id');
    if (!['accept','request_changes'].includes(String(input.action))
        || !Array.isArray(input.notes) || input.notes.length>8 || (input.action==='accept')!==(input.notes.length===0)) {
      throw new KTeamError('artifact_review_invalid');
    }
    const action = input.action as ArtifactReviewDecision['action'];
    const notes = input.notes.map(raw=>{
      const note=record(raw);
      fields(note,['start','end','text']);
      const start=Number(note.start), end=Number(note.end);
      if (!Number.isSafeInteger(note.start) || !Number.isSafeInteger(note.end) || start<1 || end<start || end-start>19) {
        throw new KTeamError('artifact_review_line_invalid');
      }
      return {start,end,text:text(note.text,'review_note',400).trim()};
    });
    const membership = await this.conversations.scope(roomId);
    const source = this.source(roomId,toolCallId);
    if (input.expectedSha256!==source.sha256) throw new KTeamError('artifact_review_changed',409);
    assertReviewer(membership,source.botId);
    const intent = digest(JSON.stringify([source.sha256,action,notes]));
    let saved = this.store.operation(source.id) as ReviewRecord | null;
    if (saved) {
      if (saved.intent!==intent) throw new KTeamError('artifact_review_changed',409);
      const decision = this.decision(saved);
      if (decision.status!=='preparing') return {ok:true,decision};
    }
    const version = this.version(source);
    if (notes.some(note=>note.end>version.lines.length)) throw new KTeamError('artifact_review_line_invalid');
    if (!saved) {
      saved = this.store.saveOperation({
        id:source.id,roomId,jobId:source.job.id,pathKey:source.pathKey,sha256:source.sha256,
        action,notes,inputId:'msg_'+digest(source.id).slice(0,32),intent,content:version.content,
      },0) as ReviewRecord;
    }
    if (action==='request_changes') {
      const body = [
        '请核对并处理这批产物审阅意见，保留其余内容，提交新版本供复核。',
        '产物 '+JSON.stringify(version.name)+' · SHA-256 '+source.sha256,
        ...notes.map(note=>[
          '第 '+(note.start===note.end?note.start:note.start+'–'+note.end)+' 行\n'+note.text,
          '选段 SHA-256 '+digest(version.lines.slice(note.start-1,note.end).join('\n')),
        ].join('\n')),
      ].join('\n\n');
      await this.inputs.submit({
        roomId,jobId:source.job.id,id:saved.inputId,text:body,mode:'queue',replyToMessageId:source.resultMessageId,
      },{botId:source.botId,beforeSend:()=>{this.version(source);},assertSnapshot:snapshot=>assertReviewer(snapshot,source.botId)});
    }
    return {ok:true,decision:this.decision(saved)};
  }
}
