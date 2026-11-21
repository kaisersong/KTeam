import type {ArtifactReviewNote} from '../../../src/protocol/artifact-review';

export type Range = Pick<ArtifactReviewNote,'start'|'end'>;
export interface ReviewDraft {
  text: string;
  notes: ArtifactReviewNote[];
  range?: Range;
  line?: number;
}

const storageKey='kteam.artifactReviewDrafts.v1';
const validRange=(value:any,maxLine:number):value is Range=>
  Number.isSafeInteger(value?.start)&&Number.isSafeInteger(value?.end)&&value.start>0
  &&value.end>=value.start&&value.end<=maxLine;

function drafts():Record<string,ReviewDraft>{
  try{
    const value=JSON.parse(localStorage.getItem(storageKey)??'{}');
    if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  }catch{}
  return {};
}

export function readReviewDraft(key:string,maxLine:number):ReviewDraft{
  const value=drafts()[key];
  return {
    range:validRange(value?.range,maxLine)?value.range:undefined,
    text:typeof value?.text==='string'?value.text.slice(0,400):'',
    notes:Array.isArray(value?.notes)?value.notes.filter(note=>
      validRange(note,maxLine)&&note.end-note.start<20
      &&typeof note.text==='string'&&note.text.trim().length>0&&note.text.length<=400,
    ).slice(0,8):[],
    line:Number.isSafeInteger(value?.line)&&value.line!>0&&value.line!<=maxLine?value.line:undefined,
  };
}

export function saveReviewDraft(key:string,value:ReviewDraft){
  try{
    const all=drafts();
    delete all[key];
    if(value.text||value.notes.length||value.range||value.line)all[key]=value;
    localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(Object.entries(all).slice(-30))));
  }catch{}
}
