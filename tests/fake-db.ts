/* Minimal in-memory stand-in for the Supabase query builder, enough to exercise the engine. */
import { randomUUID } from "node:crypto";

type Row = Record<string, any>;
const PK: Record<string, string[]> = {
  story_bibles: ["project_id"], learner_concepts: ["user_id", "concept_id"], quizzes: ["chapter_id"],
};

export class FakeDb {
  t: Record<string, Row[]> = {};
  rows(n: string) { return (this.t[n] ??= []); }
  from(n: string) { return new Q(this, n); }
  async rpc() { return { data: { ok: true } }; }
}

class Q implements PromiseLike<any> {
  op = "select"; payload: any; opts: any = {}; filters: ((r: Row) => boolean)[] = [];
  orderBy?: string; lim?: number; mode: "many" | "single" | "maybe" = "many"; returning = false;
  constructor(private db: FakeDb, private n: string) {}
  select(_c?: string, o?: any) { if (this.op === "select") this.opts = o ?? {}; else this.returning = true; return this; }
  insert(v: any) { this.op = "insert"; this.payload = v; return this; }
  update(v: any) { this.op = "update"; this.payload = v; return this; }
  upsert(v: any, o?: any) { this.op = "upsert"; this.payload = v; this.opts = o ?? {}; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
  neq(k: string, v: any) { this.filters.push((r) => r[k] !== v); return this; }
  in(k: string, v: any[]) { this.filters.push((r) => v.includes(r[k])); return this; }
  not(k: string, _o: string, v: any) { this.filters.push((r) => r[k] !== v); return this; }
  lt(k: string, v: any) { this.filters.push((r) => r[k] < v); return this; }
  order(k: string) { this.orderBy = k; return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  private match() { return this.db.rows(this.n).filter((r) => this.filters.every((f) => f(r))); }
  private run() {
    const rows = this.db.rows(this.n);
    const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).filter(Boolean);
    let out: Row[] = [];
    if (this.op === "insert") {
      out = list.map((v) => ({ id: randomUUID(), ...v }));
      rows.push(...out);
    } else if (this.op === "upsert") {
      const keys = this.opts.onConflict ? this.opts.onConflict.split(",") : PK[this.n] ?? ["id"];
      for (const v of list) {
        const ex = rows.find((r) => keys.every((k: string) => r[k] === v[k]));
        if (ex) { if (!this.opts.ignoreDuplicates) Object.assign(ex, v); out.push(ex); }
        else { const nr = { id: randomUUID(), ...v }; rows.push(nr); out.push(nr); }
      }
    } else if (this.op === "update") {
      out = this.match(); out.forEach((r) => Object.assign(r, this.payload));
    } else if (this.op === "delete") {
      const m = this.match(); this.db.t[this.n] = rows.filter((r) => !m.includes(r)); out = m;
    } else {
      out = this.match();
      if (this.orderBy) out = [...out].sort((a, b) => (a[this.orderBy!] > b[this.orderBy!] ? 1 : -1));
      if (this.lim) out = out.slice(0, this.lim);
    }
    if (this.opts.head) return { data: null, count: out.length, error: null };
    if (this.mode === "single") return out[0] ? { data: out[0], error: null } : { data: null, error: { message: "no rows" } };
    if (this.mode === "maybe") return { data: out[0] ?? null, error: null };
    return { data: out, error: null, count: out.length };
  }
  then<T1, T2>(a?: any, b?: any): Promise<T1 | T2> { return Promise.resolve(this.run()).then(a, b); }
}
