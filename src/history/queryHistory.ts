
export interface HistoryEntry { sql: string; ts: number; source: string; pinned?: boolean; ok?: boolean; }
export class QueryHistory {
  private items: HistoryEntry[] = [];
  constructor(private max = 50, initial: HistoryEntry[] = []) { this.items = initial.slice(0, max); }
  add(e: HistoryEntry) { this.items.unshift(e); const pinned=this.items.filter(i=>i.pinned); const rest=this.items.filter(i=>!i.pinned); this.items=[...pinned, ...rest].slice(0, Math.max(this.max, pinned.length)); /* keep order roughly recency within groups simplified: */ this.items.sort((a,b)=>b.ts-a.ts); if(this.items.length>this.max){ const p=this.items.filter(i=>i.pinned); const u=this.items.filter(i=>!i.pinned).slice(0,Math.max(0,this.max-p.length)); this.items=[...p,...u].sort((a,b)=>b.ts-a.ts);} }
  list(){ return [...this.items]; }
  clearUnpinned(){ this.items=this.items.filter(i=>i.pinned); }
  pin(index:number){ if(this.items[index]) this.items[index].pinned=!this.items[index].pinned; }
  toJSON(){ return this.items; }
}
