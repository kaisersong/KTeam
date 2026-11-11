import {extname} from 'node:path';
const extensions=new Set(['.html','.md','.txt','.csv','.json','.log','.pdf','.docx','.pptx','.xlsx','.png','.jpg','.jpeg','.gif','.webp']);
export const generatedFileExtension=(path:string)=>extensions.has(extname(path).toLowerCase());
