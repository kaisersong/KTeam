import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyReports} from './test-report.mjs';
const directory=process.argv[2];if(!directory)throw Error('test_report_directory_required');
const reports=readdirSync(directory).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(join(directory,name),'utf8')));
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
console.log(JSON.stringify(verifyReports(reports,revision),null,2));
