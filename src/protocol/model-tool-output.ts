/** Provider control tokens are not a successful human reply or an executed tool. */
export function unexecutedModelToolOutput(text:string):boolean {
 return /<(?:(?:｜｜|\|\|)DSML(?:｜｜|\|\|)\s+(?:calls|invoke|parameter)|\/?tool_call(?:s)?\b)/iu.test(text);
}
