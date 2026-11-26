import {lstatSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {inspectOperation} from '../protocol/operation-inspection.js';
import {canonicalFile,insideDirectory} from '../service/directory-access.js';
import {captureGeneratedFile,generatedFileExtension} from './generated-files.js';

type FileOutput={path:string;before:string|null};

export async function observeTerminalFileOutputs(
 args:Record<string,unknown>,cwd:string,scope:{root:string;roomId:string},canRead:(path:string)=>Promise<boolean>,
):Promise<FileOutput[]>{
 const outputs=new Set(inspectOperation('bash',args,cwd).facts
  .filter(fact=>fact.kind==='overwrite').map(fact=>fact.target));
 const observed:FileOutput[]=[];
 // Command inspection only suggests candidates. Access and changed bytes must be checked independently.
 for(const path of [...outputs].slice(0,8)){
  if(!isAbsolute(path)||/[\x00\r\n$*?{}`]/.test(path)||!insideDirectory(cwd,path)||!generatedFileExtension(path)||
   canonicalFile(path)!==path||insideDirectory(scope.root,path)||!await canRead(path))continue;
  try{lstatSync(path);}catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT')observed.push({path,before:null});
   continue;
  }
  try{observed.push({path,before:captureGeneratedFile(path,scope.root,scope.roomId).sha256});}
  catch{/* An uninspectable file cannot establish a baseline. */}
 }
 return observed;
}

export async function changedTerminalFileOutputs(
 outputs:FileOutput[],scope:{root:string;roomId:string},canRead:(path:string)=>Promise<boolean>,
){
 const changed=[];
 for(const {path,before} of outputs){
  if(!await canRead(path))continue;
  try{
   const file=captureGeneratedFile(path,scope.root,scope.roomId);
   if(file.sha256!==before)changed.push(file);
  }catch{/* The output may have been removed or may no longer be a verified regular file. */}
 }
 return changed;
}
