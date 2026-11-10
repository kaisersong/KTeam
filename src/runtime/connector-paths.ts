import {join} from 'node:path';
import {homedir} from 'node:os';
export function getConfigDir(subdir?:string){const root=process.env.KTEAM_MODEL_CONFIG_DIR??join(process.env.KTEAM_DATA_DIR??join(homedir(),'.kteam'),'runtime');return subdir?join(root,subdir):root;}
