const mutations=new Set(['write','edit','install_skill','uninstall_skill','render_ui','send_mail','send_connected_mail','notebook_write','lsp','subagent','spawn_agent','send_message','followup_task','wait_agent','list_agents','interrupt_agent','close_agent']);
export const discussionToolAllowed=(name:string)=>!mutations.has(name)&&!name.startsWith('mcp__');
