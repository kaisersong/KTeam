type Parse = (command:string) => {valid:boolean; segments:string[]};

const pathWord=String.raw`(?:/[\w./-]+|"(?:\$[a-zA-Z_]\w*/)?[^"\\$\x60\r\n;|&<>*?\[\]]+")`;
const write=new RegExp(String.raw`^(?:cat(?:\s+${pathWord})*|sed\s+-n\s+'\d+(?:,\d+)?p'\s+${pathWord})\s*>\s*${pathWord}$`);
const cleanup=new RegExp(String.raw`^rm\s+-f(?:\s+${pathWord})+$`);
const verify=new RegExp([
  String.raw`^wc(?:\s+-[lwc]+)+\s+${pathWord}$`,
  String.raw`^grep\s+-n\s+"\^#{1,6} "\s+${pathWord}$`,
  String.raw`^echo\s+"[^"\\$\x60\r\n;|&<>]*"$`,
].join('|'));
const assignment=/^[a-z][a-z0-9_]*=\/[\w./-]+$/;
const heredoc=new RegExp(String.raw`^(cat\s*>\s*${pathWord})\s*<<\s*'([A-Za-z_]\w*)'\s*$`);

/**
 * Recognize a bounded document workflow for one-time review. Opaque syntax and
 * inspection followed by deletion continue through the existing inspection gate.
 * Returned segments are for display only, never for executing the command.
 */
export function postWriteVerification(command:string,parse:Parse):string[]|undefined{
  if(command.length>65536||command.includes('\r'))return;
  const lines=command.split('\n');
  const statements:string[]=[];
  for(let index=0;index<lines.length;index++){
    const line=lines[index]!.trim();
    const match=heredoc.exec(line);
    if(!match){statements.push(lines[index]!);continue;}
    const end=lines.indexOf(match[2]!,index+1);
    if(end<0)return;
    statements.push(match[1]!);
    index=end;
  }
  const source=statements.join('\n');
  if(/[\\`]|\$\(/.test(source))return;
  const parsed=parse(source);
  if(!parsed.valid||parsed.segments.length>32)return;
  // The parser also flattens pipelines and conditionals. The recognized workflow
  // contains only sequential commands, with separators outside literal bodies.
  if(/[|&]/.test(source))return;
  let wrote=false,removed=false,checked=false;
  for(const segment of parsed.segments){
    if(!removed&&assignment.test(segment))continue;
    if(!removed&&write.test(segment)){wrote=true;continue;}
    if(wrote&&!removed&&cleanup.test(segment)){removed=true;continue;}
    if(removed&&verify.test(segment)){checked=true;continue;}
    return;
  }
  if(wrote&&removed&&checked)return parsed.segments;
}
