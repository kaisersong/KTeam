import{Command}from'commander';
const program=new Command().name('fixture').version('native-fixture-1.0');program.command('chat',{isDefault:true}).action(()=>{throw Error('version was misrouted into chat');});await program.parseAsync();
