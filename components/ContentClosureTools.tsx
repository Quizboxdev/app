"use client";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import { COVERAGE_TARGETS } from "@/lib/content/factory/contract";
export function CoverageTargetEditor({onSaved}:{onSaved:()=>Promise<void>}) {
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setMessage("");
    try {
      const f=new FormData(event.currentTarget),mix=JSON.parse(String(f.get("mix")));
      const result=await getSupabaseBrowserClient().rpc("qb_save_coverage_target",{p_curriculum_id:f.get("curriculum"),p_grade:f.get("grade"),p_subject:f.get("subject"),p_minimum:Number(f.get("minimum")),p_easy:Number(f.get("easy")),p_medium:Number(f.get("medium")),p_hard:Number(f.get("hard")),p_type_mix:mix});
      if(result.error)throw result.error;setMessage("Target saved.");await onSaved();
    } catch(e){setMessage(userFacingError(e));}finally{setBusy(false);}
  }
  return <details className="qb-content-review"><summary>Coverage Targets</summary><form onSubmit={save} className="qb-content-filters">
    <label>Curriculum ID<input name="curriculum" required/></label><label>Grade<input name="grade" defaultValue=""/></label><label>Subject<input name="subject" defaultValue=""/></label>
    {(["minimum","easy","medium","hard"] as const).map((key)=><label key={key}>{key}<input type="number" name={key} min={key==="minimum"?1:0} max={100} defaultValue={COVERAGE_TARGETS[key]} required/></label>)}
    <label>Question-type targets<textarea name="mix" defaultValue={'{"SINGLE_CHOICE":8,"TRUE_FALSE":2}'} required/></label>
    <button disabled={busy} type="submit">Save Target</button>
  </form><p role="status">{message}</p></details>;
}
export function QuestionMediaUpload({question,onSaved}:{question:any;onSaved:()=>Promise<void>}) {
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function upload(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setMessage("");
    try {
      const form=new FormData(event.currentTarget);form.set("question_id",question.id);form.set("version",String(question.version));
      const session=await getSupabaseBrowserClient().auth.getSession();
      if(!session.data.session)throw new Error("AUTH_REQUIRED");
      const result=await fetch("/api/content/media",{method:"POST",headers:{Authorization:"Bearer "+session.data.session.access_token},body:form});
      if(!result.ok)throw new Error("QB_INVALID_MEDIA");
      setMessage("Diagram attached. Human re-review is required.");await onSaved();
    }catch(e){setMessage(userFacingError(e));}finally{setBusy(false);}
  }
  return <details><summary>Question Diagram</summary><form className="qb-content-filters" onSubmit={upload}><label>Image<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required/></label><label>Alternative text<input name="alt" maxLength={300} required/></label><label>Change note<input name="note" minLength={3} maxLength={1000} required/></label><button type="submit" disabled={busy}>Attach Diagram</button></form><p role="status">{message}</p></details>;
}
