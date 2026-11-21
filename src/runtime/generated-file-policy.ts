import {extname} from 'node:path';
const reviewExtensions=new Set(['.md','.txt','.csv','.json','.log','.diff','.patch','.ts','.tsx','.js','.jsx','.py','.rs','.go','.swift','.css','.sql']);
export const artifactReviewExtension=(path:string)=>reviewExtensions.has(extname(path).toLowerCase());
const extensions=new Set(['.html','.md','.txt','.csv','.json','.log','.pdf','.docx','.pptx','.xlsx','.png','.jpg','.jpeg','.gif','.webp']);
export const generatedFileExtension=(path:string)=>artifactReviewExtension(path)||extensions.has(extname(path).toLowerCase());
