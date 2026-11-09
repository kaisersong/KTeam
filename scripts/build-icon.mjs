// The supplied native icon already has optically adjusted sizes. Preserve its bytes.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const provenance=JSON.parse(readFileSync('desktop/assets/brand/provenance.json','utf8'));
for(const [path,asset] of Object.entries(provenance.files)){
 const actual=createHash('sha256').update(readFileSync(path)).digest('hex');
 if(actual!==asset.sha256)throw Error(`Design asset changed: ${path}`);
}
console.log(`Verified ${Object.keys(provenance.files).length} original KTeam design assets (${provenance.archiveSha256}).`);
