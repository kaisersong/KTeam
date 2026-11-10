import {inflateSync} from 'node:zlib';
import {KTeamError} from '../errors.js';

const fail=():never=>{throw new KTeamError('invalid_profile_avatar');};
function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
/** Only a small, completely decoded static PNG may become a durable avatar. */
export function validateProfileAvatar(value:unknown):string{
 if(value==='')return '';
 if(typeof value!=='string'||value.length>131100||!value.startsWith('data:image/png;base64,'))return fail();
 const encoded=value.slice(22),png=Buffer.from(encoded,'base64');
 if(png.length>96*1024||png.toString('base64')!==encoded||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return fail();
 let offset=8,width=0,height=0,channels=0,ended=false;const data:Buffer[]=[];
 while(offset<png.length){
  if(offset+12>png.length)return fail();const length=png.readUInt32BE(offset),end=offset+12+length;if(end>png.length)return fail();
  const type=png.toString('ascii',offset+4,offset+8),chunk=png.subarray(offset+8,end-4);
  if(!/^[A-Za-z]{4}$/.test(type)||crc32(png.subarray(offset+4,end-4))!==png.readUInt32BE(end-4))return fail();
  if(offset===8&&type!=='IHDR')return fail();
  if(type==='IHDR'){
   if(width||length!==13)return fail();width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);channels=chunk[9]===6?4:chunk[9]===2?3:0;
   if(width<1||height<1||width>128||height>128||!channels||chunk[8]!==8||chunk[10]!==0||chunk[11]!==0||chunk[12]!==0)return fail();
  }else if(type==='IDAT'){if(!width)return fail();data.push(chunk);}
  else if(type==='IEND'){if(length||!data.length||end!==png.length)return fail();ended=true;}
  else if(type[0]===type[0]!.toUpperCase()||['acTL','fcTL','fdAT'].includes(type))return fail();
  offset=end;
 }
 if(!ended)return fail();
 try{const stride=width*channels+1,decoded=inflateSync(Buffer.concat(data),{maxOutputLength:stride*height});if(decoded.length!==stride*height)return fail();for(let row=0;row<height;row++)if(decoded[row*stride]!>4)return fail();}catch{return fail();}
 return value;
}
