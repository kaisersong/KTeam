/** Only explicit provider rejection responses may make a submitted request safely retryable. */
export class MailSubmissionRejected extends Error {
 constructor(code:'mail_send_reauthorize'|'mail_send_rejected'){super(code);}
}
/** Raised only before this invocation can enter a provider send; not a guess about an older request. */
export class MailNotSubmitted extends Error {}
