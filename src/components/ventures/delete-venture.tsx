"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {api} from "@/lib/client/api";
import {Button} from "@/components/ui";
export function DeleteVenture({id,name}:{id:string;name:string}){const router=useRouter();const[busy,setBusy]=useState(false),[message,setMessage]=useState("");return <div><Button variant="danger" disabled={busy} onClick={async()=>{if(!confirm(`Delete ${name}? It will be removed from ventures and plot inventory. Booking/payment history is preserved. No approval request is required.`))return;setBusy(true);try{await api(`/api/ventures/${id}`,{method:"DELETE"});router.push("/ventures");router.refresh();}catch(e){setMessage((e as Error).message);setBusy(false);}}}>{busy?"Deleting…":"Delete venture"}</Button>{message&&<p role="alert" className="mt-2 text-sm text-danger">{message}</p>}</div>}
