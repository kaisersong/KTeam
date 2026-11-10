/** Some macOS IMEs report Enter with isComposing=false but keyCode=229. */
export function nameImeActive(event:{isComposing?:boolean;keyCode?:number},composing:boolean){return composing||event.isComposing===true||event.keyCode===229;}
export function validProfileName(value:string){return !!value.trim()&&Array.from(value.trim()).length<=40&&!/[\x00-\x1f\x7f]/.test(value);}
