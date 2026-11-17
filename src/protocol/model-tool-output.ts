/** Provider control tokens are not a successful human reply or an executed tool. */
export function unexecutedModelToolOutput(text:string):boolean {
 return /^\s*<｜｜DSML｜｜\s+calls>\s*<｜｜DSML｜｜\s+invoke\b/u.test(text);
}
