/** Keep a bounded UTF-16 prefix without cutting a Unicode surrogate pair. */
export function textPrefix(value:string,limit:number){const prefix=value.slice(0,Math.max(0,limit));return /[\uD800-\uDBFF]$/.test(prefix)?prefix.slice(0,-1):prefix;}
