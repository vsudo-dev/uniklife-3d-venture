import { z } from "zod";
export const incentiveSchema=z.object({
 audience:z.enum(["employee","agent"]),monthlyTarget:z.number().int().min(0).max(10000),
 basis:z.enum(["percentage","fixed_amount"]),payoutScope:z.enum(["all_after_target","excess_only"]),
 levels:z.array(z.object({level:z.number().int().min(1).max(8),label:z.string().trim().min(1).max(80),rate:z.number().min(0).max(1000000)})).length(8),
 slabs:z.array(z.object({from:z.number().int().min(1),to:z.number().int().min(1).nullable(),rate:z.number().min(0).max(1000000)})).max(20),
}).superRefine((d,ctx)=>{
 if(new Set(d.levels.map(l=>l.level)).size!==8)ctx.addIssue({code:"custom",message:"Each of the eight levels must occur exactly once.",path:["levels"]});
 if(d.basis==="percentage"&&[...d.levels,...d.slabs].some(l=>l.rate>100))ctx.addIssue({code:"custom",message:"Percentage rates cannot exceed 100.",path:["levels"]});
 const ordered=[...d.slabs].sort((a,b)=>a.from-b.from);
 for(let i=0;i<ordered.length;i++){const s=ordered[i],prev=ordered[i-1];if((s.to!==null&&s.to<s.from)||(prev&&(prev.to===null||s.from<=prev.to)))ctx.addIssue({code:"custom",message:"Slab ranges must be disjoint and end at or after their start.",path:["slabs"]});}
});
export type IncentivePolicy=z.infer<typeof incentiveSchema>;
export function defaultIncentive(audience:"employee"|"agent"):IncentivePolicy{return {audience,monthlyTarget:audience==="employee"?1:0,basis:"percentage",payoutScope:"all_after_target",levels:Array.from({length:8},(_,i)=>({level:i+1,label:`Level ${i+1}`,rate:audience==="employee"?2:0})),slabs:[]};}
/** INR paise, one person's own monthly sales. Never distributes eight copies to uplines. */
export function calculateIncentive(policy:IncentivePolicy,level:number,sales:Array<{netPaise:number}>){
 const p=incentiveSchema.parse(policy);
 if(!sales.every(s=>Number.isSafeInteger(s.netPaise)&&s.netPaise>=0))throw new Error("Sale amounts must be non-negative integer paise.");
 if(!Number.isInteger(level)||level<1||level>8)throw new Error("Choose an employee/agent level from 1 to 8.");
 if(sales.length<=p.monthlyTarget)return {count:sales.length,eligibleCount:0,eligiblePaise:0,payoutPaise:0,rate:0};
 const eligible=p.payoutScope==="all_after_target"?sales:sales.slice(p.monthlyTarget);
 const total=eligible.reduce((n,s)=>n+s.netPaise,0);if(!Number.isSafeInteger(total))throw new Error("Sale total exceeds supported precision.");
 const slab=p.slabs.find(s=>sales.length>=s.from&&(s.to===null||sales.length<=s.to));
 const rate=slab?.rate??p.levels.find(l=>l.level===level)!.rate;
 const payoutPaise=p.basis==="percentage"?Math.round(total*rate/100):Math.round(rate*100)*eligible.length;
 if(!Number.isSafeInteger(payoutPaise))throw new Error("Payout exceeds supported precision.");
 return {count:sales.length,eligibleCount:eligible.length,eligiblePaise:total,payoutPaise,rate};
}
