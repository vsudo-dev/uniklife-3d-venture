"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {api} from "@/lib/client/api";
import {Button,Card,CardHeader} from "@/components/ui";
export function PlotMortgageForm({plotId,version,mortgaged,reference}:{plotId:string;version:number;mortgaged:boolean;reference:string}) {
 const router=useRouter();const [active,setActive]=useState(mortgaged);const [ref,setRef]=useState(reference);const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 return <Card><CardHeader title="Mortgage / loan block" subtitle="A mortgage plot cannot be booked. Enter a document or loan reference here."/><form className="space-y-3 p-5" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage("");try{await api(`/api/plots/${plotId}/mortgage`,{method:"PUT",body:{version,isMortgaged:active,reference:ref,reason}});setMessage("Saved. A released plot stays blocked until you review its price and unblock it.");router.refresh();}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}}>
 <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Mortgage active — keep blocked</label>
 <label className="block text-sm">Mortgage key / document reference<input className="input mt-1" maxLength={300} value={ref} onChange={e=>setRef(e.target.value)} required={mortgaged&&!active}/></label>
 <p className="text-xs text-muted">Use a reference label, not a password. To release, clear the checkbox and enter the release document reference and reason.</p>
 <label className="block text-sm">Reason<textarea className="input mt-1" required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <Button type="submit" disabled={busy}>Save mortgage details</Button>{message&&<p role="status" className="text-sm">{message}</p>}
 </form></Card>;
}
